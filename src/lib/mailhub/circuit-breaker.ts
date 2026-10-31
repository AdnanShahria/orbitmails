/**
 * OrbitMails / MailHub - Provider Circuit Breaker Engine
 * @module lib/mailhub/circuit-breaker
 *
 * Implements the 3-strike isolation circuit breaker:
 * - 3 consecutive TRANSIENT_SERVER_ERROR failures within 5 minutes trips to OPEN.
 * - OPEN state quarantines the provider for 15 minutes.
 * - After 15 minutes, transitions to HALF_OPEN to allow 1 probe request.
 * - If probe succeeds, circuit resets to CLOSED and health restored to 1.0.
 * - If probe fails, circuit trips back to OPEN for another 15 minutes.
 * - QUOTA_EXCEEDED never penalizes the circuit breaker or health score.
 */

import { getCircuitBreakerKey } from "./router";
import type { CircuitBreakerState, MailHubEnv } from "./types";

export interface CircuitBreakerConfig {
	/** Number of consecutive failures to trip circuit. Default: 3 */
	failureThreshold: number;
	/** Window in milliseconds within which failures are counted. Default: 5 min (300,000 ms) */
	failureWindowMs: number;
	/** Quarantine period in milliseconds while OPEN before testing HALF_OPEN. Default: 15 min (900,000 ms) */
	quarantineDurationMs: number;
	/** KV cache TTL in seconds when saving circuit state. Default: 3600 (1 hour) */
	kvTtlSeconds?: number;
}

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
	failureThreshold: 3,
	failureWindowMs: 5 * 60 * 1000, // 5 minutes
	quarantineDurationMs: 15 * 60 * 1000, // 15 minutes
	kvTtlSeconds: 3600,
};

export interface CircuitBreakerRecord {
	providerCredId: string;
	state: CircuitBreakerState; // "closed" | "half-open" | "open"
	consecutiveFailures: number;
	failureTimestamps: number[];
	lastFailureAt?: number;
	trippedAt?: number;
	healthScore: number; // 0.0 to 1.0
	lastErrorMessage?: string;
	lastErrorCode?: string;
	updatedAt: number;
	probeInFlight?: boolean;
}

export interface CanExecuteResult {
	allowed: boolean;
	isProbe: boolean;
	state: CircuitBreakerState;
	reason?: string;
	remainingQuarantineMs?: number;
}

export interface RecordFailureResult {
	tripped: boolean;
	record: CircuitBreakerRecord;
	previousState: CircuitBreakerState;
	newState: CircuitBreakerState;
}

/**
 * Calculates health score (0.0 to 1.0) based on consecutive failures
 */
export function calculateHealthScore(consecutiveFailures: number, threshold: number): number {
	if (consecutiveFailures <= 0) return 1.0;
	if (consecutiveFailures >= threshold) return 0.0;
	// Smooth exponential degradation: 1 failure => 0.70, 2 failures => 0.35, 3 failures => 0.0
	const ratio = consecutiveFailures / threshold;
	return Math.max(0, Math.round((1 - ratio * 0.95) * 100) / 100);
}

/**
 * In-memory fallback and test store for Circuit Breaker records
 */
export class LocalCircuitBreakerStore {
	private static instance: LocalCircuitBreakerStore;
	private records = new Map<string, CircuitBreakerRecord>();

	static getInstance(): LocalCircuitBreakerStore {
		if (!this.instance) {
			this.instance = new LocalCircuitBreakerStore();
		}
		return this.instance;
	}

	get(providerCredId: string): CircuitBreakerRecord | undefined {
		const rec = this.records.get(providerCredId);
		return rec ? { ...rec, failureTimestamps: [...rec.failureTimestamps] } : undefined;
	}

	set(providerCredId: string, record: CircuitBreakerRecord): void {
		this.records.set(providerCredId, {
			...record,
			failureTimestamps: [...record.failureTimestamps],
		});
	}

	delete(providerCredId: string): void {
		this.records.delete(providerCredId);
	}

	clear(): void {
		this.records.clear();
	}

	getAll(): Map<string, CircuitBreakerRecord> {
		return new Map(this.records);
	}
}

/**
 * Enterprise Circuit Breaker Engine
 */
