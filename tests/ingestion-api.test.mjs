import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-ingestion-"));
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

const normalizerModule = await bundle("src/lib/ingestion/normalizer.ts", "normalizer.mjs");
const validatorsModule = await bundle("src/lib/ingestion/validators.ts", "validators.mjs");
const authModule = await bundle("src/lib/ingestion/auth.ts", "auth.mjs");
const serviceModule = await bundle("src/lib/ingestion/service.ts", "service.mjs");
const sqliteModule = await bundle("server/runtime/sqlite-database.ts", "sqlite-db.mjs");
const migrateModule = await bundle("server/runtime/migrate.ts", "migrate.mjs");
const keysModule = await bundle("src/lib/router/keys.ts", "keys.mjs");

const { SqliteDatabase } = sqliteModule;
const { applyMigrations } = migrateModule;
const { hashRoutingKey } = keysModule;

const {
	normalizePayload,
	normalizeRecipientList,
	normalizeSender,
	normalizeAttachment,
	normalizeAttachmentContent,
} = normalizerModule;

const {
	singleEmailSchema,
	batchEmailSchema,
	formatZodError,
} = validatorsModule;

const {
	extractIngestionApiKey,
} = authModule;

const {
	handleRecipientSplitting,
	sendSingleNormalizedMessage,
	processIngestionRequest,
} = serviceModule;

test("WP-07: Ingestion API Key Extraction from Multiple SDK Header Styles", () => {
	// 1. Resend SDK: Authorization: Bearer om_live_...
	const resendReq = new Request("https://mailhub.local/v1/emails", {
		headers: { Authorization: "Bearer om_live_aurelia_1234567890abcdef" },
	});
	assert.strictEqual(
		extractIngestionApiKey(resendReq),
		"om_live_aurelia_1234567890abcdef",
		"Should extract Bearer token from Authorization header",
	);

	// 2. Brevo SDK: api-key: om_live_...
	const brevoReq = new Request("https://mailhub.local/v3/smtp/email", {
		headers: { "api-key": "om_live_lifesolver_abcdef1234567890" },
	});
	assert.strictEqual(
		extractIngestionApiKey(brevoReq),
		"om_live_lifesolver_abcdef1234567890",
		"Should extract key from 'api-key' header",
	);

	// 3. AWS / Standard REST: x-api-key: ...
	const xReq = new Request("https://mailhub.local/v1/send", {
		headers: { "x-api-key": "om_live_luvio_9988776655443322" },
	});
	assert.strictEqual(
		extractIngestionApiKey(xReq),
		"om_live_luvio_9988776655443322",
		"Should extract key from 'x-api-key' header",
	);

	// 4. Basic Auth
	const basicToken = Buffer.from("api:om_live_basic_key_123").toString("base64");
	const basicReq = new Request("https://mailhub.local/v1/send", {
		headers: { Authorization: `Basic ${basicToken}` },
	});
	assert.strictEqual(
		extractIngestionApiKey(basicReq),
		"om_live_basic_key_123",
		"Should extract password from Basic auth",
	);

	// 5. Query parameter fallback
	const queryReq = new Request("https://mailhub.local/v1/send?api_key=om_live_query_token_456");
	assert.strictEqual(
		extractIngestionApiKey(queryReq),
		"om_live_query_token_456",
		"Should extract key from query parameter",
	);
});

