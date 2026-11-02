/**
 * OrbitMails / MailHub - Provider Health & Down-Ranking Engine
 * @module lib/mailhub/webhooks/health-tracker
 *
 * Tracks delivery, bounce, and complaint metrics per provider.
 * When a provider's bounce rate exceeds 5% or complaint rate exceeds 0.1%:
 * - Generates an alert
 * - Reduces health score (0.0 - 1.0)
 * - Automatically down-ranks the provider in MailHub Router (WP-05) via KV `cb:${provider}`
 * - If bounce rate > 10% or complaint rate > 0.5%, trips the Circuit Breaker to "open"
 */

import { newId } from "@/lib/ids";
import type { NormalizedWebhookEventType, ProviderHealthMetrics, SupportedWebhookProvider } from "./types";

export const BOUNCE_RATE_DEGRADED_THRESHOLD = 0.05; // 5% bounce rate
export const BOUNCE_RATE_CRITICAL_THRESHOLD = 0.10; // 10% bounce rate trips circuit breaker
export const COMPLAINT_RATE_DEGRADED_THRESHOLD = 0.001; // 0.1% complaint rate
export const COMPLAINT_RATE_CRITICAL_THRESHOLD = 0.005; // 0.5% complaint rate

/**
 * Generates date bucket for metrics aggregation (YYYY-MM-DD).
 */
export function getMetricsDateBucket(date = new Date()): string {
	return date.toISOString().slice(0, 10);
}

/**
 * Ensures provider health table exists in D1.
 */
export async function ensureProviderHealthTable(db: any): Promise<void> {
	if (!db) return;
	try {
		await db.exec(`
			CREATE TABLE IF NOT EXISTS mailhub_provider_health (
				id TEXT PRIMARY KEY,
				provider TEXT NOT NULL,
				period TEXT NOT NULL,
				total_sent INTEGER DEFAULT 0 NOT NULL,
				delivered_count INTEGER DEFAULT 0 NOT NULL,
				bounce_count INTEGER DEFAULT 0 NOT NULL,
				hard_bounce_count INTEGER DEFAULT 0 NOT NULL,
				soft_bounce_count INTEGER DEFAULT 0 NOT NULL,
				complaint_count INTEGER DEFAULT 0 NOT NULL,
				opened_count INTEGER DEFAULT 0 NOT NULL,
				clicked_count INTEGER DEFAULT 0 NOT NULL,
				bounce_rate REAL DEFAULT 0.0 NOT NULL,
				complaint_rate REAL DEFAULT 0.0 NOT NULL,
				health_score REAL DEFAULT 1.0 NOT NULL,
				status TEXT DEFAULT 'healthy' NOT NULL,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
			);
			CREATE UNIQUE INDEX IF NOT EXISTS mailhub_provider_health_period_idx ON mailhub_provider_health(provider, period);
		`);
	} catch {}
}

/**
 * Evaluates raw delivery metrics and computes health score, status, and alerts.
 */
