import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "router-auth-test-"));
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
	});
	return import(pathToFileURL(join(outDir, outfile)).href);
}

const keysModule = await bundle("src/lib/router/keys.ts", "keys.mjs");
const rateLimiterModule = await bundle("src/lib/router/rate-limiter.ts", "rate-limiter.mjs");
const keyStoreModule = await bundle("src/lib/router/key-store.ts", "key-store.mjs");
const authMiddlewareModule = await bundle("src/lib/router/auth-middleware.ts", "auth-middleware.mjs");

const {
	generateRoutingKey,
	parseRoutingKey,
	hashRoutingKey,
	verifyRoutingKeyHash,
	timingSafeEqual,
	normalizeProjectSlug,
	ROUTING_KEY_REGEX,
} = keysModule;

const {
	resolveRoutingKey,
	invalidateRoutingKeyCache,
} = keyStoreModule;

const {
	enforceProjectRateLimit,
	getRateLimitHeaders,
} = rateLimiterModule;

const {
	extractBearerToken,
	createAuthError,
	authenticateToken,
	projectAuthMiddleware,
	authenticateProjectRequest,
} = authMiddlewareModule;

test("WP-03: Routing Key Generation & Format Validation", async () => {
	const key = await generateRoutingKey({
		projectSlug: "aurelia",
		environment: "live",
	});

	// Check key string format: om_live_aurelia_<entropy>
	assert.ok(ROUTING_KEY_REGEX.test(key.fullKey), `Key '${key.fullKey}' failed regex check`);
	assert.strictEqual(key.environment, "live");
	assert.strictEqual(key.projectSlug, "aurelia");
	assert.ok(key.fullKey.startsWith("om_live_aurelia_"));
	assert.ok(key.prefix.startsWith("om_live_aurelia_"));
	assert.ok(key.displayPrefix.includes("••••••••"));
	assert.strictEqual(key.keyHash.length, 64, "SHA-256 hash must be 64 hex characters");

	// Test slug normalization
	const normalizedSlug = normalizeProjectSlug("LifeSolver Web App!");
	assert.strictEqual(normalizedSlug, "lifesolver-web-app");

	const testKey = await generateRoutingKey({
		projectSlug: "LifeSolver",
		environment: "test",
	});
	assert.ok(testKey.fullKey.startsWith("om_test_lifesolver_"));
	assert.strictEqual(testKey.environment, "test");
});

test("WP-03: Routing Key Parsing", () => {
	const validKey = "om_live_aurelia_8f3a9e1b2c4d5e6f7a8b9c0d1e2f3a4b";
	const parsed = parseRoutingKey(validKey);

	assert.ok(parsed !== null);
	assert.strictEqual(parsed.environment, "live");
	assert.strictEqual(parsed.projectSlug, "aurelia");
	assert.strictEqual(parsed.entropy, "8f3a9e1b2c4d5e6f7a8b9c0d1e2f3a4b");
	assert.strictEqual(parsed.prefix, "om_live_aurelia_8f3a9e");

	// Invalid keys
	assert.strictEqual(parseRoutingKey("invalid_key"), null);
	assert.strictEqual(parseRoutingKey("om_stage_aurelia_1234567890abcdef"), null); // invalid env
	assert.strictEqual(parseRoutingKey("om_live__1234567890abcdef"), null); // empty slug
	assert.strictEqual(parseRoutingKey("om_live_aurelia_short"), null); // entropy too short (<16)
});

test("WP-03: SHA-256 Hashing and Timing-Safe Verification", async () => {
	const rawKey = "om_live_luvio_11223344556677889900aabbccddeeff";
	const hash1 = await hashRoutingKey(rawKey);
	const hash2 = await hashRoutingKey(rawKey);

	assert.strictEqual(hash1, hash2, "Hashing must be deterministic");
	assert.strictEqual(hash1.length, 64);

	const isValid = await verifyRoutingKeyHash(rawKey, hash1);
	assert.strictEqual(isValid, true, "Hash verification should succeed for matching key");

	const isInvalid = await verifyRoutingKeyHash(
		"om_live_luvio_00000000000000000000aabbccddeeff",
		hash1,
	);
	assert.strictEqual(isInvalid, false, "Hash verification should fail for modified key");

	// Timing-safe equal tests
	assert.strictEqual(timingSafeEqual("abc", "abc"), true);
	assert.strictEqual(timingSafeEqual("abc", "abd"), false);
	assert.strictEqual(timingSafeEqual("abc", "abcd"), false);
});

test("WP-03: Rate Limiter Engine", async () => {
	const mockProject = {
		id: "proj_ovijatric",
		slug: "ovijatric",
		name: "Ovijatric",
		environment: "live",
		keyId: "rkey_test",
		keyPrefix: "om_live_ovijatric_123456",
		rateLimitRps: 5, // 5 requests per minute for testing
	};

	const mockEnv = {}; // In-memory fallback

	// First 5 requests should pass
	for (let i = 0; i < 5; i++) {
		const res = await enforceProjectRateLimit(mockEnv, mockProject, 5);
		assert.strictEqual(res.allowed, true, `Request ${i + 1} should be allowed`);
		assert.strictEqual(res.limit, 5);
	}

	// 6th request should be throttled
	const blocked = await enforceProjectRateLimit(mockEnv, mockProject, 5);
	assert.strictEqual(blocked.allowed, false, "6th request should be blocked");
	assert.strictEqual(blocked.remaining, 0);
	assert.ok(blocked.retryAfter > 0);

	// Rate limit headers
	const headers = getRateLimitHeaders(blocked);
	assert.strictEqual(headers["X-RateLimit-Limit"], "5");
	assert.strictEqual(headers["X-RateLimit-Remaining"], "0");
	assert.ok(headers["X-RateLimit-Reset"]);
	assert.ok(headers["Retry-After"]);
});