test("WP-07: Resend Format Payload Normalization", () => {
	const rawResendPayload = {
		from: "Aurelia App <onboarding@aurelia.com>",
		to: ["alice@example.com", "bob@example.com"],
		subject: "Welcome to Aurelia",
		html: "<strong>Welcome Alice & Bob!</strong>",
		text: "Welcome Alice & Bob!",
		cc: ["manager@example.com"],
		bcc: "audit@aurelia.com",
		reply_to: "support@aurelia.com",
		tags: [
			{ name: "category", value: "onboarding" },
			{ name: "cohort", value: "2026-Q4" },
		],
		headers: {
			"X-Entity-Ref-ID": "aur_9921",
		},
		attachments: [
			{
				filename: "guide.pdf",
				content: Buffer.from("PDF_MOCK_DATA").toString("base64"),
				content_type: "application/pdf",
			},
		],
	};

	const parsed = singleEmailSchema.safeParse(rawResendPayload);
	assert.ok(parsed.success, "Resend payload should pass Zod validation");

	const normalized = normalizePayload(rawResendPayload);
	assert.strictEqual(normalized.from, "Aurelia App <onboarding@aurelia.com>");
	assert.deepStrictEqual(normalized.to, ["alice@example.com", "bob@example.com"]);
	assert.deepStrictEqual(normalized.cc, ["manager@example.com"]);
	assert.deepStrictEqual(normalized.bcc, ["audit@aurelia.com"]);
	assert.strictEqual(normalized.subject, "Welcome to Aurelia");
	assert.strictEqual(normalized.html, "<strong>Welcome Alice & Bob!</strong>");
	assert.strictEqual(normalized.replyTo, "support@aurelia.com");
	assert.strictEqual(normalized.headers["Reply-To"], "support@aurelia.com");
	assert.strictEqual(normalized.headers["X-Entity-Ref-ID"], "aur_9921");
	assert.strictEqual(normalized.headers["X-MailHub-Tag-category"], "onboarding");
	assert.strictEqual(normalized.headers["X-MailHub-Tag-cohort"], "2026-Q4");
	assert.strictEqual(normalized.attachments.length, 1);
	assert.strictEqual(normalized.attachments[0].filename, "guide.pdf");
	assert.strictEqual(normalized.attachments[0].type, "application/pdf");
	assert.ok(normalized.attachments[0].content instanceof ArrayBuffer);
});

test("WP-07: Brevo Format Payload Normalization", () => {
	const rawBrevoPayload = {
		sender: { name: "LifeSolver", email: "help@lifesolver.com" },
		to: [
			{ name: "Jane Doe", email: "jane@example.com" },
			{ email: "john@example.com" },
		],
		subject: "Your Daily LifeSolver Digest",
		htmlContent: "<p>Here is your digest for today.</p>",
		textContent: "Here is your digest for today.",
		replyTo: { name: "Support", email: "replies@lifesolver.com" },
		attachment: [
			{
				name: "report.csv",
				content: Buffer.from("id,score\n1,100").toString("base64"),
			},
		],
		headers: {
			"X-LifeSolver-ID": "ls_771",
		},
	};

	const parsed = singleEmailSchema.safeParse(rawBrevoPayload);
	assert.ok(parsed.success, "Brevo payload should pass Zod validation");

	const normalized = normalizePayload(rawBrevoPayload);
	assert.strictEqual(normalized.from, '"LifeSolver" <help@lifesolver.com>');
	assert.deepStrictEqual(normalized.to, ['"Jane Doe" <jane@example.com>', "john@example.com"]);
	assert.strictEqual(normalized.subject, "Your Daily LifeSolver Digest");
	assert.strictEqual(normalized.html, "<p>Here is your digest for today.</p>");
	assert.strictEqual(normalized.text, "Here is your digest for today.");
	assert.strictEqual(normalized.replyTo, '"Support" <replies@lifesolver.com>');
	assert.strictEqual(normalized.attachments.length, 1);
	assert.strictEqual(normalized.attachments[0].filename, "report.csv");
});

test("WP-07: Standard RFC 5322 Header Format Normalization", () => {
	const rawRfcPayload = {
		From: "Luvio Team <noreply@luvio.io>",
		To: "customer@example.com",
		Subject: "Order Confirmation #5541",
		Cc: "archive@luvio.io",
		"Reply-To": "orders@luvio.io",
		"In-Reply-To": "<msg_previous_123@luvio.io>",
		References: ["<msg_previous_123@luvio.io>", "<msg_initial_001@luvio.io>"],
		html: "<p>Thank you for your order!</p>",
	};

	const parsed = singleEmailSchema.safeParse(rawRfcPayload);
	assert.ok(parsed.success, "RFC 5322 payload should pass Zod validation");

	const normalized = normalizePayload(rawRfcPayload);
	assert.strictEqual(normalized.from, "Luvio Team <noreply@luvio.io>");
	assert.deepStrictEqual(normalized.to, ["customer@example.com"]);
	assert.deepStrictEqual(normalized.cc, ["archive@luvio.io"]);
	assert.strictEqual(normalized.subject, "Order Confirmation #5541");
	assert.strictEqual(normalized.headers["Reply-To"], "orders@luvio.io");
	assert.strictEqual(normalized.inReplyTo, "<msg_previous_123@luvio.io>");
});

