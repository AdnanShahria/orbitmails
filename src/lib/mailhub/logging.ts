/**
 * OrbitMails / MailHub - Asynchronous Send Logging & Batch Ingestion Pipeline
 * @module lib/mailhub/logging
 * 
 * WP-08: Asynchronous Send Logging & Analytics Ingestion
 * Guarantees zero latency penalty on client HTTP requests by leveraging:
 * 1. Non-blocking Cloudflare Queues or ctx.waitUntil()
 * 2. High-efficiency multi-row batching to conserve D1 write operations (up to 98% reduction)
 * 3. In-memory buffer with KV spillover on transient database pressure
 */

import { openQueue } from "@/../server/runtime/queue";
import type { BatchFlushResult, MailHubEnv, SendLogBatchOptions, SendLogEntry, SendLogStatus } from "./types";

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_FLUSH_INTERVAL_MS = 2000;
const DEFAULT_MAX_RETRIES = 3;

/**
 * Creates a normalized SendLogEntry with validated fields, UTC date bucket, and timestamp.
 */
export function createSendLogEntry(params: {
	projectId: string;
	providerCredId: string;
	provider: string;
	toAddress: string;
	subject?: string | null;
	htmlSnippet?: string | null;
	textContent?: string | null;
	status: SendLogStatus;
	providerMessageId?: string | null;
	errorMessage?: string | null;
	latencyMs: number;
	sentAt?: number;
	id?: string;
}): SendLogEntry {
	const sentAt = params.sentAt ?? Date.now();
	const dateBucket = new Date(sentAt).toISOString().slice(0, 10);
	const randomId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);

	const entry: SendLogEntry = {
		id: params.id ?? `log_${randomId}`,
		projectId: params.projectId,
		providerCredId: params.providerCredId,
		provider: params.provider.toLowerCase(),
		toAddress: params.toAddress.trim(),
		subject: params.subject ? params.subject.slice(0, 500) : null,
		status: params.status,
		providerMessageId: params.providerMessageId ?? null,
		errorMessage: params.errorMessage ? params.errorMessage.slice(0, 1000) : null,
		latencyMs: Math.max(0, Math.round(params.latencyMs)),
		sentAt,
		dateBucket,
	};

	if (params.htmlSnippet !== undefined) {
		entry.htmlSnippet = params.htmlSnippet ? params.htmlSnippet.slice(0, 2000) : null;
	}
	if (params.textContent !== undefined) {
		entry.textContent = params.textContent ? params.textContent.slice(0, 2000) : null;
	}

	return entry;
}

/**
 * Generates an SQL multi-row INSERT query and parameter array for D1 / SQLite / PostgreSQL / MySQL.
 * Formats multiple rows into a single atomic INSERT transaction.
 */
