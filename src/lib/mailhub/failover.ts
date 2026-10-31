/**
 * OrbitMails / MailHub - Failover Waterfall & Circuit Breaker Engine
 * @module lib/mailhub/failover
 */

import type { OutboundProviderMessage } from "@/lib/email/outbound-provider-types";
import { newId } from "@/lib/ids";
import {
	CircuitBreaker,
	defaultCircuitBreaker,
} from "./circuit-breaker";
import {
	type AttemptRecord,
	enqueueDlqJob,
	type FailoverQueuedResponse,
} from "./dlq";
import {
	ProviderError,
	wrapAsProviderError,
} from "./providers/error";
import { sendWithAdapter } from "./providers/registry";
import type {
	MailHubProviderType,
	ProviderSendOptions,
} from "./providers/types";
import {
	buildCandidateProviders,
	getQuotaKey,
	getTodayDateBucket,
} from "./router";
import {
	globalTelemetry,
	type TelemetryHook,
} from "./telemetry";
import type {
	MailHubEnv,
	RankedProvider,
	RoutingOptions,
} from "./types";

export interface SendWithFailoverParams {
	projectId: string;
	message: OutboundProviderMessage;
	options?: ProviderSendOptions;
	routingOptions?: RoutingOptions;
	dateBucket?: string;
	deliveryId?: string;
	candidates?: RankedProvider[];
	circuitBreaker?: CircuitBreaker;
	telemetryHook?: TelemetryHook;
	ctx?: { waitUntil: (promise: Promise<unknown>) => void };
	env: MailHubEnv;
}

export interface FailoverSuccessResult {
	success: true;
	queued: false;
	deliveryId: string;
	messageId: string;
	providerMessageId?: string;
	provider: MailHubProviderType;
	providerCredId: string;
	latencyMs: number;
	attempts: AttemptRecord[];
	failoverCount: number;
	timestamp: number;
}

export type FailoverResult = FailoverSuccessResult | FailoverQueuedResponse;

/**
 * Resolves credentials for a candidate provider from candidate properties,
 * routing overrides, D1 database, or environment bindings.
 */
export async function resolveCandidateCredentials(
	candidate: RankedProvider,
	env: MailHubEnv,
	options?: RoutingOptions,
): Promise<Record<string, any>> {
	// 1. If explicit credentials override provided (e.g. In unit tests)
	if (options?.credentialsOverride) {
		const match = options.credentialsOverride.find((c) => c.id === candidate.providerCredId);
		if (match) {
			return {
				apiKey: match.apiKeyEnc || "test_key",
				provider: match.provider,
			};
		}
	}

	// 2. If credentials already attached to candidate
	if (candidate.credential) {
		return candidate.credential;
	}

	// 3. Query from D1 Database if bound
	if (env.DB) {
		try {
			const row = await env.DB.prepare(
				"SELECT id, provider, credentials_encrypted as creds FROM provider_credentials WHERE id = ? LIMIT 1",
			).bind(candidate.providerCredId).first();

			if (row && row.creds) {
				try {
					return typeof row.creds === "string" ? JSON.parse(row.creds) : row.creds;
				} catch {
					return { apiKey: row.creds, provider: row.provider };
				}
			}
		} catch {
			// Fallback to environment variables
		}
	}

	// 4. Fallback to environment variables based on provider type
	const providerType = candidate.provider.toLowerCase();
	switch (providerType) {
		case "brevo":
			return { apiKey: env.BREVO_API_KEY || "" };
		case "resend":
			return { apiKey: env.RESEND_API_KEY || "" };
		case "zepto":
		case "zeptomail":
			return {
				sendMailToken: env.ZEPTOMAIL_API_KEY || env.ZEPTO_API_KEY || "",
				bounceAddress: env.ZEPTOMAIL_BOUNCE_ADDRESS,
			};
		case "mailgun":
			return {
				apiKey: env.MAILGUN_API_KEY || "",
				domain: env.MAILGUN_DOMAIN || "mg.orbitsaas.cloud",
				region: env.MAILGUN_REGION || "us",
			};
		case "ses":
			return {
				accessKeyId: env.AWS_ACCESS_KEY_ID || env.S3_ACCESS_KEY_ID || "",
				secretAccessKey: env.AWS_SECRET_ACCESS_KEY || env.S3_SECRET_ACCESS_KEY || "",
				region: env.AWS_REGION || env.S3_REGION || "us-east-1",
			};
		case "cloudflare":
			return {
				emailBinding: env.EMAIL,
			};
		default:
			return { apiKey: "unknown" };
	}
}