test("WP-07: Multi-Recipient Splitting and Chunking Engine", () => {
	// Generate 120 recipients
	const recipients = Array.from({ length: 120 }, (_, i) => `user_${i + 1}@example.com`);

	const largePayload = {
		from: "Aurelia <announcements@aurelia.com>",
		to: recipients,
		subject: "Product Launch Announcement",
		html: "<h1>We are live!</h1>",
		cc: ["boss@aurelia.com"],
		bcc: [],
		attachments: [],
		headers: {},
	};

	// 1. Normal chunking when > 50 recipients
	const chunks = handleRecipientSplitting(largePayload);
	assert.strictEqual(chunks.length, 3, "120 recipients should be split into 3 chunks (50, 50, 20)");
	assert.strictEqual(chunks[0].to.length, 50);
	assert.strictEqual(chunks[1].to.length, 50);
	assert.strictEqual(chunks[2].to.length, 20);

	// Primary chunk retains CC, subsequent chunks do not duplicate CC
	assert.deepStrictEqual(chunks[0].cc, ["boss@aurelia.com"]);
	assert.deepStrictEqual(chunks[1].cc, []);
	assert.deepStrictEqual(chunks[2].cc, []);

	// 2. Individual delivery isolation (split: true)
	const isolatedPayload = {
		...largePayload,
		to: ["alice@example.com", "bob@example.com", "charlie@example.com"],
		splitRecipients: true,
	};
	const isolatedChunks = handleRecipientSplitting(isolatedPayload);
	assert.strictEqual(isolatedChunks.length, 3, "Should split into 3 individual payloads");
	assert.deepStrictEqual(isolatedChunks[0].to, ["alice@example.com"]);
	assert.deepStrictEqual(isolatedChunks[1].to, ["bob@example.com"]);
	assert.deepStrictEqual(isolatedChunks[2].to, ["charlie@example.com"]);
});

test("WP-07: Batch Email Schema Validation", () => {
	const batchPayload = [
		{
			from: "billing@aurelia.com",
			to: ["alice@example.com"],
			subject: "Invoice #101",
			html: "<p>Invoice details...</p>",
		},
		{
			from: "billing@aurelia.com",
			to: ["bob@example.com"],
			subject: "Invoice #102",
			html: "<p>Invoice details...</p>",
		},
	];

	const parsed = batchEmailSchema.safeParse(batchPayload);
	assert.ok(parsed.success, "Batch payload should pass validation");
	assert.strictEqual(parsed.data.length, 2);
});

test("WP-07: Resend-Compatible Zod Error Formatting", () => {
	const invalidPayload = {
		from: "invalid-email",
		// missing 'to' and 'subject'
	};

	const parsed = singleEmailSchema.safeParse(invalidPayload);
	assert.ok(!parsed.success, "Invalid payload must fail validation");

	const resendError = formatZodError(parsed.error);
	assert.strictEqual(resendError.name, "validation_error");
	assert.strictEqual(resendError.statusCode, 422);
	assert.ok(resendError.message.length > 0);
});

test("WP-07: Data URI and Buffer Attachment Handling", () => {
	// Data URI
	const dataUri = "data:text/plain;base64,SGVsbG8gTWFpbEh1YiE=";
	const bufferFromDataUri = normalizeAttachmentContent(dataUri);
	const textFromDataUri = new TextDecoder().decode(bufferFromDataUri);
	assert.strictEqual(textFromDataUri, "Hello MailHub!");

	// Node.js Buffer JSON representation
	const bufferObj = { type: "Buffer", data: [79, 114, 98, 105, 116] };
	const bufferFromObj = normalizeAttachmentContent(bufferObj);
	const textFromObj = new TextDecoder().decode(bufferFromObj);
	assert.strictEqual(textFromObj, "Orbit");
});

