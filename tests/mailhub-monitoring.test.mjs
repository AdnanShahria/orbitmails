import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "mailhub-monitoring-test-"));
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
		alias: { "@": join(root, "src"), "@/server": join(root, "server") },
	});
	return import(pathToFileURL(join(outDir, outfile)).href);
}

const monitoring = await bundle("src/lib/mailhub/monitoring/index.ts", "monitoring.mjs");
const {
	checkQuotaThresholds,
	checkCircuitBreakers,
	checkDeadLetterQueue,
	generateDailyDigestData,
	sendDailyDigest,
	runHealthMonitoringJob,
	runDailyDigestJob,
	renderQuotaAlert,
	renderCircuitBreakerAlert,
	renderDeadLetterAlert,
	renderDailyDigest,
	isAlertSuppressed,
	markAlertDispatched,
	DEFAULT_ALERT_THRESHOLDS,
} = monitoring;

test("1. Quota Threshold Alert (>85% consumed before midday)", async () => {
	// Create mock environment
	const mockEnv = {
		MAILHUB_ADMIN_EMAIL: "developer@orbitsaas.cloud",
		KV: {
			data: new Map(),
			async get(key) {
				return this.data.get(key) || null;
			},
			async put(key, val) {
				this.data.set(key, val);
			},
		},
		EMAIL: {
			sentMessages: [],
			async send(msg) {
				this.sentMessages.push(msg);
				return { messageId: "msg_quota_test_001" };
			},
		},
	};

	// Mock 10:00 AM UTC (before midday cutoff of 12:00)
	const tenAmUtc = new Date("2026-11-02T10:00:00Z");

	// Project Aurelia: slice is 120. It has consumed 105 emails (87.5% > 85%)
	const mockAllocations = [
		{
			projectId: "proj_aurelia",
			projectName: "Aurelia",
			providerCredId: "cred_brevo_main",
			providerName: "Brevo Shared",
			dailySlice: 120,
		},
		{
			projectId: "proj_lifesolver",
			projectName: "LifeSolver",
			providerCredId: "cred_brevo_main",
			providerName: "Brevo Shared",
			dailySlice: 80,
		},
	];

	// Put usage count in mock KV
	mockEnv.KV.data.set("quota:proj_aurelia:cred_brevo_main:2026-11-02", { used: 105 });
	mockEnv.KV.data.set("quota:proj_lifesolver:cred_brevo_main:2026-11-02", { used: 40 }); // 50% - should not alert

	const alerts = await checkQuotaThresholds(mockEnv, tenAmUtc, {
		allocationsOverride: mockAllocations,
	});

	assert.equal(alerts.length, 1, "Exactly one project should breach 85% threshold");
	assert.equal(alerts[0].projectId, "proj_aurelia");
	assert.equal(alerts[0].usedToday, 105);
	assert.equal(alerts[0].remaining, 15);
	assert.equal(alerts[0].percentage, 87.5);
	assert.equal(alerts[0].hourUtc, 10);
	assert.ok(alerts[0].estimatedDepletionHours > 0, "Should compute estimated hours to depletion");

	// Verify email was sent to developer
	assert.equal(mockEnv.EMAIL.sentMessages.length, 1);
	const sent = mockEnv.EMAIL.sentMessages[0];
	assert.match(sent.subject, /87.5%/);
	assert.match(sent.html, /Aurelia/);
	assert.match(sent.html, /Brevo Shared/);
	assert.match(sent.html, /progress-bar-fill/);

	// Verify deduplication: a subsequent check within the same day does not resend
	const alertsSecondRun = await checkQuotaThresholds(mockEnv, tenAmUtc, {
		allocationsOverride: mockAllocations,
	});
	assert.equal(alertsSecondRun.length, 1, "Alert is detected");
	assert.equal(mockEnv.EMAIL.sentMessages.length, 1, "Email is suppressed on duplicate run");

	// Verify midday cutoff: Same usage at 1:00 PM UTC (13:00) should NOT trigger morning warning
	const onePmUtc = new Date("2026-11-02T13:00:00Z");
	const afternoonAlerts = await checkQuotaThresholds(mockEnv, onePmUtc, {
		allocationsOverride: mockAllocations,
	});
	assert.equal(afternoonAlerts.length, 0, "No early warning sent after 12:00 PM UTC");
});

test("2. Provider Circuit Breaker Alert (3 consecutive failures)", async () => {
	const mockEnv = {
		MAILHUB_ADMIN_EMAIL: "admin@orbitsaas.cloud",
		EMAIL: {
			sentMessages: [],
			async send(msg) {
				this.sentMessages.push(msg);
				return { messageId: "msg_cb_test_001" };
			},
		},
	};

	const now = new Date("2026-11-02T14:30:00Z");

	const mockProviders = [
		{
			providerCredId: "cred_brevo_main",
			providerName: "Brevo Primary Account",
			circuitState: "open",
			consecutiveFailures: 3,
			lastError: "Brevo API HTTP 503 Service Unavailable (Gateway Timeout)",
			trippedAt: now.getTime() - 60000,
			affectedProjects: ["Aurelia", "LifeSolver", "Luvio"],
			fallbackProvider: "Resend Secondary",
		},
		{
			providerCredId: "cred_resend_main",
			providerName: "Resend Secondary",
			circuitState: "closed",
			consecutiveFailures: 0,
		},
	];

	const alerts = await checkCircuitBreakers(mockEnv, now, {
		providersOverride: mockProviders,
	});

	assert.equal(alerts.length, 1, "Should detect 1 tripped circuit breaker");
	assert.equal(alerts[0].providerCredId, "cred_brevo_main");
	assert.equal(alerts[0].consecutiveFailures, 3);
	assert.equal(alerts[0].circuitState, "open");
	assert.match(alerts[0].lastError, /503 Service Unavailable/);
	assert.equal(alerts[0].fallbackProvider, "Resend Secondary");

	// Verify email was dispatched
	assert.equal(mockEnv.EMAIL.sentMessages.length, 1);
	const sent = mockEnv.EMAIL.sentMessages[0];
	assert.match(sent.subject, /🚨 \[MailHub CRITICAL\]/);
	assert.match(sent.subject, /Brevo Primary Account/);
	assert.match(sent.html, /503 Service Unavailable/);
	assert.match(sent.html, /Isolation Window/);
});