/**
 * Marks a project's quota slice on a provider as exhausted in KV and local cache.
 * Per specification: This is performed immediately on QUOTA_EXCEEDED without penalizing health score.
 */
export async function markQuotaSliceExhausted(
	projectId: string,
	providerCredId: string,
	dateBucket: string,
	env: MailHubEnv,
	sliceLimit = 999999,
): Promise<void> {
	const kvKey = getQuotaKey(projectId, providerCredId, dateBucket);

	// 1. Write to Cloudflare KV with TTL until end-of-day
	if (env.KV) {
		try {
			await env.KV.put(
				kvKey,
				JSON.stringify({
					used: sliceLimit,
					exhausted: true,
					exhaustedAt: Date.now(),
				}),
				{ expirationTtl: 86400 },
			);
		} catch (err) {
			console.warn(`[markQuotaSliceExhausted] Failed to put KV for ${kvKey}:`, err);
		}
	}

	// 2. Notify Durable Object Quota Coordinator if bound
	if (env.QUOTA_DO || env.QUOTA_COORDINATOR) {
		try {
			const coordinator = env.QUOTA_COORDINATOR || env.QUOTA_DO;
			const stub = coordinator.getByName ? coordinator.getByName("global") : coordinator.get(coordinator.idFromName("global"));
			if (typeof stub.markExhausted === "function") {
				await stub.markExhausted(projectId, providerCredId, dateBucket);
			}
		} catch {
			// Best effort
		}
	}
}

/**
 * Validates message payload for critical syntax errors before attempting delivery.
 */
function validateMessagePayload(message: OutboundProviderMessage): void {
	if (!message.from || typeof message.from !== "string" || !message.from.includes("@")) {
		throw new ProviderError({
			message: `Invalid sender email address: "${message?.from}"`,
			code: "INVALID_PAYLOAD",
			provider: "cloudflare",
		});
	}

	const toList = Array.isArray(message.to) ? message.to : [message.to];
	if (!toList.length || !toList.some((addr) => typeof addr === "string" && addr.includes("@"))) {
		throw new ProviderError({
			message: "At least one valid recipient address is required in 'to' field",
			code: "INVALID_PAYLOAD",
			provider: "cloudflare",
		});
	}

	if (!message.subject && message.subject !== "") {
		throw new ProviderError({
			message: "Email subject is required",
			code: "INVALID_PAYLOAD",
			provider: "cloudflare",
		});
	}
}

/**
 * Enterprise Failover Waterfall & Circuit Breaker Engine
 *
 * 1. Iterates through the sorted candidate list from WP-05.
 * 2. On QUOTA_EXCEEDED:
 *    - Immediately marks the quota slice exhausted in KV/Durable Object.
 *    - Tries next provider WITHOUT penalizing health score or circuit breaker.
 * 3. On TRANSIENT_SERVER_ERROR:
 *    - Records failure against provider's circuit breaker (3 failures within 5m trips OPEN for 15m).
 *    - Immediately attempts next provider.
 * 4. On INVALID_PAYLOAD:
 *    - Immediately rejects without failing over.
 * 5. If all candidates fail:
 *    - Enqueues to Cloudflare Queues / DLQ for exponential backoff retries.
 *    - Returns graceful 202 Accepted { success: false, queued: true, deliveryId }.
 */
