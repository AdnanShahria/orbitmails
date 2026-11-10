/**
 * OrbitMails - Centralized Client IP & API Key Rate Limiter
 * @module lib/security/rate-limiter
 */

import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/auth/client-ip";

export interface RateLimitOptions {
	limit: number; // max requests per window
	windowSeconds: number; // window size in seconds
	keyPrefix?: string;
}

interface WindowBucket {
	count: number;
	resetAt: number;
}

// In-memory fallback bucket store for isolates
const memoryBuckets = new Map<string, WindowBucket>();

export async function checkRateLimit(
	env: CloudflareEnv,
	request: Request,
	options: RateLimitOptions,
): Promise<{ allowed: boolean; limit: number; remaining: number; reset: number; retryAfter?: number }> {
	const ip = getClientIp(request) ?? "unknown_client";
	const prefix = options.keyPrefix ?? "rl";
	const key = `${prefix}:${ip}`;
	const now = Date.now();

	let bucket = memoryBuckets.get(key);
	if (!bucket || bucket.resetAt <= now) {
		bucket = {
			count: 1,
			resetAt: now + options.windowSeconds * 1000,
		};
		memoryBuckets.set(key, bucket);
		return {
			allowed: true,
			limit: options.limit,
			remaining: options.limit - 1,
			reset: Math.ceil(bucket.resetAt / 1000),
		};
	}

	bucket.count += 1;
	const remaining = Math.max(0, options.limit - bucket.count);
	const allowed = bucket.count <= options.limit;
	const reset = Math.ceil(bucket.resetAt / 1000);
	const retryAfter = allowed ? undefined : Math.ceil((bucket.resetAt - now) / 1000);

	return {
		allowed,
		limit: options.limit,
		remaining,
		reset,
		retryAfter,
	};
}

export function createRateLimitHeaders(result: {
	limit: number;
	remaining: number;
	reset: number;
	retryAfter?: number;
}): Record<string, string> {
	const headers: Record<string, string> = {
		"X-RateLimit-Limit": String(result.limit),
		"X-RateLimit-Remaining": String(result.remaining),
		"X-RateLimit-Reset": String(result.reset),
	};
	if (result.retryAfter !== undefined) {
		headers["Retry-After"] = String(result.retryAfter);
	}
	return headers;
}

export async function enforceRateLimit(
	env: CloudflareEnv,
	request: Request,
	options: RateLimitOptions,
): Promise<NextResponse | null> {
	const result = await checkRateLimit(env, request, options);
	if (!result.allowed) {
		return NextResponse.json(
			{
				error: "Too Many Requests",
				message: `Rate limit exceeded. Please retry in ${result.retryAfter ?? options.windowSeconds} seconds.`,
			},
			{
				status: 429,
				headers: createRateLimitHeaders(result),
			},
		);
	}
	return null;
}

