/**
 * OrbitMails / MailHub - Intelligent Routing & Candidate Selection Engine
 * @module lib/mailhub/router
 */

import { calculateProviderScore } from "./scoring";
import type {
	CircuitBreakerState,
	MailHubEnv,
	ProjectAllocation,
	ProviderCredential,
	ProviderHealthInfo,
	RankedProvider,
	RoutingOptions,
} from "./types";

/**
 * Standard KV key prefix helpers
 */
export function getQuotaKey(projectId: string, providerCredId: string, dateBucket: string): string {
	return `quota:${projectId}:${providerCredId}:${dateBucket}`;
}

export function getCircuitBreakerKey(providerCredId: string): string {
	return `cb:${providerCredId}`;
}

export function getTodayDateBucket(date = new Date()): string {
	return date.toISOString().slice(0, 10);
}

/**
 * Retrieves real-time used quota from:
 * 1. Options override (for tests/dry runs)
 * 2. Cloudflare Durable Object (single-threaded atomic count) if bound
 * 3. Cloudflare KV cache (`quota:{projectId}:{providerCredId}:{dateBucket}`)
 * 4. D1 Database `send_log` fallback
 */
export async function getRealtimeQuotaUsage(
	projectId: string,
	providerCredId: string,
	dateBucket: string,
	env: MailHubEnv,
	options?: RoutingOptions,
): Promise<number> {
	// 1. Simulation override
	const cacheKey = `${projectId}:${providerCredId}:${dateBucket}`;
	if (options?.usageOverride && cacheKey in options.usageOverride) {
		return options.usageOverride[cacheKey];
	}
	const genericKey = `${projectId}:${providerCredId}`;
	if (options?.usageOverride && genericKey in options.usageOverride) {
		return options.usageOverride[genericKey];
	}

	// 2. Cloudflare Durable Object (QuotaCounter)
	if (env.QUOTA_DO) {
		try {
			const doId = env.QUOTA_DO.idFromName(`${projectId}:${providerCredId}:${dateBucket}`);
			const stub = env.QUOTA_DO.get(doId);
			const response = await stub.fetch("https://quota-counter.internal/get");
			if (response.ok) {
				const data = (await response.json()) as { used: number };
				if (typeof data?.used === "number") {
					return data.used;
				}
			}
		} catch {
			// Fallback to KV if DO call fails
		}
	}

	// 3. Cloudflare KV
	if (env.KV) {
		try {
			const kvKey = getQuotaKey(projectId, providerCredId, dateBucket);
			const stored = await env.KV.get(kvKey, "json");
			if (stored && typeof stored === "object" && typeof (stored as any).used === "number") {
				return (stored as any).used;
			}
			if (typeof stored === "number") {
				return stored;
			}
		} catch {
			// Fallback to DB
		}
	}

	// 4. D1 Database query fallback
	if (env.DB) {
		try {
			const query = `SELECT COUNT(*) as count FROM send_log WHERE project_id = ? AND provider_cred_id = ? AND date_bucket = ? AND status = 'sent'`;
			const res = await env.DB.prepare(query).bind(projectId, providerCredId, dateBucket).first();
			if (res && typeof res.count === "number") {
				return res.count;
			}
		} catch {
			// If table does not exist or query fails, assume 0
		}
	}

	return 0;
}

/**
 * Retrieves the current health and circuit-breaker state for a provider.
 */
export async function getProviderHealth(
	providerCredId: string,
	env: MailHubEnv,
	options?: RoutingOptions,
): Promise<ProviderHealthInfo> {
	// 1. Override for testing / simulations
	if (options?.healthOverride && options.healthOverride[providerCredId]) {
		const override = options.healthOverride[providerCredId];
		return {
			providerCredId,
			healthScore: override.healthScore ?? 1.0,
			circuitState: override.circuitState ?? "closed",
			consecutiveFailures: override.consecutiveFailures ?? 0,
			lastFailureAt: override.lastFailureAt,
			trippedAt: override.trippedAt,
		};
	}

	// 2. Cloudflare KV lookup
	if (env.KV) {
		try {
			const cbKey = getCircuitBreakerKey(providerCredId);
			const stored = await env.KV.get(cbKey, "json");
			if (stored && typeof stored === "object") {
				const state = (stored as any).state as CircuitBreakerState;
				const consecutiveFailures = typeof (stored as any).consecutiveFailures === "number" ? (stored as any).consecutiveFailures : 0;
				const healthScore = typeof (stored as any).healthScore === "number" ? (stored as any).healthScore : 1.0;
				return {
					providerCredId,
					circuitState: state || "closed",
					consecutiveFailures,
					healthScore,
					lastFailureAt: (stored as any).lastFailureAt,
					trippedAt: (stored as any).trippedAt,
				};
			}
		} catch {
			// Default to healthy
		}
	}

	// 3. Default healthy state
	return {
		providerCredId,
		healthScore: 1.0,
		circuitState: "closed",
		consecutiveFailures: 0,
	};
}

