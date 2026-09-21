/**
 * MailHub Project Routing Key Storage, Verification & KV Caching
 * Designed for WP-03: Routing Authentication & Key Management
 *
 * Performance Architecture:
 * - Level 1 (L1): In-memory LRU / Map cache (0ms, isolate-local)
 * - Level 2 (L2): Cloudflare KV cache `rkey:${keyHash}` (sub-5ms, edge-distributed)
 * - Level 3 (L3): D1 / Database query (authoritative fallback)
 *
 * Write Amplification Prevention:
 * - `last_used_at` timestamp is updated in DB asynchronously at most once every 60 seconds
 * - Dispatched via `ctx.waitUntil()` so it never impacts outbound send latency
 */

import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { hashRoutingKey, parseRoutingKey, timingSafeEqual } from "./keys";
import type {
	AuthenticatedProject,
	CachedRoutingKey,
	ParsedRoutingKey,
	ProjectStatus,
	RoutingEnvironment,
	RoutingKeyStatus,
} from "./types";

const KV_CACHE_TTL_SECONDS = 300; // 5 minutes edge cache
const L1_CACHE_TTL_MS = 60_000; // 1 minute isolate cache
const LAST_USED_WRITE_INTERVAL_MS = 60_000; // Debounce DB writes to max 1/min per key

interface L1CacheEntry {
	data: CachedRoutingKey;
	expiresAt: number;
}

// In-memory L1 cache per Worker isolate
const memoryCache = new Map<string, L1CacheEntry>();
const MAX_MEMORY_CACHE_ENTRIES = 2000;

function cleanMemoryCache(now: number) {
	if (memoryCache.size <= MAX_MEMORY_CACHE_ENTRIES) return;
	for (const [key, entry] of memoryCache.entries()) {
		if (now > entry.expiresAt) {
			memoryCache.delete(key);
		}
	}
}

/**
 * Invalidate a routing key from L1 memory and L2 KV cache
 * (Called on key revocation, deletion, or rate limit updates)
 */
export async function invalidateRoutingKeyCache(
	keyHash: string,
	env: CloudflareEnv,
): Promise<void> {
	memoryCache.delete(keyHash);

	const kv = (env as unknown as { ROUTER_KV?: KVNamespace; KV?: KVNamespace }).ROUTER_KV ??
		(env as unknown as { ROUTER_KV?: KVNamespace; KV?: KVNamespace }).KV;

	if (kv) {
		try {
			await kv.delete(`rkey:${keyHash}`);
		} catch (err) {
			console.error("[MailHub Auth] Failed to invalidate KV cache for keyHash:", keyHash, err);
		}
	}
}

/**
 * Asynchronously record key usage in D1/DB without blocking request execution
 */
export function updateRoutingKeyLastUsed(
	env: CloudflareEnv,
	keyId: string,
	ctx?: ExecutionContext,
): void {
	if (!env?.DB) return;

	const task = async () => {
		try {
			const db = getDb(env);
			const now = new Date();
			await db.run(sql`
				UPDATE project_routing_keys 
				SET last_used_at = ${now} 
				WHERE id = ${keyId}
			`);
		} catch (err) {
			console.warn("[MailHub Auth] Could not update last_used_at for key:", keyId, err);
		}
	};

	if (ctx && typeof ctx.waitUntil === "function") {
		ctx.waitUntil(task());
	} else {
		// Run in background without unhandled rejection
		task().catch(() => {});
	}
}

/**
 * Resolve and verify a presented routing key against L1, L2 (KV), and L3 (DB).
 * Returns the AuthenticatedProject context, or null if invalid or inactive.
 */