function createMockKv(initial = {}) {
	const map = new Map(Object.entries(initial));
	return {
		async get(key, format) {
			const val = map.get(key);
			if (!val) return null;
			if (format === "json") {
				try {
					return JSON.parse(val);
				} catch {
					return val;
				}
			}
			return val;
		},
		async put(key, val) {
			map.set(key, typeof val === "string" ? val : JSON.stringify(val));
		},
		async delete(key) {
			map.delete(key);
		},
		_map: map,
	};
}

async function setupTestDb() {
	const database = new SqliteDatabase(":memory:");
	await applyMigrations(database, join(root, "drizzle/migrations"));

	const now = Math.floor(Date.now() / 1000);

	// Create MailHub router tables if not in migrations
	database.db.exec(`
		CREATE TABLE IF NOT EXISTS provider_credentials (
			id text PRIMARY KEY,
			provider text NOT NULL,
			label text,
			credentials_encrypted text,
			daily_limit integer DEFAULT 0,
			cost_per_k real DEFAULT 0,
			enabled integer DEFAULT 1
		);

		CREATE TABLE IF NOT EXISTS project_provider_allocations (
			project_id text NOT NULL,
			provider_cred_id text NOT NULL,
			daily_slice integer DEFAULT 0,
			priority integer DEFAULT 1,
			PRIMARY KEY (project_id, provider_cred_id)
		);

		CREATE TABLE IF NOT EXISTS project_routing_keys (
			id text PRIMARY KEY,
			project_id text NOT NULL,
			name text,
			prefix text NOT NULL,
			key_hash text NOT NULL,
			environment text NOT NULL,
			status text NOT NULL DEFAULT 'active',
			rate_limit_rps integer,
			last_used_at integer
		);

		INSERT INTO users (id, email, password_hash, name, role, created_at)
		VALUES ('user_aurelia', 'admin@aurelia.com', 'test_hash', 'Aurelia Admin', 'admin', ${now});

		INSERT INTO domains (id, user_id, hostname, zone_id, status, sending_provider, sending_enabled, created_at)
		VALUES ('dom_aurelia', 'user_aurelia', 'aurelia.com', 'zone_test_1', 'active', 'resend', 1, ${now});

		INSERT INTO mailboxes (id, user_id, domain_id, local_part, display_name, type, use_all_domains, disabled, created_at)
		VALUES ('mbx_aurelia', 'user_aurelia', 'dom_aurelia', 'onboarding', 'Aurelia Onboarding', 'personal', 1, 0, ${now});

		INSERT INTO provider_credentials (id, provider, label, credentials_encrypted, daily_limit, cost_per_k, enabled)
		VALUES ('cred_brevo_1', 'brevo', 'Brevo Primary', '{"apiKey":"test_brevo_key"}', 300, 0, 1),
		       ('cred_resend_1', 'resend', 'Resend Secondary', '{"apiKey":"test_resend_key"}', 100, 0, 1);

		INSERT INTO project_provider_allocations (project_id, provider_cred_id, daily_slice, priority)
		VALUES ('proj_aurelia', 'cred_brevo_1', 120, 1),
		       ('proj_aurelia', 'cred_resend_1', 50, 2);
	`);

	return database;
}

