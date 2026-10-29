import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "mailhub-adapters-"));
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

const mailhub = await bundle("src/lib/mailhub/providers/index.ts", "mailhub-providers.mjs");

test("MailHub Crypto: encryptCredential and decryptCredential roundtrip", async () => {
	const secret = "test-master-secret-key-32chars!";
	const originalApiKey = "re_1234567890abcdefghijklmnopqrstuvwxyz";

	const encrypted = await mailhub.encryptCredential(originalApiKey, secret);
	assert.ok(encrypted.startsWith("enc:v1:"), "Encrypted ciphertext should have enc:v1: prefix");
	assert.notEqual(encrypted, originalApiKey, "Encrypted text should not equal plaintext");

	const decrypted = await mailhub.decryptCredential(encrypted, secret);
	assert.equal(decrypted, originalApiKey, "Decrypted text should match original");
});

test("MailHub Crypto: unencrypted legacy keys pass through transparently", async () => {
	const secret = "test-master-secret-key-32chars!";
	const legacyKey = "brevo_legacy_raw_api_key_12345";

	const decrypted = await mailhub.decryptCredential(legacyKey, secret);
	assert.equal(decrypted, legacyKey, "Plaintext key should pass through unchanged");
});

test("MailHub Crypto: tamper detection fails securely", async () => {
	const secret = "test-master-secret-key-32chars!";
	const original = "super-secret-ses-key";
	const encrypted = await mailhub.encryptCredential(original, secret);

	// Modify ciphertext
	const parts = encrypted.split(":");
	parts[4] = parts[4].slice(0, -4) + "AAAA";
	const tampered = parts.join(":");

	await assert.rejects(
		() => mailhub.decryptCredential(tampered, secret),
		/Failed to decrypt credential/i,
		"Tampered payload should reject",
	);

	// Wrong secret
	await assert.rejects(
		() => mailhub.decryptCredential(encrypted, "wrong-secret-key-32-chars-long!"),
		/Failed to decrypt credential/i,
		"Wrong secret should reject",
	);
});

test("MailHub Crypto: decryptCredentialsRecord handles nested objects", async () => {
	const secret = "test-master-secret-key-32chars!";
	const rawCreds = {
		apiKey: "key_abc123",
		domain: "example.com",
		nested: {
			secretToken: "token_xyz789",
		},
	};

	const encryptedCreds = {
		apiKey: await mailhub.encryptCredential(rawCreds.apiKey, secret),
		domain: rawCreds.domain,
		nested: {
			secretToken: await mailhub.encryptCredential(rawCreds.nested.secretToken, secret),
		},
	};

	const decrypted = await mailhub.decryptCredentialsRecord(encryptedCreds, secret);
	assert.equal(decrypted.apiKey, rawCreds.apiKey);
	assert.equal(decrypted.domain, rawCreds.domain);
	assert.equal(decrypted.nested.secretToken, rawCreds.nested.secretToken);
});

test("MailHub Registry: returns correct adapter instance", () => {
	assert.ok(mailhub.isSupportedProvider("brevo"));
	assert.ok(mailhub.isSupportedProvider("resend"));
	assert.ok(mailhub.isSupportedProvider("ses"));
	assert.ok(mailhub.isSupportedProvider("zeptomail"));
	assert.ok(mailhub.isSupportedProvider("mailgun"));
	assert.ok(mailhub.isSupportedProvider("cloudflare"));
	assert.equal(mailhub.isSupportedProvider("unknown_provider"), false);

	const brevo = mailhub.getProviderAdapter("brevo");
	assert.equal(brevo.provider, "brevo");

	const resend = mailhub.getProviderAdapter("resend");
	assert.equal(resend.provider, "resend");

	const mailgun = mailhub.getProviderAdapter("mailgun");
	assert.equal(mailgun.provider, "mailgun");
});

test("BrevoAdapter error classification", () => {
	const adapter = new mailhub.BrevoAdapter();

	// Quota exceeded
	const quotaErr = adapter.parseError(new Error("Limit reached"), 402, { code: "not_enough_credits", message: "Not enough credits" });
	assert.equal(quotaErr.code, "QUOTA_EXCEEDED");
	assert.equal(quotaErr.suggestedAction, "FAILOVER");
	assert.equal(quotaErr.retryable, true);

	// Auth error
	const authErr = adapter.parseError(new Error("Unauthorized"), 401, { code: "unauthorized", message: "Key invalid" });
	assert.equal(authErr.code, "AUTHENTICATION_ERROR");
	assert.equal(authErr.suggestedAction, "ALERT_UNHEALTHY");
	assert.equal(authErr.retryable, false);

	// Invalid payload
	const payloadErr = adapter.parseError(new Error("Bad email"), 400, { code: "invalid_parameter", message: "Invalid email" });
	assert.equal(payloadErr.code, "INVALID_PAYLOAD");
	assert.equal(payloadErr.suggestedAction, "REJECT_NO_FAILOVER");
	assert.equal(payloadErr.retryable, false);

	// 5xx Server error
	const serverErr = adapter.parseError(new Error("Server error"), 500, { message: "Internal server error" });
	assert.equal(serverErr.code, "TRANSIENT_SERVER_ERROR");
	assert.equal(serverErr.suggestedAction, "FAILOVER");
	assert.equal(serverErr.retryable, true);
});