export function evaluateProviderHealth(metrics: {
	totalSent: number;
	deliveredCount: number;
	bounceCount: number;
	complaintCount: number;
}): {
	bounceRate: number;
	complaintRate: number;
	healthScore: number;
	status: "healthy" | "degraded" | "circuit_broken";
	circuitState: "closed" | "half-open" | "open";
	alertTriggered: boolean;
	alertMessage?: string;
} {
	const totalVolume = Math.max(metrics.totalSent, metrics.deliveredCount + metrics.bounceCount, 1);
	const bounceRate = Number((metrics.bounceCount / totalVolume).toFixed(4));
	const complaintRate = Number((metrics.complaintCount / totalVolume).toFixed(4));

	// Minimum statistical sample size before tripping penalties
	const hasStatisticalSignificance = totalVolume >= 10;

	if (!hasStatisticalSignificance) {
		return {
			bounceRate,
			complaintRate,
			healthScore: 1.0,
			status: "healthy",
			circuitState: "closed",
			alertTriggered: false,
		};
	}

	// 1. Critical Outage / Runaway Bounce Rate (>10% bounce or >0.5% complaint)
	if (bounceRate >= BOUNCE_RATE_CRITICAL_THRESHOLD || complaintRate >= COMPLAINT_RATE_CRITICAL_THRESHOLD) {
		const alertMessage = `CRITICAL: Provider bounce rate reached ${(bounceRate * 100).toFixed(1)}% (complaint rate: ${(complaintRate * 100).toFixed(2)}%)! Circuit breaker tripped to open.`;
		return {
			bounceRate,
			complaintRate,
			healthScore: 0.0,
			status: "circuit_broken",
			circuitState: "open",
			alertTriggered: true,
			alertMessage,
		};
	}

	// 2. Degraded Health (>5% bounce rate or >0.1% complaint)
	if (bounceRate >= BOUNCE_RATE_DEGRADED_THRESHOLD || complaintRate >= COMPLAINT_RATE_DEGRADED_THRESHOLD) {
		// Health score decreases proportionally from 1.0 down towards 0.2
		const penalty = (bounceRate * 8) + (complaintRate * 80);
		const healthScore = Math.max(0.1, Number((1.0 - penalty).toFixed(2)));
		const alertMessage = `WARNING: Provider bounce rate elevated to ${(bounceRate * 100).toFixed(1)}% (> 5% threshold). Provider is down-ranked in router.`;

		return {
			bounceRate,
			complaintRate,
			healthScore,
			status: "degraded",
			circuitState: "closed",
			alertTriggered: true,
			alertMessage,
		};
	}

	// 3. Healthy
	return {
		bounceRate,
		complaintRate,
		healthScore: 1.0,
		status: "healthy",
		circuitState: "closed",
		alertTriggered: false,
	};
}

/**
 * Increments provider health metrics upon receiving a normalized webhook event.
 */
