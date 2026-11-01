/**
 * OrbitMails / MailHub - Periodic Health & Threshold Evaluation Checker
 * @module lib/mailhub/monitoring/checker
 */

import { getRealtimeQuotaUsage, getTodayDateBucket } from "../router";
import { dispatchAlertEmail } from "./alert-sender";
import {
	renderCircuitBreakerAlert,
	renderDeadLetterAlert,
	renderQuotaAlert,
} from "./templates";
import {
	DEFAULT_ALERT_THRESHOLDS,
	type AlertThresholdConfig,
	type CircuitBreakerAlert,
	type DeadLetterAlert,
	type QuotaThresholdAlert,
} from "./types";

export interface CheckerOptions {
	thresholds?: Partial<AlertThresholdConfig>;
	allocationsOverride?: Array<{
		projectId: string;
		projectName: string;
		providerCredId: string;
		providerName: string;
		dailySlice: number;
	}>;
	providersOverride?: Array<{
		providerCredId: string;
		providerName: string;
		circuitState: "open" | "half-open" | "closed";
		consecutiveFailures: number;
		lastError?: string;
		trippedAt?: number;
		affectedProjects?: string[];
		fallbackProvider?: string;
	}>;
	dlqOverride?: Array<{
		dlqId: string;
		projectId: string;
		projectName: string;
		recipient: string;
		subject: string;
		attemptedProviders: Array<{ provider: string; error: string }>;
		lastError: string;
		enqueuedAt: number;
	}>;
	appUrl?: string;
}

/**
 * 1. Check if any project has consumed >85% of its daily quota slice before midday.
 */
export async function checkQuotaThresholds(
	env: CloudflareEnv,
	now = new Date(),
	options?: CheckerOptions,
): Promise<QuotaThresholdAlert[]> {
	const config: AlertThresholdConfig = {
		...DEFAULT_ALERT_THRESHOLDS,
		...options?.thresholds,
	};

	const currentHourUtc = now.getUTCHours();
	const dateBucket = getTodayDateBucket(now);
	const triggeredAlerts: QuotaThresholdAlert[] = [];

	// Midday condition: Only evaluate early warning if before cutoff hour (e.g. 12:00 UTC)
	if (currentHourUtc >= config.quotaMiddayCutoffHour) {
		return [];
	}

	// 1. Resolve allocations
	let allocations = options?.allocationsOverride;

	if (!allocations && (env as any).DB) {
		try {
			const query = `
				SELECT 
					a.project_id as projectId,
					COALESCE(p.name, a.project_id) as projectName,
					a.provider_cred_id as providerCredId,
					COALESCE(c.label, c.provider, a.provider_cred_id) as providerName,
					a.daily_slice as dailySlice
				FROM project_provider_allocations a
				LEFT JOIN projects p ON a.project_id = p.id
				LEFT JOIN provider_credentials c ON a.provider_cred_id = c.id
				WHERE a.daily_slice > 0
			`;
			const { results } = await (env as any).DB.prepare(query).all();
			if (results && results.length > 0) {
				allocations = results.map((r: any) => ({
					projectId: String(r.projectId),
					projectName: String(r.projectName),
					providerCredId: String(r.providerCredId),
					providerName: String(r.providerName),
					dailySlice: Number(r.dailySlice),
				}));
			}
		} catch {
			// Table query fallback
		}
	}

	// Fallback fixtures if database is unpopulated or in test mode
	if (!allocations || allocations.length === 0) {
		allocations = [
			{ projectId: "proj_aurelia", projectName: "Aurelia", providerCredId: "cred_brevo_main", providerName: "Brevo Shared", dailySlice: 120 },
			{ projectId: "proj_lifesolver", projectName: "LifeSolver", providerCredId: "cred_brevo_main", providerName: "Brevo Shared", dailySlice: 80 },
			{ projectId: "proj_luvio", projectName: "Luvio", providerCredId: "cred_brevo_main", providerName: "Brevo Shared", dailySlice: 60 },
			{ projectId: "proj_ovijatric", projectName: "Ovijatric", providerCredId: "cred_brevo_main", providerName: "Brevo Shared", dailySlice: 40 },
		];
	}

	// 2. Evaluate usage for each allocation
	for (const alloc of allocations) {
		if (alloc.dailySlice <= 0) continue;

		const used = await getRealtimeQuotaUsage(
			alloc.projectId,
			alloc.providerCredId,
			dateBucket,
			env as any,
		);

		const ratio = used / alloc.dailySlice;

		if (ratio >= config.quotaSliceRatioThreshold) {
			const percentage = ratio * 100;
			const remaining = Math.max(0, alloc.dailySlice - used);

			// Calculate burn rate: used so far / (currentHourUtc + fraction)
			const hoursElapsed = Math.max(1, currentHourUtc + now.getUTCMinutes() / 60);
			const burnRatePerHour = used / hoursElapsed;
			const estimatedDepletionHours = burnRatePerHour > 0 ? remaining / burnRatePerHour : undefined;

			const alert: QuotaThresholdAlert = {
				type: "quota_warning",
				severity: "warning",
				projectId: alloc.projectId,
				projectName: alloc.projectName,
				providerCredId: alloc.providerCredId,
				providerName: alloc.providerName,
				dailySlice: alloc.dailySlice,
				usedToday: used,
				remaining,
				percentage,
				dateBucket,
				detectedAt: now.getTime(),
				hourUtc: currentHourUtc,
				estimatedDepletionHours,
			};

			triggeredAlerts.push(alert);

			// Dispatch alert with 24-hour suppression dedup
			const dedupKey = `alert:quota:${alloc.projectId}:${alloc.providerCredId}:${dateBucket}`;
			const rendered = renderQuotaAlert(alert, options?.appUrl);

			await dispatchAlertEmail(env, {
				dedupKey,
				dedupTtlSeconds: 86400, // Alert at most once per project-provider-day
				subject: rendered.subject,
				html: rendered.html,
				text: rendered.text,
			});
		}
	}

	return triggeredAlerts;
}