test("ResendAdapter error classification", () => {
	const adapter = new mailhub.ResendAdapter();

	// Rate limit
	const rateLimitErr = adapter.parseError(new Error("Rate limit"), 429, { name: "rate_limit_exceeded", message: "Too many requests" });
	assert.equal(rateLimitErr.code, "QUOTA_EXCEEDED");
	assert.equal(rateLimitErr.suggestedAction, "FAILOVER");

	// Invalid API key
	const authErr = adapter.parseError(new Error("API key invalid"), 401, { name: "invalid_api_key", message: "Invalid API key" });
	assert.equal(authErr.code, "AUTHENTICATION_ERROR");
	assert.equal(authErr.suggestedAction, "ALERT_UNHEALTHY");

	// Validation error
	const valErr = adapter.parseError(new Error("Domain not verified"), 422, { name: "validation_error", message: "Domain is not verified" });
	assert.equal(valErr.code, "INVALID_PAYLOAD");
	assert.equal(valErr.suggestedAction, "REJECT_NO_FAILOVER");
});

test("ZeptoMailAdapter error classification", () => {
	const adapter = new mailhub.ZeptoMailAdapter();

	// Quota
	const quotaErr = adapter.parseError(new Error("Credit limit"), 429, { error: { code: "CREDIT_LIMIT_EXCEEDED", message: "Credits exhausted" } });
	assert.equal(quotaErr.code, "QUOTA_EXCEEDED");
	assert.equal(quotaErr.suggestedAction, "FAILOVER");

	// Auth
	const authErr = adapter.parseError(new Error("Token invalid"), 401, { error: { code: "INVALID_TOKEN", message: "Invalid send mail token" } });
	assert.equal(authErr.code, "AUTHENTICATION_ERROR");
	assert.equal(authErr.suggestedAction, "ALERT_UNHEALTHY");

	// Invalid data
	const dataErr = adapter.parseError(new Error("Bad request"), 400, { error: { code: "INVALID_DATA", message: "Malformed recipient" } });
	assert.equal(dataErr.code, "INVALID_PAYLOAD");
	assert.equal(dataErr.suggestedAction, "REJECT_NO_FAILOVER");
});

test("MailgunAdapter error classification", () => {
	const adapter = new mailhub.MailgunAdapter();

	// Payment required / Over limit
	const quotaErr = adapter.parseError(new Error("Payment required"), 402, { message: "Free account sending quota exceeded" });
	assert.equal(quotaErr.code, "QUOTA_EXCEEDED");
	assert.equal(quotaErr.suggestedAction, "FAILOVER");

	// 401 Unauthorized
	const authErr = adapter.parseError(new Error("Unauthorized"), 401, { message: "Invalid private key" });
	assert.equal(authErr.code, "AUTHENTICATION_ERROR");
	assert.equal(authErr.suggestedAction, "ALERT_UNHEALTHY");

	// 400 Invalid recipient
	const payloadErr = adapter.parseError(new Error("Bad parameter"), 400, { message: "'to' parameter is not a valid address" });
	assert.equal(payloadErr.code, "INVALID_PAYLOAD");
	assert.equal(payloadErr.suggestedAction, "REJECT_NO_FAILOVER");
});

test("SesAdapter error classification", () => {
	const adapter = new mailhub.SesAdapter();

	const fakeAwsQuotaErr = Object.assign(new Error("Daily sending quota exceeded"), { code: "LimitExceededException", status: 400 });
	const quotaParsed = adapter.parseError(fakeAwsQuotaErr);
	assert.equal(quotaParsed.code, "QUOTA_EXCEEDED");
	assert.equal(quotaParsed.suggestedAction, "FAILOVER");

	const fakeAwsAuthErr = Object.assign(new Error("The security token included in the request is invalid"), { code: "InvalidClientTokenId", status: 403, accessDenied: true });
	const authParsed = adapter.parseError(fakeAwsAuthErr);
	assert.equal(authParsed.code, "AUTHENTICATION_ERROR");
	assert.equal(authParsed.suggestedAction, "ALERT_UNHEALTHY");

	const fakeAwsRejectErr = Object.assign(new Error("Email address is not verified"), { code: "MessageRejected", status: 400 });
	const rejectParsed = adapter.parseError(fakeAwsRejectErr);
	assert.equal(rejectParsed.code, "INVALID_PAYLOAD");
	assert.equal(rejectParsed.suggestedAction, "REJECT_NO_FAILOVER");
});
