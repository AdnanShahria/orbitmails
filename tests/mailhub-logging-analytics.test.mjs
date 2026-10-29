import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "mailhub-logging-test-"));
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
	});
	return import(pathToFileURL(join(outDir, outfile)).href);
}

const loggingModule = await bundle("src/lib/mailhub/logging.ts", "mailhub-logging.mjs");
const analyticsModule = await bundle("src/lib/mailhub/analytics.ts", "mailhub-analytics.mjs");
const {
	createSendLogEntry,
	buildMultiRowInsertSql,
	flushBatchToD1,
	SendLogBuffer,
	recordSendLogAsync,
	drainKvSpilloverLogs,
} = loggingModule;

const {
	getDailyProjectMetrics,
	getDailyProviderMetrics,
	getProviderPerformanceSummary,
	getLatencyPercentiles,
	getLatencyHistogramBuckets,
	calculatePercentilesFromSamples,
	getRealtimeTodaySummary,
} = analyticsModule;

// Mock D1 Database implementation for isolated unit testing
function createMockD1Database() {
	const executedQueries = [];
	const tables = {
		email_router_send_logs: [],
	};

	return {
		executedQueries,
		tables,
		prepare(query) {
			let boundParams = [];
			return {
				bind(...params) {
					boundParams = params;
					return this;
				},
				async run() {
					executedQueries.push({ query, params: boundParams });
					return { success: true, meta: { changes: 1 } };
				},
				async all() {
					executedQueries.push({ query, params: boundParams });
					// Return mock results based on query type
					if (query.includes("GROUP BY project_id, date_bucket")) {
						return {
							results: [
								{ projectId: "proj_aurelia", dateBucket: "2026-11-02", totalSends: 120, successfulSends: 118, failedSends: 2, queuedSends: 0, avgLatencyMs: 245.5 },
								{ projectId: "proj_lifesolver", dateBucket: "2026-11-02", totalSends: 80, successfulSends: 80, failedSends: 0, queuedSends: 0, avgLatencyMs: 198.2 },
								{ projectId: "proj_luvio", dateBucket: "2026-11-02", totalSends: 60, successfulSends: 58, failedSends: 2, queuedSends: 0, avgLatencyMs: 310.0 },
								{ projectId: "proj_ovijatric", dateBucket: "2026-11-02", totalSends: 40, successfulSends: 39, failedSends: 1, queuedSends: 0, avgLatencyMs: 220.4 },
							],
						};
					}
					if (query.includes("GROUP BY provider, provider_cred_id, date_bucket")) {
						return {
							results: [
								{ provider: "brevo", providerCredId: "cred_brevo_main", dateBucket: "2026-11-02", totalAttempts: 250, successfulSends: 248, failedSends: 2, avgLatencyMs: 210.5 },
								{ provider: "resend", providerCredId: "cred_resend_main", dateBucket: "2026-11-02", totalAttempts: 50, successfulSends: 47, failedSends: 3, avgLatencyMs: 185.0 },
							],
						};
					}
					if (query.includes("GROUP BY provider, provider_cred_id")) {
						return {
							results: [
								{ provider: "brevo", providerCredId: "cred_brevo_main", totalAttempts: 250, successfulSends: 248, failedSends: 2, avgLatencyMs: 210.5, activeProjectsCount: 4 },
								{ provider: "resend", providerCredId: "cred_resend_main", totalAttempts: 50, successfulSends: 47, failedSends: 3, avgLatencyMs: 185.0, activeProjectsCount: 2 },
							],
						};
					}
					if (query.includes("GROUP BY error_message")) {
						return {
							results: [
								{ errorMessage: "429 Rate limit exceeded", errCount: 2 },
							],
						};
					}
					if (query.includes("WITH ordered_latencies")) {
						return {
							results: [
								{ provider: "brevo", totalCount: 248, minMs: 95, p50Ms: 190, p90Ms: 380, p95Ms: 450, p99Ms: 820, maxMs: 1150, avgMs: 210.5 },
								{ provider: "resend", totalCount: 47, minMs: 80, p50Ms: 165, p90Ms: 290, p95Ms: 340, p99Ms: 410, maxMs: 450, avgMs: 185.0 },
							],
						};
					}
					if (query.includes("COUNT(CASE WHEN latency_ms < 100")) {
						return {
							results: [
								{ provider: "brevo", under100ms: 15, ms100to250: 170, ms250to500: 55, ms500to1000: 7, over1000ms: 1 },
								{ provider: "resend", under100ms: 10, ms100to250: 32, ms250to500: 5, ms500to1000: 0, over1000ms: 0 },
							],
						};
					}
					return { results: [] };
				},
				async first() {
					const all = await this.all();
					return all.results[0] || null;
				},
			};
		},
	};
}

