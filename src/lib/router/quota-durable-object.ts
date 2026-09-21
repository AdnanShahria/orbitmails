import { DurableObject } from "cloudflare:workers";
import {
	type QuotaCheckResult,
	type QuotaRefundResult,
	type QuotaSnapshot,
	getTodayUtcDateBucket,
	getNextUtcMidnightMs,
	getUtcDateBucketOffsetDays,
} from "./quota-types";

export type { QuotaCheckResult, QuotaRefundResult, QuotaSnapshot };
export { getTodayUtcDateBucket, getNextUtcMidnightMs, getUtcDateBucketOffsetDays };

/**
 * QuotaCoordinator Durable Object
 * 
 * Provides single-threaded, atomic check-and-increment of daily email quotas
 * per project per provider, eliminating race conditions when multiple edge nodes
 * send emails simultaneously against shared provider accounts (e.g. Brevo 300/day).
 */
export class QuotaCoordinator extends DurableObject<CloudflareEnv> {
	/** Fast in-memory cache of `${dateBucket}:${projectId}:${providerId}` -> used count */
	private memoryCache = new Map<string, number>();
	/** Flag indicating if we scheduled the rollover alarm */
	private alarmScheduled = false;

	constructor(ctx: DurableObjectState, env: CloudflareEnv) {
		super(ctx, env);
	}

	/**
	 * Build compound cache key
	 */
	private makeKey(dateBucket: string, projectId: string, providerId: string): string {
		return `${dateBucket}:${projectId}:${providerId}`;
	}

	/**
	 * Build persistent DO storage key
	 */
	private makeStorageKey(dateBucket: string, projectId: string, providerId: string): string {
		return `quota:${dateBucket}:${projectId}:${providerId}`;
	}

	/**
	 * Internal helper to retrieve the current used count for a project/provider/date.
	 * Checks in-memory cache first, then DO storage, and falls back to D1 for cold-start recovery.
	 */
	private async getCount(dateBucket: string, projectId: string, providerId: string): Promise<number> {
		const cacheKey = this.makeKey(dateBucket, projectId, providerId);
		const cached = this.memoryCache.get(cacheKey);
		if (typeof cached === "number") {
			return cached;
		}

		// Check DO persistent storage
		const storageKey = this.makeStorageKey(dateBucket, projectId, providerId);
		const stored = await this.ctx.storage.get<number>(storageKey);
		if (typeof stored === "number") {
			this.memoryCache.set(cacheKey, stored);
			return stored;
		}

		// Cold start recovery: attempt reconciliation from D1 if available
		const recovered = await this.recoverFromD1(dateBucket, projectId, providerId);
		this.memoryCache.set(cacheKey, recovered);
		await this.ctx.storage.put(storageKey, recovered);
		return recovered;
	}

	/**
	 * Cold start recovery: queries D1 `send_log` table for count of sent emails today.
	 * Gracefully returns 0 if table does not exist or query fails.
	 */
	private async recoverFromD1(dateBucket: string, projectId: string, providerId: string): Promise<number> {
		if (!this.env.DB) return 0;
		try {
			// Query D1 directly for sent messages on this date
			const stmt = this.env.DB.prepare(
				"SELECT COUNT(*) AS total FROM send_log WHERE project_id = ? AND provider_cred_id = ? AND date_bucket = ? AND status = 'sent'"
			);
			const row = await stmt.bind(projectId, providerId, dateBucket).first<{ total: number }>();
			return typeof row?.total === "number" ? row.total : 0;
		} catch {
			// send_log table may not exist yet during initial setup
			return 0;
		}
	}

	/**
	 * Schedules the midnight rollover alarm if not already active.
	 */
	private async ensureRolloverAlarm(): Promise<void> {
		if (this.alarmScheduled) return;
		try {
			const currentAlarm = await this.ctx.storage.getAlarm();
			const nextMidnight = getNextUtcMidnightMs();
			if (currentAlarm === null || currentAlarm > nextMidnight) {
				await this.ctx.storage.setAlarm(nextMidnight);
			}
			this.alarmScheduled = true;
		} catch (err) {
			console.warn("[QuotaCoordinator] Unable to set alarm:", err);
		}
	}

