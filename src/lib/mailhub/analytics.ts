/**
 * OrbitMails / MailHub - Analytics Ingestion & High-Performance Aggregation Queries
 * @module lib/mailhub/analytics
 * 
 * WP-08: Analytics Ingestion & Performance Aggregation Queries
 * 
 * Provides ultra-fast aggregated insights across:
 * - Daily sends per project (Aurelia, LifeSolver, Luvio, Ovijatric)
 * - Daily sends per provider (Brevo, Resend, SES, ZeptoMail, etc.)
 * - Success rate / failure rate per provider
 * - Latency distribution (p50, p90, p95, p99) and latency histograms
 * - Real-time dashboard KPI summary
 */

import type {
	AnalyticsDateFilter,
	DailyProjectMetric,
	DailyProviderMetric,
	LatencyHistogramBucket,
	LatencyPercentileMetric,
	MailHubEnv,
	MailHubRealtimeSummary,
	ProviderPerformanceSummary,
} from "./types";

/**
 * Builds standard WHERE clause and parameter bindings for analytics filtering.
 */
function buildWhereClause(
	filter?: AnalyticsDateFilter,
	initialConditions: string[] = [],
	initialParams: any[] = [],
): { whereSql: string; params: any[] } {
	const conditions = [...initialConditions];
	const params = [...initialParams];

	if (filter?.startDate) {
		conditions.push("date_bucket >= ?");
		params.push(filter.startDate);
	}
	if (filter?.endDate) {
		conditions.push("date_bucket <= ?");
		params.push(filter.endDate);
	}
	if (filter?.projectId) {
		conditions.push("project_id = ?");
		params.push(filter.projectId);
	}
	if (filter?.projectIds && filter.projectIds.length > 0) {
		const placeholders = filter.projectIds.map(() => "?").join(", ");
		conditions.push(`project_id IN (${placeholders})`);
		params.push(...filter.projectIds);
	}
	if (filter?.provider) {
		conditions.push("provider = ?");
		params.push(filter.provider.toLowerCase());
	}
	if (filter?.providerCredId) {
		conditions.push("provider_cred_id = ?");
		params.push(filter.providerCredId);
	}

	const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	return { whereSql, params };
}

/**
 * Attempts query execution across table candidate names (email_router_send_logs, send_log)
 */
async function executeQueryWithFallback(
	env: MailHubEnv,
	queryTemplate: (tableName: string) => { sql: string; params: any[] },
): Promise<any[]> {
	if (!env.DB) return [];

	const tableCandidates = ["email_router_send_logs", "send_log"];
	let lastError: any = null;

	for (const tableName of tableCandidates) {
		const { sql: sqlQuery, params } = queryTemplate(tableName);
		try {
			const stmt = env.DB.prepare(sqlQuery).bind(...params);
			const result = await stmt.all();
			return result?.results ?? [];
		} catch (err: any) {
			lastError = err;
			const msg = String(err?.message || err);
			if (msg.includes("no such table") || msg.includes("doesn't exist")) {
				continue;
			}
			console.error(`[MailHub Analytics] Query failed on table ${tableName}:`, err);
			break;
		}
	}

	return [];
}

/**
 * 1. Daily sends per project:
 * Aggregates sends across projects (Aurelia, LifeSolver, Luvio, Ovijatric) by date bucket.
 */
export async function getDailyProjectMetrics(
	env: MailHubEnv,
	filter?: AnalyticsDateFilter,
): Promise<DailyProjectMetric[]> {
	const rows = await executeQueryWithFallback(env, (tableName) => {
		const { whereSql, params } = buildWhereClause(filter);
		const sql = `
			SELECT
				project_id AS projectId,
				date_bucket AS dateBucket,
				COUNT(*) AS totalSends,
				SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS successfulSends,
				SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedSends,
				SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queuedSends,
				ROUND(AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END), 1) AS avgLatencyMs
			FROM ${tableName}
			${whereSql}
			GROUP BY project_id, date_bucket
			ORDER BY date_bucket DESC, totalSends DESC
		`;
		return { sql, params };
	});

	return rows.map((row) => {
		const total = Number(row.totalSends || 0);
		const successful = Number(row.successfulSends || 0);
		return {
			projectId: String(row.projectId || ""),
			dateBucket: String(row.dateBucket || ""),
			totalSends: total,
			successfulSends: successful,
			failedSends: Number(row.failedSends || 0),
			queuedSends: Number(row.queuedSends || 0),
			successRate: total > 0 ? Math.round((successful / total) * 10000) / 100 : 0,
			avgLatencyMs: Number(row.avgLatencyMs || 0),
		};
	});
}

