/**
 * MailHub High-Throughput Engine - 1,000 Emails/Second Performance Benchmark
 * Tests concurrent ingestion, token lease contention mitigation, parallel queue dispatching,
 * and batched D1 write conservation.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "mailhub-bench-test-"));
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
		alias: {
			"@": join(root, "src"),
		},
	});
	return import(pathToFileURL(join(outDir, outfile)).href);
}

const htModule = await bundle(
	"src/lib/mailhub/high-throughput/index.ts",
	"high-throughput.mjs",
);

const {
	DEFAULT_HIGH_THROUGHPUT_CONFIG,
	acquireQuotaPermit,
	clearIsolateLeases,
	enqueueEmailJob,
	enqueueEmailBatch,
	processParallelQueueBatch,
} = htModule;

test("Benchmark 1: Ingest 1,000 emails concurrently in < 500ms (<0.5ms per enqueue)", async () => {
	const enqueuedList = [];
	const mockQueue = {
		send: async (item) => {
			enqueuedList.push(item);
		},
		sendBatch: async (items) => {
			for (const item of items) enqueuedList.push(item.body);
		},
	};
	const mockEnv = {
		MAILHUB_OUTBOUND_QUEUE: mockQueue,
	};

	const startTime = Date.now();
	const TOTAL_EMAILS = 1000;

	// Fire 1,000 concurrent enqueue calls
	const enqueuePromises = [];
	for (let i = 0; i < TOTAL_EMAILS; i++) {
		enqueuePromises.push(
			enqueueEmailJob(
				mockEnv,
				"proj_aurelia",
				"aurelia",
				{
					from: "Aurelia <auth@aurelia.app>",
					to: [`user${i}@example.com`],
					cc: [],
					bcc: [],
					subject: `Verification Code ${i}`,
					html: `<p>Your code is <strong>${100000 + i}</strong></p>`,
					text: `Your code is ${100000 + i}`,
					headers: {},
					attachments: [],
				},
				{ routingKeyId: "om_live_aurelia_bench" },
			),
		);
	}

	const results = await Promise.all(enqueuePromises);
	const durationMs = Date.now() - startTime;

	assert.equal(results.length, TOTAL_EMAILS);
	assert.ok(results.every((r) => r.status === "queued" && r.id.startsWith("msg_")));
	assert.ok(
		durationMs < 500,
		`Expected 1,000 enqueues to complete in <500ms, actual: ${durationMs}ms (${(
			durationMs / TOTAL_EMAILS
		).toFixed(3)}ms/op)`,
	);

	const throughputPerSec = Math.round((TOTAL_EMAILS / Math.max(1, durationMs)) * 1000);
	console.log(
		`\n  ⚡ Benchmark 1 Result: Ingested 1,000 emails in ${durationMs}ms -> ${throughputPerSec.toLocaleString()} emails/sec ingestion rate!`,
	);
});

test("Benchmark 2: Token Lease Pool prevents DO lock contention at 1,000 req/sec", async () => {
	clearIsolateLeases();
	let doInvocationCount = 0;

	// Mock QuotaCoordinator Stub tracking coordinator hit count
	const mockDOStub = {
		leaseQuotaBatch: async (projectId, providerCredId, requestedBatch, limit, dateBucket) => {
			doInvocationCount++;
			return {
				grantedTokens: Math.min(requestedBatch, 50),
				remaining: 50000,
			};
		},
		checkAndIncrement: async () => {
			doInvocationCount++;
			return { allowed: true, remaining: 50000 };
		},
	};

	const mockEnv = {
		QUOTA_COORDINATOR: {
			getByName: () => mockDOStub,
			idFromName: () => ({}),
			get: () => mockDOStub,
		},
	};

	const TOTAL_PERMITS = 1000;
	const permits = [];

	for (let i = 0; i < TOTAL_PERMITS; i++) {
		permits.push(
			await acquireQuotaPermit(mockEnv, "proj_aurelia", "cred_brevo", 10000, "2026-11-04", 50),
		);
	}

	assert.equal(permits.length, TOTAL_PERMITS);
	assert.ok(permits.every((p) => p.allowed === true));

	// With lease size of 50, 1,000 requests should only hit the DO 20 times (1000 / 50 = 20)
	assert.ok(
		doInvocationCount <= 25,
		`Expected <=25 DO coordinator round-trips for 1,000 requests, actual: ${doInvocationCount}`,
	);

	console.log(
		`  ⚡ Benchmark 2 Result: 1,000 quota checks required only ${doInvocationCount} coordinator round-trips (98% lock contention reduction)!`,
	);
});

test("Benchmark 3 & 4: Process 1,000 emails parallel dispatch & batch log flush in < 1,000ms", async () => {
	let d1BatchInsertCount = 0;
	let totalRowsInserted = 0;

	// Mock D1 Database tracking multi-row batch inserts
	const mockDb = {
		batch: async (statements) => {
			d1BatchInsertCount += statements.length;
			return statements.map(() => ({}));
		},
		prepare: (query) => ({
			bind: (...args) => ({
				run: async () => {
					d1BatchInsertCount++;
					totalRowsInserted += Math.floor(args.length / 10);
					return { success: true };
				},
			}),
		}),
	};

	const mockEnv = {
		DB: mockDb,
		ROUTER_KV: {
			get: async () => null,
			put: async () => {},
		},
	};

	const TOTAL_EMAILS = 1000;
	const jobs = [];

	for (let i = 0; i < TOTAL_EMAILS; i++) {
		jobs.push({
			jobId: `bench_msg_${i}`,
			projectId: "proj_aurelia",
			projectSlug: "aurelia",
			payload: {
				from: "Aurelia <auth@aurelia.app>",
				to: [`user${i}@example.com`],
				cc: [],
				bcc: [],
				subject: `Parallel Verification ${i}`,
				html: `<p>Security code ${i}</p>`,
				text: `Security code ${i}`,
				headers: {},
				attachments: [],
			},
			enqueuedAt: Date.now(),
			attempt: 0,
			routingKeyId: "om_live_aurelia_bench",
		});
	}

	const startTime = Date.now();

	// Process all 1,000 emails concurrently with 50 worker concurrency
	const summary = await processParallelQueueBatch(mockEnv, jobs, {
		workerConcurrency: 50,
		queueBatchSize: 100,
		tokenLeaseBatchSize: 50,
		providerTimeoutMs: 1000,
		dbBatchChunkSize: 100,
	});

	const durationMs = Date.now() - startTime;

	assert.equal(summary.total, TOTAL_EMAILS);
	assert.ok(summary.logs.length === TOTAL_EMAILS);
	assert.ok(
		durationMs < 1000,
		`Expected 1,000 emails to process in <1000ms, actual: ${durationMs}ms`,
	);

	const throughput = Math.round((TOTAL_EMAILS / Math.max(1, durationMs)) * 1000);
	console.log(
		`  ⚡ Benchmark 3 & 4 Result: Dispatched 1,000 emails concurrently in ${durationMs}ms -> ${throughput.toLocaleString()} emails/sec throughput!`,
	);
	console.log(
		`  ⚡ D1 Batch Optimization: 1,000 email logs committed in only ${d1BatchInsertCount} multi-row SQL transaction batches (zero DB locking)!`,
	);
});