test("WP-07 / MailHub: sendSingleNormalizedMessage executes failover, atomic quota & send logging for project key", async (t) => {
	const database = await setupTestDb();
	t.after(() => database.db.close());

	const mockKv = createMockKv();
	const env = {
		DB: database,
		KV: mockKv,
		ROUTER_KV: mockKv,
	};

	const originalFetch = globalThis.fetch;
	t.after(() => { globalThis.fetch = originalFetch; });

	let brevoCalled = false;
	globalThis.fetch = async (url) => {
		const urlStr = String(url);
		if (urlStr.includes("brevo.com")) {
			brevoCalled = true;
			return new Response(JSON.stringify({ messageId: "<brevo-test-msg-001@brevo.com>" }), {
				status: 201,
				headers: { "Content-Type": "application/json" },
			});
		}
		return new Response("Not found", { status: 404 });
	};

	const payload = normalizePayload({
		from: "onboarding@aurelia.com",
		to: "customer@example.com",
		subject: "Welcome to Aurelia App",
		html: "<p>Thank you for signing up!</p>",
		text: "Thank you for signing up!",
	});

	const auth = {
		userId: "proj_aurelia",
		projectId: "proj_aurelia",
		projectSlug: "aurelia",
		environment: "live",
		keyId: "key_1",
		keyKind: "project",
		scopes: ["send", "*"],
		mailboxIds: null,
	};

	const result = await sendSingleNormalizedMessage(env, payload, auth, "https://mailhub.local");

	// 1. Verify response shape
	assert.ok(result.id, "Result should return message ID");
	assert.strictEqual(result.messageId, "<brevo-test-msg-001@brevo.com>");
	assert.strictEqual(brevoCalled, true, "Primary Brevo provider should be called");

	// 2. Verify Sent copy recorded in user's messages table in D1
	const sentMessages = database.db.prepare("SELECT * FROM messages WHERE from_addr = 'onboarding@aurelia.com'").all();
	assert.strictEqual(sentMessages.length, 1, "Should insert 1 sent message into D1 messages table");
	const sentMsg = sentMessages[0];
	assert.strictEqual(sentMsg.status, "sent");
	assert.strictEqual(sentMsg.direction, "outbound");
	assert.strictEqual(sentMsg.user_id, "user_aurelia", "Should assign message to domain owner user");
	assert.strictEqual(sentMsg.mailbox_id, "mbx_aurelia");
	assert.strictEqual(sentMsg.to_addr, "customer@example.com");
	assert.strictEqual(sentMsg.subject, "Welcome to Aurelia App");
	assert.strictEqual(sentMsg.provider_message_id, "<brevo-test-msg-001@brevo.com>");

	// 3. Verify send log recorded in email_router_send_logs table
	const sendLogs = database.db.prepare("SELECT * FROM email_router_send_logs WHERE project_id = 'proj_aurelia'").all();
	assert.strictEqual(sendLogs.length, 1, "Should insert 1 entry into email_router_send_logs");
	const log = sendLogs[0];
	assert.strictEqual(log.provider, "brevo");
	assert.strictEqual(log.status, "sent");
	assert.strictEqual(log.to_address, "customer@example.com");
	assert.strictEqual(log.subject, "Welcome to Aurelia App");
	assert.strictEqual(log.provider_message_id, "<brevo-test-msg-001@brevo.com>");
});