/**
 * 2. Daily sends per provider:
 * Tracks daily consumption per provider account (e.g. Brevo free quota vs overflow to Resend/SES).
 */
export async function getDailyProviderMetrics(
	env: MailHubEnv,
	filter?: AnalyticsDateFilter,
): Promise<DailyProviderMetric[]> {
	const rows = await executeQueryWithFallback(env, (tableName) => {
		const { whereSql, params } = buildWhereClause(filter);
		const sql = `
			SELECT
				provider,
				provider_cred_id AS providerCredId,
				date_bucket AS dateBucket,
				COUNT(*) AS totalAttempts,
				SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS successfulSends,
				SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedSends,
				ROUND(AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END), 1) AS avgLatencyMs
			FROM ${tableName}
			${whereSql}
			GROUP BY provider, provider_cred_id, date_bucket
			ORDER BY date_bucket DESC, totalAttempts DESC
		`;
		return { sql, params };
	});

	return rows.map((row) => {
		const total = Number(row.totalAttempts || 0);
		const successful = Number(row.successfulSends || 0);
		return {
			provider: String(row.provider || ""),
			providerCredId: String(row.providerCredId || ""),
			dateBucket: String(row.dateBucket || ""),
			totalAttempts: total,
			successfulSends: successful,
			failedSends: Number(row.failedSends || 0),
			successRate: total > 0 ? Math.round((successful / total) * 10000) / 100 : 0,
			avgLatencyMs: Number(row.avgLatencyMs || 0),
		};
	});
}

/**
 * 3. Success rate / failure rate per provider:
 * Computes performance ratios and fetches top error reasons per provider.
 */
export async function getProviderPerformanceSummary(
	env: MailHubEnv,
	filter?: AnalyticsDateFilter,
): Promise<ProviderPerformanceSummary[]> {
	const summaryRows = await executeQueryWithFallback(env, (tableName) => {
		const { whereSql, params } = buildWhereClause(filter);
		const sql = `
			SELECT
				provider,
				provider_cred_id AS providerCredId,
				COUNT(*) AS totalAttempts,
				SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS successfulSends,
				SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedSends,
				ROUND(AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END), 1) AS avgLatencyMs,
				COUNT(DISTINCT project_id) AS activeProjectsCount
			FROM ${tableName}
			${whereSql}
			GROUP BY provider, provider_cred_id
			ORDER BY totalAttempts DESC
		`;
		return { sql, params };
	});

	// For each provider, fetch top error messages
	const summaries: ProviderPerformanceSummary[] = [];

	for (const row of summaryRows) {
		const providerCredId = String(row.providerCredId || "");
		const provider = String(row.provider || "");
		const total = Number(row.totalAttempts || 0);
		const successful = Number(row.successfulSends || 0);
		const failed = Number(row.failedSends || 0);

		// Query top error messages
		const errorRows = await executeQueryWithFallback(env, (tableName) => {
			const { whereSql, params } = buildWhereClause(filter, [
				"provider_cred_id = ?",
				"status = 'failed'",
				"error_message IS NOT NULL",
			], [providerCredId]);

			const sql = `
				SELECT
					error_message AS errorMessage,
					COUNT(*) AS errCount
				FROM ${tableName}
				${whereSql}
				GROUP BY error_message
				ORDER BY errCount DESC
				LIMIT 5
			`;
			return { sql, params };
		});

		const topErrors = errorRows.map((er) => ({
			error: String(er.errorMessage || "Unknown error"),
			count: Number(er.errCount || 0),
		}));

		summaries.push({
			provider,
			providerCredId,
			totalAttempts: total,
			successfulSends: successful,
			failedSends: failed,
			successRate: total > 0 ? Math.round((successful / total) * 10000) / 100 : 0,
			failureRate: total > 0 ? Math.round((failed / total) * 10000) / 100 : 0,
			avgLatencyMs: Number(row.avgLatencyMs || 0),
			activeProjectsCount: Number(row.activeProjectsCount || 0),
			topErrors,
		});
	}

	return summaries;
}

