/**
 * OrbitMails - Application Performance Monitoring (APM) & Threshold Alerting
 * @module lib/apm
 */

import { logger } from "@/lib/logging/logger";

export interface RequestMetric {
	endpoint: string;
	method: string;
	status: number;
	durationMs: number;
	timestamp: number;
}

export interface ApmMetricsSummary {
	totalRequests: number;
	errorCount: number;
	errorRatePercent: number;
	avgDurationMs: number;
	p50DurationMs: number;
	p95DurationMs: number;
	p99DurationMs: number;
	slowestEndpoints: Array<{ endpoint: string; durationMs: number }>;
}

export interface AlertThresholds {
	p95LatencyThresholdMs: number; // default: 2000ms
	errorRateThresholdPercent: number; // default: 5%
}

const DEFAULT_THRESHOLDS: AlertThresholds = {
	p95LatencyThresholdMs: 2000,
	errorRateThresholdPercent: 5,
};

class ApmTracker {
	private metricsBuffer: RequestMetric[] = [];
	private readonly bufferLimit = 1000;
	private lastAlertTime = 0;
	private readonly alertCooldownMs = 300_000; // 5 minutes cooldown between alerts

	record(metric: RequestMetric, env?: CloudflareEnv): void {
		this.metricsBuffer.push(metric);
		if (this.metricsBuffer.length > this.bufferLimit) {
			this.metricsBuffer.shift();
		}

		// Periodic evaluation of alerts
		if (this.metricsBuffer.length >= 20 && Date.now() - this.lastAlertTime > this.alertCooldownMs) {
			this.evaluateAlerts(env);
		}
	}

	getSummary(): ApmMetricsSummary {
		if (this.metricsBuffer.length === 0) {
			return {
				totalRequests: 0,
				errorCount: 0,
				errorRatePercent: 0,
				avgDurationMs: 0,
				p50DurationMs: 0,
				p95DurationMs: 0,
				p99DurationMs: 0,
				slowestEndpoints: [],
			};
		}

		const totalRequests = this.metricsBuffer.length;
		const errorCount = this.metricsBuffer.filter((m) => m.status >= 500).length;
		const errorRatePercent = Number(((errorCount / totalRequests) * 100).toFixed(2));

		const durations = this.metricsBuffer.map((m) => m.durationMs).sort((a, b) => a - b);
		const sum = durations.reduce((acc, d) => acc + d, 0);
		const avgDurationMs = Math.round(sum / totalRequests);

		const p50DurationMs = durations[Math.floor(durations.length * 0.50)] ?? 0;
		const p95DurationMs = durations[Math.floor(durations.length * 0.95)] ?? 0;
		const p99DurationMs = durations[Math.floor(durations.length * 0.99)] ?? 0;

		const slowestEndpoints = [...this.metricsBuffer]
			.sort((a, b) => b.durationMs - a.durationMs)
			.slice(0, 5)
			.map((m) => ({ endpoint: `${m.method} ${m.endpoint}`, durationMs: m.durationMs }));

		return {
			totalRequests,
			errorCount,
			errorRatePercent,
			avgDurationMs,
			p50DurationMs,
			p95DurationMs,
			p99DurationMs,
			slowestEndpoints,
		};
	}

	private evaluateAlerts(env?: CloudflareEnv): void {
		const summary = this.getSummary();

		if (summary.p95DurationMs > DEFAULT_THRESHOLDS.p95LatencyThresholdMs) {
			this.lastAlertTime = Date.now();
			logger.error(`[APM Alert] High latency detected: p95 is ${summary.p95DurationMs}ms (threshold: ${DEFAULT_THRESHOLDS.p95LatencyThresholdMs}ms)`, {
				summary,
			});
		}

		if (summary.errorRatePercent > DEFAULT_THRESHOLDS.errorRateThresholdPercent) {
			this.lastAlertTime = Date.now();
			logger.error(`[APM Alert] High 5xx error rate: ${summary.errorRatePercent}% (threshold: ${DEFAULT_THRESHOLDS.errorRateThresholdPercent}%)`, {
				summary,
			});
		}
	}
}

export const apm = new ApmTracker();

/**
 * Convenience helper to trace an API route execution time and record metric.
 */
export async function traceApiRoute<T>(
	request: Request,
	fn: () => Promise<Response>,
	env?: CloudflareEnv,
): Promise<Response> {
	const start = Date.now();
	const url = new URL(request.url);

	try {
		const response = await fn();
		const durationMs = Date.now() - start;

		apm.record({
			endpoint: url.pathname,
			method: request.method,
			status: response.status,
			durationMs,
			timestamp: Date.now(),
		}, env);

		response.headers.set("Server-Timing", `total;dur=${durationMs}`);
		return response;
	} catch (error) {
		const durationMs = Date.now() - start;
		apm.record({
			endpoint: url.pathname,
			method: request.method,
			status: 500,
			durationMs,
			timestamp: Date.now(),
		}, env);
		throw error;
	}
}