	/**
	 * Background sync to KV if `ROUTER_KV` is configured.
	 */
	private syncToKvIfAvailable(dateBucket: string, projectId: string, providerId: string, used: number): void {
		const kv = (this.env as CloudflareEnv & { ROUTER_KV?: KVNamespace }).ROUTER_KV;
		if (!kv) return;

		this.ctx.waitUntil(
			kv.put(
				`quota:${projectId}:${providerId}:${dateBucket}`,
				JSON.stringify({ used, updatedAt: Date.now() }),
				{ expirationTtl: 172800 } // 48 hours
			).catch((err) => {
				console.warn("[QuotaCoordinator] KV sync error:", err);
			})
		);
	}

	/**
	 * Atomically checks whether a project has quota remaining on a provider slice
	 * for the given dateBucket, and if so, increments the counter.
	 * 
	 * Guarantees zero race conditions via single-threaded DO execution.
	 */
	async checkAndIncrement(
		projectId: string,
		providerId: string,
		sliceLimit: number,
		dateBucket?: string
	): Promise<QuotaCheckResult> {
		const date = dateBucket || getTodayUtcDateBucket();
		const resetAt = getNextUtcMidnightMs();
		const cacheKey = this.makeKey(date, projectId, providerId);
		const storageKey = this.makeStorageKey(date, projectId, providerId);

		const currentUsed = await this.getCount(date, projectId, providerId);

		// If current usage meets or exceeds slice limit, deny send immediately
		if (currentUsed >= sliceLimit) {
			return {
				allowed: false,
				remaining: 0,
				currentUsed,
				sliceLimit,
				dateBucket: date,
				resetAt,
			};
		}

		// Atomic increment
		const newUsed = currentUsed + 1;
		this.memoryCache.set(cacheKey, newUsed);
		await this.ctx.storage.put(storageKey, newUsed);

		// Ensure midnight cleanup alarm is scheduled
		await this.ensureRolloverAlarm();

		// Asynchronously update KV snapshot if bound
		this.syncToKvIfAvailable(date, projectId, providerId, newUsed);

		return {
			allowed: true,
			remaining: Math.max(0, sliceLimit - newUsed),
			currentUsed: newUsed,
			sliceLimit,
			dateBucket: date,
			resetAt,
		};
	}

	/**
	 * Peeks at the quota status without incrementing.
	 */
	async peekQuota(
		projectId: string,
		providerId: string,
		sliceLimit: number,
		dateBucket?: string
	): Promise<QuotaCheckResult> {
		const date = dateBucket || getTodayUtcDateBucket();
		const resetAt = getNextUtcMidnightMs();
		const currentUsed = await this.getCount(date, projectId, providerId);

		return {
			allowed: currentUsed < sliceLimit,
			remaining: Math.max(0, sliceLimit - currentUsed),
			currentUsed,
			sliceLimit,
			dateBucket: date,
			resetAt,
		};
	}

	/**
	 * Refunds/decrements a quota allocation if an outbound send failed at the provider level
	 * (e.g. 500 error or network failure after quota was reserved).
	 */
	async refundQuota(
		projectId: string,
		providerId: string,
		dateBucket?: string,
		count: number = 1
	): Promise<QuotaRefundResult> {
		const date = dateBucket || getTodayUtcDateBucket();
		const cacheKey = this.makeKey(date, projectId, providerId);
		const storageKey = this.makeStorageKey(date, projectId, providerId);

		const currentUsed = await this.getCount(date, projectId, providerId);
		const newUsed = Math.max(0, currentUsed - count);

		this.memoryCache.set(cacheKey, newUsed);
		await this.ctx.storage.put(storageKey, newUsed);
		this.syncToKvIfAvailable(date, projectId, providerId, newUsed);

		return {
			refunded: true,
			remaining: 0,
			currentUsed: newUsed,
			dateBucket: date,
		};
	}

