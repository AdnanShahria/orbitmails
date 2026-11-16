/**
 * OrbitMails / MailHub - Delivery Diagnostics & Real Error Persistence
 * @module lib/mailhub/diagnostics
 *
 * Captures the real underlying provider/routing errors, HTTP status codes,
 * full failover waterfall attempt traces, and actionable remediation hints,
 * persisting them across D1 (`mailhub_delivery_diagnostics`), KV, and memory.
 */

import type { AttemptRecord } from "./dlq";
import type { MailHubEnv } from "./types";

export interface DiagnosticAttempt {
	provider: string;
	providerCredId?: string;
	code: string;
	status: number;
	latencyMs: number;
	error?: string;
	rawError?: string;
	hint?: string;
	timestamp: string;
}

export interface DeliveryDiagnostics {
	deliveryId?: string;
	stage: "validation" | "routing" | "provider_attempt" | "failover_exhausted" | "delivered" | "unexpected_error";
	summaryError?: string;
	errorCode?: string;
	httpStatus?: number;
	provider?: string;
	providerCredId?: string;
	diagnosticHint?: string;
	fromAddress?: string;
	totalLatencyMs: number;
	attempts: DiagnosticAttempt[];
	recordedAt: number;
}

const MAX_IN_MEMORY_DIAGNOSTICS = 300;
const inMemoryDiagnostics = new Map<string, DeliveryDiagnostics>();
let hasEnsuredDiagnosticsTable = false;

function rememberInMemory(logId: string, diagnostics: DeliveryDiagnostics): void {
	if (inMemoryDiagnostics.size >= MAX_IN_MEMORY_DIAGNOSTICS) {
		const oldestKey = inMemoryDiagnostics.keys().next().value;
		if (oldestKey) inMemoryDiagnostics.delete(oldestKey);
	}
	inMemoryDiagnostics.set(logId, diagnostics);
}

/**
 * Maps an error code + provider + error message into an HTTP-like status code for UI/waterfall clarity.
 */
export function resolveAttemptHttpStatus(attempt: {
	code?: string;
	statusCode?: number;
	message?: string;
}): number {
	if (typeof attempt.statusCode === "number" && attempt.statusCode >= 100) {
		return attempt.statusCode;
	}
	const code = (attempt.code || "").toUpperCase();
	if (code === "SUCCESS") return 200;
	if (code === "QUOTA_EXCEEDED") return 429;
	if (code === "AUTHENTICATION_ERROR") return 401;
	if (code === "INVALID_PAYLOAD") return 400;
	if (code === "CIRCUIT_OPEN") return 503;
	if (code === "NO_CANDIDATES") return 503;
	if (code === "RESTRICTED_DOMAIN") return 403;

	const msg = (attempt.message || "").toLowerCase();
	if (msg.includes("401")) return 401;
	if (msg.includes("403")) return 403;
	if (msg.includes("429")) return 429;
	if (msg.includes("400") || msg.includes("422")) return 400;
	if (msg.includes("503")) return 503;
	if (msg.includes("502")) return 502;
	return 500;
}

/**
 * Strips redundant `[MailHub:PROVIDER] CODE:` prefixes when building clean nested messages.
 */
export function cleanProviderErrorMessage(message?: string | null): string {
	if (!message) return "";
	return message.replace(/^\[MailHub:[A-Z0-9_-]+\]\s*[A-Z0-9_]+:\s*/i, "").trim();
}

/**
 * Generates an actionable diagnostic hint explaining *why* a failure happened and how to fix it.
 */
