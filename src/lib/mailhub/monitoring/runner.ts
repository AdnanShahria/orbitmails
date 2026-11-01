/**
 * OrbitMails / MailHub - Cron Scheduler Health & Digest Job Runners
 * @module lib/mailhub/monitoring/runner
 */

import { checkCircuitBreakers, checkDeadLetterQueue, checkQuotaThresholds } from "./checker";
import { getPreviousUtcDay, sendDailyDigest } from "./digest";
import type { DailyDigestSummary, HealthMonitoringSummary } from "./types";

/**
 * 10-Minute Health Monitoring Job
 * Evaluates:
 * 1. Projects exceeding 85% of their daily quota slice before midday.
 * 2. Providers triggering circuit breakers (>= 3 consecutive failures).
 * 3. Emails pushed to the Dead Letter Queue (all waterfall providers failed).
 */
export async function runHealthMonitoringJob(
	env: CloudflareEnv,
	now = new Date(),
): Promise<HealthMonitoringSummary> {
	const start = Date.now();
	const errors: string[] = [];

	let quotaAlerts: any[] = [];
	let circuitAlerts: any[] = [];
	let dlqAlerts: any[] = [];

	try {
		quotaAlerts = await checkQuotaThresholds(env, now);
	} catch (err) {
		const msg = `Quota threshold check failed: ${(err as Error).message}`;
		console.error("[MailHub Monitor]", msg);
		errors.push(msg);
	}

	try {
		circuitAlerts = await checkCircuitBreakers(env, now);
	} catch (err) {
		const msg = `Circuit breaker check failed: ${(err as Error).message}`;
		console.error("[MailHub Monitor]", msg);
		errors.push(msg);
	}

	try {
		dlqAlerts = await checkDeadLetterQueue(env, now);
	} catch (err) {
		const msg = `Dead Letter Queue check failed: ${(err as Error).message}`;
		console.error("[MailHub Monitor]", msg);
		errors.push(msg);
	}

	const durationMs = Date.now() - start;
	const totalTriggered = quotaAlerts.length + circuitAlerts.length + dlqAlerts.length;

	console.log(
		`[MailHub Monitor] Health check completed in ${durationMs}ms: ` +
			`${quotaAlerts.length} quota warnings, ${circuitAlerts.length} circuit breakers, ${dlqAlerts.length} DLQ alerts.`,
	);

	return {
		timestamp: now.toISOString(),
		durationMs,
		quotaAlertsChecked: 4,
		quotaAlertsTriggered: quotaAlerts.length,
		circuitAlertsChecked: 3,
		circuitAlertsTriggered: circuitAlerts.length,
		dlqAlertsChecked: 1,
		dlqAlertsTriggered: dlqAlerts.length,
		emailsSent: totalTriggered,
		errors,
	};
}

/**
 * 8:00 AM Daily Developer Digest Job
 * Summarizes yesterday's email performance, provider health, costs, and optimization recommendations.
 */
export async function runDailyDigestJob(
	env: CloudflareEnv,
	now = new Date(),
): Promise<DailyDigestSummary> {
	const targetDate = getPreviousUtcDay(now);
	console.log(`[MailHub Monitor] Initiating 8:00 AM daily digest for date bucket ${targetDate}...`);

	const summary = await sendDailyDigest(env, targetDate);

	console.log(
		`[MailHub Monitor] Daily digest finished for ${targetDate}: ` +
			`sent=${summary.sent}, recipient=${summary.recipient}, volume=${summary.totalVolume}, cost=$${summary.totalCostUsd.toFixed(4)}`,
	);

	return summary;
}