/**
 * Resolves allocations and credential records for a given project.
 */
export async function resolveProjectAllocations(
	projectId: string,
	env: MailHubEnv,
	options?: RoutingOptions,
): Promise<Array<ProjectAllocation & { credential: ProviderCredential }>> {
	// 1. Isolated overrides
	if (options?.allocationsOverride) {
		const credsMap = new Map<string, ProviderCredential>(
			(options.credentialsOverride ?? []).map((c) => [c.id, c]),
		);
		return options.allocationsOverride
			.filter((a) => a.projectId === projectId)
			.map((alloc) => {
				const credential = credsMap.get(alloc.providerCredId) ?? {
					id: alloc.providerCredId,
					provider: alloc.providerCredId.split("_")[0] || "resend",
					dailyLimit: 1000,
					costPerK: 0,
					enabled: true,
				};
				return { ...alloc, credential };
			});
	}

	// 2. Query from D1 Database
	if (env.DB) {
		try {
			const query = `
				SELECT 
					a.project_id as projectId,
					a.provider_cred_id as providerCredId,
					a.daily_slice as dailySlice,
					a.priority as priority,
					c.id as credId,
					c.provider as provider,
					c.label as label,
					c.daily_limit as dailyLimit,
					c.cost_per_k as costPerK,
					c.enabled as enabled
				FROM project_provider_allocations a
				JOIN provider_credentials c ON a.provider_cred_id = c.id
				WHERE a.project_id = ?
				ORDER BY a.priority ASC
			`;
			const { results } = await env.DB.prepare(query).bind(projectId).all();
			if (results && results.length > 0) {
				return results.map((row: any) => ({
					projectId: row.projectId,
					providerCredId: row.providerCredId,
					dailySlice: Number(row.dailySlice ?? 0),
					priority: Number(row.priority ?? 1),
					credential: {
						id: row.credId,
						provider: row.provider,
						label: row.label,
						dailyLimit: Number(row.dailyLimit ?? 0),
						costPerK: Number(row.costPerK ?? 0),
						enabled: Boolean(row.enabled ?? true),
					},
				}));
			}
		} catch {
			// Fall through to environment-based fallback
		}
	}

	// 3. Fallback: If no allocations found in DB, check environment bindings
	// to avoid complete failure and allow seamless self-healing
	const fallbackList: Array<ProjectAllocation & { credential: ProviderCredential }> = [];

	if (env.BREVO_API_KEY) {
		fallbackList.push({
			projectId,
			providerCredId: "cred_brevo_default",
			dailySlice: 300,
			priority: 1,
			credential: {
				id: "cred_brevo_default",
				provider: "brevo",
				label: "Brevo (Env)",
				dailyLimit: 300,
				costPerK: 0,
				enabled: true,
			},
		});
	}

	if (env.RESEND_API_KEY) {
		fallbackList.push({
			projectId,
			providerCredId: "cred_resend_default",
			dailySlice: 100,
			priority: 2,
			credential: {
				id: "cred_resend_default",
				provider: "resend",
				label: "Resend (Env)",
				dailyLimit: 100,
				costPerK: 0,
				enabled: true,
			},
		});
	}

	return fallbackList;
}

/**
 * Builds and ranks all candidate providers for a project on a given date bucket.
 *
 * Scoring Heuristic:
 * Score = (CostTierWeight * 1000) + (PriorityScore * 100) + (RemainingQuotaRatio * 10) - (FailurePenalty)
 *
 * @param projectId Project identifier (e.g. "proj_aurelia")
 * @param dateBucket Date bucket "YYYY-MM-DD"
 * @param env Cloudflare Worker environment
 * @param options Simulation & routing options
 * @returns Ranked list of candidate providers sorted by score descending
 */
