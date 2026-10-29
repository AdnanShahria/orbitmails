import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "mailhub-webhooks-test-"));
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

const webhooksModule = await bundle("src/lib/mailhub/webhooks/index.ts", "webhooks.mjs");
const {
	normalizeWebhookPayload,
	normalizeResendPayload,
	normalizeBrevoPayload,
	normalizeSesPayload,
	normalizeMailgunPayload,
	verifyMailgunWebhook,
	verifyBrevoWebhook,
	hmacSha256Hex,
	timingSafeEqualStrings,
	evaluateProviderHealth,
	recordSuppression,
	isEmailSuppressed,
	removeSuppression,
	processInboundWebhook,
	BOUNCE_RATE_DEGRADED_THRESHOLD,
	BOUNCE_RATE_CRITICAL_THRESHOLD,
} = webhooksModule;

test("WP-09: Resend Payload Normalization", () => {
	// 1. Delivered event
	const deliveredPayload = {
		type: "email.delivered",
		created_at: "2026-11-02T16:00:00.000Z",
		data: {
			email_id: "resend_msg_001",
			from: "billing@aurelia.com",
			to: ["customer@example.com"],
			subject: "Your Invoice",
			tags: { project_id: "proj_aurelia" },
		},
	};
	const deliveredEvents = normalizeResendPayload(deliveredPayload);
	assert.equal(deliveredEvents.length, 1);
	assert.equal(deliveredEvents[0].eventType, "delivered");
	assert.equal(deliveredEvents[0].provider, "resend");
	assert.equal(deliveredEvents[0].providerMessageId, "resend_msg_001");
	assert.equal(deliveredEvents[0].recipient, "customer@example.com");
	assert.equal(deliveredEvents[0].projectId, "proj_aurelia");

	// 2. Hard Bounce event
	const hardBouncePayload = {
		type: "email.bounced",
		created_at: "2026-11-02T16:05:00.000Z",
		data: {
			id: "resend_msg_002",
			to: ["invalid-user@badhost.xyz"],
			bounce: {
				type: "hard",
				message: "550 5.1.1 User unknown",
			},
			tags: { project_id: "proj_aurelia" },
		},
	};
	const bounceEvents = normalizeResendPayload(hardBouncePayload);
	assert.equal(bounceEvents.length, 1);
	assert.equal(bounceEvents[0].eventType, "bounced");
	assert.equal(bounceEvents[0].subType, "hard");
	assert.equal(bounceEvents[0].reason, "550 5.1.1 User unknown");
	assert.equal(bounceEvents[0].recipient, "invalid-user@badhost.xyz");

	// 3. Spam complaint
	const complaintPayload = {
		type: "email.complained",
		data: {
			email_id: "resend_msg_003",
			to: ["angry-user@example.com"],
			complaint: {
				type: "abuse",
				message: "Marked as spam by user",
			},
		},
	};
	const complaintEvents = normalizeResendPayload(complaintPayload);
	assert.equal(complaintEvents.length, 1);
	assert.equal(complaintEvents[0].eventType, "complaint");
	assert.equal(complaintEvents[0].subType, "abuse");
});

test("WP-09: Brevo Payload Normalization", () => {
	// Single object event
	const brevoSingle = {
		event: "hard_bounce",
		email: "test.bounced@domain.org",
		"message-id": "<brevo_abc123@domain.org>",
		date: "2026-11-02 16:10:00",
		reason: "smtp; 550 Invalid recipient",
		tag: "proj_lifesolver",
	};
	const singleEvents = normalizeBrevoPayload(brevoSingle);
	assert.equal(singleEvents.length, 1);
	assert.equal(singleEvents[0].eventType, "bounced");
	assert.equal(singleEvents[0].subType, "hard");
	assert.equal(singleEvents[0].providerMessageId, "brevo_abc123@domain.org");
	assert.equal(singleEvents[0].recipient, "test.bounced@domain.org");
	assert.equal(singleEvents[0].projectId, "proj_lifesolver");

	// Array of events (Brevo batch delivery)
	const brevoBatch = [
		{
			event: "delivered",
			email: "user1@domain.org",
			"message-id": "msg_batch_1",
		},
		{
			event: "spam",
			email: "user2@domain.org",
			"message-id": "msg_batch_2",
		},
	];
	const batchEvents = normalizeBrevoPayload(brevoBatch);
	assert.equal(batchEvents.length, 2);
	assert.equal(batchEvents[0].eventType, "delivered");
	assert.equal(batchEvents[1].eventType, "complaint");
});