export function inferDiagnosticHint(params: {
	provider?: string;
	errorCode?: string;
	errorMessage?: string;
	httpStatus?: number;
}): string | undefined {
	const provider = (params.provider || "").toLowerCase();
	const code = (params.errorCode || "").toUpperCase();
	const msg = (params.errorMessage || "").toLowerCase();
	const status = params.httpStatus;

	if (!msg && !code) return undefined;

	if (msg.includes("email binding is not available") || msg.includes("env.email")) {
		return "Cloudflare SendEmail binding (env.EMAIL) is missing in this runtime and CF_ACCOUNT_ID / CF_TOKEN REST credentials are not configured. Verify the send_email binding in wrangler.jsonc or add CF_ACCOUNT_ID and CF_TOKEN secrets.";
	}

	if (provider === "cloudflare" && (status === 401 || status === 403 || code === "AUTHENTICATION_ERROR")) {
		return "Cloudflare Email Sending rejected authentication or permissions. Ensure CF_TOKEN includes 'Email Sending Edit' and CF_ACCOUNT_ID matches the account owning the verified domain.";
	}

	if (
		msg.includes("not verified") ||
		msg.includes("unverified") ||
		msg.includes("domain is not verified") ||
		msg.includes("restricted_domain") ||
		msg.includes("not authorized for project")
	) {
		return "The sender domain or destination address is not verified or not authorized for this project/provider. Verify the domain DNS/DKIM records in Domains and confirm the provider allows sending from this address.";
	}

	if (msg.includes("api key is missing") || msg.includes("credentials") && msg.includes("missing")) {
		return `No API key or credentials found for ${provider || "this provider"}. Save credentials in MailHub Provider Keys or configure the provider environment variable.`;
	}

	if (code === "AUTHENTICATION_ERROR" || status === 401 || status === 403) {
		return `Provider ${provider ? provider.toUpperCase() : ""} rejected the API key or token (HTTP ${status || 401}). Check that the stored key is valid, unrevoked, and has send permissions.`;
	}

	if (code === "CIRCUIT_OPEN" || msg.includes("circuit breaker is open")) {
		return "This provider is temporarily quarantined by the 3-strike circuit breaker after consecutive failures. Reset the breaker in Provider Fleets once the underlying issue is fixed.";
	}

	if (code === "NO_CANDIDATES" || msg.includes("no active candidate providers")) {
		return "This project has no enabled or eligible provider allocations left (check daily quota slices, disabled providers, or open circuit breakers in Rebalance Slices).";
	}

	if (code === "QUOTA_EXCEEDED" || status === 429) {
		return "Daily quota slice or upstream provider rate limit was reached. Increase the project's slice or configure an additional fallback provider.";
	}

	if (code === "INVALID_PAYLOAD" || status === 400 || status === 422) {
		return "The upstream provider rejected the message payload (sender address, recipient, headers, or body validation failed). Inspect the raw provider response below.";
	}

	if (msg.includes("timeout") || msg.includes("abort") || msg.includes("econnrefused") || msg.includes("fetch failed")) {
		return "Network request to the provider timed out or failed to connect. Check outbound network access and provider API status.";
	}

	if (msg === "all failover attempts failed or queued") {
		return "Legacy log entry recorded before detailed error capture was enabled. Trigger a new test send to capture the full provider response.";
	}

	return undefined;
}

/**
 * Formats an array of AttemptRecords into a clear single-line summary preserving every real error.
 */
export function formatAttemptsErrorSummary(attempts: AttemptRecord[]): string {
	const failed = attempts.filter((a) => a.code !== "SUCCESS");
	if (failed.length === 0) return "Delivery failed";

	return failed
		.map((a) => {
			const cleanMsg = cleanProviderErrorMessage(a.message) || a.code || "Failed";
			const statusPart = a.statusCode ? ` HTTP ${a.statusCode}` : "";
			return `[${a.provider.toUpperCase()} ${a.code}${statusPart}] ${cleanMsg}`;
		})
		.join(" -> ")
		.slice(0, 1800);
}

/**
 * Converts AttemptRecord[] (and optional error fallback) into full DeliveryDiagnostics.
 */