/**
 * 4. Latency distribution (p50, p90, p95, p99, min, max, avg):
 * High performance SQLite window function query utilizing ROW_NUMBER() OVER (...).
 */
export async function getLatencyPercentiles(
	env: MailHubEnv,
	filter?: AnalyticsDateFilter,
): Promise<LatencyPercentileMetric[]> {
	const rows = await executeQueryWithFallback(env, (tableName) => {
		const { whereSql, params } = buildWhereClause(filter, [
			"status = 'sent'",
			"latency_ms IS NOT NULL",
		]);

		const sql = `
			WITH ordered_latencies AS (
				SELECT
					provider,
					latency_ms AS latencyMs,
					ROW_NUMBER() OVER (PARTITION BY provider ORDER BY latency_ms ASC) AS rowNum,
					COUNT(*) OVER (PARTITION BY provider) AS totalCount
				FROM ${tableName}
				${whereSql}
			)
			SELECT
				provider,
				totalCount,
				MIN(latencyMs) AS minMs,
				MAX(CASE WHEN rowNum = MAX(1, CAST(ROUND(totalCount * 0.50) AS INT)) THEN latencyMs END) AS p50Ms,
				MAX(CASE WHEN rowNum = MAX(1, CAST(ROUND(totalCount * 0.90) AS INT)) THEN latencyMs END) AS p90Ms,
				MAX(CASE WHEN rowNum = MAX(1, CAST(ROUND(totalCount * 0.95) AS INT)) THEN latencyMs END) AS p95Ms,
				MAX(CASE WHEN rowNum = MAX(1, CAST(ROUND(totalCount * 0.99) AS INT)) THEN latencyMs END) AS p99Ms,
				MAX(latencyMs) AS maxMs,
				ROUND(AVG(latencyMs), 1) AS avgMs
			FROM ordered_latencies
			GROUP BY provider
			ORDER BY totalCount DESC
		`;
		return { sql, params };
	});

	return rows.map((row) => ({
		provider: String(row.provider || ""),
		sampleCount: Number(row.totalCount || 0),
		minMs: Number(row.minMs || 0),
		p50Ms: Number(row.p50Ms || 0),
		p90Ms: Number(row.p90Ms || 0),
		p95Ms: Number(row.p95Ms || 0),
		p99Ms: Number(row.p99Ms || 0),
		maxMs: Number(row.maxMs || 0),
		avgMs: Number(row.avgMs || 0),
	}));
}

/**
 * Latency Histogram Bucketing:
 * Categorizes response times into discrete buckets (<100ms, 100-250ms, 250-500ms, 500-1000ms, >1000ms)
 * for snappy bar/area charting in the admin dashboard.
 */