test("WP-09: Amazon SES Payload Normalization", () => {
	// SNS Wrapped SES Bounce Notification
	const sesMessage = JSON.stringify({
		eventType: "Bounce",
		mail: {
			messageId: "ses_raw_msg_999",
			destination: ["recipient@example.com"],
			tags: { project_id: ["proj_luvio"] },
		},
		bounce: {
			bounceType: "Permanent",
			bounceSubType: "General",
			bouncedRecipients: [
				{
					emailAddress: "recipient@example.com",
					diagnosticCode: "smtp; 550 5.1.1 Mailbox does not exist",
				},
			],
			timestamp: "2026-11-02T16:15:00.000Z",
		},
	});

	const snsEnvelope = {
		Type: "Notification",
		MessageId: "sns_envelope_id",
		Message: sesMessage,
	};

	const sesEvents = normalizeSesPayload(snsEnvelope);
	assert.equal(sesEvents.length, 1);
	assert.equal(sesEvents[0].eventType, "bounced");
	assert.equal(sesEvents[0].subType, "hard");
	assert.equal(sesEvents[0].provider, "ses");
	assert.equal(sesEvents[0].providerMessageId, "ses_raw_msg_999");
	assert.equal(sesEvents[0].recipient, "recipient@example.com");
	assert.equal(sesEvents[0].projectId, "proj_luvio");
	assert.match(sesEvents[0].reason, /Mailbox does not exist/);
});

test("WP-09: Mailgun Payload Normalization", () => {
	const mailgunPayload = {
		"event-data": {
			event: "failed",
			severity: "permanent",
			recipient: "mg-fail@target.com",
			timestamp: 1730560000,
			reason: "bounce",
			"delivery-status": {
				message: "550 Requested action not taken: mailbox unavailable",
			},
			message: {
				headers: {
					"message-id": "<mailgun_msg_777@domain.com>",
				},
			},
			"user-variables": {
				project_id: "proj_ovijatric",
			},
		},
	};

	const mgEvents = normalizeMailgunPayload(mailgunPayload);
	assert.equal(mgEvents.length, 1);
	assert.equal(mgEvents[0].eventType, "bounced");
	assert.equal(mgEvents[0].subType, "hard");
	assert.equal(mgEvents[0].provider, "mailgun");
	assert.equal(mgEvents[0].providerMessageId, "mailgun_msg_777@domain.com");
	assert.equal(mgEvents[0].recipient, "mg-fail@target.com");
	assert.equal(mgEvents[0].projectId, "proj_ovijatric");
	assert.match(mgEvents[0].reason, /mailbox unavailable/);
});

test("WP-09: Cryptographic Signature Verification", async () => {
	// 1. Mailgun HMAC verification
	const signingKey = "key-test-mailgun-secret-12345";
	const timestamp = Math.floor(Date.now() / 1000);
	const token = "rand-token-abc-987";
	const validSig = await hmacSha256Hex(signingKey, `${timestamp}${token}`);

	// Valid signature
	const validResult = await verifyMailgunWebhook(signingKey, {
		timestamp,
		token,
		signature: validSig,
	});
	assert.equal(validResult.valid, true);

	// Tampered signature
	const tamperedResult = await verifyMailgunWebhook(signingKey, {
		timestamp,
		token,
		signature: "0000000000000000000000000000000000000000000000000000000000000000",
	});
	assert.equal(tamperedResult.valid, false);

	// Expired timestamp (replay attack)
	const expiredTimestamp = timestamp - 3600; // 1 hour ago
	const expiredSig = await hmacSha256Hex(signingKey, `${expiredTimestamp}${token}`);
	const replayResult = await verifyMailgunWebhook(signingKey, {
		timestamp: expiredTimestamp,
		token,
		signature: expiredSig,
	});
	assert.equal(replayResult.valid, false);
	assert.match(replayResult.error, /expired/);

	// 2. Brevo Token & HMAC verification
	const brevoSecret = "brevo-webhook-secret-token-xyz";
	const tokenCheck = await verifyBrevoWebhook(brevoSecret, {}, brevoSecret);
	assert.equal(tokenCheck.valid, true);

	const badTokenCheck = await verifyBrevoWebhook(brevoSecret, {}, "wrong-token");
	assert.equal(badTokenCheck.valid, false);

	// Brevo HMAC signature
	const body = JSON.stringify({ event: "delivered", email: "test@example.com" });
	const brevoHmac = await hmacSha256Hex(brevoSecret, body);
	const hmacCheck = await verifyBrevoWebhook(brevoSecret, { signature: brevoHmac }, null, body);
	assert.equal(hmacCheck.valid, true);
});

