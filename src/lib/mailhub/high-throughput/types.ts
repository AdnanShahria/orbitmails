/**
 * MailHub High-Throughput Engine - Types & Definitions
 * Optimized for parallel processing of 1,000+ emails/sec
 * @module lib/mailhub/high-throughput/types
 */

import type { NormalizedSendPayload } from "@/lib/ingestion/types";
import type { SendLogEntry } from "@/lib/mailhub/types";

export interface HighThroughputConfig {
	/** Concurrency limit per worker isolate for outbound parallel requests (default: 50) */
	workerConcurrency: number;
	/** Number of messages pulled per queue batch (default: 100) */
	queueBatchSize: number;
	/** Number of quota tokens reserved per isolate lease to prevent DO lock contention (default: 50) */
	tokenLeaseBatchSize: number;
	/** Timeout in ms for individual provider HTTP calls during high-throughput bursts (default: 5000) */
	providerTimeoutMs: number;
	/** Maximum size for multi-row database insert chunking (default: 100) */
	dbBatchChunkSize: number;
}

export const DEFAULT_HIGH_THROUGHPUT_CONFIG: HighThroughputConfig = {
	workerConcurrency: 50,
	queueBatchSize: 100,
	tokenLeaseBatchSize: 50,
	providerTimeoutMs: 5000,
	dbBatchChunkSize: 100,
};

export interface QueuedEmailJob {
	jobId: string;
	projectId: string;
	projectSlug: string;
	payload: NormalizedSendPayload;
	enqueuedAt: number;
	attempt: number;
	routingKeyId?: string;
	metadata?: Record<string, unknown>;
}

export interface TokenLease {
	leaseId: string;
	projectId: string;
	providerCredId: string;
	dateBucket: string;
	tokensGranted: number;
	tokensUsed: number;
	expiresAt: number; // Unix timestamp in ms (typically 60 seconds)
}

export interface ParallelDispatchSummary {
	batchId: string;
	total: number;
	succeeded: number;
	failed: number;
	cascadeFailovers: number;
	durationMs: number;
	throughputPerSec: number;
	logs: SendLogEntry[];
}