	/**
	 * Queries current usage for a specific project across all providers for a given date.
	 */
	async getProjectUsage(
		projectId: string,
		dateBucket?: string
	): Promise<Record<string, { currentUsed: number; dateBucket: string }>> {
		const date = dateBucket || getTodayUtcDateBucket();
		const prefix = `quota:${date}:${projectId}:`;
		const list = await this.ctx.storage.list<number>({ prefix });
		const result: Record<string, { currentUsed: number; dateBucket: string }> = {};

		for (const [key, value] of list.entries()) {
			const parts = key.split(":");
			const providerId = parts[3];
			if (providerId) {
				result[providerId] = {
					currentUsed: value,
					dateBucket: date,
				};
			}
		}

		for (const [memKey, value] of this.memoryCache.entries()) {
			const parts = memKey.split(":");
			if (parts[0] === date && parts[1] === projectId && parts[2]) {
				const providerId = parts[2];
				result[providerId] = {
					currentUsed: value,
					dateBucket: date,
				};
			}
		}

		return result;
	}

	/**
	 * Queries usage across ALL projects and providers for a given date.
	 * Returns: `{ [projectId]: { [providerId]: count } }`
	 */
	async getAllUsage(dateBucket?: string): Promise<Record<string, Record<string, number>>> {
		const date = dateBucket || getTodayUtcDateBucket();
		const prefix = `quota:${date}:`;
		const list = await this.ctx.storage.list<number>({ prefix });
		const result: Record<string, Record<string, number>> = {};

		for (const [key, value] of list.entries()) {
			const parts = key.split(":");
			const proj = parts[2];
			const prov = parts[3];
			if (proj && prov) {
				if (!result[proj]) result[proj] = {};
				result[proj][prov] = value;
			}
		}

		for (const [memKey, value] of this.memoryCache.entries()) {
			const parts = memKey.split(":");
			if (parts[0] === date && parts[1] && parts[2]) {
				const proj = parts[1];
				const prov = parts[2];
				if (!result[proj]) result[proj] = {};
				result[proj][prov] = value;
			}
		}

		return result;
	}

	/**
	 * Administratively resets or overrides quota for a project and provider.
	 */
	async resetQuota(projectId: string, providerId: string, dateBucket?: string): Promise<void> {
		const date = dateBucket || getTodayUtcDateBucket();
		const cacheKey = this.makeKey(date, projectId, providerId);
		const storageKey = this.makeStorageKey(date, projectId, providerId);

		this.memoryCache.set(cacheKey, 0);
		await this.ctx.storage.put(storageKey, 0);
		this.syncToKvIfAvailable(date, projectId, providerId, 0);
	}

	/**
	 * Cold-start reconciliation: Re-synchronizes usage counts directly from D1 `send_log` table.
	 */
	async syncFromD1(dateBucket?: string): Promise<{ syncedRecords: number }> {
		const date = dateBucket || getTodayUtcDateBucket();
		if (!this.env.DB) return { syncedRecords: 0 };

		try {
			const query = `
				SELECT project_id, provider_cred_id, COUNT(*) as count 
				FROM send_log 
				WHERE date_bucket = ? AND status = 'sent' 
				GROUP BY project_id, provider_cred_id
			`;
			const { results } = await this.env.DB.prepare(query).bind(date).all<{
				project_id: string;
				provider_cred_id: string;
				count: number;
			}>();

			if (!results || results.length === 0) {
				return { syncedRecords: 0 };
			}

			let syncedRecords = 0;
			for (const row of results) {
				const cacheKey = this.makeKey(date, row.project_id, row.provider_cred_id);
				const storageKey = this.makeStorageKey(date, row.project_id, row.provider_cred_id);
				this.memoryCache.set(cacheKey, row.count);
				await this.ctx.storage.put(storageKey, row.count);
				this.syncToKvIfAvailable(date, row.project_id, row.provider_cred_id, row.count);
				syncedRecords++;
			}

			return { syncedRecords };
		} catch (err) {
			console.warn("[QuotaCoordinator] syncFromD1 skipped or table not yet created:", err);
			return { syncedRecords: 0 };
		}
	}