export class CircuitBreaker {
	readonly config: CircuitBreakerConfig;

	constructor(config: Partial<CircuitBreakerConfig> = {}) {
		this.config = { ...DEFAULT_CIRCUIT_CONFIG, ...config };
	}

	/**
	 * Retrieves current circuit breaker state from memory / KV with automatic
	 * quarantine expiration checks (OPEN -> HALF_OPEN).
	 */
	async getState(
		providerCredId: string,
		env?: MailHubEnv,
		now = Date.now(),
	): Promise<CircuitBreakerRecord> {
		const localStore = LocalCircuitBreakerStore.getInstance();
		let record = localStore.get(providerCredId);

		// Fallback to Cloudflare KV if not cached in memory
		if (!record && env?.KV) {
			try {
				const kvKey = getCircuitBreakerKey(providerCredId);
				const stored = await env.KV.get(kvKey, "json");
				if (stored && typeof stored === "object") {
					const data = stored as Partial<CircuitBreakerRecord>;
					record = {
						providerCredId,
						state: (data.state as CircuitBreakerState) || "closed",
						consecutiveFailures: Number(data.consecutiveFailures ?? 0),
						failureTimestamps: Array.isArray(data.failureTimestamps) ? data.failureTimestamps : [],
						lastFailureAt: data.lastFailureAt,
						trippedAt: data.trippedAt,
						healthScore: Number(data.healthScore ?? 1.0),
						lastErrorMessage: data.lastErrorMessage,
						lastErrorCode: data.lastErrorCode,
						updatedAt: Number(data.updatedAt ?? now),
					};
					localStore.set(providerCredId, record);
				}
			} catch (err) {
				console.warn(`[CircuitBreaker] Failed to read KV for ${providerCredId}:`, err);
			}
		}

		// If no record exists, initialize fresh closed state
		if (!record) {
			record = {
				providerCredId,
				state: "closed",
				consecutiveFailures: 0,
				failureTimestamps: [],
				healthScore: 1.0,
				updatedAt: now,
			};
			localStore.set(providerCredId, record);
			return record;
		}

		// Check if OPEN quarantine has expired and transition to HALF_OPEN
		if (record.state === "open" && record.trippedAt) {
			const elapsed = now - record.trippedAt;
			if (elapsed >= this.config.quarantineDurationMs) {
				record.state = "half-open";
				record.probeInFlight = false;
				record.updatedAt = now;
				// In half-open, health score rises to 0.5 to allow tentative scoring
				record.healthScore = 0.5;
				localStore.set(providerCredId, record);
				await this.persistToKv(record, env);
			}
		}

		return record;
	}

	/**
	 * Determines whether a request is allowed to call this provider.
	 */
	async canExecute(
		providerCredId: string,
		env?: MailHubEnv,
		now = Date.now(),
	): Promise<CanExecuteResult> {
		const record = await this.getState(providerCredId, env, now);

		if (record.state === "closed") {
			return { allowed: true, isProbe: false, state: "closed" };
		}

		if (record.state === "half-open") {
			// Allow a single probe request through
			if (!record.probeInFlight) {
				record.probeInFlight = true;
				LocalCircuitBreakerStore.getInstance().set(providerCredId, record);
				return { allowed: true, isProbe: true, state: "half-open" };
			}
			// Another probe is already in flight
			return {
				allowed: false,
				isProbe: false,
				state: "half-open",
				reason: "PROBE_IN_FLIGHT",
			};
		}

		// State is OPEN
		const remaining = record.trippedAt
			? Math.max(0, this.config.quarantineDurationMs - (now - record.trippedAt))
			: this.config.quarantineDurationMs;

		return {
			allowed: false,
			isProbe: false,
			state: "open",
			reason: "CIRCUIT_OPEN",
			remainingQuarantineMs: remaining,
		};
	}

