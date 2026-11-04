import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "node_modules", "mailhub-admin-api-test-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

async function bundle(entry, outfile) {
	await build({
		entryPoints: [join(root, entry)],
		outfile: join(outDir, outfile),
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node22",
		packages: "external",
		logLevel: "silent",
		alias: {
			"@": join(root, "src"),
			"next/server": "next/server.js",
			"next/headers": "next/headers.js",
			"cloudflare:workers": join(root, "server/runtime/cloudflare-workers.ts"),
		},
	});
	return import(pathToFileURL(join(outDir, outfile)).href);
}

const statsModule = await bundle("src/app/api/admin/mailhub/stats/route.ts", "stats.mjs");
const activitiesModule = await bundle("src/app/api/admin/mailhub/activities/route.ts", "activities.mjs");
const testSendModule = await bundle("src/app/api/admin/mailhub/test-send/route.ts", "test-send.mjs");
const circuitBreakerModule = await bundle("src/app/api/admin/mailhub/circuit-breaker/route.ts", "circuit-breaker.mjs");
const pingModule = await bundle("src/app/api/admin/mailhub/ping/route.ts", "ping.mjs");

before(() => {
	process.env.NODE_ENV = "development";
	globalThis.__orbitflareNodeEnv = {
		ORBITFLARE_RUNTIME: "node",
		KV: {
			get: async () => null,
			put: async () => {},
			delete: async () => {},
			list: async () => ({ keys: [] }),
		},
	};
});

after(() => {
	delete globalThis.__orbitflareNodeEnv;
	try {
		rmSync(outDir, { recursive: true, force: true });
	} catch {}
	setTimeout(() => process.exit(0), 100);
});

test("GET /api/admin/mailhub/stats returns complete KPI summary and provider circuit breaker status", async () => {
	const req = new Request("http://localhost:3000/api/admin/mailhub/stats", {
		method: "GET",
		headers: {
			"x-session-user": JSON.stringify({ id: "admin-1", role: "admin" }),
		},
	});

	const res = await statsModule.GET(req);
	assert.equal(res.status, 200);

	const data = await res.json();
	assert.equal(data.success, true);
	assert.ok(data.stats, "Expected stats object");
	assert.equal(typeof data.stats.totalSentToday, "number");
	assert.equal(typeof data.stats.deliveredToday, "number");
	assert.equal(typeof data.stats.failedToday, "number");
	assert.equal(typeof data.stats.failoversTriggeredToday, "number");
	assert.equal(typeof data.stats.activeProjects, "number");
	assert.equal(typeof data.stats.activeProviders, "number");
	assert.equal(typeof data.stats.averageLatencyMs, "number");
	assert.equal(typeof data.stats.quotaUtilizationPct, "number");

	assert.ok(Array.isArray(data.providers), "Expected providers array");
	assert.ok(data.providers.length >= 3, "Expected at least 3 default providers");

	const brevo = data.providers.find((p) => p.provider === "brevo");
	assert.ok(brevo, "Expected Brevo provider to be present");
	assert.equal(brevo.dailyLimit, 300);
	assert.ok(["healthy", "degraded", "tripped"].includes(brevo.circuitStatus));
	assert.ok(["closed", "half-open", "open"].includes(brevo.circuitState));
});

test("GET /api/admin/mailhub/activities returns formatted MailHubActivityItems with query filters", async () => {
	// 1. Fetch default activities (no filter)
	const req = new Request("http://localhost:3000/api/admin/mailhub/activities?limit=10", {
		method: "GET",
		headers: {
			"x-session-user": JSON.stringify({ id: "admin-1", role: "admin" }),
		},
	});

	const res = await activitiesModule.GET(req);
	assert.equal(res.status, 200);

	const data = await res.json();
	assert.equal(data.success, true);
	assert.ok(Array.isArray(data.activities), "Expected activities array");
	assert.ok(data.activities.length <= 10);
	assert.ok(data.activities.length > 0);

	const first = data.activities[0];
	assert.ok(first.id, "Missing activity id");
	assert.ok(first.timestamp, "Missing timestamp");
	assert.ok(first.projectId, "Missing projectId");
	assert.ok(first.projectName, "Missing projectName");
	assert.ok(first.recipient, "Missing recipient");
	assert.ok(first.subject, "Missing subject");
	assert.ok(first.provider, "Missing provider");
	assert.equal(typeof first.wasFailover, "boolean");
	assert.ok(Array.isArray(first.routeAttempts), "Expected routeAttempts array");

	// 2. Filter by project
	const reqProj = new Request("http://localhost:3000/api/admin/mailhub/activities?projectId=proj_aurelia", {
		method: "GET",
		headers: {
			"x-session-user": JSON.stringify({ id: "admin-1", role: "admin" }),
		},
	});
	const resProj = await activitiesModule.GET(reqProj);
	const dataProj = await resProj.json();
	assert.ok(dataProj.activities.every((a) => a.projectId.includes("aurelia")));
});