test("WP-07 / MailHub: Quota Exceeded on primary triggers waterfall failover to secondary provider", async (t) => {
	const database = await setupTestDb();
	t.after(() => database.db.close());

	const mockKv = createMockKv();
	const env = {
		DB: database,
		KV: mockKv,
		ROUTER_KV: mockKv,
	};

	const originalFetch = globalThis.fetch;
	t.after(() => { globalThis.fetch = originalFetch; });

	let brevoCalled = false;
	let resendCalled = false;

	globalThis.fetch = async (url) => {
		const urlStr = String(url);
		if (urlStr.includes("brevo.com")) {
			brevoCalled = true;
			return new Response(JSON.stringify({ code: "quota_exceeded", message: "Daily quota limit reached" }), {
				status: 402,
				headers: { "Content-Type": "application/json" },
			});
		}
		if (urlStr.includes("resend.com")) {
			resendCalled = true;
			return new Response(JSON.stringify({ id: "resend_failover_uuid_777" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		return new Response("Not found", { status: 404 });
	};

	const payload = normalizePayload({
		from: "onboarding@aurelia.com",
		to: "subscriber@example.com",
		subject: "Failover Test Notice",
		html: "<p>Testing failover</p>",
	});

	const auth = {
		userId: "proj_aurelia",
		projectId: "proj_aurelia",
		projectSlug: "aurelia",
		environment: "live",
		keyId: "key_1",
		keyKind: "project",
		scopes: ["send", "*"],
		mailboxIds: null,
	};

	const result = await sendSingleNormalizedMessage(env, payload, auth, "https://mailhub.local");

	// Brevo should have failed with QUOTA_EXCEEDED, and Resend should have succeeded
	assert.strictEqual(brevoCalled, true, "Brevo was attempted first");
	assert.strictEqual(resendCalled, true, "Resend was called after Brevo quota exceeded");
	assert.ok(result.id.includes("resend_failover_uuid_777"));

	// Check that Brevo's quota slice is marked exhausted in KV
	const today = new Date().toISOString().slice(0, 10);
	const brevoKvKey = `quota:proj_aurelia:cred_brevo_1:${today}`;
	const brevoKv = await mockKv.get(brevoKvKey, "json");
	assert.ok(brevoKv, "Brevo slice should be recorded in KV");
	assert.strictEqual(brevoKv.exhausted, true, "Brevo slice should be marked exhausted");

	// Check send log recorded with Resend
	const sendLogs = database.db.prepare("SELECT * FROM email_router_send_logs WHERE project_id = 'proj_aurelia' AND provider = 'resend'").all();
	assert.strictEqual(sendLogs.length, 1, "Resend send log should be recorded");
	assert.strictEqual(sendLogs[0].status, "sent");
});

test("WP-07 / MailHub: Full HTTP flow via processIngestionRequest with Resend SDK and Brevo conventions", async (t) => {
	const database = await setupTestDb();
	t.after(() => database.db.close());

	const routingKey = "om_live_aurelia_1234567890abcdef";
	const keyHash = await hashRoutingKey(routingKey);

	const mockKv = createMockKv();
	// Pre-seed L2 KV cache so routing key resolves instantly
	await mockKv.put(
		`rkey:${keyHash}`,
		JSON.stringify({
			keyId: "key_1",
			projectId: "proj_aurelia",
			projectSlug: "aurelia",
			projectName: "Aurelia App",
			environment: "live",
			keyPrefix: "om_live_aurelia_123456",
			keyStatus: "active",
			projectStatus: "active",
			rateLimitRps: 100,
		}),
	);

	const env = {
		DB: database,
		KV: mockKv,
		ROUTER_KV: mockKv,
	};

	const originalFetch = globalThis.fetch;
	t.after(() => { globalThis.fetch = originalFetch; });

	let httpMsgCount = 0;
	globalThis.fetch = async (url) => {
		const urlStr = String(url);
		if (urlStr.includes("brevo.com")) {
			httpMsgCount++;
			return new Response(JSON.stringify({ messageId: `<brevo-http-msg-${httpMsgCount}@brevo.com>` }), {
				status: 201,
				headers: { "Content-Type": "application/json" },
			});
		}
		return new Response("Not found", { status: 404 });
	};

	// 1. Test Resend SDK Drop-in Request (POST /v1/emails with Bearer token)
	const resendReq = new Request("https://mailhub.local/v1/emails", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${routingKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			from: "onboarding@aurelia.com",
			to: "resend-user@example.com",
			subject: "Hello via Resend SDK",
			html: "<p>Sent via Resend SDK standard</p>",
		}),
	});

	const resendResponse = await processIngestionRequest(resendReq, env);
	assert.strictEqual(resendResponse.status, 200, "Resend send should return HTTP 200");
	const resendData = await resendResponse.json();
	assert.strictEqual(resendData.id, "<brevo-http-msg-1@brevo.com>");
	assert.strictEqual(resendData.messageId, "<brevo-http-msg-1@brevo.com>");

	// 2. Test Brevo SDK Drop-in Request (POST /api/v1/send with api-key header)
	const brevoReq = new Request("https://mailhub.local/api/v1/send", {
		method: "POST",
		headers: {
			"api-key": routingKey,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			sender: { name: "Aurelia", email: "onboarding@aurelia.com" },
			to: [{ email: "brevo-user@example.com", name: "Brevo User" }],
			subject: "Hello via Brevo SDK",
			htmlContent: "<p>Sent via Brevo payload standard</p>",
		}),
	});

	const brevoResponse = await processIngestionRequest(brevoReq, env);
	assert.strictEqual(brevoResponse.status, 200, "Brevo send should return HTTP 200");
	const brevoData = await brevoResponse.json();
	assert.strictEqual(brevoData.id, "<brevo-http-msg-2@brevo.com>");

	// Check database has both sent messages
	const totalMessages = database.db.prepare("SELECT COUNT(*) as count FROM messages").get();
	assert.strictEqual(totalMessages.count, 2, "Both emails should be in messages table");

	const totalLogs = database.db.prepare("SELECT COUNT(*) as count FROM email_router_send_logs").get();
	assert.strictEqual(totalLogs.count, 2, "Both emails should have send logs");
});

test("WP-07 / MailHub: Recipient splitting with > 50 recipients routes chunks and logs all sends", async (t) => {
	const database = await setupTestDb();
	t.after(() => database.db.close());

	const routingKey = "om_live_aurelia_1234567890abcdef";
	const keyHash = await hashRoutingKey(routingKey);

	const mockKv = createMockKv();
	await mockKv.put(
		`rkey:${keyHash}`,
		JSON.stringify({
			keyId: "key_1",
			projectId: "proj_aurelia",
			projectSlug: "aurelia",
			projectName: "Aurelia App",
			environment: "live",
			keyPrefix: "om_live_aurelia_123456",
			keyStatus: "active",
			projectStatus: "active",
			rateLimitRps: 100,
		}),
	);

	const env = {
		DB: database,
		KV: mockKv,
		ROUTER_KV: mockKv,
	};

	const originalFetch = globalThis.fetch;
	t.after(() => { globalThis.fetch = originalFetch; });

	let sendCount = 0;
	globalThis.fetch = async (url) => {
		sendCount++;
		return new Response(JSON.stringify({ messageId: `<chunk-msg-${sendCount}@brevo.com>` }), {
			status: 201,
			headers: { "Content-Type": "application/json" },
		});
	};

	// 75 recipients -> will chunk into 50 and 25
	const recipients = Array.from({ length: 75 }, (_, i) => `chunk_user_${i + 1}@example.com`);

	const req = new Request("https://mailhub.local/v1/emails", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${routingKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			from: "onboarding@aurelia.com",
			to: recipients,
			subject: "Bulk Newsletter",
			html: "<p>Newsletter Content</p>",
		}),
	});

	const response = await processIngestionRequest(req, env);
	assert.strictEqual(response.status, 200);
	const data = await response.json();
	assert.strictEqual(data.id, "<chunk-msg-1@brevo.com>");
	assert.strictEqual(sendCount, 2, "Should have made 2 provider dispatches (50 + 25)");

	// Verify both chunks are recorded in email_router_send_logs
	const logs = database.db.prepare("SELECT * FROM email_router_send_logs WHERE project_id = 'proj_aurelia'").all();
	assert.strictEqual(logs.length, 2, "Both chunks should be logged");
});