export async function sendWithFailover(
	params: SendWithFailoverParams,
): Promise<FailoverResult> {
	const {
		projectId,
		message,
		options,
		routingOptions,
		env,
		ctx,
		telemetryHook,
	} = params;

	const dateBucket = params.dateBucket || getTodayDateBucket();
	const deliveryId = params.deliveryId || newId("dlv");
	const circuitBreaker = params.circuitBreaker || defaultCircuitBreaker;

	// 1. Fast payload validation
	try {
		validateMessagePayload(message);
	} catch (validationErr) {
		const providerErr = wrapAsProviderError(validationErr, "cloudflare", "INVALID_PAYLOAD");
		await globalTelemetry.emit(
			{
				type: "invalid_payload_rejected",
				deliveryId,
				projectId,
				errorCode: "INVALID_PAYLOAD",
				errorMessage: providerErr.message,
				timestamp: Date.now(),
			},
			telemetryHook,
			ctx,
		);
		throw providerErr;
	}

	// 2. Resolve sorted candidate list from WP-05 router
	let candidates = params.candidates;
	if (!candidates || candidates.length === 0) {
		candidates = await buildCandidateProviders(projectId, dateBucket, env, routingOptions);
	}

	const attempts: AttemptRecord[] = [];

	// 3. If no candidate providers available at all: enqueue to DLQ immediately
	if (!candidates.length) {
		return enqueueDlqJob(env, {
			deliveryId,
			projectId,
			dateBucket,
			message,
			options,
			failedAttempts: [
				{
					providerCredId: "none",
					provider: "none",
					code: "NO_CANDIDATES",
					message: "No active candidate providers allocated or configured for this project",
					timestamp: Date.now(),
					latencyMs: 0,
				},
			],
			idempotencyKey: options?.idempotencyKey,
		});
	}

	// 4. Waterfall loop across candidate providers in priority/score order
	for (let index = 0; index < candidates.length; index++) {
		const candidate = candidates[index];
		const { providerCredId, provider } = candidate;
		const providerType = provider.toLowerCase() as MailHubProviderType;

		// 4a. Check Circuit Breaker state
		const canExecute = await circuitBreaker.canExecute(providerCredId, env);
		if (!canExecute.allowed) {
			attempts.push({
				providerCredId,
				provider,
				code: "CIRCUIT_OPEN",
				message: `Provider circuit breaker is OPEN (quarantined). Remaining: ${Math.round((canExecute.remainingQuarantineMs ?? 0) / 1000)}s`,
				timestamp: Date.now(),
				latencyMs: 0,
			});

			await globalTelemetry.emit(
				{
					type: "circuit_bypassed",
					deliveryId,
					projectId,
					provider,
					providerCredId,
					attemptIndex: index + 1,
					totalCandidates: candidates.length,
					timestamp: Date.now(),
					metadata: { remainingQuarantineMs: canExecute.remainingQuarantineMs },
				},
				telemetryHook,
				ctx,
			);

			// Fast bypass to next candidate
			continue;
		}

		// 4b. Prepare attempt
		const attemptStart = Date.now();
		await globalTelemetry.emit(
			{
				type: "attempt_start",
				deliveryId,
				projectId,
				provider,
				providerCredId,
				attemptIndex: index + 1,
				totalCandidates: candidates.length,
				timestamp: attemptStart,
				metadata: { isProbe: canExecute.isProbe },
			},
			telemetryHook,
			ctx,
		);

		try {
			// Resolve credentials for this candidate
			const credentials = await resolveCandidateCredentials(candidate, env, routingOptions);

			// Execute send via adapter
			const sendResult = await sendWithAdapter(
				providerType,
				credentials,
				message,
				options,
				env,
			);

			const latencyMs = Math.max(1, Date.now() - attemptStart);

			// Success! Record attempt
			attempts.push({
				providerCredId,
				provider,
				code: "SUCCESS",
				message: `Sent successfully via ${provider}`,
				timestamp: Date.now(),
				latencyMs,
			});

			// If circuit was in HALF_OPEN: probe succeeded -> reset circuit to CLOSED
			if (canExecute.isProbe) {
				await circuitBreaker.recordSuccess(providerCredId, env);
				await globalTelemetry.emit(
					{
						type: "circuit_reset",
						deliveryId,
						projectId,
						provider,
						providerCredId,
						timestamp: Date.now(),
					},
					telemetryHook,
					ctx,
				);
			}

			// Emit success telemetry
			await globalTelemetry.emit(
				{
					type: "attempt_success",
					deliveryId,
					projectId,
					provider,
					providerCredId,
					attemptIndex: index + 1,
					totalCandidates: candidates.length,
					latencyMs,
					timestamp: Date.now(),
					metadata: {
						messageId: sendResult.messageId,
						providerMessageId: sendResult.providerMessageId,
						failoverCount: index,
					},
				},
				telemetryHook,
				ctx,
			);

			return {
				success: true,
				queued: false,
				deliveryId,
				messageId: sendResult.providerMessageId || sendResult.messageId,
				providerMessageId: sendResult.providerMessageId,
				provider: providerType,
				providerCredId,
				latencyMs,
				attempts,
				failoverCount: index,
				timestamp: Date.now(),
			};
		} catch (err) {
			const latencyMs = Math.max(1, Date.now() - attemptStart);
			const providerError = wrapAsProviderError(err, providerType);

			// Record failure in attempts list
			attempts.push({
				providerCredId,
				provider,
				code: providerError.code,
				message: providerError.message,
				statusCode: providerError.statusCode,
				timestamp: Date.now(),
				latencyMs,
			});

			// Case 1: INVALID_PAYLOAD -> Hard reject immediately without failing over
			if (providerError.code === "INVALID_PAYLOAD") {
				await globalTelemetry.emit(
					{
						type: "invalid_payload_rejected",
						deliveryId,
						projectId,
						provider,
						providerCredId,
						errorCode: providerError.code,
						errorMessage: providerError.message,
						timestamp: Date.now(),
					},
					telemetryHook,
					ctx,
				);
				throw providerError;
			}

			// Case 2: QUOTA_EXCEEDED -> Mark slice exhausted in KV/DO without penalizing health score
			if (providerError.code === "QUOTA_EXCEEDED") {
				await markQuotaSliceExhausted(projectId, providerCredId, dateBucket, env, candidate.dailySlice);

				await globalTelemetry.emit(
					{
						type: "quota_exhausted",
						deliveryId,
						projectId,
						provider,
						providerCredId,
						dateBucket,
						errorCode: providerError.code,
						errorMessage: providerError.message,
						timestamp: Date.now(),
					},
					telemetryHook,
					ctx,
				);

				// Do NOT record circuit breaker failure! Continue to next candidate
				continue;
			}

			// Case 3: TRANSIENT_SERVER_ERROR -> Record failure against circuit breaker (3-strikes in 5m)
			if (providerError.code === "TRANSIENT_SERVER_ERROR") {
				const tripResult = await circuitBreaker.recordFailure(providerCredId, providerError, env);

				if (tripResult.tripped) {
					await globalTelemetry.emit(
						{
							type: "circuit_trip",
							deliveryId,
							projectId,
							provider,
							providerCredId,
							consecutiveFailures: tripResult.record.consecutiveFailures,
							quarantineMinutes: Math.round(circuitBreaker.config.quarantineDurationMs / 60000),
							errorCode: providerError.code,
							errorMessage: providerError.message,
							timestamp: Date.now(),
						},
						telemetryHook,
						ctx,
					);
				}

				await globalTelemetry.emit(
					{
						type: "attempt_failure",
						deliveryId,
						projectId,
						provider,
						providerCredId,
						attemptIndex: index + 1,
						latencyMs,
						errorCode: providerError.code,
						errorMessage: providerError.message,
						consecutiveFailures: tripResult.record.consecutiveFailures,
						timestamp: Date.now(),
					},
					telemetryHook,
					ctx,
				);

				// Continue to next provider in the waterfall
				continue;
			}

			// Case 4: AUTHENTICATION_ERROR -> Alert & failover
			await globalTelemetry.emit(
				{
					type: "attempt_failure",
					deliveryId,
					projectId,
					provider,
					providerCredId,
					attemptIndex: index + 1,
					latencyMs,
					errorCode: providerError.code,
					errorMessage: providerError.message,
					timestamp: Date.now(),
				},
				telemetryHook,
				ctx,
			);
		}
	}

	// 5. All candidates failed: Enqueue message to Cloudflare Queues / DLQ
	return enqueueDlqJob(env, {
		deliveryId,
		projectId,
		dateBucket,
		message,
		options,
		failedAttempts: attempts,
		idempotencyKey: options?.idempotencyKey,
		telemetryHook,
		ctx,
	});
}