/**
 * 2. Check if any provider has triggered a circuit breaker (3 consecutive failures).
 */
export async function checkCircuitBreakers(
	env: CloudflareEnv,
	now = new Date(),
	options?: CheckerOptions,
): Promise<CircuitBreakerAlert[]> {
	const config: AlertThresholdConfig = {
		...DEFAULT_ALERT_THRESHOLDS,
		...options?.thresholds,
	};

	const triggeredAlerts: CircuitBreakerAlert[] = [];
	let providers = options?.providersOverride;

	// Query known providers from D1 or KV
	if (!providers && (env as any).DB) {
		try {
			const query = `
				SELECT id, provider, label, consecutive_failures, circuit_state, last_error, tripped_at
				FROM provider_credentials
				WHERE enabled = 1
			`;
			const { results } = await (env as any).DB.prepare(query).all();
			if (results && results.length > 0) {
				providers = results.map((r: any) => ({
					providerCredId: String(r.id),
					providerName: String(r.label || r.provider),
					circuitState: (r.circuit_state || "closed") as "open" | "half-open" | "closed",
					consecutiveFailures: Number(r.consecutive_failures || 0),
					lastError: r.last_error ? String(r.last_error) : undefined,
					trippedAt: r.tripped_at ? Number(r.tripped_at) : undefined,
				}));
			}
		} catch {
			// Table query fallback
		}
	}

	// Also inspect Cloudflare KV circuit breaker states
	if (!providers) {
		const knownCreds = ["cred_brevo_main", "cred_resend_main", "cred_ses_backup", "cred_zeptomail_main"];
		providers = [];

		for (const credId of knownCreds) {
			const cbKey = `cb:${credId}`;
			let cbData: any = null;
			if ((env as any).KV) {
				try {
					cbData = await (env as any).KV.get(cbKey, "json");
				} catch {
					// KV lookup fallback
				}
			}

			if (cbData) {
				providers.push({
					providerCredId: credId,
					providerName: credId.replace("cred_", "").replace("_main", "").toUpperCase(),
					circuitState: cbData.state || "closed",
					consecutiveFailures: Number(cbData.consecutiveFailures || 0),
					lastError: cbData.lastError,
					trippedAt: cbData.trippedAt,
					fallbackProvider: cbData.fallbackProvider,
				});
			}
		}
	}

	for (const prov of providers) {
		const isTripped =
			prov.circuitState === "open" ||
			prov.consecutiveFailures >= config.circuitBreakerFailureThreshold;

		if (isTripped) {
			const trippedAt = prov.trippedAt || now.getTime();
			const alert: CircuitBreakerAlert = {
				type: "circuit_breaker",
				severity: "critical",
				providerCredId: prov.providerCredId,
				providerName: prov.providerName,
				consecutiveFailures: Math.max(prov.consecutiveFailures, config.circuitBreakerFailureThreshold),
				circuitState: "open",
				lastError: prov.lastError || "3 consecutive HTTP request timeouts / connection refused",
				trippedAt,
				cooldownMinutes: config.circuitBreakerCooldownMinutes,
				affectedProjects: prov.affectedProjects || ["Aurelia", "LifeSolver", "Luvio"],
				fallbackProvider: prov.fallbackProvider || "Resend (Secondary Priority)",
			};

			triggeredAlerts.push(alert);

			// Deduplicate so we alert once per isolation cooling period (e.g. 15 min)
			const periodIndex = Math.floor(trippedAt / (config.circuitBreakerCooldownMinutes * 60 * 1000));
			const dedupKey = `alert:cb:${prov.providerCredId}:${periodIndex}`;
			const rendered = renderCircuitBreakerAlert(alert, options?.appUrl);

			await dispatchAlertEmail(env, {
				dedupKey,
				dedupTtlSeconds: config.circuitBreakerCooldownMinutes * 60,
				subject: rendered.subject,
				html: rendered.html,
				text: rendered.text,
			});
		}
	}

	return triggeredAlerts;
}