export async function resolveRoutingKey(
	rawKey: string,
	env: CloudflareEnv,
	ctx?: ExecutionContext,
	pepper?: string,
): Promise<{ project: AuthenticatedProject; routingKey: ParsedRoutingKey } | null> {
	const parsed = parseRoutingKey(rawKey);
	if (!parsed) return null;

	const keyHash = await hashRoutingKey(parsed.raw, pepper);
	const nowMs = Date.now();

	// --- Level 1: In-Memory Isolate Cache ---
	const memoryEntry = memoryCache.get(keyHash);
	if (memoryEntry && nowMs < memoryEntry.expiresAt) {
		const cached = memoryEntry.data;
		if (cached.keyStatus !== "active" || cached.projectStatus !== "active") {
			return null;
		}

		// Check if lastUsedAt update is due
		if (!cached.lastUsedAt || nowMs - cached.lastUsedAt > LAST_USED_WRITE_INTERVAL_MS) {
			cached.lastUsedAt = nowMs;
			updateRoutingKeyLastUsed(env, cached.keyId, ctx);
		}

		return {
			project: {
				id: cached.projectId,
				slug: cached.projectSlug,
				name: cached.projectName,
				environment: cached.environment,
				keyId: cached.keyId,
				keyPrefix: cached.keyPrefix,
				rateLimitRps: cached.rateLimitRps,
			},
			routingKey: parsed,
		};
	}

	// --- Level 2: Cloudflare KV Cache ---
	const kv = (env as unknown as { ROUTER_KV?: KVNamespace; KV?: KVNamespace }).ROUTER_KV ??
		(env as unknown as { ROUTER_KV?: KVNamespace; KV?: KVNamespace }).KV;

	if (kv) {
		try {
			const kvVal = await kv.get(`rkey:${keyHash}`, "json") as CachedRoutingKey | null;
			if (kvVal) {
				// Store in L1 Memory Cache
				cleanMemoryCache(nowMs);
				memoryCache.set(keyHash, {
					data: kvVal,
					expiresAt: nowMs + L1_CACHE_TTL_MS,
				});

				if (kvVal.keyStatus !== "active" || kvVal.projectStatus !== "active") {
					return null;
				}

				if (!kvVal.lastUsedAt || nowMs - kvVal.lastUsedAt > LAST_USED_WRITE_INTERVAL_MS) {
					kvVal.lastUsedAt = nowMs;
					updateRoutingKeyLastUsed(env, kvVal.keyId, ctx);
				}

				return {
					project: {
						id: kvVal.projectId,
						slug: kvVal.projectSlug,
						name: kvVal.projectName,
						environment: kvVal.environment,
						keyId: kvVal.keyId,
						keyPrefix: kvVal.keyPrefix,
						rateLimitRps: kvVal.rateLimitRps,
					},
					routingKey: parsed,
				};
			}
		} catch (err) {
			console.warn("[MailHub Auth] KV lookup failed, falling back to D1:", err);
		}
	}

	// --- Level 3: Database Query (D1 / PostgreSQL / MySQL) ---
	try {
		const db = getDb(env);

		interface KeyQueryResult {
			key_id: string;
			project_id: string;
			key_name: string;
			prefix: string;
			key_hash: string;
			environment: string;
			key_status: string;
			rate_limit_rps: number | null;
			last_used_at: Date | number | null;
			project_name: string;
			project_slug: string;
			project_status: string;
		}

		// Standard SQL joining project_routing_keys with projects
		const rows = await db.all<KeyQueryResult>(sql`
			SELECT 
				pk.id as key_id,
				pk.project_id as project_id,
				pk.name as key_name,
				pk.prefix as prefix,
				pk.key_hash as key_hash,
				pk.environment as environment,
				pk.status as key_status,
				pk.rate_limit_rps as rate_limit_rps,
				pk.last_used_at as last_used_at,
				p.name as project_name,
				p.slug as project_slug,
				p.status as project_status
			FROM project_routing_keys pk
			JOIN projects p ON p.id = pk.project_id
			WHERE pk.key_hash = ${keyHash}
			LIMIT 1
		`);

		const row = rows?.[0];
		if (!row) {
			return null;
		}

		// Timing-safe check of the hash
		if (!timingSafeEqual(keyHash, row.key_hash)) {
			return null;
		}

		const keyStatus = (row.key_status ?? "active") as RoutingKeyStatus;
		const projectStatus = (row.project_status ?? "active") as ProjectStatus;
		const rateLimitRps = Number(row.rate_limit_rps) || 60;
		const lastUsedMs = row.last_used_at
			? typeof row.last_used_at === "number"
				? row.last_used_at * 1000
				: new Date(row.last_used_at).getTime()
			: 0;

		const cachedEntry: CachedRoutingKey = {
			projectId: row.project_id,
			projectSlug: row.project_slug,
			projectName: row.project_name,
			projectStatus,
			environment: row.environment as RoutingEnvironment,
			keyId: row.key_id,
			keyPrefix: row.prefix,
			keyStatus,
			rateLimitRps,
			lastUsedAt: lastUsedMs,
			cachedAt: nowMs,
		};

		// Write to L1 Memory
		cleanMemoryCache(nowMs);
		memoryCache.set(keyHash, {
			data: cachedEntry,
			expiresAt: nowMs + L1_CACHE_TTL_MS,
		});

		// Write to L2 KV Cache
		if (kv) {
			try {
				await kv.put(`rkey:${keyHash}`, JSON.stringify(cachedEntry), {
					expirationTtl: KV_CACHE_TTL_SECONDS,
				});
			} catch (kvErr) {
				console.warn("[MailHub Auth] Failed to write key to KV cache:", kvErr);
			}
		}

		// If either the key or project is inactive/revoked/disabled, return null
		if (keyStatus !== "active" || projectStatus !== "active") {
			return null;
		}

		// Trigger background last_used_at update if needed
		if (!lastUsedMs || nowMs - lastUsedMs > LAST_USED_WRITE_INTERVAL_MS) {
			updateRoutingKeyLastUsed(env, row.key_id, ctx);
		}

		return {
			project: {
				id: row.project_id,
				slug: row.project_slug,
				name: row.project_name,
				environment: row.environment as RoutingEnvironment,
				keyId: row.key_id,
				keyPrefix: row.prefix,
				rateLimitRps,
			},
			routingKey: parsed,
		};
	} catch (dbErr) {
		console.error("[MailHub Auth] Database lookup error:", dbErr);
		return null;
	}
}
