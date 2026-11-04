/**
 * MailHub Drop-in Compatible Ingestion API - Core Service Pipeline
 * Handles validation, domain authorization, auto-provisioning, recipient splitting,
 * and dispatching via MailHub / Orbitmails outbound engine.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { mailboxes, messages } from "@/db/schema";
import { newId } from "@/lib/ids";
import { getEmailAddress, getEmailDisplayName } from "@/lib/email/address";
import { sendEmail, type SendEmailInput } from "@/lib/email/send";
import { readJsonBody } from "@/lib/http/request";
import { RequestBodyTooLargeError } from "@/lib/http/errors";
import { getSendErrorStatus } from "@/app/api/send/error-utils";
import { buildSnippet } from "@/lib/email/parse";
import { normalizeMessageId } from "@/lib/email/threading";
import { storeMessageAttachments } from "@/lib/email/attachments";
import type { OutboundProviderMessage } from "@/lib/email/outbound-provider-types";
import {
	authenticateIngestionRequest,
	authorizeDomainForProject,
} from "./auth";
import { enqueueEmailBatch, enqueueEmailJob } from "@/lib/mailhub/high-throughput";
import {
	buildCandidateProviders,
	getQuotaKey,
	getTodayDateBucket,
} from "@/lib/mailhub/router";
import {
	markQuotaSliceExhausted,
	sendWithFailover,
} from "@/lib/mailhub/failover";
import {
	checkAndIncrementQuota,
	refundQuota,
} from "@/lib/router/quota-client";
import {
	createSendLogEntry,
	flushBatchToD1,
} from "@/lib/mailhub/logging";
import type { RankedProvider } from "@/lib/mailhub/types";
import { normalizePayload } from "./normalizer";
import {
	batchEmailSchema,
	formatZodError,
	singleEmailSchema,
} from "./validators";
import type {
	IngestionAuthResult,
	NormalizedSendPayload,
	ResendBatchSuccessResponse,
	ResendErrorResponse,
	ResendSuccessResponse,
} from "./types";

const MAX_RECIPIENTS_PER_MESSAGE = 50;
const MAX_INGESTION_BODY_SIZE = 40 * 1024 * 1024; // 40 MB

/**
 * Resolves an existing mailbox for the sender address, or automatically provisions
 * a transactional mailbox under the verified domain.
 */
export async function resolveOrProvisionMailbox(
	env: CloudflareEnv,
	domain: { id: string; hostname: string; userId: string },
	fromAddress: string,
	preferredMailboxId?: string,
): Promise<{ mailboxId: string; displayName: string }> {
	const db = getDb(env);
	const fromEmail = getEmailAddress(fromAddress).toLowerCase();
	const localPart = fromEmail.split("@")[0] || "support";
	const displayName = getEmailDisplayName(fromAddress) || localPart;

	// 1. If explicit mailbox ID provided, verify it exists
	if (preferredMailboxId) {
		const [existing] = await db
			.select()
			.from(mailboxes)
			.where(eq(mailboxes.id, preferredMailboxId))
			.limit(1);
		if (existing) {
			return { mailboxId: existing.id, displayName: existing.displayName || displayName };
		}
	}

	// 2. Look for existing mailbox under this domain matching localPart
	const [matchingMailbox] = await db
		.select()
		.from(mailboxes)
		.where(and(eq(mailboxes.domainId, domain.id), eq(mailboxes.localPart, localPart)))
		.limit(1);

	if (matchingMailbox) {
		return {
			mailboxId: matchingMailbox.id,
			displayName: matchingMailbox.displayName || displayName,
		};
	}

	// 3. Auto-provision a mailbox under this verified domain for zero-friction transactional sending
	const mailboxId = newId("mbx");
	await db.insert(mailboxes).values({
		id: mailboxId,
		userId: domain.userId,
		domainId: domain.id,
		localPart,
		displayName,
		type: "personal",
		useAllDomains: true,
		disabled: false,
	});

	return { mailboxId, displayName };
}

/**
 * Splits a payload into multiple chunks if recipients exceed provider limit (50)
 * or if individual recipient delivery isolation was requested.
 */
