/**
 * OrbitMails / MailHub - Intelligent Scoring & Routing Types
 * @module lib/mailhub/types
 */

export type CostTier = "free" | "low" | "standard" | "paid" | "exhausted";

export type CircuitBreakerState = "closed" | "half-open" | "open";

export interface ProviderCredential {
	id: string;
	provider: "brevo" | "resend" | "ses" | "zepto" | "mailgun" | "cloudflare" | string;
	label?: string | null;
	apiKeyEnc?: string;
	dailyLimit: number;
	costPerK: number;
	enabled: boolean;
}

export interface ProjectAllocation {
	projectId: string;
	providerCredId: string;
	dailySlice: number; // How many emails per day this project can send on this provider (e.g. 120)
	priority: number; // 1 = primary (try first), 2 = secondary, 3 = tertiary, etc.
}

export interface ProviderHealthInfo {
	providerCredId: string;
	healthScore: number; // 0.0 to 1.0 (1.0 = 100% healthy, 0.0 = total outage)
	circuitState: CircuitBreakerState; // "closed" (normal), "half-open" (testing), "open" (tripped)
	consecutiveFailures: number;
	lastFailureAt?: number;
	trippedAt?: number;
}

export interface QuotaUsageInfo {
	used: number;
	slice: number;
	remaining: number;
	ratio: number;
}

export interface ScoringCandidateParams {
	providerCredId: string;
	provider: string;
	dailySlice: number;
	usedToday: number;
	priority: number;
	costPerK: number;
	healthScore?: number;
	consecutiveFailures?: number;
	circuitState?: CircuitBreakerState;
	enabled?: boolean;
}

export interface ProviderScoreBreakdown {
	costTier: CostTier;
	costTierWeight: number; // Multiplied by 1000
	costTierScore: number; // (CostTierWeight * 1000)
	priority: number;
	priorityScore: number; // Normalized priority rank (e.g. 10 for priority 1, 9 for priority 2)
	priorityPoints: number; // (PriorityScore * 100)
	remainingQuota: number;
	remainingQuotaRatio: number; // 0.0 to 1.0
	quotaPoints: number; // (RemainingQuotaRatio * 10)
	failurePenalty: number;
	healthScore: number;
	consecutiveFailures: number;
	circuitState: CircuitBreakerState;
	score: number; // (CostTierWeight * 1000) + (PriorityScore * 100) + (RemainingQuotaRatio * 10) - FailurePenalty
	eligible: boolean;
	disqualificationReason?: "QUOTA_EXHAUSTED" | "CIRCUIT_OPEN" | "DISABLED" | "UNAVAILABLE";
}

export interface RankedProvider {
	providerCredId: string;
	provider: string;
	label?: string | null;
	dailySlice: number;
	usedToday: number;
	remainingQuota: number;
	remainingQuotaRatio: number;
	costTier: CostTier;
	costTierWeight: number;
	priority: number;
	priorityScore: number;
	healthScore: number;
	circuitState: CircuitBreakerState;
	failurePenalty: number;
	score: number;
	eligible: boolean;
	disqualificationReason?: string;
	breakdown: ProviderScoreBreakdown;
	credential?: any;
}

export interface MailHubEnv {
	DB?: any;
	KV?: any;
	QUOTA_DO?: any;
	SEND_QUEUE?: any;
	BREVO_API_KEY?: string;
	RESEND_API_KEY?: string;
	ZEPTOMAIL_API_KEY?: string;
	ZEPTO_API_KEY?: string;
	[key: string]: any;
}

export interface RoutingOptions {
	includeExhausted?: boolean; // If true, returned list includes exhausted providers with score 0
	includeCircuitOpen?: boolean; // If true, returned list includes tripped circuit-breaker providers
	forceProviderCredId?: string; // Pin specific provider for testing or admin override
	allocationsOverride?: ProjectAllocation[]; // For isolated unit tests & offline simulations
	credentialsOverride?: ProviderCredential[]; // For isolated unit tests & offline simulations
	healthOverride?: Record<string, Partial<ProviderHealthInfo>>; // Simulated health events
	usageOverride?: Record<string, number>; // Simulated quota usage counts
}