	/**
	 * Cloudflare Durable Object Alarm Handler
	 * Triggered at UTC Midnight to clean up obsolete cache entries and older storage keys.
	 */
	async alarm(): Promise<void> {
		this.alarmScheduled = false;
		const today = getTodayUtcDateBucket();
		const yesterday = getUtcDateBucketOffsetDays(-1);

		// 1. Evict memory cache entries older than yesterday
		for (const key of this.memoryCache.keys()) {
			const [date] = key.split(":");
			if (date !== today && date !== yesterday) {
				this.memoryCache.delete(key);
			}
		}

		// 2. Prune storage keys older than 7 days (D1 holds permanent records)
		const cutoffDate = getUtcDateBucketOffsetDays(-7);
		try {
			const list = await this.ctx.storage.list<number>({ prefix: "quota:" });
			const keysToDelete: string[] = [];

			for (const key of list.keys()) {
				const parts = key.split(":");
				const date = parts[1];
				if (date && date < cutoffDate) {
					keysToDelete.push(key);
				}
			}

			if (keysToDelete.length > 0) {
				await this.ctx.storage.delete(keysToDelete);
			}
		} catch (err) {
			console.warn("[QuotaCoordinator] Alarm storage pruning warning:", err);
		}

		// 3. Schedule next UTC midnight alarm
		await this.ensureRolloverAlarm();
	}

	/**
	 * HTTP Fetch Handler
	 * Allows standard HTTP invocation of the Quota Engine if RPC is bypassed or for external testing.
	 */
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		try {
			if (url.pathname === "/check-and-increment" && request.method === "POST") {
				const body = (await request.json()) as {
					projectId: string;
					providerId: string;
					sliceLimit: number;
					dateBucket?: string;
				};
				if (!body.projectId || !body.providerId || typeof body.sliceLimit !== "number") {
					return new Response(JSON.stringify({ error: "Missing required fields" }), {
						status: 400,
						headers: { "Content-Type": "application/json" },
					});
				}
				const result = await this.checkAndIncrement(
					body.projectId,
					body.providerId,
					body.sliceLimit,
					body.dateBucket
				);
				return new Response(JSON.stringify(result), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}

			if (url.pathname === "/peek" && request.method === "POST") {
				const body = (await request.json()) as {
					projectId: string;
					providerId: string;
					sliceLimit: number;
					dateBucket?: string;
				};
				const result = await this.peekQuota(
					body.projectId,
					body.providerId,
					body.sliceLimit,
					body.dateBucket
				);
				return new Response(JSON.stringify(result), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}

			if (url.pathname === "/refund" && request.method === "POST") {
				const body = (await request.json()) as {
					projectId: string;
					providerId: string;
					dateBucket?: string;
					count?: number;
				};
				const result = await this.refundQuota(
					body.projectId,
					body.providerId,
					body.dateBucket,
					body.count
				);
				return new Response(JSON.stringify(result), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}

			if (url.pathname === "/usage/all" && request.method === "GET") {
				const dateBucket = url.searchParams.get("dateBucket") || undefined;
				const usage = await this.getAllUsage(dateBucket);
				return new Response(JSON.stringify(usage), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}

			if (url.pathname === "/usage/project" && request.method === "GET") {
				const projectId = url.searchParams.get("projectId");
				if (!projectId) {
					return new Response(JSON.stringify({ error: "Missing projectId parameter" }), {
						status: 400,
						headers: { "Content-Type": "application/json" },
					});
				}
				const dateBucket = url.searchParams.get("dateBucket") || undefined;
				const usage = await this.getProjectUsage(projectId, dateBucket);
				return new Response(JSON.stringify(usage), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}

			if (url.pathname === "/reset" && request.method === "POST") {
				const body = (await request.json()) as {
					projectId: string;
					providerId: string;
					dateBucket?: string;
				};
				await this.resetQuota(body.projectId, body.providerId, body.dateBucket);
				return new Response(JSON.stringify({ reset: true }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}

			if (url.pathname === "/sync-from-d1" && request.method === "POST") {
				const body = (await request.json().catch(() => ({}))) as { dateBucket?: string };
				const result = await this.syncFromD1(body.dateBucket);
				return new Response(JSON.stringify(result), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}

			return new Response("Not Found", { status: 404 });
		} catch (error) {
			console.error("[QuotaCoordinator HTTP Error]", error);
			return new Response(
				JSON.stringify({ error: (error as Error).message || "Internal DO Error" }),
				{ status: 500, headers: { "Content-Type": "application/json" } }
			);
		}
	}
}