export function handleRecipientSplitting(
	payload: NormalizedSendPayload,
): NormalizedSendPayload[] {
	if (payload.splitRecipients && payload.to.length > 1) {
		// Individual email per recipient
		return payload.to.map((singleRecipient) => ({
			...payload,
			to: [singleRecipient],
			cc: [], // CC/BCC excluded from isolated individual sends
			bcc: [],
		}));
	}

	if (payload.to.length <= MAX_RECIPIENTS_PER_MESSAGE) {
		return [payload];
	}

	// Chunk recipients into slices of 50
	const chunks: NormalizedSendPayload[] = [];
	for (let i = 0; i < payload.to.length; i += MAX_RECIPIENTS_PER_MESSAGE) {
		const chunkTo = payload.to.slice(i, i + MAX_RECIPIENTS_PER_MESSAGE);
		chunks.push({
			...payload,
			to: chunkTo,
			// Only include CC and BCC on the first chunk
			cc: i === 0 ? payload.cc : [],
			bcc: i === 0 ? payload.bcc : [],
		});
	}
	return chunks;
}

/**
 * Executes sending a single normalized payload through MailHub.
 */
export async function sendSingleNormalizedMessage(
	env: CloudflareEnv,
	payload: NormalizedSendPayload,
	auth: IngestionAuthResult,
	origin: string,
): Promise<ResendSuccessResponse> {
	// 1. Authorize sender domain
	const authDomain = await authorizeDomainForProject(env, payload.from, auth);
	if (!authDomain.authorized) {
		const error = new Error(authDomain.error);
		(error as any).statusCode = authDomain.statusCode;
		(error as any).name = "restricted_domain";
		throw error;
	}

	// 2. Resolve or provision sender mailbox
	const { mailboxId } = await resolveOrProvisionMailbox(
		env,
		authDomain.domain,
		payload.from,
		payload.mailboxId,
	);

	// Check mailbox scope if restricted on API key
	if (auth.mailboxIds && !auth.mailboxIds.includes(mailboxId)) {
		const error = new Error(`Mailbox not found or unauthorized for this key.`);
		(error as any).statusCode = 404;
		(error as any).name = "mailbox_not_found";
		throw error;
	}

	// 3. Inject MailHub tracking headers
	const headers: Record<string, string> = {
		...payload.headers,
		...(auth.projectSlug ? { "X-MailHub-Project": auth.projectSlug } : {}),
		...(auth.keyId ? { "X-MailHub-Key": auth.keyId } : {}),
	};
	if (payload.replyTo) {
		headers["Reply-To"] = payload.replyTo;
	}
	if (payload.inReplyTo) {
		headers["In-Reply-To"] = payload.inReplyTo;
	}
	if (payload.references) {
		headers.References = Array.isArray(payload.references)
			? payload.references.join(" ")
			: payload.references;
	}

	// 4. When auth.projectId is present (from a validated om_live_... routing key):
	// Route through MailHub intelligent candidate ranking, atomic quota check, failover waterfall, and send logging.
	if (auth.projectId) {
		const dateBucket = getTodayDateBucket();

		// 4a. Build candidate providers for this project
		const candidates = await buildCandidateProviders(auth.projectId, dateBucket, env as any);

		// 4b. Check and acquire atomic quota via QuotaCoordinator / KV
		let acquiredCandidate: RankedProvider | null = null;
		let effectiveCandidates: RankedProvider[] = [];

		for (let i = 0; i < candidates.length; i++) {
			const candidate = candidates[i];

			// Provider with unlimited daily slice (e.g. SES)
			if (!candidate.dailySlice || candidate.dailySlice <= 0) {
				acquiredCandidate = candidate;
				effectiveCandidates = candidates.slice(i);
				break;
			}

			// Check KV quota cache if KV is bound
			if (env.KV) {
				try {
					const kvKey = getQuotaKey(auth.projectId, candidate.providerCredId, dateBucket);
					const stored = (await env.KV.get(kvKey, "json")) as {
						exhausted?: boolean;
						used?: number;
					} | null;

					if (stored?.exhausted || (typeof stored?.used === "number" && stored.used >= candidate.dailySlice)) {
						continue;
					}
				} catch {
					// Fall through to atomic DO check
				}
			}

			// Atomic check & increment via QuotaCoordinator / LocalQuotaFallback
			try {
				const quotaRes = await checkAndIncrementQuota(env, {
					projectId: auth.projectId,
					providerId: candidate.providerCredId,
					sliceLimit: candidate.dailySlice,
					dateBucket,
				});

				if (!quotaRes.allowed) {
					await markQuotaSliceExhausted(
						auth.projectId,
						candidate.providerCredId,
						dateBucket,
						env as any,
						candidate.dailySlice,
					);
					continue;
				}

				acquiredCandidate = candidate;
				effectiveCandidates = candidates.slice(i);
				break;
			} catch (err) {
				console.warn(`[MailHub Quota] Check failed for ${candidate.providerCredId}:`, err);
				acquiredCandidate = candidate;
				effectiveCandidates = candidates.slice(i);
				break;
			}
		}

		if (!acquiredCandidate && effectiveCandidates.length === 0) {
			effectiveCandidates = candidates.filter((c) => !c.dailySlice || c.dailySlice <= 0);
		}

		// 4c. Execute delivery via sendWithFailover
		const outboundMessage: OutboundProviderMessage = {
			from: payload.from,
			to: payload.to,
			cc: payload.cc.length > 0 ? payload.cc : undefined,
			bcc: payload.bcc.length > 0 ? payload.bcc : undefined,
			subject: payload.subject,
			html: payload.html,
			text: payload.text,
			headers,
			attachments: payload.attachments.length > 0 ? payload.attachments : undefined,
		};

		const failoverResult = await sendWithFailover({
			env: env as any,
			projectId: auth.projectId,
			deliveryId: newId("dlv"),
			message: outboundMessage,
			candidates: effectiveCandidates.length > 0 ? effectiveCandidates : candidates,
			dateBucket,
		});

		// 4d. Post-send handling: adjust quota, record Sent copy in D1 messages, and log
		if (failoverResult.success) {
			// If failover routed to a different provider than the initially acquired one, reconcile quota
			if (acquiredCandidate && acquiredCandidate.dailySlice > 0) {
				if (failoverResult.providerCredId !== acquiredCandidate.providerCredId) {
					await refundQuota(env, {
						projectId: auth.projectId,
						providerId: acquiredCandidate.providerCredId,
						dateBucket,
					});

					const actualCandidate = candidates.find((c) => c.providerCredId === failoverResult.providerCredId);
					if (actualCandidate && actualCandidate.dailySlice > 0) {
						await checkAndIncrementQuota(env, {
							projectId: auth.projectId,
							providerId: actualCandidate.providerCredId,
							sliceLimit: actualCandidate.dailySlice,
							dateBucket,
						});
					}
				}
			}

			const messageRecordId = newId("msg");
			const db = getDb(env);

			// Record Sent copy into user's messages table in D1 so email appears in webmail Sent box
			try {
				await db.insert(messages).values({
					id: messageRecordId,
					userId: authDomain.domain.userId,
					mailboxId,
					direction: "outbound",
					providerMessageId: failoverResult.providerMessageId || failoverResult.messageId,
					fromAddr: payload.from,
					toAddr: payload.to.join(", "),
					ccAddr: payload.cc.length > 0 ? payload.cc.join(", ") : null,
					bccAddr: payload.bcc.length > 0 ? payload.bcc.join(", ") : null,
					replyTo: payload.replyTo || null,
					subject: payload.subject,
					snippet: buildSnippet(payload.text ?? null, payload.html ?? null),
					textBody: payload.text ?? null,
					htmlBody: payload.html ?? null,
					status: "sent",
					read: true,
					threadId: normalizeMessageId(failoverResult.messageId) || messageRecordId,
					inReplyTo: payload.inReplyTo ? normalizeMessageId(payload.inReplyTo) : null,
					references: payload.references
						? Array.isArray(payload.references)
							? payload.references.join(" ")
							: payload.references
						: null,
					createdAt: new Date(),
				});

				if (payload.attachments && payload.attachments.length > 0 && env.BUCKET) {
					await storeMessageAttachments(
						env,
						messageRecordId,
						payload.attachments.map((att) => ({
							filename: att.filename,
							type: att.type,
							content: att.content,
							disposition: att.disposition,
							contentId: att.contentId,
						})),
					).catch((err) => console.warn("[MailHub] Attachment storage skipped:", err));
				}
			} catch (dbErr) {
				console.error("[MailHub Ingestion] Failed to record Sent copy in messages table:", dbErr);
			}

			// Record send log in email_router_send_logs via createSendLogEntry & flushBatchToD1
			try {
				const logEntry = createSendLogEntry({
					projectId: auth.projectId,
					providerCredId: failoverResult.providerCredId || "unknown",
					provider: failoverResult.provider || "unknown",
					toAddress: payload.to.join(", "),
					subject: payload.subject,
					htmlSnippet: payload.html ? payload.html.slice(0, 1500) : null,
					textContent: payload.text ? payload.text.slice(0, 1000) : null,
					status: "sent",
					providerMessageId: failoverResult.providerMessageId || failoverResult.messageId,
					latencyMs: failoverResult.latencyMs || 0,
					sentAt: failoverResult.timestamp || Date.now(),
				});
				await flushBatchToD1([logEntry], env as any);
			} catch (logErr) {
				console.error("[MailHub Ingestion] Failed to record send log:", logErr);
			}

			return {
				id: failoverResult.messageId,
				messageId: failoverResult.messageId,
			};
		}

		// Failed across all candidates: refund acquired quota slot
		if (acquiredCandidate && acquiredCandidate.dailySlice > 0) {
			await refundQuota(env, {
				projectId: auth.projectId,
				providerId: acquiredCandidate.providerCredId,
				dateBucket,
			});
		}

		// Record failure log
		try {
			const lastAttempt = failoverResult.failedAttempts?.[failoverResult.failedAttempts.length - 1];
			const logEntry = createSendLogEntry({
				projectId: auth.projectId,
				providerCredId: lastAttempt?.providerCredId || "all_failed",
				provider: lastAttempt?.provider || "unknown",
				toAddress: payload.to.join(", "),
				subject: payload.subject,
				htmlSnippet: payload.html ? payload.html.slice(0, 1500) : null,
				textContent: payload.text ? payload.text.slice(0, 1000) : null,
				status: failoverResult.queued ? "queued" : "failed",
				errorMessage: failoverResult.message || "Delivery failed across all providers",
				latencyMs: 0,
				sentAt: Date.now(),
			});
			await flushBatchToD1([logEntry], env as any);
		} catch {}

		const error = new Error(failoverResult.message || "Email delivery failed across all candidate providers");
		(error as any).statusCode = 500;
		(error as any).name = "delivery_failed";
		throw error;
	}

	// 5. When auth.projectId is not set (e.g. legacy user/admin mailbox API key):
	// Preserve existing sendEmail(env, sendInput) path
	const sendInput: SendEmailInput = {
		userId: auth.userId,
		mailboxId,
		from: payload.from,
		to: payload.to,
		cc: payload.cc.length > 0 ? payload.cc : undefined,
		bcc: payload.bcc.length > 0 ? payload.bcc : undefined,
		subject: payload.subject,
		html: payload.html,
		text: payload.text,
		headers,
		inReplyTo: payload.inReplyTo,
		references: payload.references,
		scheduledAt: payload.scheduledAt,
		publicOrigin: origin,
		attachments: payload.attachments.map((att) => ({
			filename: att.filename,
			type: att.type,
			content: att.content,
			disposition: att.disposition,
			contentId: att.contentId,
		})),
	};

	const result = await sendEmail(env, sendInput);

	return {
		id: result.messageId,
		messageId: result.messageId,
		scheduled: result.scheduled,
		scheduledAt: result.scheduledAt,
	};
}

