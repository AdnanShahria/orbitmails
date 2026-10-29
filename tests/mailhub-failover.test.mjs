import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after, beforeEach } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "mailhub-failover-test-"));
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

const mailhub = await bundle("src/lib/mailhub/index.ts", "mailhub-bundle.mjs");
const {
	CircuitBreaker,
	LocalCircuitBreakerStore,
	LocalDlqStore,
	sendWithFailover,
	markQuotaSliceExhausted,
	getExponentialBackoffSeconds,
	ProviderError,
	globalTelemetry,
} = mailhub;

function createMockEnv(initialKv = {}) {
	const kvMap = new Map(Object.entries(initialKv));
	const queuedJobs = [];
	return {
		KV: {
			async get(key, format) {
				const val = kvMap.get(key);
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
			async put(key, value) {
				kvMap.set(key, typeof value === "string" ? value : JSON.stringify(value));
			},
			async delete(key) {
				kvMap.delete(key);
			},
			_store: kvMap,
		},
		OUTBOUND_QUEUE: {
			async send(job, options) {
				queuedJobs.push({ job, options });
			},
			_jobs: queuedJobs,
		},
	};
}

const SAMPLE_MESSAGE = {
	from: "noreply@orbitsaas.cloud",
	to: ["recipient@example.com"],
	subject: "Test Failover Engine",
	html: "<p>Hello World</p>",
	text: "Hello World",
};

test.beforeEach(() => {
	LocalCircuitBreakerStore.getInstance().clear();
	LocalDlqStore.getInstance().clear();
	globalTelemetry.clear();
});

test("Scenario 1: Primary provider succeeds immediately on first attempt", async () => {
	const env = createMockEnv();
	const telemetryEvents = [];

	const candidates = [
		{
			providerCredId: "cred_brevo_1",
			provider: "brevo",
			dailySlice: 300,
			priority: 1,
			score: 950,
			eligible: true,
			breakdown: {},
			credential: { apiKey: "valid_brevo_key" },
		},
	];

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (url) => {
		if (String(url).includes("brevo.com")) {
			return new Response(JSON.stringify({ messageId: "<brevo-success-123@brevo.com>" }), {
				status: 201,
				headers: { "Content-Type": "application/json" },
			});
		}
		return new Response("Not Found", { status: 404 });
	};

	try {
		const result = await sendWithFailover({
			projectId: "proj_aurelia",
			message: SAMPLE_MESSAGE,
			candidates,
			env,
			telemetryHook: (ev) => telemetryEvents.push(ev),
		});

		assert.equal(result.success, true);
		assert.equal(result.queued, false);
		assert.equal(result.provider, "brevo");
		assert.equal(result.messageId, "<brevo-success-123@brevo.com>");
		assert.equal(result.failoverCount, 0);
		assert.equal(result.attempts.length, 1);
		assert.equal(result.attempts[0].code, "SUCCESS");

		// Telemetry verification
		assert.ok(telemetryEvents.some((e) => e.type === "attempt_start"));
		assert.ok(telemetryEvents.some((e) => e.type === "attempt_success"));
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("Scenario 2: Quota Exceeded on Brevo triggers failover to Resend without health penalty", async () => {
	const env = createMockEnv();
	const telemetryEvents = [];
	const circuitBreaker = new CircuitBreaker();

	const candidates = [
		{
			providerCredId: "cred_brevo_1",
			provider: "brevo",
			dailySlice: 120,
			priority: 1,
			score: 900,
			eligible: true,
			breakdown: {},
			credential: { apiKey: "key_brevo" },
		},
		{
			providerCredId: "cred_resend_2",
			provider: "resend",
			dailySlice: 100,
			priority: 2,
			score: 800,
			eligible: true,
			breakdown: {},
			credential: { apiKey: "key_resend" },
		},
	];

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (url) => {
		const urlStr = String(url);
		if (urlStr.includes("brevo.com")) {
			// Simulate Brevo 429 Daily Quota Limit Reached
			return new Response(JSON.stringify({ message: "Daily quota limit reached", code: "not_enough_credits" }), {
				status: 400,
				headers: { "Content-Type": "application/json" },
			});
		}
		if (urlStr.includes("resend.com")) {
			// Simulate Resend success
			return new Response(JSON.stringify({ id: "resend_msg_456" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		return new Response("Unknown endpoint", { status: 404 });
	};

	try {
		const result = await sendWithFailover({
			projectId: "proj_aurelia",
			message: SAMPLE_MESSAGE,
			candidates,
			circuitBreaker,
			env,
			telemetryHook: (ev) => telemetryEvents.push(ev),
		});

		assert.equal(result.success, true);
		assert.equal(result.queued, false);
		assert.equal(result.provider, "resend");
		assert.equal(result.failoverCount, 1);
		assert.equal(result.attempts.length, 2);
		assert.equal(result.attempts[0].code, "QUOTA_EXCEEDED");
		assert.equal(result.attempts[1].code, "SUCCESS");

		// Requirement: Brevo health score must NOT be penalized and circuit breaker must have 0 failures
		const brevoState = await circuitBreaker.getState("cred_brevo_1", env);
		assert.equal(brevoState.consecutiveFailures, 0);
		assert.equal(brevoState.healthScore, 1.0);
		assert.equal(brevoState.state, "closed");

		// Requirement: Quota slice marked exhausted in KV
		const kvStored = env.KV._store.get("quota:proj_aurelia:cred_brevo_1:" + new Date().toISOString().slice(0, 10));
		assert.ok(kvStored, "Quota must be recorded in KV");
		const parsedKv = JSON.parse(kvStored);
		assert.equal(parsedKv.exhausted, true);

		// Telemetry check
		assert.ok(telemetryEvents.some((e) => e.type === "quota_exhausted"));
		assert.ok(telemetryEvents.some((e) => e.type === "attempt_success" && e.provider === "resend"));
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("Scenario 3: Transient 5xx failure records against circuit breaker and fails over", async () => {
	const env = createMockEnv();
	const circuitBreaker = new CircuitBreaker();

	const candidates = [
		{
			providerCredId: "cred_resend_1",
			provider: "resend",
			dailySlice: 100,
			priority: 1,
			score: 900,
			eligible: true,
			breakdown: {},
			credential: { apiKey: "key_resend" },
		},
		{
			providerCredId: "cred_brevo_backup",
			provider: "brevo",
			dailySlice: 300,
			priority: 2,
			score: 700,
			eligible: true,
			breakdown: {},
			credential: { apiKey: "key_brevo" },
		},
	];

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (url) => {
		const urlStr = String(url);
		if (urlStr.includes("resend.com")) {
			// 503 Service Unavailable
			return new Response("Service Unavailable - Maintenance", { status: 503 });
		}
		if (urlStr.includes("brevo.com")) {
			// Brevo backup succeeds
			return new Response(JSON.stringify({ messageId: "<brevo-backup-789@brevo.com>" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		return new Response("Not found", { status: 404 });
	};

	try {
		const result = await sendWithFailover({
			projectId: "proj_lifesolver",
			message: SAMPLE_MESSAGE,
			candidates,
			circuitBreaker,
			env,
		});

		assert.equal(result.success, true);
		assert.equal(result.provider, "brevo");
		assert.equal(result.failoverCount, 1);
		assert.equal(result.attempts[0].code, "TRANSIENT_SERVER_ERROR");
		assert.equal(result.attempts[1].code, "SUCCESS");

		// Circuit Breaker on Resend should have recorded 1 failure
		const resendState = await circuitBreaker.getState("cred_resend_1", env);
		assert.equal(resendState.consecutiveFailures, 1);
		assert.equal(resendState.state, "closed"); // Still closed since < 3
		assert.ok(resendState.healthScore < 1.0, "Health score should degrade on 5xx failure");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("Scenario 4: 3-Strike Isolation trips circuit to OPEN and fast-bypasses subsequent calls", async () => {
	const env = createMockEnv();
	const circuitBreaker = new CircuitBreaker({
		failureThreshold: 3,
		failureWindowMs: 5 * 60 * 1000,
		quarantineDurationMs: 15 * 60 * 1000,
	});

	const originalFetch = globalThis.fetch;
	// Mock Resend to consistently throw 500
	globalThis.fetch = async () => new Response("Internal Server Error", { status: 500 });

	const candidateResend = {
		providerCredId: "cred_resend_failing",
		provider: "resend",
		dailySlice: 100,
		priority: 1,
		score: 900,
		eligible: true,
		breakdown: {},
		credential: { apiKey: "key_resend" },
	};

	try {
		// Strike 1
		await sendWithFailover({
			projectId: "proj_luvio",
			message: SAMPLE_MESSAGE,
			candidates: [candidateResend],
			circuitBreaker,
			env,
		});
		let state = await circuitBreaker.getState("cred_resend_failing", env);
		assert.equal(state.consecutiveFailures, 1);
		assert.equal(state.state, "closed");

		// Strike 2
		await sendWithFailover({
			projectId: "proj_luvio",
			message: SAMPLE_MESSAGE,
			candidates: [candidateResend],
			circuitBreaker,
			env,
		});
		state = await circuitBreaker.getState("cred_resend_failing", env);
		assert.equal(state.consecutiveFailures, 2);
		assert.equal(state.state, "closed");

		// Strike 3 (trips circuit!)
		await sendWithFailover({
			projectId: "proj_luvio",
			message: SAMPLE_MESSAGE,
			candidates: [candidateResend],
			circuitBreaker,
			env,
		});
		state = await circuitBreaker.getState("cred_resend_failing", env);
		assert.equal(state.consecutiveFailures, 3);
		assert.equal(state.state, "open");
		assert.equal(state.healthScore, 0.0);
		assert.ok(state.trippedAt, "trippedAt timestamp must be recorded");

		// 4th send attempt: should immediately fast-bypass without calling network
		let networkCalled = false;
		globalThis.fetch = async () => {
			networkCalled = true;
			return new Response("OK", { status: 200 });
		};

		const bypassResult = await sendWithFailover({
			projectId: "proj_luvio",
			message: SAMPLE_MESSAGE,
			candidates: [candidateResend],
			circuitBreaker,
			env,
		});

		assert.equal(networkCalled, false, "Network fetch must NOT be called when circuit is OPEN");
		assert.equal(bypassResult.queued, true);
		assert.equal(bypassResult.failedAttempts[0].code, "CIRCUIT_OPEN");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("Scenario 5: Quarantine expiration leads to HALF_OPEN probe and full recovery", async () => {
	const env = createMockEnv();
	// Use small quarantine duration of 80ms for test
	const circuitBreaker = new CircuitBreaker({
		failureThreshold: 3,
		failureWindowMs: 5000,
		quarantineDurationMs: 80,
	});

	const credId = "cred_recovering_provider";
	const now = Date.now();

	// Force state to OPEN with timestamp = now
	await circuitBreaker.recordFailure(credId, { message: "Fail 1", code: "TRANSIENT_SERVER_ERROR" }, env, now);
	await circuitBreaker.recordFailure(credId, { message: "Fail 2", code: "TRANSIENT_SERVER_ERROR" }, env, now);
	await circuitBreaker.recordFailure(credId, { message: "Fail 3", code: "TRANSIENT_SERVER_ERROR" }, env, now);

	let state = await circuitBreaker.getState(credId, env, now);
	assert.equal(state.state, "open");
	assert.equal(state.consecutiveFailures, 3);

	// Advance time past quarantine (now + 100ms > 80ms)
	const futureTime = now + 100;
	state = await circuitBreaker.getState(credId, env, futureTime);
	assert.equal(state.state, "half-open");

	const canExec = await circuitBreaker.canExecute(credId, env, futureTime);
	assert.equal(canExec.allowed, true);
	assert.equal(canExec.isProbe, true);

	// Probe succeeds!
	await circuitBreaker.recordSuccess(credId, env, futureTime);
	state = await circuitBreaker.getState(credId, env, futureTime);
	assert.equal(state.state, "closed");
	assert.equal(state.consecutiveFailures, 0);
	assert.equal(state.healthScore, 1.0);
});

test("Scenario 6: Hard Reject on INVALID_PAYLOAD without waterfall failover", async () => {
	const env = createMockEnv();
	const candidates = [
		{
			providerCredId: "cred_brevo",
			provider: "brevo",
			dailySlice: 300,
			priority: 1,
			score: 900,
			eligible: true,
			breakdown: {},
		},
		{
			providerCredId: "cred_resend",
			provider: "resend",
			dailySlice: 100,
			priority: 2,
			score: 800,
			eligible: true,
			breakdown: {},
		},
	];

	// Invalid message: malformed email
	const badMessage = {
		from: "not-an-email",
		to: ["bad-recipient"],
		subject: "Test",
	};

	let errorThrown;
	try {
		await sendWithFailover({
			projectId: "proj_aurelia",
			message: badMessage,
			candidates,
			env,
		});
	} catch (err) {
		errorThrown = err;
	}

	assert.ok(errorThrown, "Should throw on invalid payload");
	assert.equal(errorThrown.code, "INVALID_PAYLOAD");
});

test("Scenario 7: Total Candidate Failure enqueues to DLQ and returns graceful 202 Accepted", async () => {
	const env = createMockEnv();
	const telemetryEvents = [];

	const candidates = [
		{
			providerCredId: "cred_brevo_down",
			provider: "brevo",
			dailySlice: 120,
			priority: 1,
			score: 900,
			eligible: true,
			breakdown: {},
			credential: { apiKey: "key1" },
		},
		{
			providerCredId: "cred_resend_down",
			provider: "resend",
			dailySlice: 80,
			priority: 2,
			score: 800,
			eligible: true,
			breakdown: {},
			credential: { apiKey: "key2" },
		},
	];

	// Both fail with 500
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response("Outage", { status: 500 });

	try {
		const result = await sendWithFailover({
			projectId: "proj_ovijatric",
			message: SAMPLE_MESSAGE,
			candidates,
			env,
			telemetryHook: (ev) => telemetryEvents.push(ev),
		});

		assert.equal(result.success, false);
		assert.equal(result.queued, true);
		assert.equal(result.statusCode, 202);
		assert.ok(result.deliveryId.startsWith("dlv_"));
		assert.equal(result.failedAttempts.length, 2);
		assert.equal(result.nextRetryDelaySeconds, 30); // First backoff attempt = 30s

		// Check job recorded in DLQ store
		const dlqJob = LocalDlqStore.getInstance().get(result.deliveryId);
		assert.ok(dlqJob, "Job must exist in DLQ store");
		assert.equal(dlqJob.projectId, "proj_ovijatric");
		assert.equal(dlqJob.retryCount, 0);

		// Check job enqueued in Cloudflare Queue mock
		assert.equal(env.OUTBOUND_QUEUE._jobs.length, 1);
		assert.equal(env.OUTBOUND_QUEUE._jobs[0].options.delaySeconds, 30);

		// Telemetry check
		assert.ok(telemetryEvents.some((e) => e.type === "all_exhausted_queued"));
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("Scenario 8: Exponential backoff calculation schedule", () => {
	assert.equal(getExponentialBackoffSeconds(0), 30); // 30s
	assert.equal(getExponentialBackoffSeconds(1), 120); // 2m
	assert.equal(getExponentialBackoffSeconds(2), 600); // 10m
	assert.equal(getExponentialBackoffSeconds(3), 1800); // 30m
	assert.equal(getExponentialBackoffSeconds(4), 3600); // 1h
	assert.equal(getExponentialBackoffSeconds(10), 3600); // Cap at max
});
