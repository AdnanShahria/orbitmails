/**
 * MailHub Drop-in Compatible Ingestion API - Core Service Pipeline
 * Handles validation, domain authorization, auto-provisioning, recipient splitting,
 * and dispatching via MailHub / Orbitmails outbound engine.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { mailboxes } from "@/db/schema";
import { newId } from "@/lib/ids";
import { getEmailAddress, getEmailDisplayName } from "@/lib/email/address";
import { sendEmail, type SendEmailInput } from "@/lib/email/send";
import { readJsonBody } from "@/lib/http/request";
import { RequestBodyTooLargeError } from "@/lib/http/errors";
import { getSendErrorStatus } from "@/app/api/send/error-utils";
import {
	authenticateIngestionRequest,
	authorizeDomainForProject,
} from "./auth";
import { enqueueEmailBatch, enqueueEmailJob } from "@/lib/mailhub/high-throughput";
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

	// 4. Construct SendEmailInput
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