test("WP-09: Provider Health Evaluation & Automatic Down-Ranking Thresholds", () => {
	// 1. Under statistical significance (< 10 total volume) -> healthy
	const lowVolume = evaluateProviderHealth({
		totalSent: 5,
		deliveredCount: 4,
		bounceCount: 1, // 20% but only 5 sends
		complaintCount: 0,
	});
	assert.equal(lowVolume.status, "healthy");
	assert.equal(lowVolume.healthScore, 1.0);
	assert.equal(lowVolume.alertTriggered, false);

	// 2. Normal Volume with low bounce rate (< 5%) -> healthy
	const normal = evaluateProviderHealth({
		totalSent: 100,
		deliveredCount: 97,
		bounceCount: 3, // 3% bounce rate
		complaintCount: 0,
	});
	assert.equal(normal.status, "healthy");
	assert.equal(normal.healthScore, 1.0);
	assert.equal(normal.circuitState, "closed");
	assert.equal(normal.alertTriggered, false);

	// 3. Elevated Bounce Rate (> 5%) -> Degraded & Down-ranked
	const degraded = evaluateProviderHealth({
		totalSent: 100,
		deliveredCount: 93,
		bounceCount: 7, // 7% bounce rate > 5% threshold
		complaintCount: 0,
	});
	assert.equal(degraded.status, "degraded");
	assert.equal(degraded.circuitState, "closed");
	assert.ok(degraded.healthScore < 1.0); // Health reduced
	assert.equal(degraded.alertTriggered, true);
	assert.match(degraded.alertMessage, /> 5% threshold/);

	// 4. Critical Runaway Bounce Rate (> 10%) -> Circuit Breaker Tripped (Open)
	const runaway = evaluateProviderHealth({
		totalSent: 100,
		deliveredCount: 88,
		bounceCount: 12, // 12% bounce rate > 10% critical threshold
		complaintCount: 0,
	});
	assert.equal(runaway.status, "circuit_broken");
	assert.equal(runaway.circuitState, "open");
	assert.equal(runaway.healthScore, 0.0);
	assert.equal(runaway.alertTriggered, true);
	assert.match(runaway.alertMessage, /Circuit breaker tripped/);
});

test("WP-09: Suppression List Maintenance & Multi-Tier Lookup", async () => {
	// Mock Cloudflare KV & D1 environment
	const kvStore = new Map();
	const mockEnv = {
		KV: {
			get: async (k) => kvStore.get(k) || null,
			put: async (k, v) => kvStore.set(k, JSON.parse(v)),
			delete: async (k) => kvStore.delete(k),
		},
	};

	const testEmail = "bad-mailbox-99@example.com";

	// Initial state: not suppressed
	const check1 = await isEmailSuppressed(mockEnv, testEmail);
	assert.equal(check1.suppressed, false);

	// Record hard bounce suppression
	const record = await recordSuppression(mockEnv, {
		recipient: testEmail,
		reason: "hard_bounce",
		subType: "hard",
		provider: "brevo",
		details: "550 User does not exist",
	});
	assert.equal(record.recipient, testEmail);
	assert.equal(record.reason, "hard_bounce");

	// Verified in suppression list
	const check2 = await isEmailSuppressed(mockEnv, testEmail);
	assert.equal(check2.suppressed, true);
	assert.equal(check2.reason, "hard_bounce");

	// Test case-insensitive lookup
	const checkUpper = await isEmailSuppressed(mockEnv, "BAD-MAILBOX-99@EXAMPLE.COM");
	assert.equal(checkUpper.suppressed, true);

	// Admin unsuppress
	await removeSuppression(mockEnv, testEmail);
	const check3 = await isEmailSuppressed(mockEnv, testEmail);
	assert.equal(check3.suppressed, false);
});