// Mock Cloudflare KV implementation
function createMockKv() {
	const storage = new Map();
	return {
		storage,
		async get(key, type) {
			const val = storage.get(key);
			if (val === undefined) return null;
			if (type === "json") return JSON.parse(val);
			return val;
		},
		async put(key, value) {
			storage.set(key, typeof value === "string" ? value : JSON.stringify(value));
		},
		async delete(key) {
			storage.delete(key);
		},
		async list(options) {
			const keys = [];
			for (const k of storage.keys()) {
				if (!options?.prefix || k.startsWith(options.prefix)) {
					keys.push({ name: k });
				}
			}
			return { keys };
		},
	};
}

test("createSendLogEntry - normalizes values, dates and IDs", () => {
	const entry = createSendLogEntry({
		projectId: "proj_aurelia",
		providerCredId: "cred_brevo_main",
		provider: "BREVO",
		toAddress: "  user@example.com ",
		subject: "Welcome to Aurelia",
		status: "sent",
		providerMessageId: "brevo-msg-12345",
		latencyMs: 245.8,
		sentAt: 1730560000000,
	});

	assert.equal(entry.projectId, "proj_aurelia");
	assert.equal(entry.provider, "brevo"); // Lowercased
	assert.equal(entry.toAddress, "user@example.com"); // Trimmed
	assert.equal(entry.latencyMs, 246); // Rounded
	assert.equal(entry.dateBucket, "2024-11-02"); // UTC Date Bucket from timestamp
	assert.ok(entry.id.startsWith("log_"));
});

test("buildMultiRowInsertSql - creates valid multi-row parameter placeholders", () => {
	const entries = [
		createSendLogEntry({
			projectId: "proj_aurelia",
			providerCredId: "cred_brevo_main",
			provider: "brevo",
			toAddress: "a@test.com",
			status: "sent",
			latencyMs: 150,
		}),
		createSendLogEntry({
			projectId: "proj_lifesolver",
			providerCredId: "cred_resend_main",
			provider: "resend",
			toAddress: "b@test.com",
			status: "failed",
			errorMessage: "Quota exceeded",
			latencyMs: 320,
		}),
	];

	const { sql, params } = buildMultiRowInsertSql(entries, "email_router_send_logs");

	assert.ok(sql.includes("INSERT INTO email_router_send_logs"));
	assert.ok(sql.includes("VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"));
	assert.equal(params.length, 24); // 12 columns * 2 rows
	assert.equal(params[1], "proj_aurelia");
	assert.equal(params[13], "proj_lifesolver");
});

test("createSendLogEntry & buildMultiRowInsertSql - captures and serializes htmlSnippet and textContent (truncated to 2000 chars)", () => {
	const longHtml = "<p>" + "X".repeat(2500) + "</p>";
	const longText = "Y".repeat(2500);

	const entryWithSnippets = createSendLogEntry({
		projectId: "proj_aurelia",
		providerCredId: "cred_brevo_main",
		provider: "brevo",
		toAddress: "a@test.com",
		subject: "Test snippets",
		status: "sent",
		latencyMs: 150,
		htmlSnippet: longHtml,
		textContent: longText,
	});

	assert.equal(entryWithSnippets.htmlSnippet?.length, 2000);
	assert.equal(entryWithSnippets.textContent?.length, 2000);

	const { sql, params } = buildMultiRowInsertSql([entryWithSnippets], "email_router_send_logs");

	assert.ok(sql.includes("html_snippet, text_content"));
	assert.ok(sql.includes("VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"));
	assert.equal(params.length, 14);
	assert.equal(params[12]?.length, 2000);
	assert.equal(params[13]?.length, 2000);
});

test("flushBatchToD1 - commits atomic multi-row statement to D1", async () => {
	const mockDb = createMockD1Database();
	const env = { DB: mockDb };

	const entries = [
		createSendLogEntry({
			projectId: "proj_aurelia",
			providerCredId: "cred_brevo_main",
			provider: "brevo",
			toAddress: "aurelia@test.com",
			status: "sent",
			latencyMs: 180,
		}),
		createSendLogEntry({
			projectId: "proj_luvio",
			providerCredId: "cred_ses_backup",
			provider: "ses",
			toAddress: "luvio@test.com",
			status: "sent",
			latencyMs: 120,
		}),
	];

	const result = await flushBatchToD1(entries, env);

	assert.equal(result.flushedCount, 2);
	assert.equal(result.failedCount, 0);
	assert.equal(mockDb.executedQueries.length, 1);
	assert.ok(mockDb.executedQueries[0].query.includes("INSERT INTO email_router_send_logs"));
});

