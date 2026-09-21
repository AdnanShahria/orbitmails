/**
 * MailHub Per-Project Rate Limiter
 * Designed for WP-03: Routing Authentication & Key Management
 *
 * Implements a dual-engine rate limiting strategy:
 * 1. Cloudflare Native RateLimit binding (if env.ROUTER_RATE_LIMIT is bound)
 * 2. Sliding window counter backed by Cloudflare KV or in-memory map
 *
 * Emits standard headers:
 * - X-RateLimit-Limit
 * - X-RateLimit-Remaining
 * - X-RateLimit-Reset
 * - Retry-After (when rate limited)
 */

import type { AuthenticatedProject, RateLimitResult } from "./types";

interface MemoryBucket {
	count: number;
	windowStartSec: number;
}

// In-memory sliding window cache for fast isolate lookups
const inMemoryBuckets = new Map<string, MemoryBucket>();
const MAX_MEMORY_BUCKETS = 5000;

function cleanMemoryBuckets(currentSec: number) {
	if (inMemoryBuckets.size <= MAX_MEMORY_BUCKETS) return;
	for (const [key, bucket] of inMemoryBuckets.entries()) {
		if (currentSec - bucket.windowStartSec > 120) {
			inMemoryBuckets.delete(key);
		}
	}
}

/**
 * Check and enforce per-project rate limit for the current minute window.
 */
export async function enforceProjectRateLimit(
	env: CloudflareEnv,
	project: AuthenticatedProject,
	customLimitRpm?: number,
): Promise<RateLimitResult> {
	const limit = customLimitRpm ?? project.rateLimitRps ?? 60;
	const nowMs = Date.now();
	const nowSec = Math.floor(nowMs / 1000);
	const windowLengthSec = 60;
	const currentWindowSec = Math.floor(nowSec / windowLengthSec) * windowLengthSec;
	const resetSec = currentWindowSec + windowLengthSec;
	const retryAfter = Math.max(1, resetSec - nowSec);

	// 1. Check Cloudflare Native RateLimit binding if present
	const nativeRateLimit = (env as unknown as { ROUTER_RATE_LIMIT?: { limit: (options: { key: string }) => Promise<{ success: boolean }> } }).ROUTER_RATE_LIMIT;
	if (nativeRateLimit && typeof nativeRateLimit.limit === "function") {
		try {
			const outcome = await nativeRateLimit.limit({ key: project.id });
			if (!outcome.success) {
				return {
					allowed: false,
					limit,
					remaining: 0,
					reset: resetSec,
					retryAfter,
				};
			}
			return {
				allowed: true,
				limit,
				remaining: Math.max(1, Math.floor(limit / 2)), // Approximation when native doesn't expose remaining count
				reset: resetSec,
			};
		} catch {
			// Fallback to KV / Memory on native binding error
		}
	}

	// 2. Check KV namespace if present
	const kv = (env as unknown as { ROUTER_KV?: KVNamespace; KV?: KVNamespace }).ROUTER_KV ??
		(env as unknown as { ROUTER_KV?: KVNamespace; KV?: KVNamespace }).KV;

	const kvKey = `ratelimit:${project.id}:${currentWindowSec}`;

	if (kv) {
		try {
			const currentVal = await kv.get(kvKey);
			const count = currentVal ? parseInt(currentVal, 10) || 0 : 0;
			const nextCount = count + 1;

			if (count >= limit) {
				return {
					allowed: false,
					limit,
					remaining: 0,
					reset: resetSec,
					retryAfter,
				};
			}

			// Non-blocking write back to KV with 120s TTL
			await kv.put(kvKey, nextCount.toString(), { expirationTtl: 120 });

			return {
				allowed: true,
				limit,
				remaining: Math.max(0, limit - nextCount),
				reset: resetSec,
			};
		} catch {
			// Fallback to in-memory on KV error
		}
	}

	// 3. Fallback: In-memory sliding window
	cleanMemoryBuckets(nowSec);
	const memoryKey = `${project.id}:${currentWindowSec}`;
	const bucket = inMemoryBuckets.get(memoryKey);

	if (!bucket) {
		inMemoryBuckets.set(memoryKey, { count: 1, windowStartSec: currentWindowSec });
		return {
			allowed: true,
			limit,
			remaining: limit - 1,
			reset: resetSec,
		};
	}

	bucket.count += 1;
	if (bucket.count > limit) {
		return {
			allowed: false,
			limit,
			remaining: 0,
			reset: resetSec,
			retryAfter,
		};
	}

	return {
		allowed: true,
		limit,
		remaining: Math.max(0, limit - bucket.count),
		reset: resetSec,
	};
}

/**
 * Format rate limit result into standard HTTP headers
 */
export function getRateLimitHeaders(rateLimit: RateLimitResult): Record<string, string> {
	const headers: Record<string, string> = {
		"X-RateLimit-Limit": rateLimit.limit.toString(),
		"X-RateLimit-Remaining": rateLimit.remaining.toString(),
		"X-RateLimit-Reset": rateLimit.reset.toString(),
	};

	if (!rateLimit.allowed && rateLimit.retryAfter !== undefined) {
		headers["Retry-After"] = rateLimit.retryAfter.toString();
	}

	return headers;
}