test("WP-07 / MailHub: Legacy API key (without auth.projectId) preserves sendEmail path", async (t) => {
	const database = await setupTestDb();
	t.after(() => database.db.close());

	const mockKv = createMockKv();
	const env = {
		DB: database,
		KV: mockKv,
		ROUTER_KV: mockKv,
		RESEND_API_KEY: "test_resend_env_key",
		APP_URL: "https://mailhub.local",
	};

	const originalFetch = globalThis.fetch;
	t.after(() => { globalThis.fetch = originalFetch; });

	let legacyResendCalled = false;
	globalThis.fetch = async (url) => {
		const urlStr = String(url);
		if (urlStr.includes("resend.com")) {
			legacyResendCalled = true;
			return new Response(JSON.stringify({ id: "resend_legacy_789" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		return new Response("Not found", { status: 404 });
	};

	const payload = normalizePayload({
		from: "onboarding@aurelia.com",
		to: "legacy-user@example.com",
		subject: "Legacy API Key Send",
		html: "<p>Sending through user mailbox</p>",
	});

	// Legacy auth: no projectId set
	const auth = {
		userId: "user_aurelia",
		keyId: "ep_key_user_1",
		keyKind: "user",
		scopes: ["send"],
		mailboxIds: ["mbx_aurelia"],
	};

	const result = await sendSingleNormalizedMessage(env, payload, auth, "https://mailhub.local");

	// Legacy sendEmail returns a messageId starting with msg_
	assert.ok(result.id, "Should return message ID");
	assert.ok(result.id.startsWith("msg_"), `Expected message ID to start with msg_, got ${result.id}`);
	assert.strictEqual(legacyResendCalled, true, "Should have used standard outbound provider via sendEmail");

	// Verify message in database
	const message = database.db.prepare("SELECT * FROM messages WHERE id = ?").get(result.id);
	assert.ok(message, "Message should be saved in messages table");
	assert.strictEqual(message.status, "sent");
});