export function buildDeliveryDiagnostics(params: {
	deliveryId?: string;
	attempts?: AttemptRecord[];
	fallbackError?: unknown;
	fallbackProvider?: string;
	fallbackProviderCredId?: string;
	stage?: DeliveryDiagnostics["stage"];
	fromAddress?: string;
	totalLatencyMs?: number;
}): DeliveryDiagnostics {
	const now = Date.now();
	const rawAttempts = params.attempts ?? [];

	let diagnosticAttempts: DiagnosticAttempt[] = rawAttempts.map((att) => {
		const status = resolveAttemptHttpStatus(att);
		const cleanMsg = cleanProviderErrorMessage(att.message);
		const isSuccess = att.code === "SUCCESS";
		return {
			provider: att.provider,
			providerCredId: att.providerCredId,
			code: att.code,
			status,
			latencyMs: Math.max(0, Math.round(att.latencyMs || 0)),
			error: isSuccess ? undefined : cleanMsg || att.message,
			rawError: isSuccess ? undefined : att.message,
			hint: isSuccess
				? undefined
				: inferDiagnosticHint({
						provider: att.provider,
						errorCode: att.code,
						errorMessage: att.message,
						httpStatus: status,
					}),
			timestamp: new Date(att.timestamp || now).toISOString(),
		};
	});

	if (diagnosticAttempts.length === 0 && params.fallbackError) {
		const err = params.fallbackError as any;
		const rawMsg = err instanceof Error ? err.message : String(err);
		const cleanMsg = cleanProviderErrorMessage(rawMsg);
		const errCode = String(err?.code || err?.name || "UNEXPECTED_ERROR").toUpperCase();
		const provider = String(err?.provider || params.fallbackProvider || "routing");
		const status = resolveAttemptHttpStatus({
			code: errCode,
			statusCode: typeof err?.statusCode === "number" ? err.statusCode : undefined,
			message: rawMsg,
		});
		const rawResponseStr =
			err?.rawResponse !== undefined
				? typeof err.rawResponse === "string"
					? err.rawResponse
					: JSON.stringify(err.rawResponse)
				: undefined;

		diagnosticAttempts = [
			{
				provider,
				providerCredId: params.fallbackProviderCredId,
				code: errCode,
				status,
				latencyMs: Math.max(0, Math.round(params.totalLatencyMs ?? 0)),
				error: cleanMsg || rawMsg,
				rawError: rawResponseStr && rawResponseStr !== "{}" ? `${rawMsg} | Response: ${rawResponseStr}` : rawMsg,
				hint: inferDiagnosticHint({
					provider,
					errorCode: errCode,
					errorMessage: rawMsg,
					httpStatus: status,
				}),
				timestamp: new Date(now).toISOString(),
			},
		];
	}

	const failedAttempts = diagnosticAttempts.filter((a) => a.code !== "SUCCESS");
	const succeeded = diagnosticAttempts.some((a) => a.code === "SUCCESS");
	const lastFailed = failedAttempts[failedAttempts.length - 1];
	const primaryFailed = failedAttempts[0];

	const computedLatency =
		params.totalLatencyMs && params.totalLatencyMs > 0
			? Math.round(params.totalLatencyMs)
			: diagnosticAttempts.reduce((sum, a) => sum + (a.latencyMs || 0), 0);

	const summaryError =
		failedAttempts.length > 0
			? failedAttempts
					.map((a) => `[${a.provider.toUpperCase()} ${a.code}${a.status ? ` HTTP ${a.status}` : ""}] ${a.error || "Failed"}`)
					.join(" -> ")
					.slice(0, 1800)
			: undefined;

	const diagnosticHint =
		lastFailed?.hint ||
		primaryFailed?.hint ||
		(summaryError
			? inferDiagnosticHint({
					provider: lastFailed?.provider || params.fallbackProvider,
					errorCode: lastFailed?.code,
					errorMessage: summaryError,
					httpStatus: lastFailed?.status,
				})
			: undefined);

	const stage: DeliveryDiagnostics["stage"] =
		params.stage ??
		(succeeded ? "delivered" : failedAttempts.length > 1 ? "failover_exhausted" : "provider_attempt");

	return {
		deliveryId: params.deliveryId,
		stage,
		summaryError,
		errorCode: lastFailed?.code || primaryFailed?.code,
		httpStatus: lastFailed?.status || primaryFailed?.status,
		provider: lastFailed?.provider || params.fallbackProvider,
		providerCredId: lastFailed?.providerCredId || params.fallbackProviderCredId,
		diagnosticHint,
		fromAddress: params.fromAddress,
		totalLatencyMs: computedLatency,
		attempts: diagnosticAttempts,
		recordedAt: now,
	};
}