export async function getLatencyHistogramBuckets(
	env: MailHubEnv,
	filter?: AnalyticsDateFilter,
): Promise<LatencyHistogramBucket[]> {
	const rows = await executeQueryWithFallback(env, (tableName) => {
		const { whereSql, params } = buildWhereClause(filter, [
			"status = 'sent'",
			"latency_ms IS NOT NULL",
		]);

		const sql = `
			SELECT
				provider,
				COUNT(CASE WHEN latency_ms < 100 THEN 1 END) AS under100ms,
				COUNT(CASE WHEN latency_ms >= 100 AND latency_ms < 250 THEN 1 END) AS ms100to250,
				COUNT(CASE WHEN latency_ms >= 250 AND latency_ms < 500 THEN 1 END) AS ms250to500,
				COUNT(CASE WHEN latency_ms >= 500 AND latency_ms < 1000 THEN 1 END) AS ms500to1000,
				COUNT(CASE WHEN latency_ms >= 1000 THEN 1 END) AS over1000ms
			FROM ${tableName}
			${whereSql}
			GROUP BY provider
			ORDER BY provider ASC
		`;
		return { sql, params };
	});

	return rows.map((row) => ({
		provider: String(row.provider || ""),
		under100ms: Number(row.under100ms || 0),
		ms100to250: Number(row.ms100to250 || 0),
		ms250to500: Number(row.ms250to500 || 0),
		ms500to1000: Number(row.ms500to1000 || 0),
		over1000ms: Number(row.over1000ms || 0),
	}));
}

/**
 * In-Memory Fallback & Math Calculation Utility:
 * Computes exact percentiles from an array of numeric latencies.
 */
export function calculatePercentilesFromSamples(
	provider: string,
	latencies: number[],
): LatencyPercentileMetric {
	if (latencies.length === 0) {
		return {
			provider,
			sampleCount: 0,
			minMs: 0,
			p50Ms: 0,
			p90Ms: 0,
			p95Ms: 0,
			p99Ms: 0,
			maxMs: 0,
			avgMs: 0,
		};
	}

	const sorted = [...latencies].sort((a, b) => a - b);
	const count = sorted.length;
	const sum = sorted.reduce((acc, val) => acc + val, 0);

	const getValAtPct = (pct: number) => {
		const index = Math.max(0, Math.min(count - 1, Math.round((pct / 100) * count) - 1));
		return sorted[index];
	};

	return {
		provider,
		sampleCount: count,
		minMs: sorted[0],
		p50Ms: getValAtPct(50),
		p90Ms: getValAtPct(90),
		p95Ms: getValAtPct(95),
		p99Ms: getValAtPct(99),
		maxMs: sorted[count - 1],
		avgMs: Math.round((sum / count) * 10) / 10,
	};
}

/**
 * Real-time Today Summary:
 * Powers the top KPI stats in the MailHub Admin Dashboard.
 */
export async function getRealtimeTodaySummary(
	env: MailHubEnv,
	targetDate?: string,
): Promise<MailHubRealtimeSummary> {
	const todayDateBucket = targetDate ?? new Date().toISOString().slice(0, 10);

	const projectMetrics = await getDailyProjectMetrics(env, {
		startDate: todayDateBucket,
		endDate: todayDateBucket,
	});

	const providerMetrics = await getDailyProviderMetrics(env, {
		startDate: todayDateBucket,
		endDate: todayDateBucket,
	});

	let totalSent = 0;
	let totalFailed = 0;
	let latencySum = 0;
	let latencyCount = 0;
	const activeProjects = new Set<string>();

	for (const pm of projectMetrics) {
		totalSent += pm.successfulSends;
		totalFailed += pm.failedSends;
		if (pm.successfulSends > 0) {
			latencySum += pm.avgLatencyMs * pm.successfulSends;
			latencyCount += pm.successfulSends;
		}
		if (pm.totalSends > 0) {
			activeProjects.add(pm.projectId);
		}
	}

	const totalAttempts = totalSent + totalFailed;
	const overallSuccessRate = totalAttempts > 0 ? Math.round((totalSent / totalAttempts) * 10000) / 100 : 100;
	const avgLatency = latencyCount > 0 ? Math.round((latencySum / latencyCount) * 10) / 10 : 0;

	const providerBreakdown = providerMetrics.map((p) => {
		return {
			provider: p.provider,
			sentCount: p.successfulSends,
			limit: 0, // Injected by caller if quota credentials known
			sliceUsedPct: 0,
		};
	});

	return {
		todayDateBucket,
		totalSentToday: totalSent,
		totalFailedToday: totalFailed,
		successRateToday: overallSuccessRate,
		activeProjectsToday: activeProjects.size,
		avgLatencyMsToday: avgLatency,
		providerBreakdown,
	};
}
