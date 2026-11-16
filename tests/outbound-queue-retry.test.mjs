import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-outbound-queue-retry-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

async function bundle(entry, outfile) {
	await build({
		entryPoints: [join(root, entry)],
		outfile: join(outDir, outfile),
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node22",
		logLevel: "silent",
		alias: { "@": join(root, "src") },
		nodePaths: [join(root, "node_modules")],
		external: ["better-sqlite3"],
	});
	return import(pathToFileURL(join(outDir, outfile)).href);
}

const mailhub = await bundle("src/lib/mailhub/index.ts", "mailhub.mjs");
const sendMod = await bundle("src/lib/email/send.ts", "send.mjs");
const htMod = await bundle("src/lib/mailhub/high-throughput/queue-producer.ts", "ht.mjs");
const workerUtilsMod = await bundle("worker-utils.ts", "worker-utils.mjs");
const sqliteMod = await bundle("server/runtime/sqlite-database.ts", "sqlite-db.mjs");
const migrateMod = await bundle("server/runtime/migrate.ts", "migrate.mjs");

const { sendWithFailover, CircuitBreaker, LocalCircuitBreakerStore, LocalDlqStore } = mailhub;
const { sendEmail, processOutboundQueue } = sendMod;
const { getHighThroughputQueue } = htMod;
const { isOutboundEmailMessage, isQueuedEmailJob } = workerUtilsMod;
const { SqliteDatabase } = sqliteMod;
const { applyMigrations } = migrateMod;

async function setupDb() {
	const db = new SqliteDatabase(":memory:");
	await applyMigrations(db, join(root, "drizzle", "migrations"));
	const now = Math.floor(Date.now() / 1000);
	db.db.exec(`
		INSERT INTO users (id, email, name, password_hash, role, created_at)
		VALUES ('u_1', 'admin@example.com', 'Admin', 'hash', 'admin', ${now});
		INSERT INTO domains (id, user_id, hostname, zone_id, status, sending_provider, sending_enabled, created_at)
		VALUES ('d_1', 'u_1', 'example.com', 'zone_1', 'active', 'resend', 1, ${now});
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, display_name, type, use_all_domains, disabled, created_at)
		VALUES ('mbx_1', 'u_1', 'd_1', 'noreply', 'NoReply', 'personal', 1, 0, ${now});
	`);
	return db;
}