async function ensureDiagnosticsTable(env: MailHubEnv): Promise<void> {
	if (!env?.DB || hasEnsuredDiagnosticsTable) return;
	try {
		await env.DB.prepare(
			"CREATE TABLE IF NOT EXISTS mailhub_delivery_diagnostics (log_id TEXT PRIMARY KEY, delivery_id TEXT, project_id TEXT, diagnostics_json TEXT NOT NULL, created_at INTEGER NOT NULL)",
		).run();
		hasEnsuredDiagnosticsTable = true;
	} catch {
		// Ignore if D1 is read-only or unavailable
	}
}

/**
 * Persists detailed DeliveryDiagnostics keyed by send log ID.
 */
export async function recordDeliveryDiagnostics(
	logId: string,
	projectId: string,
	diagnostics: DeliveryDiagnostics,
	env: MailHubEnv,
): Promise<void> {
	if (!logId) return;
	rememberInMemory(logId, diagnostics);

	const json = JSON.stringify(diagnostics);

	if (env?.DB) {
		try {
			await ensureDiagnosticsTable(env);
			await env.DB.prepare(
				"INSERT OR REPLACE INTO mailhub_delivery_diagnostics (log_id, delivery_id, project_id, diagnostics_json, created_at) VALUES (?, ?, ?, ?, ?)",
			)
				.bind(logId, diagnostics.deliveryId ?? null, projectId, json, diagnostics.recordedAt || Date.now())
				.run();
			return;
		} catch (err) {
			console.warn("[MailHub Diagnostics] Failed to persist to D1, falling back to KV:", err);
		}
	}

	if (env?.KV) {
		try {
			await env.KV.put(`diag:send_log:${logId}`, json, { expirationTtl: 7 * 86400 });
		} catch {
			// Best effort
		}
	}
}

/**
 * Loads DeliveryDiagnostics for a batch of send log IDs from memory, D1, and KV.
 */
export async function getDeliveryDiagnosticsMap(
	logIds: string[],
	env: MailHubEnv,
): Promise<Map<string, DeliveryDiagnostics>> {
	const result = new Map<string, DeliveryDiagnostics>();
	const missingIds: string[] = [];

	for (const id of logIds) {
		if (!id) continue;
		const cached = inMemoryDiagnostics.get(id);
		if (cached) {
			result.set(id, cached);
		} else {
			missingIds.push(id);
		}
	}

	if (missingIds.length === 0) return result;

	if (env?.DB) {
		try {
			await ensureDiagnosticsTable(env);
			// Chunk into groups of 50 to avoid SQLite bind parameter limits
			for (let i = 0; i < missingIds.length; i += 50) {
				const chunk = missingIds.slice(i, i + 50);
				const placeholders = chunk.map(() => "?").join(", ");
				const res = await env.DB.prepare(
					`SELECT log_id, diagnostics_json FROM mailhub_delivery_diagnostics WHERE log_id IN (${placeholders})`,
				)
					.bind(...chunk)
					.all();
				for (const row of (res?.results ?? []) as Array<{ log_id?: string; diagnostics_json?: string }>) {
					if (row.log_id && row.diagnostics_json) {
						try {
							const parsed = JSON.parse(row.diagnostics_json) as DeliveryDiagnostics;
							result.set(row.log_id, parsed);
							rememberInMemory(row.log_id, parsed);
						} catch {
							// Ignore malformed JSON
						}
					}
				}
			}
		} catch {
			// Table may not exist yet or D1 unavailable
		}
	}

	// KV fallback for any remaining IDs
	if (env?.KV) {
		const stillMissing = missingIds.filter((id) => !result.has(id)).slice(0, 20);
		await Promise.all(
			stillMissing.map(async (id) => {
				try {
					const raw = await env.KV.get(`diag:send_log:${id}`, "json");
					if (raw && typeof raw === "object") {
						const parsed = raw as DeliveryDiagnostics;
						result.set(id, parsed);
						rememberInMemory(id, parsed);
					}
				} catch {
					// Ignore
				}
			}),
		);
	}

	return result;
}
