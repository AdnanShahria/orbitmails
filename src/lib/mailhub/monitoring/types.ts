/**
 * OrbitMails / MailHub - Health Monitoring & Proactive Alerting Types
 * @module lib/mailhub/monitoring/types
 */

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertKind = "quota_warning" | "circuit_breaker" | "dead_letter" | "daily_digest";

export interface AlertThresholdConfig {
	/** Fraction of daily slice that triggers warning (default: 0.85 = 85%) */
	quotaSliceRatioThreshold: number;
	/** Midday cutoff hour in UTC (default: 12) */
	quotaMiddayCutoffHour: number;
	/** Consecutive failures before opening circuit breaker alert (default: 3) */
	circuitBreakerFailureThreshold: number;
	/** Cooldown window for circuit breakers in minutes (default: 15) */
	circuitBreakerCooldownMinutes: number;
	/** Rolling window for dead letter queue lookups in minutes (default: 15) */
	dlqLookbackMinutes: number;
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholdConfig = {
	quotaSliceRatioThreshold: 0.85,
	quotaMiddayCutoffHour: 12,
	circuitBreakerFailureThreshold: 3,
	circuitBreakerCooldownMinutes: 15,
	dlqLookbackMinutes: 15,
};

export interface QuotaThresholdAlert {
	type: "quota_warning";
	severity: "warning";
	projectId: string;
	projectName: string;
	providerCredId: string;
	providerName: string;
	dailySlice: number;
	usedToday: number;
	remaining: number;
	percentage: number; // e.g. 88.5
	dateBucket: string;
	detectedAt: number;
	hourUtc: number;
	estimatedDepletionHours?: number;
}

export interface CircuitBreakerAlert {
	type: "circuit_breaker";
	severity: "critical";
	providerCredId: string;
	providerName: string;
	consecutiveFailures: number;
	circuitState: "open" | "half-open";
	lastError: string;
	trippedAt: number;
	cooldownMinutes: number;
	affectedProjects: string[];
	fallbackProvider?: string;
}

export interface DeadLetterAlert {
	type: "dead_letter";
	severity: "critical";
	dlqId: string;
	projectId: string;
	projectName: string;
	recipient: string;
	subject: string;
	attemptedProviders: Array<{ provider: string; error: string }>;
	lastError: string;
	enqueuedAt: number;
}

export interface ProjectDigestItem {
	id: string;
	name: string;
	slug: string;
	sent: number;
	failed: number;
	quotaUsed: number;
	quotaSlice: number;
	quotaUtilizationPct: number;
	costUsd: number;
	primaryProvider: string;
	failoversTriggered: number;
}

export interface ProviderHealthDigestItem {
	id: string;
	name: string;
	provider: string;
	totalRequests: number;
	successRatePct: number;
	avgLatencyMs: number;
	circuitBreakerTrips: number;
	status: "healthy" | "degraded" | "circuit_open";
}

export interface DailyDigest {
	type: "daily_digest";
	severity: "info";
	date: string; // YYYY-MM-DD
	generatedAt: number;
	totalSent: number;
	totalFailed: number;
	deliverySuccessRatePct: number;
	totalCostUsd: number;
	activeProjectsCount: number;
	projects: ProjectDigestItem[];
	providers: ProviderHealthDigestItem[];
	warnings: string[];
	recommendations: string[];
}

export interface AlertSendResult {
	sent: boolean;
	messageId?: string;
	recipient: string;
	suppressed?: boolean;
	error?: string;
}

export interface HealthMonitoringSummary {
	timestamp: string;
	durationMs: number;
	quotaAlertsChecked: number;
	quotaAlertsTriggered: number;
	circuitAlertsChecked: number;
	circuitAlertsTriggered: number;
	dlqAlertsChecked: number;
	dlqAlertsTriggered: number;
	emailsSent: number;
	errors: string[];
}

export interface DailyDigestSummary {
	date: string;
	generatedAt: string;
	sent: boolean;
	recipient: string;
	messageId?: string;
	projectsSummarized: number;
	providersSummarized: number;
	totalVolume: number;
	totalCostUsd: number;
	error?: string;
}
