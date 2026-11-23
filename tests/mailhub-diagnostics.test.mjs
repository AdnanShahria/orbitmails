import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "node_modules", "mailhub-diag-test-"));
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

const diagnosticsModule = await bundle("src/lib/mailhub/diagnostics.ts", "diagnostics.mjs");
const testSendModule = await bundle("src/app/api/admin/mailhub/test-send/route.ts", "test-send.mjs");
const activitiesModule = await bundle("src/app/api/admin/mailhub/activities/route.ts", "activities.mjs");

const {
	buildDeliveryDiagnostics,
	formatAttemptsErrorSummary,
	recordDeliveryDiagnostics,
	getDeliveryDiagnosticsMap,
	inferDiagnosticHint,
} = diagnosticsModule;

test("buildDeliveryDiagnostics preserves real multi-provider errors and generates actionable hints", () => {
	const attempts = [
		{
			providerCredId: "cred_cloudflare_main",
			provider: "cloudflare",
			code: "AUTHENTICATION_ERROR",
			message: "[MailHub:CLOUDFLARE] AUTHENTICATION_ERROR: Cloudflare EMAIL binding is not available in environment or credentials",
			timestamp: Date.now() - 50,
			latencyMs: 12,
		},
		{
			providerCredId: "cred_brevo_main",
			provider: "brevo",
			code: "QUOTA_EXCEEDED",
			statusCode: 429,
			message: "[MailHub:BREVO] QUOTA_EXCEEDED: Daily credit limit reached",
			timestamp: Date.now() - 20,
			latencyMs: 38,
		},
	];

	const summary = formatAttemptsErrorSummary(attempts);
	assert.match(summary, /\[CLOUDFLARE AUTHENTICATION_ERROR\] Cloudflare EMAIL binding is not available/);
	assert.match(summary, /\[BREVO QUOTA_EXCEEDED HTTP 429\] Daily credit limit reached/);

	const diag = buildDeliveryDiagnostics({
		deliveryId: "dlv_test_1",
		attempts,
		stage: "failover_exhausted",
		fromAddress: "contact@mail.orbitsaas.cloud",
	});

	assert.equal(diag.errorCode, "QUOTA_EXCEEDED");
	assert.equal(diag.httpStatus, 429);
	assert.equal(diag.totalLatencyMs, 50);
	assert.equal(diag.attempts.length, 2);
	assert.match(diag.attempts[0].hint, /send_email binding|CF_ACCOUNT_ID/i);
	assert.match(diag.attempts[1].hint, /quota|rate limit/i);
	assert.ok(diag.diagnosticHint);
});

test("inferDiagnosticHint maps domain verification and legacy placeholder errors clearly", () => {
	const domainHint = inferDiagnosticHint({
		provider: "cloudflare",
		errorCode: "INVALID_PAYLOAD",
		errorMessage: "Sender domain example.com is not verified",
		httpStatus: 400,
	});
	assert.match(domainHint, /not verified/i);

	const legacyHint = inferDiagnosticHint({
		provider: "cloudflare",
		errorMessage: "All failover attempts failed or queued",
	});
	assert.match(legacyHint, /Legacy log entry/i);
});

test("recordDeliveryDiagnostics and getDeliveryDiagnosticsMap persist via D1 and KV", async () => {
	const diagRows = new Map();
	const mockDb = {
		prepare(sql) {
			let params = [];
			return {
				bind(...args) {
					params = args;
					return this;
				},
				async run() {
					if (sql.includes("INSERT OR REPLACE INTO mailhub_delivery_diagnostics")) {
						diagRows.set(params[0], params[3]);
					}
					return { success: true };
				},
				async all() {
					if (sql.includes("FROM mailhub_delivery_diagnostics")) {
						const results = [];
						for (const id of params) {
							if (diagRows.has(id)) {
								results.push({ log_id: id, diagnostics_json: diagRows.get(id) });
							}
						}
						return { results };
					}
					return { results: [] };
				},
			};
		},
	};

	const diag = buildDeliveryDiagnostics({
		deliveryId: "dlv_persist_1",
		attempts: [
			{
				providerCredId: "cred_cloudflare_main",
				provider: "cloudflare",
				code: "AUTHENTICATION_ERROR",
				message: "Cloudflare Email Sending failed (403): Missing Email Sending Edit permission",
				statusCode: 403,
				timestamp: Date.now(),
				latencyMs: 25,
			},
		],
	});

	await recordDeliveryDiagnostics("log_persist_1", "proj_fashion-doniya", diag, { DB: mockDb });
	assert.ok(diagRows.has("log_persist_1"));

	const loaded = await getDeliveryDiagnosticsMap(["log_persist_1"], { DB: mockDb });
	const found = loaded.get("log_persist_1");
	assert.ok(found);
	assert.equal(found.errorCode, "AUTHENTICATION_ERROR");
	assert.equal(found.httpStatus, 403);
	assert.equal(found.attempts.length, 1);
	assert.match(found.attempts[0].error, /403/);
});

