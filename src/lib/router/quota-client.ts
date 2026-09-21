import type { QuotaCoordinator } from "./quota-durable-object.ts";
import {
	type QuotaCheckResult,
	type QuotaRefundResult,
	type QuotaParams,
	type RefundParams,
	getTodayUtcDateBucket,
	getNextUtcMidnightMs,
} from "./quota-types.ts";

export { getTodayUtcDateBucket, getNextUtcMidnightMs };

/**
 * Fallback In-Memory store for environments where Cloudflare Durable Objects
 * are not active (e.g. self-hosted Node.js runtime, unit testing, or local mocks).
 */
export class LocalQuotaFallback {
	private static instance: LocalQuotaFallback;
	private counters = new Map<string, number>();

	static getInstance(): LocalQuotaFallback {
		if (!this.instance) {
			this.instance = new LocalQuotaFallback();
		}
		return this.instance;
	}

	clear(): void {
		this.counters.clear();
	}

	private makeKey(dateBucket: string, projectId: string, providerId: string): string {
		return `${dateBucket}:${projectId}:${providerId}`;
	}

	checkAndIncrement(params: QuotaParams): QuotaCheckResult {
		const date = params.dateBucket || getTodayUtcDateBucket();
		const resetAt = getNextUtcMidnightMs();
		const key = this.makeKey(date, params.projectId, params.providerId);
		const current = this.counters.get(key) ?? 0;

		if (current >= params.sliceLimit) {
			return {
				allowed: false,
				remaining: 0,
				currentUsed: current,
				sliceLimit: params.sliceLimit,
				dateBucket: date,
				resetAt,
			};
		}

		const newUsed = current + 1;
		this.counters.set(key, newUsed);

		return {
			allowed: true,
			remaining: Math.max(0, params.sliceLimit - newUsed),
			currentUsed: newUsed,
			sliceLimit: params.sliceLimit,
			dateBucket: date,
			resetAt,
		};
	}

	peek(params: QuotaParams): QuotaCheckResult {
		const date = params.dateBucket || getTodayUtcDateBucket();
		const resetAt = getNextUtcMidnightMs();
		const key = this.makeKey(date, params.projectId, params.providerId);
		const current = this.counters.get(key) ?? 0;

		return {
			allowed: current < params.sliceLimit,
			remaining: Math.max(0, params.sliceLimit - current),
			currentUsed: current,
			sliceLimit: params.sliceLimit,
			dateBucket: date,
			resetAt,
		};
	}

	refund(params: RefundParams): QuotaRefundResult {
		const date = params.dateBucket || getTodayUtcDateBucket();
		const key = this.makeKey(date, params.projectId, params.providerId);
		const current = this.counters.get(key) ?? 0;
		const count = params.count ?? 1;
		const newUsed = Math.max(0, current - count);
		this.counters.set(key, newUsed);

		return {
			refunded: true,
			remaining: 0,
			currentUsed: newUsed,
			dateBucket: date,
		};
	}

	getProjectUsage(projectId: string, dateBucket?: string): Record<string, { currentUsed: number; dateBucket: string }> {
		const date = dateBucket || getTodayUtcDateBucket();
		const result: Record<string, { currentUsed: number; dateBucket: string }> = {};

		for (const [key, value] of this.counters.entries()) {
			const parts = key.split(":");
			if (parts[0] === date && parts[1] === projectId && parts[2]) {
				result[parts[2]] = { currentUsed: value, dateBucket: date };
			}
		}

		return result;
	}

	getAllUsage(dateBucket?: string): Record<string, Record<string, number>> {
		const date = dateBucket || getTodayUtcDateBucket();
		const result: Record<string, Record<string, number>> = {};

		for (const [key, value] of this.counters.entries()) {
			const parts = key.split(":");
			if (parts[0] === date && parts[1] && parts[2]) {
				const proj = parts[1];
				const prov = parts[2];
				if (!result[proj]) result[proj] = {};
				result[proj][prov] = value;
			}
		}

		return result;
	}

	reset(projectId: string, providerId: string, dateBucket?: string): void {
		const date = dateBucket || getTodayUtcDateBucket();
		const key = this.makeKey(date, projectId, providerId);
		this.counters.set(key, 0);
	}
}

/**
 * Retrieves the Durable Object stub for the QuotaCoordinator.
 */
export function getQuotaCoordinatorStub(
	env: CloudflareEnv,
	name = "global"
): DurableObjectStub<QuotaCoordinator> | null {
	const coordinatorBinding = (env as CloudflareEnv & {
		QUOTA_COORDINATOR?: DurableObjectNamespace<QuotaCoordinator>;
	}).QUOTA_COORDINATOR;

	if (!coordinatorBinding) {
		return null;
	}

	return coordinatorBinding.getByName(name);
}

/**
 * Atomically checks and increments a project's quota slice on a provider.
 * Uses Cloudflare Durable Object single-threaded atomic counter when available,
 * falling back to in-memory fallback in local/non-DO environments.
 */
export async function checkAndIncrementQuota(
	env: CloudflareEnv,
	params: QuotaParams
): Promise<QuotaCheckResult> {
	const stub = getQuotaCoordinatorStub(env);

	if (stub) {
		try {
			// Direct RPC invocation
			if (typeof stub.checkAndIncrement === "function") {
				return await stub.checkAndIncrement(
					params.projectId,
					params.providerId,
					params.sliceLimit,
					params.dateBucket
				);
			}

			// HTTP fetch fallback if direct RPC is unavailable
			const resp = await stub.fetch("https://mailhub-quota/check-and-increment", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(params),
			});
			if (resp.ok) {
				return (await resp.json()) as QuotaCheckResult;
			}
			throw new Error(`Quota DO returned status ${resp.status}`);
		} catch (err) {
			console.error("[checkAndIncrementQuota] DO invocation failed, engaging fallback:", err);
		}
	}

	// Local fallback
	return LocalQuotaFallback.getInstance().checkAndIncrement(params);
}

