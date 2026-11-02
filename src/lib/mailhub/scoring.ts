/**
 * OrbitMails / MailHub - Scoring Algorithm Engine
 * @module lib/mailhub/scoring
 *
 * Implements the core scoring heuristic:
 * Score = (CostTierWeight * 1000) + (PriorityScore * 100) + (RemainingQuotaRatio * 10) - (FailurePenalty)
 */

import type {
	CircuitBreakerState,
	CostTier,
	ProviderScoreBreakdown,
	ScoringCandidateParams,
} from "./types";

/**
 * Weights for Cost Tiers in the scoring formula.
 * Scaled by 1000 to guarantee that free-tier quota slices are strictly
 * exhausted before escalating to paid/metered providers.
 */
export const COST_TIER_WEIGHTS: Record<CostTier, number> = {
	free: 10, // 10 * 1000 = 10,000 pts (Free quota allocations)
	low: 5, //  5 * 1000 =  5,000 pts (Discounted or bulk volume)
	paid: 1, //  1 * 1000 =  1,000 pts (Pay-as-you-go, e.g. Amazon SES)
	standard: 1, //  1 * 1000 =  1,000 pts
	exhausted: 0, //  0 * 1000 =      0 pts (Slice reached zero)
};

/**
 * Maps raw database allocation priority (1 = try first, 2 = try second, ...)
 * into a normalized priority score where higher = preferred.
 * Priority 1 -> 10 (1000 pts)
 * Priority 2 -> 9  (900 pts)
 * Priority 3 -> 8  (800 pts)
 * ...
 * Priority 10 -> 1 (100 pts)
 */
export function normalizePriority(rawPriority: number): { priorityScore: number; priorityPoints: number } {
	const clamped = Math.max(1, Math.round(rawPriority));
	const priorityScore = clamped <= 10 ? 11 - clamped : Math.max(0.1, +(1 / (clamped - 9)).toFixed(2));
	const priorityPoints = +(priorityScore * 100).toFixed(2);
	return { priorityScore, priorityPoints };
}

/**
 * Determines the cost tier based on slice, pricing, and remaining quota.
 */
export function determineCostTier(costPerK: number, dailySlice: number, remainingQuota: number): CostTier {
	if (dailySlice > 0 && remainingQuota <= 0) {
		return "exhausted";
	}
	if (costPerK === 0 || (dailySlice > 0 && costPerK <= 0)) {
		return "free";
	}
	if (costPerK > 0 && costPerK < 0.05) {
		return "low";
	}
	return "paid";
}

/**
 * Computes the FailurePenalty based on health score (0.0 to 1.0),
 * consecutive errors, and circuit breaker status.
 */
export function calculateFailurePenalty(
	healthScore: number,
	consecutiveFailures: number,
	circuitState: CircuitBreakerState,
): number {
	const clampedHealth = Math.min(1.0, Math.max(0.0, healthScore));
	const healthPenalty = (1.0 - clampedHealth) * 500;
	const consecutivePenalty = Math.max(0, consecutiveFailures) * 100;

	let circuitPenalty = 0;
	if (circuitState === "half-open") {
		circuitPenalty = 300; // Probationary trial penalty
	} else if (circuitState === "open") {
		circuitPenalty = 100_000; // Disqualifying penalty
	}

	return +(healthPenalty + consecutivePenalty + circuitPenalty).toFixed(2);
}

/**
 * Pure heuristic scoring function.
 * Evaluates a candidate provider and produces a transparent score breakdown.
 *
 * Formula:
 * Score = (CostTierWeight * 1000) + (PriorityScore * 100) + (RemainingQuotaRatio * 10) - (FailurePenalty)
 */
export function calculateProviderScore(params: ScoringCandidateParams): ProviderScoreBreakdown {
	const {
		providerCredId,
		dailySlice,
		usedToday,
		priority: rawPriority,
		costPerK,
		healthScore = 1.0,
		consecutiveFailures = 0,
		circuitState = "closed",
		enabled = true,
	} = params;

	// 1. Quota calculations
	const isUnlimited = dailySlice <= 0;
	const remainingQuota = isUnlimited ? Infinity : Math.max(0, dailySlice - usedToday);
	const remainingQuotaRatio = isUnlimited
		? 1.0
		: dailySlice > 0
			? Math.min(1.0, Math.max(0.0, +(remainingQuota / dailySlice).toFixed(4)))
			: 0.0;
	const quotaPoints = +(remainingQuotaRatio * 10).toFixed(2);

	// 2. Cost tier calculations
	const costTier = determineCostTier(costPerK, dailySlice, remainingQuota);
	const costTierWeight = COST_TIER_WEIGHTS[costTier] ?? 1;
	const costTierScore = costTierWeight * 1000;

	// 3. Priority calculations
	const { priorityScore, priorityPoints } = normalizePriority(rawPriority);

	// 4. Failure penalty calculations
	const failurePenalty = calculateFailurePenalty(healthScore, consecutiveFailures, circuitState);

	// 5. Total composite score
	const rawScore = costTierScore + priorityPoints + quotaPoints - failurePenalty;
	const score = +rawScore.toFixed(2);

	// 6. Eligibility & Disqualification check
	let eligible = true;
	let disqualificationReason: ProviderScoreBreakdown["disqualificationReason"] | undefined;

	if (!enabled) {
		eligible = false;
		disqualificationReason = "DISABLED";
	} else if (circuitState === "open") {
		eligible = false;
		disqualificationReason = "CIRCUIT_OPEN";
	} else if (!isUnlimited && remainingQuota <= 0) {
		eligible = false;
		disqualificationReason = "QUOTA_EXHAUSTED";
	} else if (healthScore <= 0.0) {
		eligible = false;
		disqualificationReason = "UNAVAILABLE";
	}

	return {
		costTier,
		costTierWeight,
		costTierScore,
		priority: rawPriority,
		priorityScore,
		priorityPoints,
		remainingQuota,
		remainingQuotaRatio,
		quotaPoints,
		failurePenalty,
		healthScore,
		consecutiveFailures,
		circuitState,
		score,
		eligible,
		disqualificationReason,
	};
}
