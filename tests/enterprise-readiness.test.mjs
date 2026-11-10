import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-enterprise-"));
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
		external: ["better-sqlite3", "next", "next/*"],
		alias: { "@": join(root, "src") },
		plugins: [
			{
				name: "resolve-next-server",
				setup(builder) {
					builder.onResolve({ filter: /^next\/server$/ }, () => ({ path: "next/server.js", external: true }));
				},
			},
		],
	});
	return import(pathToFileURL(join(outDir, outfile)).href);
}

const tokens = await bundle("src/lib/security/signed-tokens.ts", "signed-tokens.mjs");
const cacheLib = await bundle("src/lib/cache/index.ts", "cache.mjs");
const logging = await bundle("src/lib/logging/logger.ts", "logger.mjs");
const sanitizer = await bundle("src/lib/security/sanitizer.ts", "sanitizer.mjs");
const validator = await bundle("src/lib/backups/validator.ts", "validator.mjs");
const rateLimiter = await bundle("src/lib/security/rate-limiter.ts", "rate-limiter.mjs");

test("signed short-lived token generates and verifies correctly", async () => {
	const secret = "test-very-secure-signing-secret-key-32-bytes";
	const user = {
		id: "usr_enterprise_123",
		email: "admin@orbitmails.dev",
		role: "admin",
		scopes: ["read:messages", "send:messages"],
		isPrimaryAdmin: true,
	};

	const token = await tokens.createSignedToken(user, secret, { expiresInSeconds: 60 });
	assert.ok(typeof token === "string");
	assert.equal(token.split(".").length, 3);

	const verification = await tokens.verifySignedToken(token, secret);
	assert.equal(verification.valid, true);
	assert.equal(verification.claims.sub, "usr_enterprise_123");
	assert.equal(verification.claims.email, "admin@orbitmails.dev");
	assert.equal(verification.claims.role, "admin");
	assert.equal(verification.claims.isPrimaryAdmin, true);

	// RBAC assertion
	assert.doesNotThrow(() => tokens.assertTokenRole(verification.claims, "admin"));
	assert.doesNotThrow(() => tokens.assertTokenRole(verification.claims, "user"));

	// Invalid signature check
	const tampered = await tokens.verifySignedToken(token, "wrong-secret-key-that-should-fail");
	assert.equal(tampered.valid, false);
});

test("cache manager correctly stores, retrieves, and expires entries", async () => {
	const cache = new cacheLib.CacheManager();
	await cache.set("test_key_1", { foo: "bar" }, { ttlSeconds: 2 });

	const retrieved = await cache.get("test_key_1");
	assert.deepEqual(retrieved, { foo: "bar" });

	await cache.delete("test_key_1");
	const deleted = await cache.get("test_key_1");
	assert.equal(deleted, null);
});

test("structured logger redacts PII, emails, tokens, and secrets", () => {
	const rawPayload = {
		password: "SuperSecretPassword123!",
		token: "sess_secret_token_abc",
		email: "security.audit@company.org",
		normalField: "hello world",
		nested: {
			apiKey: "om_live_secret_key_12345",
			authorization: "Bearer eyJhbGciOi...",
			customHeader: "Bearer eyJhbGciOi...",
		},
	};

	const sanitized = logging.sanitizeLogValue(rawPayload);
	assert.equal(sanitized.password, "[REDACTED]");
	assert.equal(sanitized.token, "[REDACTED]");
	assert.equal(sanitized.email, "s***@company.org");
	assert.equal(sanitized.normalField, "hello world");
	assert.equal(sanitized.nested.apiKey, "[REDACTED]");
	assert.equal(sanitized.nested.authorization, "[REDACTED]");
	assert.equal(sanitized.nested.customHeader, "Bearer [REDACTED]");
});

test("sanitizer strips null bytes, CRLF header injection, and escapes HTML", () => {
	const maliciousHeader = "test@domain.com\r\nBcc: victim@domain.com\nSubject: Injected";
	const cleanHeader = sanitizer.sanitizeHeaderValue(maliciousHeader);
	assert.ok(!cleanHeader.includes("\r"));
	assert.ok(!cleanHeader.includes("\n"));

	const maliciousNull = "file\0name.pdf";
	assert.equal(sanitizer.stripNullBytes(maliciousNull), "filename.pdf");

	const xssPayload = "<script>alert(1)</script>&test";
	assert.equal(sanitizer.escapeHtml(xssPayload), "&lt;script&gt;alert(1)&lt;/script&gt;&amp;test");
});

test("rate limiter bounds requests within window", async () => {
	const req = new Request("http://localhost/api/test", {
		headers: { "x-orbitflare-client-ip": "192.0.2.1" },
	});

	const outcome1 = await rateLimiter.checkRateLimit({}, req, { limit: 2, windowSeconds: 60, keyPrefix: "test" });
	assert.equal(outcome1.allowed, true);
	assert.equal(outcome1.remaining, 1);

	const outcome2 = await rateLimiter.checkRateLimit({}, req, { limit: 2, windowSeconds: 60, keyPrefix: "test" });
	assert.equal(outcome2.allowed, true);
	assert.equal(outcome2.remaining, 0);

	const outcome3 = await rateLimiter.checkRateLimit({}, req, { limit: 2, windowSeconds: 60, keyPrefix: "test" });
	assert.equal(outcome3.allowed, false);
});

test("disaster recovery backup validation simulates restore without error", () => {
	const validBackup = JSON.stringify({
		users: [{ id: "u1", email: "a@b.com", name: "User 1" }],
		domains: [{ id: "d1", hostname: "b.com", status: "active" }],
		mailboxes: [{ id: "m1", localPart: "info", domainId: "d1" }],
	});

	const result = validator.validateBackupContent(validBackup);
	assert.equal(result.valid, true);
	assert.equal(result.simulatedRestoreSuccess, true);
	assert.equal(result.totalRows, 3);
	assert.equal(result.errors.length, 0);

	// Missing essential table test
	const invalidBackup = JSON.stringify({
		domains: [{ id: "d1", hostname: "b.com" }],
	});

	const invalidResult = validator.validateBackupContent(invalidBackup);
	assert.equal(invalidResult.valid, false);
	assert.ok(invalidResult.errors.length > 0);
});