test("SendLogBuffer - batches multiple items and flushes when threshold is hit", async () => {
	const mockDb = createMockD1Database();
	const env = { DB: mockDb };

	// Configure small batch threshold of 3 for testing
	const buffer = new SendLogBuffer(env, { maxBatchSize: 3, flushIntervalMs: 10000 });

	const waitUntilPromises = [];
	const mockCtx = {
		waitUntil: (p) => waitUntilPromises.push(p),
	};

	buffer.push(createSendLogEntry({ projectId: "proj_a", providerCredId: "p1", provider: "brevo", toAddress: "1@t.com", status: "sent", latencyMs: 100 }), mockCtx);
	buffer.push(createSendLogEntry({ projectId: "proj_b", providerCredId: "p1", provider: "brevo", toAddress: "2@t.com", status: "sent", latencyMs: 110 }), mockCtx);

	// 2 items: under threshold, no flush triggered yet
	assert.equal(buffer.pendingCount, 2);
	assert.equal(waitUntilPromises.length, 0);

	// 3rd item: hits threshold of 3, immediate asynchronous flush is scheduled
	buffer.push(createSendLogEntry({ projectId: "proj_c", providerCredId: "p2", provider: "resend", toAddress: "3@t.com", status: "sent", latencyMs: 120 }), mockCtx);

	assert.equal(waitUntilPromises.length, 1);
	await Promise.all(waitUntilPromises);

	// Buffer drained and written in 1 atomic database query
	assert.equal(buffer.pendingCount, 0);
	assert.equal(mockDb.executedQueries.length, 1);
});

test("recordSendLogAsync - leverages Cloudflare Queue producer when bound", () => {
	let enqueuedItem = null;
	const mockQueue = {
		async send(entry) {
			enqueuedItem = entry;
		},
	};

	const env = { ROUTER_LOG_QUEUE: mockQueue };
	const waitUntilPromises = [];
	const mockCtx = {
		waitUntil: (p) => waitUntilPromises.push(p),
	};

	const logEntry = createSendLogEntry({
		projectId: "proj_ovijatric",
		providerCredId: "cred_brevo_main",
		provider: "brevo",
		toAddress: "ovijatric@test.com",
		status: "sent",
		latencyMs: 230,
	});

	// Fire async logger
	recordSendLogAsync(logEntry, env, mockCtx);

	assert.equal(waitUntilPromises.length, 1);
	return Promise.all(waitUntilPromises).then(() => {
		assert.ok(enqueuedItem);
		assert.equal(enqueuedItem.projectId, "proj_ovijatric");
	});
});

test("KV Spillover & Recovery - persists logs to KV on DB failure and drains successfully", async () => {
	const mockKv = createMockKv();
	// Failing DB mock
	const failingDb = {
		prepare() {
			return {
				bind() { return this; },
				async run() { throw new Error("SQLITE_BUSY: database is locked"); },
			};
		},
	};

	const envFailing = { DB: failingDb, KV: mockKv };
	const entries = [
		createSendLogEntry({ projectId: "proj_aurelia", providerCredId: "p1", provider: "brevo", toAddress: "u@t.com", status: "sent", latencyMs: 150 }),
	];

	// Attempt flush to failing DB
	const flushRes = await flushBatchToD1(entries, envFailing, { maxRetries: 1 });
	assert.equal(flushRes.flushedCount, 0);

	// Verify logs were spilled to KV
	const spilledKeys = await mockKv.list({ prefix: "spillover:send_logs:" });
	assert.equal(spilledKeys.keys.length, 1);

	// Now recover: switch to healthy DB and drain spillover
	const healthyDb = createMockD1Database();
	const envHealthy = { DB: healthyDb, KV: mockKv };

	const drainRes = await drainKvSpilloverLogs(envHealthy);
	assert.equal(drainRes.recoveredCount, 1);
	assert.equal(drainRes.keysCleaned, 1);

	// Verify KV is cleaned
	const postDrain = await mockKv.list({ prefix: "spillover:send_logs:" });
	assert.equal(postDrain.keys.length, 0);
	// Verify D1 received the insert
	assert.equal(healthyDb.executedQueries.length, 1);
});