test("POST /api/admin/mailhub/test-send validates input and executes dispatch waterfall", async () => {
	// 1. Invalid payload rejected with 400
	const invalidReq = new Request("http://localhost:3000/api/admin/mailhub/test-send", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ projectId: "proj_aurelia", recipient: "not-an-email" }),
	});
	const invalidRes = await testSendModule.POST(invalidReq);
	assert.equal(invalidRes.status, 400);

	// 2. Valid payload dispatches test send
	const validReq = new Request("http://localhost:3000/api/admin/mailhub/test-send", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			projectId: "proj_aurelia",
			recipient: "developer@orbitmails.internal",
			subject: "Test Dispatch: Automated Verification",
			routingMode: "auto",
		}),
	});

	const validRes = await testSendModule.POST(validReq);
	assert.equal(validRes.status, 200);

	const data = await validRes.json();
	assert.ok(data.result, "Expected result object");
	assert.ok(data.result.providerUsed, "Expected providerUsed");
	assert.equal(typeof data.result.latencyMs, "number");
	assert.ok(data.result.deliveryId, "Expected deliveryId");
	assert.ok(Array.isArray(data.result.waterfall), "Expected waterfall array");
	assert.ok(Array.isArray(data.result.attempts), "Expected attempts array");
});

test("POST /api/admin/mailhub/circuit-breaker resets and manages provider states", async () => {
	// 1. Trip circuit breaker manually
	const tripReq = new Request("http://localhost:3000/api/admin/mailhub/circuit-breaker", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			action: "trip",
			providerCredId: "cred_brevo_main",
			reason: "Simulated consecutive 500 errors",
		}),
	});

	const tripRes = await circuitBreakerModule.POST(tripReq);
	assert.equal(tripRes.status, 200);
	const tripData = await tripRes.json();
	assert.equal(tripData.success, true);

	// 2. Query circuit breaker status
	const getReq = new Request("http://localhost:3000/api/admin/mailhub/circuit-breaker?providerCredId=cred_brevo_main", {
		method: "GET",
	});
	const getRes = await circuitBreakerModule.GET(getReq);
	assert.equal(getRes.status, 200);
	const getData = await getRes.json();
	assert.equal(getData.success, true);
	assert.ok(getData.record);

	// 3. Reset circuit breaker back to closed
	const resetReq = new Request("http://localhost:3000/api/admin/mailhub/circuit-breaker", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			action: "reset",
			providerCredId: "cred_brevo_main",
		}),
	});

	const resetRes = await circuitBreakerModule.POST(resetReq);
	assert.equal(resetRes.status, 200);
	const resetData = await resetRes.json();
	assert.equal(resetData.success, true);
	assert.equal(resetData.record.state, "closed");
	assert.equal(resetData.record.healthScore, 1.0);
	assert.equal(resetData.record.consecutiveFailures, 0);
});

test("POST /api/admin/mailhub/ping measures roundtrip latency to provider", async () => {
	const pingReq = new Request("http://localhost:3000/api/admin/mailhub/ping", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			providerId: "resend",
		}),
	});

	const pingRes = await pingModule.POST(pingReq);
	assert.equal(pingRes.status, 200);

	const data = await pingRes.json();
	assert.equal(data.success, true);
	assert.equal(typeof data.latencyMs, "number");
	assert.ok(data.latencyMs >= 1);
	assert.ok(typeof data.status === "string" && data.status.length > 0);
});