test("WP-03: Authorization Header Parsing & Error Responses", () => {
	assert.strictEqual(extractBearerToken(null), null);
	assert.strictEqual(extractBearerToken(""), null);
	assert.strictEqual(extractBearerToken("Basic abc"), null);
	assert.strictEqual(extractBearerToken("Bearer om_live_aurelia_1234"), "om_live_aurelia_1234");
	assert.strictEqual(extractBearerToken("bearer om_live_aurelia_5678"), "om_live_aurelia_5678");

	const err = createAuthError("Unauthorized token", "authentication_error", 401);
	assert.strictEqual(err.error.code, 401);
	assert.strictEqual(err.error.type, "authentication_error");
});

test("WP-03: Hono Middleware & Standard Request Integration", async () => {
	// Test rejection with missing token
	const missingAuthRes = await authenticateToken(null, {});
	assert.strictEqual(missingAuthRes.success, false);
	assert.strictEqual(missingAuthRes.statusCode, 401);
	assert.strictEqual(missingAuthRes.errorBody.error.type, "authentication_error");

	// Test rejection with malformed token
	const malformedAuthRes = await authenticateToken("bad_token_shape", {});
	assert.strictEqual(malformedAuthRes.success, false);
	assert.strictEqual(malformedAuthRes.statusCode, 401);

	// Test Hono middleware invocation with missing auth header
	const mockHonoContext = {
		req: {
			header: (name) => (name.toLowerCase() === "authorization" ? undefined : null),
		},
		env: {},
		var: {},
		set(key, value) {
			this.var[key] = value;
		},
		header(name, value) {},
		json(data, status, headers) {
			return new Response(JSON.stringify(data), { status, headers });
		},
	};

	let nextCalled = false;
	const middleware = projectAuthMiddleware();
	const response = await middleware(mockHonoContext, async () => {
		nextCalled = true;
	});

	assert.strictEqual(nextCalled, false, "next() must not be called when auth fails");
	assert.ok(response instanceof Response);
	assert.strictEqual(response.status, 401);
});

test("WP-03: KV Caching & Key Resolution Pipeline", async () => {
	const kvStore = new Map();
	const mockKv = {
		async get(key, type) {
			const val = kvStore.get(key);
			if (!val) return null;
			return type === "json" ? JSON.parse(val) : val;
		},
		async put(key, value) {
			kvStore.set(key, typeof value === "string" ? value : JSON.stringify(value));
		},
		async delete(key) {
			kvStore.delete(key);
		},
	};

	const mockEnv = {
		ROUTER_KV: mockKv,
	};

	const sampleKey = await generateRoutingKey({
		projectSlug: "aurelia",
		environment: "live",
	});

	// Pre-populate KV cache as if populated by previous DB lookup
	const cachedEntry = {
		projectId: "proj_aurelia",
		projectSlug: "aurelia",
		projectName: "Aurelia Web",
		projectStatus: "active",
		environment: "live",
		keyId: sampleKey.keyId,
		keyPrefix: sampleKey.prefix,
		keyStatus: "active",
		rateLimitRps: 100,
		cachedAt: Date.now(),
	};
	await mockKv.put(`rkey:${sampleKey.keyHash}`, JSON.stringify(cachedEntry));

	// 1. Resolve key through KV cache
	const resolved = await resolveRoutingKey(sampleKey.fullKey, mockEnv);
	assert.ok(resolved !== null);
	assert.strictEqual(resolved.project.id, "proj_aurelia");
	assert.strictEqual(resolved.project.slug, "aurelia");
	assert.strictEqual(resolved.project.name, "Aurelia Web");
	assert.strictEqual(resolved.project.environment, "live");
	assert.strictEqual(resolved.project.rateLimitRps, 100);

	// 2. Full Request Authentication via authenticateProjectRequest
	const req = new Request("https://mail.internal/v1/send", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${sampleKey.fullKey}`,
			"Content-Type": "application/json",
		},
	});

	const authResult = await authenticateProjectRequest(req, mockEnv);
	assert.strictEqual(authResult.success, true);
	assert.strictEqual(authResult.project.slug, "aurelia");
	assert.ok(authResult.headers["X-RateLimit-Limit"]);
	assert.ok(authResult.headers["X-RateLimit-Remaining"]);

	// 3. Environment constraint check: require "test" on a "live" key
	const envMismatchResult = await authenticateProjectRequest(req, mockEnv, undefined, {
		requireEnvironment: "test",
	});
	assert.strictEqual(envMismatchResult.success, false);
	assert.strictEqual(envMismatchResult.statusCode, 403);
	assert.strictEqual(envMismatchResult.errorBody.error.type, "forbidden_error");

	// 4. Invalidation of KV cache
	await invalidateRoutingKeyCache(sampleKey.keyHash, mockEnv);
	assert.strictEqual(kvStore.has(`rkey:${sampleKey.keyHash}`), false);
});

