/**
 * OrbitMails / MailHub - Dead Letter Queue (DLQ) & Exponential Backoff Retry Engine
 * @module lib/mailhub/dlq
 */

import type { OutboundProviderMessage } from "@/lib/email/outbound-provider-types";
import { openQueue } from "@/../server/runtime/queue";
import type { ProviderSendOptions } from "./providers/types";
import { globalTelemetry } from "./telemetry";
import type { MailHubEnv } from "./types";

export interface AttemptRecord {
	providerCredId: string;
	provider: string;
	code: string;
	message: string;
	timestamp: number;
	latencyMs: number;
	statusCode?: number;
}

export interface MailHubDlqJob {
	kind: "mailhub.delivery.retry";
	deliveryId: string;
	projectId: string;
	dateBucket: string;
	message: OutboundProviderMessage;
	options?: ProviderSendOptions;
	retryCount: number;
	maxRetries: number;
	firstEnqueuedAt: number;
	lastFailedAt: number;
	failedAttempts: AttemptRecord[];
	nextRetryDelaySeconds: number;
	idempotencyKey?: string;
}

export interface EnqueueDlqParams {
	deliveryId: string;
	projectId: string;
	dateBucket: string;
	message: OutboundProviderMessage;
	options?: ProviderSendOptions;
	failedAttempts: AttemptRecord[];
	retryCount?: number;
	maxRetries?: number;
	idempotencyKey?: string;
	telemetryHook?: import("./telemetry").TelemetryHook;
	ctx?: { waitUntil: (promise: Promise<unknown>) => void };
}

export interface FailoverQueuedResponse {
	success: false;
	queued: true;
	deliveryId: string;
	statusCode: 202;
	message: string;
	failedAttempts: AttemptRecord[];
	queuedAt: number;
	nextRetryDelaySeconds: number;
	retryCount: number;
}

/**
 * Exponential backoff schedule in seconds:
 * Attempt 0 (first background retry): 30s
 * Attempt 1: 120s (2m)
 * Attempt 2: 600s (10m)
 * Attempt 3: 1800s (30m)
 * Attempt 4: 3600s (1h)
 */
export const RETRY_DELAYS_SECONDS = [30, 120, 600, 1800, 3600];
export const DEFAULT_MAX_RETRIES = 5;

export function getExponentialBackoffSeconds(retryCount: number): number {
	const index = Math.min(Math.max(0, retryCount), RETRY_DELAYS_SECONDS.length - 1);
	return RETRY_DELAYS_SECONDS[index];
}

/**
 * In-memory test store to record enqueued DLQ jobs for offline assertions and unit tests
 */
export class LocalDlqStore {
	private static instance: LocalDlqStore;
	private jobs: MailHubDlqJob[] = [];

	static getInstance(): LocalDlqStore {
		if (!this.instance) {
			this.instance = new LocalDlqStore();
		}
		return this.instance;
	}

	push(job: MailHubDlqJob): void {
		this.jobs.push(job);
	}

	getAll(): MailHubDlqJob[] {
		return [...this.jobs];
	}

	get(deliveryId: string): MailHubDlqJob | undefined {
		return this.jobs.find((j) => j.deliveryId === deliveryId);
	}

	clear(): void {
		this.jobs = [];
	}
}

/**
 * Enqueues a message that exhausted all active candidate providers to Cloudflare Queues / DLQ.
 * Retries are scheduled using exponential backoff delays.
 */
export async function enqueueDlqJob(
	env: MailHubEnv,
	params: EnqueueDlqParams,
): Promise<FailoverQueuedResponse> {
	const now = Date.now();
	const retryCount = params.retryCount ?? 0;
	const maxRetries = params.maxRetries ?? DEFAULT_MAX_RETRIES;
	const delaySeconds = getExponentialBackoffSeconds(retryCount);

	const job: MailHubDlqJob = {
		kind: "mailhub.delivery.retry",
		deliveryId: params.deliveryId,
		projectId: params.projectId,
		dateBucket: params.dateBucket,
		message: params.message,
		options: params.options,
		retryCount,
		maxRetries,
		firstEnqueuedAt: now,
		lastFailedAt: now,
		failedAttempts: params.failedAttempts,
		nextRetryDelaySeconds: delaySeconds,
		idempotencyKey: params.idempotencyKey,
	};

	// Always record in local DLQ store for diagnostics & unit testing
	LocalDlqStore.getInstance().push(job);

	let enqueuedSuccessfully = false;

	// 1. Try dedicated MAILHUB_DLQ Cloudflare Queue
	if (env.MAILHUB_DLQ && typeof env.MAILHUB_DLQ.send === "function") {
		try {
			await env.MAILHUB_DLQ.send(job, { delaySeconds });
			enqueuedSuccessfully = true;
		} catch (err) {
			console.warn("[MailHub:DLQ] Failed to send to env.MAILHUB_DLQ:", err);
		}
	}

	// 2. Try default OUTBOUND_QUEUE Cloudflare Queue
	if (!enqueuedSuccessfully && env.OUTBOUND_QUEUE && typeof env.OUTBOUND_QUEUE.send === "function") {
		try {
			await env.OUTBOUND_QUEUE.send(job, { delaySeconds });
			enqueuedSuccessfully = true;
		} catch (err) {
			console.warn("[MailHub:DLQ] Failed to send to env.OUTBOUND_QUEUE:", err);
		}
	}

	// 3. Fallback to InProcessQueue if running in Node runtime or local dev
	if (!enqueuedSuccessfully) {
		try {
			const inProcess = openQueue<MailHubDlqJob>("mailhub-dlq");
			await inProcess.send(job, { delaySeconds });
			enqueuedSuccessfully = true;
		} catch (err) {
			console.warn("[MailHub:DLQ] Failed to send to InProcessQueue fallback:", err);
		}
	}

	// Emit telemetry event
	await globalTelemetry.emit(
		{
			type: "all_exhausted_queued",
			deliveryId: params.deliveryId,
			projectId: params.projectId,
			attemptIndex: params.failedAttempts.length,
			nextRetryDelaySeconds: delaySeconds,
			retryCount,
			timestamp: now,
			metadata: {
				failedProviders: params.failedAttempts.map((a) => a.provider),
				maxRetries,
			},
		},
		params.telemetryHook,
		params.ctx,
	);

	return {
		success: false,
		queued: true,
		deliveryId: params.deliveryId,
		statusCode: 202,
		message: "All candidate providers unavailable or exhausted. Message queued for automatic background retry.",
		failedAttempts: params.failedAttempts,
		queuedAt: now,
		nextRetryDelaySeconds: delaySeconds,
		retryCount,
	};
}

/**
 * Type guard for queue message body
 */
export function isMailHubDlqJob(body: unknown): body is MailHubDlqJob {
	return (
		typeof body === "object" &&
		body !== null &&
		(body as { kind?: unknown }).kind === "mailhub.delivery.retry" &&
		typeof (body as { deliveryId?: unknown }).deliveryId === "string"
	);
}