/**
 * Main HTTP Ingestion Request Handler.
 * Supports:
 * - Single send (Resend or Brevo format)
 * - Batch send (Array of sends or `/emails/batch`)
 * - Multi-recipient splitting
 * - Resend-standard response output `{ id: string }`
 */
export async function processIngestionRequest(
	request: Request,
	env: CloudflareEnv,
	ctx?: ExecutionContext,
	options?: { forceBatch?: boolean },
): Promise<Response> {
	// 1. Authenticate request
	const authResult = await authenticateIngestionRequest(request, env, ctx);
	if (!authResult.success) {
		return authResult.response;
	}
	const { auth } = authResult;
	const rateLimitHeaders = auth.rateLimitHeaders || {};

	// 2. Read request body with size protection
	let body: unknown;
	try {
		body = await readJsonBody(request, MAX_INGESTION_BODY_SIZE);
	} catch (error) {
		const isTooLarge = error instanceof RequestBodyTooLargeError;
		const errorBody: ResendErrorResponse = {
			name: isTooLarge ? "payload_too_large" : "invalid_json",
			message: isTooLarge
				? `Payload exceeds maximum limit of ${MAX_INGESTION_BODY_SIZE / (1024 * 1024)} MB`
				: "Request body must be valid JSON",
			statusCode: isTooLarge ? 413 : 400,
			error: isTooLarge ? "Payload too large" : "Invalid JSON",
		};
		return Response.json(errorBody, {
			status: errorBody.statusCode,
			headers: { "Content-Type": "application/json", ...rateLimitHeaders },
		});
	}

	const requestUrl = new URL(request.url);
	const origin = requestUrl.origin;
	const isBatch = options?.forceBatch || Array.isArray(body);
	const isAsyncRequested =
		request.headers.get("x-mailhub-async") === "true" ||
		requestUrl.searchParams.get("async") === "true" ||
		(typeof body === "object" && body !== null && (body as any).async === true);

	// --- Batch Send Flow ---
	if (isBatch) {
		const parsedBatch = batchEmailSchema.safeParse(body);
		if (!parsedBatch.success) {
			const errorBody = formatZodError(parsedBatch.error);
			return Response.json(errorBody, {
				status: errorBody.statusCode,
				headers: { "Content-Type": "application/json", ...rateLimitHeaders },
			});
		}

		if (isAsyncRequested) {
			const subPayloadsList: NormalizedSendPayload[] = [];
			for (const item of parsedBatch.data) {
				const normalized = normalizePayload(item);
				subPayloadsList.push(...handleRecipientSplitting(normalized));
			}
			const enqueuedResults = await enqueueEmailBatch(
				env,
				auth.projectId || "default",
				auth.projectSlug || "default",
				subPayloadsList,
				{ routingKeyId: auth.keyId },
			);
			return Response.json(
				{ data: enqueuedResults.map((r) => ({ id: r.id, status: r.status })) },
				{
					status: 202,
					headers: { "Content-Type": "application/json", ...rateLimitHeaders },
				},
			);
		}

		try {
			const results: ResendSuccessResponse[] = [];
			for (const item of parsedBatch.data) {
				const normalized = normalizePayload(item);
				const subPayloads = handleRecipientSplitting(normalized);
				for (const sub of subPayloads) {
					const res = await sendSingleNormalizedMessage(env, sub, auth, origin);
					results.push(res);
				}
			}

			const responseBody: ResendBatchSuccessResponse = {
				data: results.map((r) => ({ id: r.id, messageId: r.messageId })),
			};

			return Response.json(responseBody, {
				status: 200,
				headers: { "Content-Type": "application/json", ...rateLimitHeaders },
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : "Batch sending failed";
			const statusCode = (err as any)?.statusCode || getSendErrorStatus(message);
			const errorBody: ResendErrorResponse = {
				name: (err as any)?.name || "batch_send_error",
				message,
				statusCode,
				error: message,
			};
			return Response.json(errorBody, {
				status: statusCode,
				headers: { "Content-Type": "application/json", ...rateLimitHeaders },
			});
		}
	}

	// --- Single Send Flow ---
	const parsedSingle = singleEmailSchema.safeParse(body);
	if (!parsedSingle.success) {
		const errorBody = formatZodError(parsedSingle.error);
		return Response.json(errorBody, {
			status: errorBody.statusCode,
			headers: { "Content-Type": "application/json", ...rateLimitHeaders },
		});
	}

	try {
		const normalized = normalizePayload(parsedSingle.data);
		const payloads = handleRecipientSplitting(normalized);

		if (isAsyncRequested) {
			if (payloads.length > 1) {
				const enqueuedBatch = await enqueueEmailBatch(
					env,
					auth.projectId || "default",
					auth.projectSlug || "default",
					payloads,
					{ routingKeyId: auth.keyId },
				);
				return Response.json(
					{
						id: enqueuedBatch[0]?.id,
						status: "queued",
					},
					{
						status: 202,
						headers: { "Content-Type": "application/json", ...rateLimitHeaders },
					},
				);
			}

			const enqueued = await enqueueEmailJob(
				env,
				auth.projectId || "default",
				auth.projectSlug || "default",
				payloads[0],
				{ routingKeyId: auth.keyId },
			);
			return Response.json(
				{
					id: enqueued.id,
					status: "queued",
				},
				{
					status: 202,
					headers: { "Content-Type": "application/json", ...rateLimitHeaders },
				},
			);
		}

		// If split into multiple chunks/messages, dispatch all and return the primary/first id
		const results: ResendSuccessResponse[] = [];
		for (const p of payloads) {
			const res = await sendSingleNormalizedMessage(env, p, auth, origin);
			results.push(res);
		}

		const primary = results[0];

		// Return standardized Resend output { id: string }
		return Response.json(
			{
				id: primary.id,
				messageId: primary.messageId,
				scheduled: primary.scheduled,
				scheduledAt: primary.scheduledAt,
			},
			{
				status: 200,
				headers: { "Content-Type": "application/json", ...rateLimitHeaders },
			},
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Email send failed";
		const statusCode = (err as any)?.statusCode || getSendErrorStatus(message);
		const errorBody: ResendErrorResponse = {
			name: (err as any)?.name || "send_failed",
			message,
			statusCode,
			error: message,
		};
		return Response.json(errorBody, {
			status: statusCode,
			headers: { "Content-Type": "application/json", ...rateLimitHeaders },
		});
	}
}