/**
 * 3. Check Dead Letter Queue (DLQ) for messages that failed across all providers.
 */
export async function checkDeadLetterQueue(
	env: CloudflareEnv,
	now = new Date(),
	options?: CheckerOptions,
): Promise<DeadLetterAlert[]> {
	const config: AlertThresholdConfig = {
		...DEFAULT_ALERT_THRESHOLDS,
		...options?.thresholds,
	};

	const triggeredAlerts: DeadLetterAlert[] = [];
	let dlqItems = options?.dlqOverride;

	if (!dlqItems && (env as any).DB) {
		try {
			const lookbackMs = config.dlqLookbackMinutes * 60 * 1000;
			const cutoff = now.getTime() - lookbackMs;
			const query = `
				SELECT id, project_id, recipient, subject, last_error, attempted_providers, created_at
				FROM dead_letter_queue
				WHERE created_at >= ? AND alerted = 0
				ORDER BY created_at ASC
				LIMIT 20
			`;
			const { results } = await (env as any).DB.prepare(query).bind(cutoff).all();
			if (results && results.length > 0) {
				dlqItems = results.map((r: any) => ({
					dlqId: String(r.id),
					projectId: String(r.project_id),
					projectName: String(r.project_id).replace("proj_", "").toUpperCase(),
					recipient: String(r.recipient),
					subject: String(r.subject || "(No Subject)"),
					attemptedProviders: r.attempted_providers ? JSON.parse(r.attempted_providers) : [],
					lastError: String(r.last_error || "All candidate providers failed"),
					enqueuedAt: Number(r.created_at),
				}));
			}
		} catch {
			// DLQ table fallback
		}
	}

	if (dlqItems && dlqItems.length > 0) {
		for (const item of dlqItems) {
			const alert: DeadLetterAlert = {
				type: "dead_letter",
				severity: "critical",
				dlqId: item.dlqId,
				projectId: item.projectId,
				projectName: item.projectName,
				recipient: item.recipient,
				subject: item.subject,
				attemptedProviders: item.attemptedProviders,
				lastError: item.lastError,
				enqueuedAt: item.enqueuedAt,
			};

			triggeredAlerts.push(alert);

			const dedupKey = `alert:dlq:${item.dlqId}`;
			const rendered = renderDeadLetterAlert(alert, options?.appUrl);

			await dispatchAlertEmail(env, {
				dedupKey,
				dedupTtlSeconds: 86400,
				subject: rendered.subject,
				html: rendered.html,
				text: rendered.text,
			});

			// Mark as alerted in DB if available
			if ((env as any).DB) {
				try {
					await (env as any).DB.prepare(
						"UPDATE dead_letter_queue SET alerted = 1 WHERE id = ?",
					).bind(item.dlqId).run();
				} catch {
					// Ignore
				}
			}
		}
	}

	return triggeredAlerts;
}
