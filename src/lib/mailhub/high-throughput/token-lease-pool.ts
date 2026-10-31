/**
 * MailHub Token Lease Pool - Local Isolate Token Reservation Engine
 * Eliminates Durable Object single-thread lock contention during 1,000+ emails/sec bursts
 * by leasing quota slices in batches of 20-50 to edge worker isolates.
 * @module lib/mailhub/high-throughput/token-lease-pool
 */

import { newId } from "@/lib/ids";
import type { TokenLease } from "./types";
import { DEFAULT_HIGH_THROUGHPUT_CONFIG } from "./types";
import { getQuotaCoordinatorStub, getTodayUtcDateBucket } from "@/lib/router/quota-client";

interface LocalLeaseState {
	lease: TokenLease;
	lockPromise: Promise<void> | null;
}

// In-memory isolate lease cache keyed by `${projectId}:${providerCredId}:${dateBucket}`
const isolateLeaseCache = new Map<string, LocalLeaseState>();

/**
 * Acquires a single quota permit from the local isolate lease pool.
 * If the local lease is exhausted or expired, asynchronously requests a new batch lease
 * from the QuotaCoordinator Durable Object.
 */
export async function acquireQuotaPermit(
	env: CloudflareEnv,
	projectId: string,
	providerCredId: string,
	dailySliceLimit: number,
	dateBucket: string = getTodayUtcDateBucket(),
	batchSize: number = DEFAULT_HIGH_THROUGHPUT_CONFIG.tokenLeaseBatchSize,
): Promise<{ allowed: boolean; remainingInSlice: number; leasedFromDO: boolean }> {
	const cacheKey = `${projectId}:${providerCredId}:${dateBucket}`;
	const now = Date.now();

	let state = isolateLeaseCache.get(cacheKey);

	// Check if current lease has available tokens and has not expired
	if (state && state.lease.tokensUsed < state.lease.tokensGranted && state.lease.expiresAt > now) {
		state.lease.tokensUsed++;
		const remaining = Math.max(0, state.lease.tokensGranted - state.lease.tokensUsed);
		return { allowed: true, remainingInSlice: remaining, leasedFromDO: false };
	}

	// Lease needs renewal: acquire a batch lease from QuotaCoordinator
	try {
		const stub = getQuotaCoordinatorStub(env);
		if (!stub) {
			// No DO configured (e.g. unit tests or local node) -> permit immediately
			return { allowed: true, remainingInSlice: dailySliceLimit, leasedFromDO: false };
		}

		// Request a block of tokens up to batchSize
		const requestedBatch = Math.min(batchSize, dailySliceLimit);
		
		// If the stub has a batch lease method or checkAndIncrement:
		let grantedTokens = 0;
		let remainingInTotalSlice = 0;

		if (typeof (stub as any).leaseQuotaBatch === "function") {
			const res = await (stub as any).leaseQuotaBatch(projectId, providerCredId, requestedBatch, dailySliceLimit, dateBucket);
			grantedTokens = res.grantedTokens;
			remainingInTotalSlice = res.remaining;
		} else {
			// Use standard checkAndIncrement
			const res = await stub.checkAndIncrement(projectId, providerCredId, dailySliceLimit, dateBucket);
			if (res.allowed) {
				grantedTokens = 1;
				remainingInTotalSlice = res.remaining;
			} else {
				grantedTokens = 0;
				remainingInTotalSlice = 0;
			}
		}

		if (grantedTokens <= 0) {
			// Slice is fully exhausted
			return { allowed: false, remainingInSlice: 0, leasedFromDO: true };
		}

		// Store fresh lease valid for 60 seconds
		const newLease: TokenLease = {
			leaseId: newId("lease"),
			projectId,
			providerCredId,
			dateBucket,
			tokensGranted: grantedTokens,
			tokensUsed: 1, // Consume the first token for current request
			expiresAt: now + 60_000,
		};

		isolateLeaseCache.set(cacheKey, { lease: newLease, lockPromise: null });

		return {
			allowed: true,
			remainingInSlice: remainingInTotalSlice,
			leasedFromDO: true,
		};
	} catch (err) {
		console.warn(`[MailHub TokenLease] Error leasing quota tokens from coordinator:`, err);
		// Graceful degradation: permit send so user traffic is never dropped
		return { allowed: true, remainingInSlice: 999, leasedFromDO: false };
	}
}

/**
 * Refunds an unconsumed token to the local lease if an upstream send was aborted before dispatch.
 */
export function refundLocalPermit(
	projectId: string,
	providerCredId: string,
	dateBucket: string = getTodayUtcDateBucket(),
): void {
	const cacheKey = `${projectId}:${providerCredId}:${dateBucket}`;
	const state = isolateLeaseCache.get(cacheKey);
	if (state && state.lease.tokensUsed > 0) {
		state.lease.tokensUsed--;
	}
}

/**
 * Resets local isolate lease cache (useful for testing or midnight rollovers).
 */
export function clearIsolateLeases(): void {
	isolateLeaseCache.clear();
}