// ---------------------------------------------------------------------------
// WP-08: Asynchronous Send Logging & Analytics Types
// ---------------------------------------------------------------------------

export type SendLogStatus = "sent" | "failed" | "queued";

export interface SendLogEntry {
	id: string; // Unique record ID: log_<uuid>
	projectId: string; // Project slug or ID: e.g. "proj_aurelia" or "aurelia"
	providerCredId: string; // ID of provider credential: e.g. "cred_brevo_main"
	provider: string; // e.g. "brevo", "resend", "ses", "zepto", "cloudflare", "mailgun"
	toAddress: string; // Recipient email address
	subject?: string | null; // Subject line (optional/truncated)
	status: SendLogStatus; // "sent" | "failed" | "queued"
	providerMessageId?: string | null; // Provider's message ID (e.g. from Brevo/Resend)
	errorMessage?: string | null; // Failure explanation if status === 'failed'
	latencyMs: number; // Duration of HTTP dispatch in milliseconds
	sentAt: number; // Unix timestamp in milliseconds
	dateBucket: string; // YYYY-MM-DD UTC date bucket
	htmlSnippet?: string | null;
	textContent?: string | null;
}

export interface SendLogBatchOptions {
	maxBatchSize?: number; // Default 50 items
	flushIntervalMs?: number; // Default 2000 ms
	maxRetries?: number; // Default 3 attempts
	spilloverToKv?: boolean; // Save unwritten logs to KV on persistent DB failure
}

export interface BatchFlushResult {
	flushedCount: number;
	failedCount: number;
	durationMs: number;
	error?: string;
}

export interface AnalyticsDateFilter {
	startDate?: string; // YYYY-MM-DD
	endDate?: string; // YYYY-MM-DD
	projectId?: string;
	projectIds?: string[];
	provider?: string;
	providerCredId?: string;
}

export interface DailyProjectMetric {
	projectId: string;
	dateBucket: string;
	totalSends: number;
	successfulSends: number;
	failedSends: number;
	queuedSends: number;
	successRate: number; // 0.0 - 100.0%
	avgLatencyMs: number;
}

export interface DailyProviderMetric {
	provider: string;
	providerCredId: string;
	dateBucket: string;
	totalAttempts: number;
	successfulSends: number;
	failedSends: number;
	successRate: number; // 0.0 - 100.0%
	avgLatencyMs: number;
}

export interface ProviderPerformanceSummary {
	provider: string;
	providerCredId: string;
	totalAttempts: number;
	successfulSends: number;
	failedSends: number;
	successRate: number; // 0.0 - 100.0%
	failureRate: number; // 0.0 - 100.0%
	avgLatencyMs: number;
	activeProjectsCount: number;
	topErrors: Array<{ error: string; count: number }>;
}

export interface LatencyPercentileMetric {
	provider: string;
	sampleCount: number;
	minMs: number;
	p50Ms: number; // Median
	p90Ms: number;
	p95Ms: number; // 95th percentile
	p99Ms: number;
	maxMs: number;
	avgMs: number;
}

export interface LatencyHistogramBucket {
	provider: string;
	under100ms: number;
	ms100to250: number;
	ms250to500: number;
	ms500to1000: number;
	over1000ms: number;
}

export interface MailHubRealtimeSummary {
	todayDateBucket: string;
	totalSentToday: number;
	totalFailedToday: number;
	successRateToday: number;
	activeProjectsToday: number;
	avgLatencyMsToday: number;
	providerBreakdown: Array<{
		provider: string;
		sentCount: number;
		limit: number;
		sliceUsedPct: number;
	}>;
}
