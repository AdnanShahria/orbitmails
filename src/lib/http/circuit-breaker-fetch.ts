/**
 * OrbitMails - Outbound HTTP Circuit Breaker & Timeout Client
 * @module lib/http/circuit-breaker-fetch
 */

import { CircuitBreaker } from "@/lib/mailhub/circuit-breaker";

export interface ResilientFetchOptions extends RequestInit {
	timeoutMs?: number;
	serviceIdentifier?: string;
}

const globalBreaker = new CircuitBreaker({
	failureThreshold: 3,
	quarantineDurationMs: 5 * 60 * 1000,
});

/**
 * Resilient fetch that enforces strict timeouts and circuit breaker isolation for external APIs.
 */
export async function resilientFetch(
	url: string | URL,
	options: ResilientFetchOptions = {},
	env?: CloudflareEnv,
): Promise<Response> {
	const serviceId = options.serviceIdentifier ?? (typeof url === "string" ? new URL(url).hostname : url.hostname);
	const timeoutMs = options.timeoutMs ?? 10_000; // 10s default timeout

	// 1. Check circuit breaker state
	const execution = await globalBreaker.canExecute(serviceId, env as any);
	if (!execution.allowed) {
		const cooldownLeft = Math.ceil((execution.remainingQuarantineMs ?? 0) / 1000);
		throw new Error(
			`Circuit breaker is OPEN for service '${serviceId}'. Service is undergoing cooldown (${cooldownLeft}s remaining).`,
		);
	}

	// 2. Setup timeout signal
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	const combinedSignal = options.signal
		? AbortSignal.any([options.signal, timeoutSignal])
		: timeoutSignal;

	const startTime = Date.now();
	try {
		const response = await fetch(url, {
			...options,
			signal: combinedSignal,
		});

		// 5xx responses count as upstream service failure
		if (response.status >= 500) {
			await globalBreaker.recordFailure(serviceId, {
				code: "HTTP_5XX",
				message: `Upstream HTTP ${response.status}`,
			}, env as any);
		} else {
			// Record success
			await globalBreaker.recordSuccess(serviceId, env as any);
		}

		return response;
	} catch (error) {
		const latency = Date.now() - startTime;
		const isTimeout = timeoutSignal.aborted || (error instanceof Error && error.name === "TimeoutError");

		await globalBreaker.recordFailure(serviceId, {
			code: isTimeout ? "TIMEOUT" : "NETWORK_ERROR",
			message: isTimeout ? `Request timed out after ${timeoutMs}ms (took ${latency}ms)` : (error as Error).message,
		}, env as any);

		throw error;
	}
}