test("test-send persists real error and activities endpoint exposes full diagnostics", async () => {
	const sendLogs = [];
	const diagMap = new Map();
	const prevEnv = globalThis.__orbitflareNodeEnv;
	const prevNodeEnv = process.env.NODE_ENV;
	process.env.NODE_ENV = "development";

	const mockDb = {
		prepare(sql) {
			let params = [];
			return {
				bind(...args) {
					params = args;
					return this;
				},
				async run() {
					if (sql.includes("INSERT INTO email_router_send_logs")) {
						sendLogs.unshift({
							id: params[0],
							project_id: params[1],
							provider_cred_id: params[2],
							provider: params[3],
							to_address: params[4],
							subject: params[5],
							status: params[6],
							provider_message_id: params[7],
							error_message: params[8],
							latency_ms: params[9],
							sent_at: params[10],
							date_bucket: params[11],
							html_snippet: params[12],
							text_content: params[13],
						});
					} else if (sql.includes("INSERT OR REPLACE INTO mailhub_delivery_diagnostics")) {
						diagMap.set(params[0], params[3]);
					}
					return { success: true };
				},
				async first() {
					return null;
				},
				async all() {
					if (sql.includes("FROM email_router_send_logs")) {
						return { results: sendLogs };
					}
					if (sql.includes("FROM mailhub_delivery_diagnostics")) {
						const results = [];
						for (const id of params) {
							if (diagMap.has(id)) {
								results.push({ log_id: id, diagnostics_json: diagMap.get(id) });
							}
						}
						return { results };
					}
					return { results: [] };
				},
			};
		},
	};

	globalThis.__orbitflareNodeEnv = {
		ORBITFLARE_RUNTIME: "node",
		DB: mockDb,
		KV: {
			get: async () => null,
			put: async () => {},
			delete: async () => {},
			list: async () => ({ keys: [] }),
		},
	};

	try {
		const req = new Request("http://localhost:3000/api/admin/mailhub/test-send", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				projectId: "proj_aurelia",
				recipient: "buyer@example.com",
				subject: "Real Error Capture Test",
				routingMode: "auto",
			}),
		});

		const res = await testSendModule.POST(req);
		const data = await res.json();
		assert.equal(data.success, false);
		assert.notEqual(data.error, "All failover attempts failed or queued");
		assert.match(data.error, /Brevo API key is missing or empty/i);
		assert.match(data.error, /Resend API key is missing or empty/i);
		assert.ok(data.diagnosticHint);
		assert.ok(data.result.latencyMs >= 1);

		const actReq = new Request("http://localhost:3000/api/admin/mailhub/activities?limit=10", {
			method: "GET",
		});
		const actRes = await activitiesModule.GET(actReq);
		assert.equal(actRes.status, 200);
		const actData = await actRes.json();
		assert.ok(actData.activities.length >= 1);
		const item = actData.activities[0];
		assert.equal(item.status, "failed");
		assert.match(item.errorMessage, /Brevo API key is missing or empty/i);
		assert.ok(item.diagnosticHint);
		assert.equal(item.routeAttempts.length, 3);
		assert.match(item.routeAttempts[0].error, /Brevo API key is missing or empty/i);
		assert.match(item.routeAttempts[1].error, /Resend API key is missing or empty/i);
	} finally {
		globalThis.__orbitflareNodeEnv = prevEnv;
		process.env.NODE_ENV = prevNodeEnv;
	}
});