	/**
	 * Records a successful delivery.
	 * If the circuit was HALF_OPEN, resets to CLOSED.
	 */
	async recordSuccess(
		providerCredId: string,
		env?: MailHubEnv,
		now = Date.now(),
	): Promise<CircuitBreakerRecord> {
		const record = await this.getState(providerCredId, env, now);
		const wasHalfOpen = record.state === "half-open";

		record.state = "closed";
		record.consecutiveFailures = 0;
		record.failureTimestamps = [];
		record.healthScore = 1.0;
		record.probeInFlight = false;
		record.trippedAt = undefined;
		record.lastErrorMessage = undefined;
		record.lastErrorCode = undefined;
		record.updatedAt = now;

		LocalCircuitBreakerStore.getInstance().set(providerCredId, record);
		await this.persistToKv(record, env);

		return record;
	}

	/**
	 * Records a TRANSIENT_SERVER_ERROR failure.
	 * Evaluates consecutive failures in the 5-minute sliding window.
	 * Trips to OPEN on 3 consecutive failures.
	 */
	async recordFailure(
		providerCredId: string,
		error: { message?: string; code?: string } | Error,
		env?: MailHubEnv,
		now = Date.now(),
	): Promise<RecordFailureResult> {
		const record = await this.getState(providerCredId, env, now);
		const previousState = record.state;

		const errorMessage = error instanceof Error ? error.message : error?.message || "Unknown error";
		const errorCode = (error as { code?: string })?.code || "TRANSIENT_SERVER_ERROR";

		record.lastFailureAt = now;
		record.lastErrorMessage = errorMessage;
		record.lastErrorCode = errorCode;
		record.updatedAt = now;
		record.probeInFlight = false;

		// Prune failure timestamps outside the 5-minute sliding window
		const windowStart = now - this.config.failureWindowMs;
		record.failureTimestamps = record.failureTimestamps.filter((t) => t >= windowStart);
		record.failureTimestamps.push(now);

		record.consecutiveFailures = record.failureTimestamps.length;

		let tripped = false;

		// If failure happens while HALF_OPEN: immediate re-trip to OPEN
		if (previousState === "half-open") {
			record.state = "open";
			record.trippedAt = now;
			record.healthScore = 0.0;
			tripped = true;
		} else if (record.consecutiveFailures >= this.config.failureThreshold) {
			// Trip from CLOSED to OPEN
			record.state = "open";
			record.trippedAt = now;
			record.healthScore = 0.0;
			tripped = true;
		} else {
			// Degrade health score gracefully
			record.healthScore = calculateHealthScore(record.consecutiveFailures, this.config.failureThreshold);
		}

		LocalCircuitBreakerStore.getInstance().set(providerCredId, record);
		await this.persistToKv(record, env);

		return {
			tripped,
			record,
			previousState,
			newState: record.state,
		};
	}

	/**
	 * Manually resets a provider's circuit breaker to CLOSED (admin/test utility)
	 */
	async reset(providerCredId: string, env?: MailHubEnv): Promise<CircuitBreakerRecord> {
		const record: CircuitBreakerRecord = {
			providerCredId,
			state: "closed",
			consecutiveFailures: 0,
			failureTimestamps: [],
			healthScore: 1.0,
			updatedAt: Date.now(),
		};

		LocalCircuitBreakerStore.getInstance().set(providerCredId, record);
		await this.persistToKv(record, env);
		return record;
	}

	/**
	 * Persists the circuit breaker record to Cloudflare KV for edge cross-worker synchronization
	 */
	private async persistToKv(record: CircuitBreakerRecord, env?: MailHubEnv): Promise<void> {
		if (!env?.KV) return;
		try {
			const kvKey = getCircuitBreakerKey(record.providerCredId);
			const ttl = this.config.kvTtlSeconds || 3600;
			await env.KV.put(
				kvKey,
				JSON.stringify({
					state: record.state,
					consecutiveFailures: record.consecutiveFailures,
					failureTimestamps: record.failureTimestamps,
					lastFailureAt: record.lastFailureAt,
					trippedAt: record.trippedAt,
					healthScore: record.healthScore,
					lastErrorMessage: record.lastErrorMessage,
					lastErrorCode: record.lastErrorCode,
					updatedAt: record.updatedAt,
				}),
				{ expirationTtl: ttl },
			);
		} catch (err) {
			console.warn(`[CircuitBreaker] Failed to persist KV for ${record.providerCredId}:`, err);
		}
	}
}

/**
 * Global default circuit breaker instance
 */
export const defaultCircuitBreaker = new CircuitBreaker();