test("WP-09: End-to-End Webhook Ingestion & Pipeline Orchestration", async () => {
	const kvStore = new Map();
	const sqlExecutions = [];

	const mockEnv = {
		KV: {
			get: async (k) => kvStore.get(k) || null,
			put: async (k, v) => kvStore.set(k, JSON.parse(v)),
			delete: async (k) => kvStore.delete(k),
		},
		DB: {
			prepare: (query) => ({
				bind: (...args) => ({
					run: async () => {
						sqlExecutions.push({ query, args });
						return { changes: 1 };
					},
					first: async () => null,
					all: async () => ({ results: [] }),
				}),
			}),
			exec: async (sql) => {
				sqlExecutions.push({ query: sql, args: [] });
			},
		},
	};

	// Simulated Resend Hard Bounce Webhook
	const resendPayload = {
		type: "email.bounced",
		created_at: new Date().toISOString(),
		data: {
			email_id: "resend_msg_12345",
			to: ["recipient-dead@company.xyz"],
			bounce: {
				type: "hard",
				message: "550 No such user",
			},
			tags: { project_id: "proj_aurelia" },
		},
	};

	const result = await processInboundWebhook(
		"resend",
		new Request("https://mailhub.internal/api/v1/webhooks/resend", {
			method: "POST",
			body: JSON.stringify(resendPayload),
		}),
		JSON.stringify(resendPayload),
		mockEnv,
		{ skipVerification: true },
	);

	assert.equal(result.success, true);
	assert.equal(result.processedCount, 1);
	assert.equal(result.suppressionsAdded, 1);
	assert.equal(result.events[0].eventType, "bounced");
	assert.equal(result.events[0].subType, "hard");
	assert.equal(result.events[0].providerMessageId, "resend_msg_12345");

	// Verify that suppression was recorded in KV
	const isSuppressed = await isEmailSuppressed(mockEnv, "recipient-dead@company.xyz");
	assert.equal(isSuppressed.suppressed, true);

	// Verify that send_log was updated in D1
	const sendLogUpdate = sqlExecutions.find((x) => x.query.includes("UPDATE send_log"));
	assert.ok(sendLogUpdate, "send_log table must be updated with bounce status");
	assert.equal(sendLogUpdate.args[0], "hard_bounce");
	assert.equal(sendLogUpdate.args[2], "resend_msg_12345");
});

test("WP-09: Soft Bounces Do NOT Add To Suppression List", async () => {
	const kvStore = new Map();
	const mockEnv = {
		KV: {
			get: async (k) => kvStore.get(k) || null,
			put: async (k, v) => kvStore.set(k, JSON.parse(v)),
			delete: async (k) => kvStore.delete(k),
		},
		DB: {
			prepare: () => ({
				bind: () => ({
					run: async () => ({ changes: 1 }),
					first: async () => null,
					all: async () => ({ results: [] }),
				}),
			}),
			exec: async () => {},
		},
	};

	const softBouncePayload = {
		type: "email.bounced",
		created_at: new Date().toISOString(),
		data: {
			email_id: "resend_soft_1",
			to: ["full-mailbox@server.com"],
			bounce: {
				type: "soft",
				message: "452 Mailbox quota exceeded",
			},
		},
	};

	const result = await processInboundWebhook(
		"resend",
		new Request("https://mailhub.internal/api/v1/webhooks/resend", {
			method: "POST",
			body: JSON.stringify(softBouncePayload),
		}),
		JSON.stringify(softBouncePayload),
		mockEnv,
		{ skipVerification: true },
	);

	assert.equal(result.success, true);
	assert.equal(result.processedCount, 1);
	assert.equal(result.suppressionsAdded, 0, "Soft bounce must not trigger recipient suppression");

	const check = await isEmailSuppressed(mockEnv, "full-mailbox@server.com");
	assert.equal(check.suppressed, false);
});

