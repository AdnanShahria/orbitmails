/**
 * OrbitMails / MailHub - Telemetry & Observability Pipeline
 * @module lib/mailhub/telemetry
 */

export type FailoverEventType =
	| "attempt_start"
	| "attempt_success"
	| "attempt_failure"
	| "quota_exhausted"
	| "circuit_trip"
	| "circuit_reset"
	| "circuit_probe"
	| "circuit_bypassed"
	| "failover_triggered"
	| "all_exhausted_queued"
	| "invalid_payload_rejected"
	| "dlq_retry_scheduled";

export interface FailoverTelemetryEvent {
	type: FailoverEventType;
	deliveryId: string;
	projectId: string;
	provider?: string;
	providerCredId?: string;
	attemptIndex?: number;
	totalCandidates?: number;
	latencyMs?: number;
	errorCode?: string;
	errorMessage?: string;
	statusCode?: number;
	consecutiveFailures?: number;
	quarantineMinutes?: number;
	dateBucket?: string;
	nextRetryDelaySeconds?: number;
	retryCount?: number;
	timestamp: number;
	metadata?: Record<string, unknown>;
}

export type TelemetryHook = (event: FailoverTelemetryEvent) => Promise<void> | void;

export class TelemetryDispatcher {
	private hooks: Set<TelemetryHook> = new Set();

	/**
	 * Registers a global telemetry hook listener.
	 * Returns an unregister cleanup function.
	 */
	register(hook: TelemetryHook): () => void {
		this.hooks.add(hook);
		return () => {
			this.hooks.delete(hook);
		};
	}

	/**
	 * Emits a telemetry event across all registered hooks and optional one-off hook.
	 * If Cloudflare ExecutionContext is provided, asynchronous hooks are tracked via waitUntil
	 * so user-facing response times are never blocked.
	 */
	async emit(
		event: FailoverTelemetryEvent,
		extraHook?: TelemetryHook,
		ctx?: { waitUntil: (promise: Promise<unknown>) => void },
	): Promise<void> {
		const allHooks: TelemetryHook[] = Array.from(this.hooks);
		if (extraHook) {
			allHooks.push(extraHook);
		}

		if (allHooks.length === 0) return;

		const dispatchPromises = allHooks.map(async (hook) => {
			try {
				await hook(event);
			} catch (err) {
				console.error("[MailHub:Telemetry] Hook invocation failed:", err);
			}
		});

		if (ctx && typeof ctx.waitUntil === "function") {
			ctx.waitUntil(Promise.all(dispatchPromises));
		} else {
			// In environments without waitUntil (Node/test), wait for immediate dispatch
			await Promise.all(dispatchPromises);
		}
	}

	clear(): void {
		this.hooks.clear();
	}
}

/**
 * Global singleton dispatcher instance
 */
export const globalTelemetry = new TelemetryDispatcher();

/**
 * Creates a structured JSON console logger hook for Cloudflare Observability & logs
 */
export function createConsoleTelemetryLogger(options?: { verbose?: boolean }): TelemetryHook {
	return (event: FailoverTelemetryEvent) => {
		const prefix = `[MailHub:Telemetry][${event.type}]`;
		const payload = {
			deliveryId: event.deliveryId,
			projectId: event.projectId,
			provider: event.provider,
			providerCredId: event.providerCredId,
			latencyMs: event.latencyMs,
			errorCode: event.errorCode,
			errorMessage: event.errorMessage,
			timestamp: event.timestamp,
		};

		if (event.type === "circuit_trip" || event.type === "all_exhausted_queued") {
			console.error(`${prefix} CRITICAL:`, JSON.stringify(payload));
		} else if (event.type === "attempt_failure" || event.type === "quota_exhausted") {
			console.warn(`${prefix} WARNING:`, JSON.stringify(payload));
		} else if (options?.verbose) {
			console.log(`${prefix} INFO:`, JSON.stringify(payload));
		}
	};
}
