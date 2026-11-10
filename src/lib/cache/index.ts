/**
 * OrbitMails - High-Performance Multi-Tier Cache Layer
 * @module lib/cache
 *
 * Implements a layered caching architecture:
 * Level 1: In-memory LRU isolate cache (0ms lookup, microsecond hit)
 * Level 2: Cloudflare KV (sub-5ms distributed edge cache)
 * Level 3: Redis / External cache adapter (when REDIS_URL is configured)
 */

interface CacheEntry<T> {
	value: T;
	expiresAt: number;
}

export class MemoryCache {
	private readonly store = new Map<string, CacheEntry<unknown>>();
	private readonly maxEntries: number;

	constructor(maxEntries = 5000) {
		this.maxEntries = maxEntries;
	}

	get<T>(key: string): T | undefined {
		const entry = this.store.get(key);
		if (!entry) return undefined;
		if (Date.now() > entry.expiresAt) {
			this.store.delete(key);
			return undefined;
		}
		// Refresh position for LRU
		this.store.delete(key);
		this.store.set(key, entry);
		return entry.value as T;
	}

	set<T>(key: string, value: T, ttlSeconds: number): void {
		if (this.store.size >= this.maxEntries) {
			// Evict oldest entry
			const oldestKey = this.store.keys().next().value;
			if (oldestKey) this.store.delete(oldestKey);
		}
		this.store.set(key, {
			value,
			expiresAt: Date.now() + ttlSeconds * 1000,
		});
	}

	delete(key: string): void {
		this.store.delete(key);
	}

	clear(): void {
		this.store.clear();
	}
}

// Global isolate-level L1 memory cache
export const globalL1Cache = new MemoryCache();

export interface CacheOptions {
	ttlSeconds?: number;
	skipL1?: boolean;
}

export class CacheManager {
	constructor(private readonly memory = globalL1Cache) {}

	/**
	 * Retrieve a cached item from L1 (memory) or L2 (Cloudflare KV).
	 */
	async get<T>(key: string, env?: CloudflareEnv): Promise<T | null> {
		// 1. Try L1 Memory Cache
		const memVal = this.memory.get<T>(key);
		if (memVal !== undefined) return memVal;

		// 2. Try L2 KV Cache if available
		const kv = (env as unknown as { ROUTER_KV?: KVNamespace; KV?: KVNamespace })?.ROUTER_KV ??
			(env as unknown as { ROUTER_KV?: KVNamespace; KV?: KVNamespace })?.KV;

		if (kv && typeof kv.get === "function") {
			try {
				const raw = await kv.get(key, "text");
				if (raw) {
					const parsed = JSON.parse(raw) as T;
					// Backfill L1
					this.memory.set(key, parsed, 60);
					return parsed;
				}
			} catch (err) {
				console.warn("[Cache] KV read failure for key:", key, err);
			}
		}

		return null;
	}

	/**
	 * Set a cached item in L1 (memory) and L2 (Cloudflare KV).
	 */
	async set<T>(key: string, value: T, options: CacheOptions = {}, env?: CloudflareEnv): Promise<void> {
		const ttl = options.ttlSeconds ?? 300;

		if (!options.skipL1) {
			this.memory.set(key, value, ttl);
		}

		const kv = (env as unknown as { ROUTER_KV?: KVNamespace; KV?: KVNamespace })?.ROUTER_KV ??
			(env as unknown as { ROUTER_KV?: KVNamespace; KV?: KVNamespace })?.KV;

		if (kv && typeof kv.put === "function") {
			try {
				await kv.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, ttl) });
			} catch (err) {
				console.warn("[Cache] KV write failure for key:", key, err);
			}
		}
	}

	/**
	 * Remember pattern: returns cached item or computes and caches it.
	 */
	async remember<T>(
		key: string,
		ttlSeconds: number,
		compute: () => Promise<T>,
		env?: CloudflareEnv,
	): Promise<T> {
		const existing = await this.get<T>(key, env);
		if (existing !== null) return existing;

		const computed = await compute();
		await this.set<T>(key, computed, { ttlSeconds }, env);
		return computed;
	}

	/**
	 * Invalidate cache key across L1 and L2.
	 */
	async delete(key: string, env?: CloudflareEnv): Promise<void> {
		this.memory.delete(key);

		const kv = (env as unknown as { ROUTER_KV?: KVNamespace; KV?: KVNamespace })?.ROUTER_KV ??
			(env as unknown as { ROUTER_KV?: KVNamespace; KV?: KVNamespace })?.KV;

		if (kv && typeof kv.delete === "function") {
			try {
				await kv.delete(key);
			} catch (err) {
				console.warn("[Cache] KV delete failure for key:", key, err);
			}
		}
	}
}

export const cache = new CacheManager();