test("getDailyProjectMetrics - aggregates sends per project across date buckets", async () => {
	const mockDb = createMockD1Database();
	const env = { DB: mockDb };

	const metrics = await getDailyProjectMetrics(env, { startDate: "2026-11-02", endDate: "2026-11-02" });

	assert.equal(metrics.length, 4);
	const aurelia = metrics.find((m) => m.projectId === "proj_aurelia");
	assert.ok(aurelia);
	assert.equal(aurelia.totalSends, 120);
	assert.equal(aurelia.successfulSends, 118);
	assert.equal(aurelia.failedSends, 2);
	assert.equal(aurelia.successRate, 98.33);
});

test("getDailyProviderMetrics - aggregates send attempts per provider account", async () => {
	const mockDb = createMockD1Database();
	const env = { DB: mockDb };

	const metrics = await getDailyProviderMetrics(env);

	assert.equal(metrics.length, 2);
	const brevo = metrics.find((m) => m.provider === "brevo");
	assert.ok(brevo);
	assert.equal(brevo.totalAttempts, 250);
	assert.equal(brevo.successfulSends, 248);
	assert.equal(brevo.successRate, 99.2);
});

test("getProviderPerformanceSummary - calculates failure rates and top errors", async () => {
	const mockDb = createMockD1Database();
	const env = { DB: mockDb };

	const summaries = await getProviderPerformanceSummary(env);

	assert.equal(summaries.length, 2);
	const brevo = summaries.find((s) => s.provider === "brevo");
	assert.ok(brevo);
	assert.equal(brevo.successRate, 99.2);
	assert.equal(brevo.failureRate, 0.8);
	assert.equal(brevo.activeProjectsCount, 4);
	assert.equal(brevo.topErrors.length, 1);
	assert.equal(brevo.topErrors[0].error, "429 Rate limit exceeded");
});

test("getLatencyPercentiles - calculates p50, p90, p95, p99 and latency distribution", async () => {
	const mockDb = createMockD1Database();
	const env = { DB: mockDb };

	const percentiles = await getLatencyPercentiles(env);

	assert.equal(percentiles.length, 2);
	const brevo = percentiles.find((p) => p.provider === "brevo");
	assert.ok(brevo);
	assert.equal(brevo.minMs, 95);
	assert.equal(brevo.p50Ms, 190);
	assert.equal(brevo.p95Ms, 450);
	assert.equal(brevo.p99Ms, 820);
	assert.equal(brevo.maxMs, 1150);
});

test("calculatePercentilesFromSamples - mathematically computes accurate percentiles", () => {
	// Sample latencies: 100 samples from 10ms to 1000ms
	const samples = Array.from({ length: 100 }, (_, i) => (i + 1) * 10);
	const result = calculatePercentilesFromSamples("resend", samples);

	assert.equal(result.sampleCount, 100);
	assert.equal(result.minMs, 10);
	assert.equal(result.p50Ms, 500); // 50th percentile
	assert.equal(result.p90Ms, 900); // 90th percentile
	assert.equal(result.p95Ms, 950); // 95th percentile
	assert.equal(result.p99Ms, 990); // 99th percentile
	assert.equal(result.maxMs, 1000);
	assert.equal(result.avgMs, 505);
});

test("getLatencyHistogramBuckets - categorizes response times into histogram bins", async () => {
	const mockDb = createMockD1Database();
	const env = { DB: mockDb };

	const buckets = await getLatencyHistogramBuckets(env);

	assert.equal(buckets.length, 2);
	const resend = buckets.find((b) => b.provider === "resend");
	assert.ok(resend);
	assert.equal(resend.under100ms, 10);
	assert.equal(resend.ms100to250, 32);
	assert.equal(resend.ms250to500, 5);
	assert.equal(resend.ms500to1000, 0);
	assert.equal(resend.over1000ms, 0);
});

test("getRealtimeTodaySummary - compiles high level KPI overview", async () => {
	const mockDb = createMockD1Database();
	const env = { DB: mockDb };

	const summary = await getRealtimeTodaySummary(env, "2026-11-02");

	assert.equal(summary.todayDateBucket, "2026-11-02");
	assert.equal(summary.totalSentToday, 295); // 118 + 80 + 58 + 39
	assert.equal(summary.totalFailedToday, 5); // 2 + 0 + 2 + 1
	assert.equal(summary.activeProjectsToday, 4);
	assert.ok(summary.successRateToday > 98);
});