test("3. Dead Letter Queue (DLQ) Critical Alert", async () => {
	const mockEnv = {
		MAILHUB_ADMIN_EMAIL: "admin@orbitsaas.cloud",
		EMAIL: {
			sentMessages: [],
			async send(msg) {
				this.sentMessages.push(msg);
				return { messageId: "msg_dlq_test_001" };
			},
		},
	};

	const now = new Date("2026-11-02T15:00:00Z");
	const mockDlq = [
		{
			dlqId: "dlq_msg_8849204",
			projectId: "proj_aurelia",
			projectName: "Aurelia",
			recipient: "user@example.com",
			subject: "Your Aurelia Verification Code",
			attemptedProviders: [
				{ provider: "brevo", error: "401 Unauthorized" },
				{ provider: "resend", error: "Rate limit exceeded" },
				{ provider: "ses", error: "Account sending paused" },
			],
			lastError: "SES: Account sending paused",
			enqueuedAt: now.getTime() - 120000,
		},
	];

	const alerts = await checkDeadLetterQueue(mockEnv, now, {
		dlqOverride: mockDlq,
	});

	assert.equal(alerts.length, 1);
	assert.equal(alerts[0].dlqId, "dlq_msg_8849204");
	assert.equal(alerts[0].recipient, "user@example.com");
	assert.equal(alerts[0].attemptedProviders.length, 3);

	// Verify email
	assert.equal(mockEnv.EMAIL.sentMessages.length, 1);
	const sent = mockEnv.EMAIL.sentMessages[0];
	assert.match(sent.subject, /🔥 \[MailHub CRITICAL\]/);
	assert.match(sent.html, /dlq_msg_8849204/);
	assert.match(sent.html, /user@example.com/);
	assert.match(sent.html, /Your Aurelia Verification Code/);
});

test("4. Daily Developer Digest (8:00 AM UTC)", async () => {
	const mockEnv = {
		MAILHUB_ADMIN_EMAIL: "admin@orbitsaas.cloud",
		EMAIL: {
			sentMessages: [],
			async send(msg) {
				this.sentMessages.push(msg);
				return { messageId: "msg_digest_test_001" };
			},
		},
	};

	const digestData = await generateDailyDigestData(mockEnv, "2026-11-01");
	assert.equal(digestData.type, "daily_digest");
	assert.ok(digestData.totalSent > 0);
	assert.ok(digestData.deliverySuccessRatePct >= 99);
	assert.ok(digestData.projects.length >= 4);
	assert.ok(digestData.providers.length >= 3);
	assert.ok(digestData.recommendations.length > 0);

	// Render templates
	const rendered = renderDailyDigest(digestData, "https://orbitmails.cloud");
	assert.match(rendered.subject, /Daily Developer Briefing/);
	assert.match(rendered.html, /Project Utilization Breakdown/);
	assert.match(rendered.html, /Provider Reliability & Latency Matrix/);
	assert.match(rendered.text, /PROJECT USAGE SUMMARY/);

	// Test dispatch function
	const summary = await sendDailyDigest(mockEnv, "2026-11-01");
	assert.equal(summary.sent, true);
	assert.equal(summary.recipient, "admin@orbitsaas.cloud");
	assert.ok(summary.projectsSummarized >= 4);
	assert.ok(summary.providersSummarized >= 3);
});

test("5. Health Monitoring & Daily Digest Cron Runners", async () => {
	const mockEnv = {
		MAILHUB_ADMIN_EMAIL: "admin@orbitsaas.cloud",
		EMAIL: {
			sentMessages: [],
			async send(msg) {
				this.sentMessages.push(msg);
				return { messageId: "msg_runner_test" };
			},
		},
	};

	const now = new Date("2026-11-05T08:00:00Z");

	// 10-Minute Health Job
	const healthSummary = await runHealthMonitoringJob(mockEnv, now);
	assert.ok(healthSummary.durationMs >= 0);
	assert.equal(healthSummary.errors.length, 0);

	// 8:00 AM Daily Digest Job
	const digestSummary = await runDailyDigestJob(mockEnv, now);
	assert.equal(digestSummary.sent, true);
	assert.ok(digestSummary.totalVolume > 0);
});

test("6. Alert Deduplication & TTL Suppression", async () => {
	const mockEnv = {
		KV: {
			data: new Map(),
			async get(key) {
				return this.data.get(key) || null;
			},
			async put(key, val) {
				this.data.set(key, val);
			},
		},
	};

	const testKey = "alert:test:quota:proj_test_01";
	assert.equal(await isAlertSuppressed(testKey, mockEnv), false);

	await markAlertDispatched(testKey, 3600, mockEnv);
	assert.equal(await isAlertSuppressed(testKey, mockEnv), true);
});