/**
 * Peeks at a project's quota status without incrementing.
 */
export async function peekQuota(
	env: CloudflareEnv,
	params: QuotaParams
): Promise<QuotaCheckResult> {
	const stub = getQuotaCoordinatorStub(env);

	if (stub) {
		try {
			if (typeof stub.peekQuota === "function") {
				return await stub.peekQuota(
					params.projectId,
					params.providerId,
					params.sliceLimit,
					params.dateBucket
				);
			}

			const resp = await stub.fetch("https://mailhub-quota/peek", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(params),
			});
			if (resp.ok) {
				return (await resp.json()) as QuotaCheckResult;
			}
		} catch (err) {
			console.error("[peekQuota] DO invocation failed, engaging fallback:", err);
		}
	}

	return LocalQuotaFallback.getInstance().peek(params);
}

/**
 * Refunds a previously incremented quota slot (e.g. after provider send failure).
 */
export async function refundQuota(
	env: CloudflareEnv,
	params: RefundParams
): Promise<QuotaRefundResult> {
	const stub = getQuotaCoordinatorStub(env);

	if (stub) {
		try {
			if (typeof stub.refundQuota === "function") {
				return await stub.refundQuota(
					params.projectId,
					params.providerId,
					params.dateBucket,
					params.count
				);
			}

			const resp = await stub.fetch("https://mailhub-quota/refund", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(params),
			});
			if (resp.ok) {
				return (await resp.json()) as QuotaRefundResult;
			}
		} catch (err) {
			console.error("[refundQuota] DO invocation failed, engaging fallback:", err);
		}
	}

	return LocalQuotaFallback.getInstance().refund(params);
}

/**
 * Retrieves today's quota usage for a specific project across all providers.
 */
export async function getProjectQuotaUsage(
	env: CloudflareEnv,
	projectId: string,
	dateBucket?: string
): Promise<Record<string, { currentUsed: number; dateBucket: string }>> {
	const stub = getQuotaCoordinatorStub(env);

	if (stub) {
		try {
			if (typeof stub.getProjectUsage === "function") {
				return await stub.getProjectUsage(projectId, dateBucket);
			}

			const url = new URL("https://mailhub-quota/usage/project");
			url.searchParams.set("projectId", projectId);
			if (dateBucket) url.searchParams.set("dateBucket", dateBucket);

			const resp = await stub.fetch(url.toString());
			if (resp.ok) {
				return (await resp.json()) as Record<string, { currentUsed: number; dateBucket: string }>;
			}
		} catch (err) {
			console.error("[getProjectQuotaUsage] DO invocation failed, engaging fallback:", err);
		}
	}

	return LocalQuotaFallback.getInstance().getProjectUsage(projectId, dateBucket);
}

/**
 * Retrieves today's quota usage across ALL projects and providers (for dashboard).
 */
export async function getAllQuotaUsage(
	env: CloudflareEnv,
	dateBucket?: string
): Promise<Record<string, Record<string, number>>> {
	const stub = getQuotaCoordinatorStub(env);

	if (stub) {
		try {
			if (typeof stub.getAllUsage === "function") {
				return await stub.getAllUsage(dateBucket);
			}

			const url = new URL("https://mailhub-quota/usage/all");
			if (dateBucket) url.searchParams.set("dateBucket", dateBucket);

			const resp = await stub.fetch(url.toString());
			if (resp.ok) {
				return (await resp.json()) as Record<string, Record<string, number>>;
			}
		} catch (err) {
			console.error("[getAllQuotaUsage] DO invocation failed, engaging fallback:", err);
		}
	}

	return LocalQuotaFallback.getInstance().getAllUsage(dateBucket);
}

/**
 * Triggers cold-start reconciliation from D1 `send_log` table.
 */
export async function syncQuotaFromD1(
	env: CloudflareEnv,
	dateBucket?: string
): Promise<{ syncedRecords: number }> {
	const stub = getQuotaCoordinatorStub(env);

	if (stub) {
		try {
			if (typeof stub.syncFromD1 === "function") {
				return await stub.syncFromD1(dateBucket);
			}

			const resp = await stub.fetch("https://mailhub-quota/sync-from-d1", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ dateBucket }),
			});
			if (resp.ok) {
				return (await resp.json()) as { syncedRecords: number };
			}
		} catch (err) {
			console.error("[syncQuotaFromD1] DO invocation failed:", err);
		}
	}

	return { syncedRecords: 0 };
}

/**
 * Resets quota allocation for a specific project/provider slice.
 */
export async function resetQuota(
	env: CloudflareEnv,
	projectId: string,
	providerId: string,
	dateBucket?: string
): Promise<void> {
	const stub = getQuotaCoordinatorStub(env);

	if (stub) {
		try {
			if (typeof stub.resetQuota === "function") {
				await stub.resetQuota(projectId, providerId, dateBucket);
				return;
			}

			await stub.fetch("https://mailhub-quota/reset", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ projectId, providerId, dateBucket }),
			});
			return;
		} catch (err) {
			console.error("[resetQuota] DO invocation failed, engaging fallback:", err);
		}
	}

	LocalQuotaFallback.getInstance().reset(projectId, providerId, dateBucket);
}