test("sendWithFailover holds ~1 second before failing over after transient error", async (t) => {
	LocalCircuitBreakerStore.getInstance().clear();
	LocalDlqStore.getInstance().clear();
	const env = { KV: undefined };
	const cb = new CircuitBreaker();

	const timestamps = [];
	const origFetch = globalThis.fetch;
	t.after(() => { globalThis.fetch = origFetch; });
	globalThis.fetch = async (url) => {
		timestamps.push(Date.now());
		if (String(url).includes("resend.com")) {
			return new Response("Temporary outage", { status: 503 });
		}
		return new Response(JSON.stringify({ messageId: "<brevo-ok@brevo.com>" }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};

	const candidates = [
		{
			providerCredId: "c1",
			provider: "resend",
			dailySlice: 100,
			priority: 1,
			score: 900,
			eligible: true,
			breakdown: {},
			credential: { apiKey: "k_resend" },
		},
		{
			providerCredId: "c2",
			provider: "brevo",
			dailySlice: 100,
			priority: 2,
			score: 800,
			eligible: true,
			breakdown: {},
			credential: { apiKey: "k_brevo" },
		},
	];

	const res = await sendWithFailover({
		projectId: "proj_hold",
		message: { from: "noreply@example.com", to: ["user@target.com"], subject: "Hold test", text: "hi" },
		candidates,
		circuitBreaker: cb,
		env,
	});

	assert.equal(res.success, true);
	assert.equal(res.provider, "brevo");
	assert.equal(timestamps.length, 2);
	const elapsed = timestamps[1] - timestamps[0];
	assert.ok(elapsed >= 900, `Expected ~1000ms hold between attempts, got ${elapsed}ms`);
});

test("sendEmail holds ~1s and succeeds on inline transient retry", async (t) => {
	const db = await setupDb();
	t.after(() => db.db.close());

	const origFetch = globalThis.fetch;
	t.after(() => { globalThis.fetch = origFetch; });

	const callTimes = [];
	globalThis.fetch = async (url) => {
		const urlStr = String(url);
		if (!urlStr.includes("resend.com")) {
			return new Response("Not found", { status: 404 });
		}
		callTimes.push({ t: Date.now(), url: urlStr });
		if (callTimes.length === 1) {
			return new Response("503 Unavailable", { status: 503 });
		}
		return new Response(JSON.stringify({ id: "resend_retry_ok" }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};

	const env = {
		DB: db,
		RESEND_API_KEY: "test_resend_key",
		OUTBOUND_QUEUE: { async send() {} },
	};

	const res = await sendEmail(env, {
		userId: "u_1",
		mailboxId: "mbx_1",
		from: "noreply@example.com",
		to: "dest@other.com",
		subject: "Transient inline retry",
		text: "Hello",
	});

	assert.ok(res.messageId.startsWith("msg_"));
	assert.equal(res.queued, undefined);
	assert.equal(callTimes.length, 2, `Expected 2 fetch calls, got: ${JSON.stringify(callTimes)}`);
	assert.ok(callTimes[1].t - callTimes[0].t >= 900, `Expected ~1s hold before retry, got ${callTimes[1].t - callTimes[0].t}ms (${JSON.stringify(callTimes)})`);

	const row = db.db.prepare("SELECT status FROM messages WHERE id = ?").get(res.messageId);
	assert.equal(row.status, "sent");
});

test("sendEmail enqueues to OUTBOUND_QUEUE after transient failure & processOutboundQueue delivers when recovered", async (t) => {
	const db = await setupDb();
	t.after(() => db.db.close());

	const origFetch = globalThis.fetch;
	t.after(() => { globalThis.fetch = origFetch; });

	let providerHealthy = false;
	globalThis.fetch = async (url) => {
		if (!String(url).includes("resend.com")) {
			return new Response("Not found", { status: 404 });
		}
		if (!providerHealthy) {
			return new Response("Service Unavailable", { status: 503 });
		}
		return new Response(JSON.stringify({ id: "resend_queue_recovered" }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};

	const queuedMessages = [];
	const env = {
		DB: db,
		RESEND_API_KEY: "test_resend_key",
		OUTBOUND_QUEUE: {
			async send(body, options) {
				queuedMessages.push({ body, options });
			},
		},
	};

	const res = await sendEmail(env, {
		userId: "u_1",
		mailboxId: "mbx_1",
		from: "noreply@example.com",
		to: "dest@other.com",
		subject: "Queued retry test",
		text: "Hello",
		retryHoldMs: 50,
	});

	assert.equal(res.queued, true);
	assert.equal(queuedMessages.length, 1);
	assert.equal(queuedMessages[0].body.kind, "email.retry");
	assert.equal(queuedMessages[0].body.attempt, 1);
	assert.equal(queuedMessages[0].options.delaySeconds, 10);

	let row = db.db.prepare("SELECT status FROM messages WHERE id = ?").get(res.messageId);
	assert.equal(row.status, "queued");

	// Provider recovers -> queue consumer processes retry job
	providerHealthy = true;
	await processOutboundQueue(env, queuedMessages[0].body);

	row = db.db.prepare("SELECT status, provider_message_id FROM messages WHERE id = ?").get(res.messageId);
	assert.equal(row.status, "sent");
	assert.ok(row.provider_message_id && row.provider_message_id.includes("@example.com"));
});

test("getHighThroughputQueue falls back to OUTBOUND_QUEUE and worker guards detect job shapes", () => {
	const outboundQueue = { send: async () => {}, sendBatch: async () => {} };
	const q = getHighThroughputQueue({ OUTBOUND_QUEUE: outboundQueue });
	assert.strictEqual(q, outboundQueue);

	assert.equal(isOutboundEmailMessage({ kind: "email.scheduled", jobId: "j1", messageId: "m1", scheduledAt: "2026-01-01" }), true);
	assert.equal(isOutboundEmailMessage({ kind: "email.retry", jobId: "j1", messageId: "m1", attempt: 1 }), true);
	assert.equal(isOutboundEmailMessage({ kind: "webhook.retry", deliveryId: "d1" }), false);

	assert.equal(isQueuedEmailJob({ jobId: "j1", projectId: "p1", payload: { from: "a@b.c", to: ["x@y.z"] } }), true);
	assert.equal(isQueuedEmailJob({ kind: "email.retry", jobId: "j1" }), false);
});