export async function buildCandidateProviders(
	projectId: string,
	dateBucket: string = getTodayDateBucket(),
	env: MailHubEnv,
	options?: RoutingOptions,
): Promise<RankedProvider[]> {
	// 1. Resolve project allocations & credentials
	const allocations = await resolveProjectAllocations(projectId, env, options);

	// If no allocations configured for this project, attempt to resolve unallocated fallback (e.g. SES)
	if (allocations.length === 0 && env.DB) {
		try {
			// Find default unlimited or paid provider (e.g. SES)
			const fallbackCreds = await env.DB.prepare(
				`SELECT id, provider, label, daily_limit as dailyLimit, cost_per_k as costPerK, enabled 
				 FROM provider_credentials 
				 WHERE enabled = 1 AND (cost_per_k > 0 OR provider = 'ses')
				 LIMIT 1`,
			).first();

			if (fallbackCreds) {
				allocations.push({
					projectId,
					providerCredId: fallbackCreds.id,
					dailySlice: 0, // unlimited
					priority: 99,
					credential: {
						id: fallbackCreds.id,
						provider: fallbackCreds.provider,
						label: fallbackCreds.label,
						dailyLimit: Number(fallbackCreds.dailyLimit ?? 0),
						costPerK: Number(fallbackCreds.costPerK ?? 0.1),
						enabled: Boolean(fallbackCreds.enabled),
					},
				});
			}
		} catch {
			// Ignore if DB is absent
		}
	}

	// 2. Evaluate each allocation concurrently
	const rankedCandidates = await Promise.all(
		allocations.map(async (alloc) => {
			const { providerCredId, dailySlice, priority, credential } = alloc;

			// Fetch real-time quota usage and health
			const [usedToday, healthInfo] = await Promise.all([
				getRealtimeQuotaUsage(projectId, providerCredId, dateBucket, env, options),
				getProviderHealth(providerCredId, env, options),
			]);

			// Compute score and breakdown
			const breakdown = calculateProviderScore({
				providerCredId,
				provider: credential.provider,
				dailySlice,
				usedToday,
				priority,
				costPerK: credential.costPerK,
				healthScore: healthInfo.healthScore,
				consecutiveFailures: healthInfo.consecutiveFailures,
				circuitState: healthInfo.circuitState,
				enabled: credential.enabled,
			});

			const ranked: RankedProvider = {
				providerCredId,
				provider: credential.provider,
				label: credential.label,
				dailySlice,
				usedToday,
				remainingQuota: breakdown.remainingQuota,
				remainingQuotaRatio: breakdown.remainingQuotaRatio,
				costTier: breakdown.costTier,
				costTierWeight: breakdown.costTierWeight,
				priority,
				priorityScore: breakdown.priorityScore,
				healthScore: breakdown.healthScore,
				circuitState: breakdown.circuitState,
				failurePenalty: breakdown.failurePenalty,
				score: breakdown.score,
				eligible: breakdown.eligible,
				disqualificationReason: breakdown.disqualificationReason,
				breakdown,
			};

			return ranked;
		}),
	);

	// 3. Filter candidates
	let filtered = rankedCandidates;

	if (!options?.includeExhausted) {
		filtered = filtered.filter(
			(c) => c.breakdown.disqualificationReason !== "QUOTA_EXHAUSTED",
		);
	}

	if (!options?.includeCircuitOpen) {
		filtered = filtered.filter(
			(c) => c.breakdown.disqualificationReason !== "CIRCUIT_OPEN",
		);
	}

	filtered = filtered.filter((c) => c.breakdown.disqualificationReason !== "DISABLED");

	// 4. Sort candidates
	filtered.sort((a, b) => {
		// If manual provider forced, place it first if eligible
		if (options?.forceProviderCredId) {
			if (a.providerCredId === options.forceProviderCredId) return -1;
			if (b.providerCredId === options.forceProviderCredId) return 1;
		}

		// Eligible candidates always rank higher than ineligible ones
		if (a.eligible !== b.eligible) {
			return a.eligible ? -1 : 1;
		}

		// Primary: Highest composite score first
		if (b.score !== a.score) {
			return b.score - a.score;
		}

		// Secondary: More remaining quota ratio first (load balance tie-breaker)
		if (b.remainingQuotaRatio !== a.remainingQuotaRatio) {
			return b.remainingQuotaRatio - a.remainingQuotaRatio;
		}

		// Tertiary: Stated allocation priority (1 before 2)
		return a.priority - b.priority;
	});

	return filtered;
}

/**
 * Selects the single best candidate provider to attempt the send with.
 * Returns null if all providers are exhausted or down.
 */
export function selectOptimalProvider(candidates: RankedProvider[]): RankedProvider | null {
	const eligible = candidates.filter((c) => c.eligible);
	return eligible.length > 0 ? eligible[0] : null;
}