export function buildMultiRowInsertSql(
	entries: SendLogEntry[],
	tableName = "email_router_send_logs",
): { sql: string; params: any[] } {
	if (entries.length === 0) {
		return { sql: "", params: [] };
	}

	const hasSnippets = entries.some(
		(entry) => entry.htmlSnippet !== undefined || entry.textContent !== undefined,
	);

	const columns = [
		"id",
		"project_id",
		"provider_cred_id",
		"provider",
		"to_address",
		"subject",
		"status",
		"provider_message_id",
		"error_message",
		"latency_ms",
		"sent_at",
		"date_bucket",
	];

	if (hasSnippets) {
		columns.push("html_snippet", "text_content");
	}

	const placeholders: string[] = [];
	const params: any[] = [];

	for (const entry of entries) {
		if (hasSnippets) {
			placeholders.push(`(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
			params.push(
				entry.id,
				entry.projectId,
				entry.providerCredId,
				entry.provider,
				entry.toAddress,
				entry.subject ?? null,
				entry.status,
				entry.providerMessageId ?? null,
				entry.errorMessage ?? null,
				entry.latencyMs,
				entry.sentAt,
				entry.dateBucket,
				entry.htmlSnippet ? entry.htmlSnippet.slice(0, 2000) : null,
				entry.textContent ? entry.textContent.slice(0, 2000) : null,
			);
		} else {
			placeholders.push(`(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
			params.push(
				entry.id,
				entry.projectId,
				entry.providerCredId,
				entry.provider,
				entry.toAddress,
				entry.subject ?? null,
				entry.status,
				entry.providerMessageId ?? null,
				entry.errorMessage ?? null,
				entry.latencyMs,
				entry.sentAt,
				entry.dateBucket,
			);
		}
	}

	const sqlQuery = `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES ${placeholders.join(", ")}`;
	return { sql: sqlQuery, params };
}

/**
 * Writes a batch of SendLogEntry items to D1 database in a single atomic multi-row statement.
 * Supports automatic fallback between `email_router_send_logs` and `send_log` table names.
 */
export async function flushBatchToD1(
	entries: SendLogEntry[],
	env: MailHubEnv,
	options: SendLogBatchOptions = {},
): Promise<BatchFlushResult> {
	if (!entries || entries.length === 0) {
		return { flushedCount: 0, failedCount: 0, durationMs: 0 };
	}

	const startTime = Date.now();
	const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

	if (!env.DB) {
		// If DB is missing, check KV spillover
		if (options.spilloverToKv !== false && env.KV) {
			await spillLogsToKv(entries, env);
		}
		return {
			flushedCount: 0,
			failedCount: entries.length,
			durationMs: Date.now() - startTime,
			error: "No DB binding configured in env",
		};
	}

	// Try standard table name email_router_send_logs first, with fallback to send_log
	const tableCandidates = ["email_router_send_logs", "send_log"];
	let lastError: Error | null = null;

	for (const tableName of tableCandidates) {
		const { sql: sqlQuery, params } = buildMultiRowInsertSql(entries, tableName);

		let attempt = 0;
		let success = false;

		while (attempt < maxRetries && !success) {
			attempt++;
			try {
				const stmt = env.DB.prepare(sqlQuery).bind(...params);
				await stmt.run();
				success = true;
				return {
					flushedCount: entries.length,
					failedCount: 0,
					durationMs: Date.now() - startTime,
				};
			} catch (err: any) {
				lastError = err;
				const errMsg = String(err?.message || err);

				// If table doesn't exist, try next candidate table immediately without retry
				if (errMsg.includes("no such table") || errMsg.includes("doesn't exist")) {
					break;
				}

				// If transient lock or busy error, wait with exponential backoff
				if (attempt < maxRetries) {
					const backoffMs = attempt * 50;
					await new Promise((res) => setTimeout(res, backoffMs));
				}
			}
		}
	}

	// If all attempts failed, spill over to KV to prevent data loss
	if (options.spilloverToKv !== false && env.KV) {
		try {
			await spillLogsToKv(entries, env);
		} catch (kvErr) {
			console.error("[MailHub] KV spillover failed after DB flush failure:", kvErr);
		}
	}

	return {
		flushedCount: 0,
		failedCount: entries.length,
		durationMs: Date.now() - startTime,
		error: lastError ? lastError.message : "Flush to D1 failed",
	};
}

/**
 * Spills uncommitted logs to Cloudflare KV with a 24-hour expiration so they can be re-ingested.
 */
async function spillLogsToKv(entries: SendLogEntry[], env: MailHubEnv): Promise<void> {
	if (!env.KV) return;
	const timestamp = Date.now();
	const key = `spillover:send_logs:${timestamp}:${Math.random().toString(36).slice(2, 8)}`;
	// Retain for 24 hours (86400 seconds)
	await env.KV.put(key, JSON.stringify(entries), { expirationTtl: 86400 });
}

/**
 * Sweeps uncommitted spillover logs from KV and flushes them to D1.
 * Useful for scheduled maintenance crons (e.g. every 5 minutes).
 */
export async function drainKvSpilloverLogs(env: MailHubEnv): Promise<{ recoveredCount: number; keysCleaned: number }> {
	if (!env.KV || !env.DB) {
		return { recoveredCount: 0, keysCleaned: 0 };
	}

	let recoveredCount = 0;
	let keysCleaned = 0;

	try {
		const list = await env.KV.list({ prefix: "spillover:send_logs:" });
		for (const keyInfo of list.keys) {
			const raw = await env.KV.get(keyInfo.name, "json");
			if (Array.isArray(raw) && raw.length > 0) {
				const flushResult = await flushBatchToD1(raw as SendLogEntry[], env, { spilloverToKv: false });
				if (flushResult.flushedCount > 0) {
					recoveredCount += flushResult.flushedCount;
					await env.KV.delete(keyInfo.name);
					keysCleaned++;
				}
			} else {
				await env.KV.delete(keyInfo.name);
				keysCleaned++;
			}
		}
	} catch (err) {
		console.error("[MailHub] Error draining KV spillover logs:", err);
	}

	return { recoveredCount, keysCleaned };
}

/**
 * In-Memory Batch Buffer for worker isolates.
 * Batches send logs and flushes them when size threshold is reached or timer expires.
 */
export class SendLogBuffer {
	private buffer: SendLogEntry[] = [];
	private timer: any = null;
	private isFlushing = false;
	private options: Required<SendLogBatchOptions>;

	constructor(
		private env: MailHubEnv,
		options: SendLogBatchOptions = {},
	) {
		this.options = {
			maxBatchSize: options.maxBatchSize ?? DEFAULT_BATCH_SIZE,
			flushIntervalMs: options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
			maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
			spilloverToKv: options.spilloverToKv ?? true,
		};
	}

	/**
	 * Pushes a log entry into the buffer.
	 * If the buffer reaches maxBatchSize, triggers an immediate asynchronous flush.
	 */
	push(entry: SendLogEntry, ctx?: { waitUntil: (p: Promise<any>) => void }): void {
		this.buffer.push(entry);

		if (this.buffer.length >= this.options.maxBatchSize) {
			const flushPromise = this.flush();
			if (ctx?.waitUntil) {
				ctx.waitUntil(flushPromise);
			}
		} else if (!this.timer) {
			this.timer = setTimeout(() => {
				this.timer = null;
				void this.flush();
			}, this.options.flushIntervalMs);
		}
	}

	/**
	 * Flushes all pending log entries to D1.
	 */
	async flush(): Promise<BatchFlushResult> {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}

		if (this.buffer.length === 0) {
			return { flushedCount: 0, failedCount: 0, durationMs: 0 };
		}

		// Take current items and reset buffer
		const itemsToFlush = this.buffer.splice(0, this.buffer.length);
		this.isFlushing = true;

		try {
			const result = await flushBatchToD1(itemsToFlush, this.env, this.options);
			return result;
		} finally {
			this.isFlushing = false;
		}
	}

	/**
	 * Current pending count in buffer.
	 */
	get pendingCount(): number {
		return this.buffer.length;
	}

	/**
	 * Clear memory without flushing (useful for test resets).
	 */
	clear(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		this.buffer = [];
	}
}

// Module-level buffer instances mapped by env identity
const activeBuffers = new WeakMap<object, SendLogBuffer>();
let fallbackBuffer: SendLogBuffer | null = null;

export function getSendLogBuffer(env: MailHubEnv, options?: SendLogBatchOptions): SendLogBuffer {
	if (typeof env === "object" && env !== null) {
		let buf = activeBuffers.get(env);
		if (!buf) {
			buf = new SendLogBuffer(env, options);
			activeBuffers.set(env, buf);
		}
		return buf;
	}
	if (!fallbackBuffer) {
		fallbackBuffer = new SendLogBuffer(env, options);
	}
	return fallbackBuffer;
}

/**
 * Fallback In-Process Queue instance for local Node/Next.js/Vinext environments.
 */
let inProcessLogQueue: ReturnType<typeof openQueue<SendLogEntry>> | null = null;

export function getLocalLogQueue(env: MailHubEnv) {
	if (!inProcessLogQueue) {
		inProcessLogQueue = openQueue<SendLogEntry>("mailhub-send-logs");
		inProcessLogQueue.setConsumer(async (msg) => {
			const entry = msg as SendLogEntry;
			const buffer = getSendLogBuffer(env);
			buffer.push(entry);
		});
	}
	return inProcessLogQueue;
}

/**
 * PRIMARY NON-BLOCKING ENTRY POINT:
 * Records an email send asynchronously without delaying the client's HTTP response.
 * 
 * Execution Flow:
 * 1. If Cloudflare Queues (`env.ROUTER_LOG_QUEUE` or `env.SEND_LOG_QUEUE`) are bound:
 *    Enqueues the message to the queue. (Wrapped in ctx.waitUntil() for 0ms added latency).
 * 2. If Cloudflare Queues are not bound:
 *    Pushes to memory SendLogBuffer and flushes in batches via ctx.waitUntil().
 * 3. In local development / test mode:
 *    Routes to InProcessQueue or direct in-memory buffer.
 */
export function recordSendLogAsync(
	entry: SendLogEntry,
	env: MailHubEnv,
	ctx?: { waitUntil: (p: Promise<any>) => void },
): void {
	// 1. Cloudflare Queue Producer (Production Binding)
	const queueBinding = env.ROUTER_LOG_QUEUE || env.SEND_LOG_QUEUE;
	if (queueBinding && typeof queueBinding.send === "function") {
		const enqueuePromise = queueBinding.send(entry).catch((err: any) => {
			console.error("[MailHub] Queue enqueue failed, falling back to buffer:", err);
			// Fallback to memory buffer on queue failure
			const buffer = getSendLogBuffer(env);
			buffer.push(entry, ctx);
		});

		if (ctx?.waitUntil) {
			ctx.waitUntil(enqueuePromise);
		}
		return;
	}

	// 2. In-Memory Micro-Batch Buffer with ctx.waitUntil()
	const buffer = getSendLogBuffer(env);
	buffer.push(entry, ctx);
}
