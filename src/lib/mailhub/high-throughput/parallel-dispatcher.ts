/**
 * MailHub Parallel Dispatcher - High-Throughput Queue Consumer
 * Processes batches of queued emails concurrently (up to 50 parallel sockets per isolate)
 * and batches audit log writes to D1, sustaining 1,000+ emails/sec across provider pools.
 * @module lib/mailhub/high-throughput/parallel-dispatcher
 */

import type { QueuedEmailJob, ParallelDispatchSummary } from "./types";
import { DEFAULT_HIGH_THROUGHPUT_CONFIG } from "./types";
import { buildCandidateProviders } from "@/lib/mailhub/router";
import { sendWithFailover } from "@/lib/mailhub/failover";
import { flushBatchToD1 } from "@/lib/mailhub/logging";
import type { SendLogEntry } from "@/lib/mailhub/types";
import { acquireQuotaPermit } from "./token-lease-pool";
import { getTodayUtcDateBucket } from "@/lib/router/quota-client";

/**
 * Concurrency throttler executing tasks in parallel up to a specified concurrency limit.
 */
async function mapConcurrent<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let currentIndex = 0;

	const workers = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
		while (currentIndex < items.length) {
			const index = currentIndex++;
			results[index] = await fn(items[index], index);
		}
	});

	await Promise.all(workers);
	return results;
}

/**
 * Processes a batch of queued email jobs concurrently.
 * Designed to be invoked by Cloudflare Queue consumer (`worker.ts`) or in-process queue runner.
 */
export async function processParallelQueueBatch(
	env: CloudflareEnv,
	jobs: QueuedEmailJob[],
	config = DEFAULT_HIGH_THROUGHPUT_CONFIG,
): Promise<ParallelDispatchSummary> {
	const startTime = Date.now();
	const batchId = `batch_${startTime}_${jobs.length}`;
	const dateBucket = getTodayUtcDateBucket();

	let succeededCount = 0;
	let failedCount = 0;
	let failoversTriggered = 0;
	const sendLogs: SendLogEntry[] = [];

	// Process jobs in parallel with controlled concurrency
	await mapConcurrent(jobs, config.workerConcurrency, async (job) => {
		const jobStart = Date.now();
		try {
			// 1. Resolve ranked candidate providers for this project
			const candidates = await buildCandidateProviders(job.projectId, dateBucket, env);
			if (candidates.length === 0) {
				throw new Error(`No eligible providers available for project ${job.projectSlug}`);
			}

			// 2. Fast token lease check on primary candidate
			const primary = candidates[0];
			const permit = await acquireQuotaPermit(
				env,
				job.projectId,
				primary.providerCredId,
				primary.dailySlice,
				dateBucket,
				config.tokenLeaseBatchSize,
			);

			// If primary quota exhausted, re-score to cascade
			let effectiveCandidates = candidates;
			if (!permit.allowed) {
				failoversTriggered++;
				effectiveCandidates = candidates.slice(1);
			}

			// 3. Dispatch via failover engine
			const result = await sendWithFailover({
				env: env as any,
				projectId: job.projectId,
				deliveryId: job.jobId,
				message: {
					from: job.payload.from,
					to: Array.isArray(job.payload.to) ? job.payload.to : [job.payload.to],
					cc: job.payload.cc,
					bcc: job.payload.bcc,
					subject: job.payload.subject,
					html: job.payload.html,
					text: job.payload.text,
					headers: job.payload.headers,
					attachments: job.payload.attachments as any,
				},
				candidates: effectiveCandidates,
			});

			const latencyMs = Date.now() - jobStart;

			if (result.success) {
				succeededCount++;
				if (result.attempts && result.attempts.length > 1) {
					failoversTriggered++;
				}
				sendLogs.push({
					id: `log_${job.jobId}`,
					projectId: job.projectId,
					providerCredId: result.providerCredId || "unknown",
					provider: result.provider || "unknown",
					toAddress: Array.isArray(job.payload.to) ? job.payload.to.join(", ") : String(job.payload.to),
					subject: job.payload.subject,
					status: "sent",
					providerMessageId: result.providerMessageId || result.messageId,
					latencyMs,
					dateBucket,
					sentAt: Date.now(),
					htmlSnippet: job.payload.html ? job.payload.html.slice(0, 1500) : null,
					textContent: job.payload.text ? job.payload.text.slice(0, 1000) : null,
				});
			} else {
				failedCount++;
				const lastAttempt = result.failedAttempts?.[result.failedAttempts.length - 1];
				sendLogs.push({
					id: `log_${job.jobId}`,
					projectId: job.projectId,
					providerCredId: lastAttempt?.providerCredId || "all_failed",
					provider: lastAttempt?.provider || "unknown",
					toAddress: Array.isArray(job.payload.to) ? job.payload.to.join(", ") : String(job.payload.to),
					subject: job.payload.subject,
					status: result.queued ? "queued" : "failed",
					errorMessage: result.message || "Delivery failed across all providers",
					latencyMs,
					dateBucket,
					sentAt: Date.now(),
					htmlSnippet: job.payload.html ? job.payload.html.slice(0, 1500) : null,
					textContent: job.payload.text ? job.payload.text.slice(0, 1000) : null,
				});
			}
		} catch (err) {
			failedCount++;
			const latencyMs = Date.now() - jobStart;
			sendLogs.push({
				id: `log_${job.jobId}`,
				projectId: job.projectId,
				providerCredId: "error",
				provider: "unknown",
				toAddress: Array.isArray(job.payload.to) ? job.payload.to.join(", ") : String(job.payload.to),
				subject: job.payload.subject,
				status: "failed",
				errorMessage: (err as Error).message,
				latencyMs,
				dateBucket,
				sentAt: Date.now(),
				htmlSnippet: job.payload.html ? job.payload.html.slice(0, 1500) : null,
				textContent: job.payload.text ? job.payload.text.slice(0, 1000) : null,
			});
		}
	});

	// 4. Batch flush all send logs into D1 in a SINGLE atomic SQL statement
	if (sendLogs.length > 0) {
		try {
			await flushBatchToD1(sendLogs, env as any);
		} catch (err) {
			console.error(`[MailHub HighThroughput] Failed to batch flush ${sendLogs.length} logs to D1:`, err);
		}
	}

	const durationMs = Math.max(1, Date.now() - startTime);
	const throughputPerSec = Math.round((jobs.length / durationMs) * 1000);

	return {
		batchId,
		total: jobs.length,
		succeeded: succeededCount,
		failed: failedCount,
		cascadeFailovers: failoversTriggered,
		durationMs,
		throughputPerSec,
		logs: sendLogs,
	};
}