export async function trackProviderEventHealth(
	env: any,
	provider: SupportedWebhookProvider,
	eventType: NormalizedWebhookEventType,
	subType?: string,
	dateBucket: string = getMetricsDateBucket(),
): Promise<ProviderHealthMetrics> {
	const db = env?.DB;
	const kv = env?.ROUTER_KV || env?.KV;

	let current: ProviderHealthMetrics = {
		provider,
		period: dateBucket,
		totalSent: 0,
		deliveredCount: 0,
		bounceCount: 0,
		hardBounceCount: 0,
		softBounceCount: 0,
		complaintCount: 0,
		openedCount: 0,
		clickedCount: 0,
		bounceRate: 0.0,
		complaintRate: 0.0,
		healthScore: 1.0,
		status: "healthy",
	};

	// 1. Fetch existing metrics from D1 or KV
	if (db) {
		try {
			await ensureProviderHealthTable(db);
			const row = await db
				.prepare(`SELECT * FROM mailhub_provider_health WHERE provider = ? AND period = ?`)
				.bind(provider, dateBucket)
				.first();

			if (row) {
				current = {
					provider,
					period: dateBucket,
					totalSent: Number(row.total_sent ?? 0),
					deliveredCount: Number(row.delivered_count ?? 0),
					bounceCount: Number(row.bounce_count ?? 0),
					hardBounceCount: Number(row.hard_bounce_count ?? 0),
					softBounceCount: Number(row.soft_bounce_count ?? 0),
					complaintCount: Number(row.complaint_count ?? 0),
					openedCount: Number(row.opened_count ?? 0),
					clickedCount: Number(row.clicked_count ?? 0),
					bounceRate: Number(row.bounce_rate ?? 0),
					complaintRate: Number(row.complaint_rate ?? 0),
					healthScore: Number(row.health_score ?? 1.0),
					status: row.status || "healthy",
				};
			}
		} catch (err) {
			console.warn("[MailHub Health] Error fetching metrics from D1:", err);
		}
	} else if (kv) {
		try {
			const cached = await kv.get(`health:${provider}:${dateBucket}`, "json");
			if (cached && typeof cached === "object") {
				current = { ...current, ...cached };
			}
		} catch {}
	}

	// 2. Increment counters based on event type
	switch (eventType) {
		case "delivered":
			current.deliveredCount += 1;
			break;
		case "bounced":
			current.bounceCount += 1;
			if (subType === "hard") {
				current.hardBounceCount += 1;
			} else {
				current.softBounceCount += 1;
			}
			break;
		case "complaint":
			current.complaintCount += 1;
			break;
		case "opened":
			current.openedCount += 1;
			break;
		case "clicked":
			current.clickedCount += 1;
			break;
	}

	// 3. Re-evaluate Health & Down-ranking
	const evaluation = evaluateProviderHealth(current);
	current.bounceRate = evaluation.bounceRate;
	current.complaintRate = evaluation.complaintRate;
	current.healthScore = evaluation.healthScore;
	current.status = evaluation.status;
	current.alertTriggered = evaluation.alertTriggered;
	current.alertMessage = evaluation.alertMessage;

	// 4. Synchronize with Cloudflare KV Circuit Breaker & Router state
	// Updates both generic `cb:${provider}` and potential credential IDs (e.g. `cb:cred_${provider}_main`)
	if (kv) {
		try {
			const cbPayload = {
				state: evaluation.circuitState,
				healthScore: evaluation.healthScore,
				bounceRate: evaluation.bounceRate,
				complaintRate: evaluation.complaintRate,
				consecutiveFailures: evaluation.status === "circuit_broken" ? 3 : evaluation.status === "degraded" ? 1 : 0,
				lastFailureAt: evaluation.alertTriggered ? Date.now() : undefined,
				trippedAt: evaluation.circuitState === "open" ? Date.now() : undefined,
			};

			// Sync with standard MailHub router KV keys
			await kv.put(`cb:${provider}`, JSON.stringify(cbPayload), { expirationTtl: 86400 });
			await kv.put(`cb:cred_${provider}_main`, JSON.stringify(cbPayload), { expirationTtl: 86400 });
			await kv.put(`cb:cred_${provider}_default`, JSON.stringify(cbPayload), { expirationTtl: 86400 });
			await kv.put(`health:${provider}:${dateBucket}`, JSON.stringify(current), { expirationTtl: 86400 * 7 });
		} catch (err) {
			console.warn("[MailHub Health] Could not write health to KV:", err);
		}
	}

	// 5. Persist back to D1 Database
	if (db) {
		try {
			const id = newId("mph");
			await db
				.prepare(`
					INSERT INTO mailhub_provider_health (
						id, provider, period, total_sent, delivered_count, bounce_count,
						hard_bounce_count, soft_bounce_count, complaint_count, opened_count,
						clicked_count, bounce_rate, complaint_rate, health_score, status, updated_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
					ON CONFLICT(provider, period) DO UPDATE SET
						delivered_count = excluded.delivered_count,
						bounce_count = excluded.bounce_count,
						hard_bounce_count = excluded.hard_bounce_count,
						soft_bounce_count = excluded.soft_bounce_count,
						complaint_count = excluded.complaint_count,
						opened_count = excluded.opened_count,
						clicked_count = excluded.clicked_count,
						bounce_rate = excluded.bounce_rate,
						complaint_rate = excluded.complaint_rate,
						health_score = excluded.health_score,
						status = excluded.status,
						updated_at = CURRENT_TIMESTAMP
				`)
				.bind(
					id,
					provider,
					dateBucket,
					current.totalSent,
					current.deliveredCount,
					current.bounceCount,
					current.hardBounceCount,
					current.softBounceCount,
					current.complaintCount,
					current.openedCount,
					current.clickedCount,
					current.bounceRate,
					current.complaintRate,
					current.healthScore,
					current.status,
				)
				.run();
		} catch (err) {
			console.warn("[MailHub Health] Error updating D1 provider health:", err);
		}
	}

	return current;
}
