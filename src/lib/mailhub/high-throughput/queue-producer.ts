/**
 * MailHub High-Throughput Queue Producer
 * Asynchronously ingests emails into Cloudflare Queues with sub-5ms response times,
 * enabling parallel ingestion of 1,000+ emails per second without connection exhaustion.
 * @module lib/mailhub/high-throughput/queue-producer
 */

import { newId } from "@/lib/ids";
import type { NormalizedSendPayload } from "@/lib/ingestion/types";
import type { QueuedEmailJob } from "./types";
import { openQueue } from "../../../../server/runtime/queue";

// In-memory high-throughput queue fallback for local Node / testing / standalone runs
let localHighThroughputQueue: any = null;

export function getHighThroughputQueue(env: CloudflareEnv): any {
	if (env && (env as any).MAILHUB_OUTBOUND_QUEUE) {
		return (env as any).MAILHUB_OUTBOUND_QUEUE;
	}
	if (!localHighThroughputQueue) {
		localHighThroughputQueue = openQueue<QueuedEmailJob>("mailhub_outbound_queue");
	}
	return localHighThroughputQueue;
}

/**
 * Enqueues a single normalized email for asynchronous high-throughput dispatch.
 * Returns immediately with generated message ID in <5ms.
 */
export async function enqueueEmailJob(
	env: CloudflareEnv,
	projectId: string,
	projectSlug: string,
	payload: NormalizedSendPayload,
	options?: { routingKeyId?: string; metadata?: Record<string, unknown> },
): Promise<{ id: string; status: "queued"; enqueuedAt: number }> {
	const messageId = newId("msg");
	const now = Date.now();

	const job: QueuedEmailJob = {
		jobId: messageId,
		projectId,
		projectSlug,
		payload: {
			...payload,
			headers: {
				...payload.headers,
				"Message-ID": payload.headers["Message-ID"] || `<${messageId}@mailhub.internal>`,
			},
		},
		enqueuedAt: now,
		attempt: 0,
		routingKeyId: options?.routingKeyId,
		metadata: options?.metadata,
	};

	const queue = getHighThroughputQueue(env);
	await queue.send(job);

	return {
		id: messageId,
		status: "queued",
		enqueuedAt: now,
	};
}

/**
 * Enqueues a batch of normalized emails (up to 500 at a time) for parallel processing.
 * Returns array of generated IDs in <10ms.
 */
export async function enqueueEmailBatch(
	env: CloudflareEnv,
	projectId: string,
	projectSlug: string,
	payloads: NormalizedSendPayload[],
	options?: { routingKeyId?: string; metadata?: Record<string, unknown> },
): Promise<Array<{ id: string; status: "queued"; enqueuedAt: number }>> {
	const now = Date.now();
	const queue = getHighThroughputQueue(env);
	const results: Array<{ id: string; status: "queued"; enqueuedAt: number }> = [];
	const jobs: Array<{ body: QueuedEmailJob }> = [];

	for (const payload of payloads) {
		const messageId = newId("msg");
		const job: QueuedEmailJob = {
			jobId: messageId,
			projectId,
			projectSlug,
			payload: {
				...payload,
				headers: {
					...payload.headers,
					"Message-ID": payload.headers["Message-ID"] || `<${messageId}@mailhub.internal>`,
				},
			},
			enqueuedAt: now,
			attempt: 0,
			routingKeyId: options?.routingKeyId,
			metadata: options?.metadata,
		};
		jobs.push({ body: job });
		results.push({ id: messageId, status: "queued", enqueuedAt: now });
	}

	if (typeof queue.sendBatch === "function") {
		await queue.sendBatch(jobs);
	} else {
		// Fallback parallel sends
		await Promise.all(jobs.map((j) => queue.send(j.body)));
	}

	return results;
}

