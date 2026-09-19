/**
 * MailHub Drop-in Compatible Ingestion API - Zod Validators
 * Validates Resend, Brevo, and standard RFC 5322 payloads.
 */

import { z } from "zod";
import type { ResendErrorResponse } from "./types";

const recipientObjectSchema = z.object({
	email: z.string().min(3).max(320),
	name: z.string().max(255).optional(),
});

export const recipientListSchema = z.union([
	z.string().min(1).max(5000),
	z.array(z.string().min(1).max(320)),
	z.array(recipientObjectSchema),
]);

export const attachmentInputSchema = z.object({
	filename: z.string().max(255).optional(),
	name: z.string().max(255).optional(),
	content: z.any().optional(),
	contentBase64: z.string().optional(),
	path: z.string().optional(),
	type: z.string().max(255).optional(),
	content_type: z.string().max(255).optional(),
	disposition: z.enum(["attachment", "inline"]).optional(),
	content_id: z.string().max(255).optional(),
	cid: z.string().max(255).optional(),
	id: z.string().max(255).optional(),
}).refine(
	(data) => !!(data.content !== undefined || data.contentBase64 || data.path),
	{ message: "Attachment must provide content, contentBase64, or path" },
);

export const tagSchema = z.union([
	z.object({
		name: z.string().min(1).max(256),
		value: z.string().max(256),
	}),
	z.string().max(256),
]);

export const singleEmailSchema = z.object({
	// Sender field: 'from' (Resend) or 'sender' (Brevo) or 'From' (RFC 5322)
	from: z.string().min(3).max(500).optional(),
	sender: recipientObjectSchema.optional(),
	From: z.string().min(3).max(500).optional(),

	// Recipients
	to: recipientListSchema.optional(),
	To: recipientListSchema.optional(),

	// Subject
	subject: z.string().min(1).max(998).optional(),
	Subject: z.string().min(1).max(998).optional(),

	// Body content
	html: z.string().max(5 * 1024 * 1024).optional(),
	htmlContent: z.string().max(5 * 1024 * 1024).optional(),
	text: z.string().max(5 * 1024 * 1024).optional(),
	textContent: z.string().max(5 * 1024 * 1024).optional(),

	// Secondary recipients
	cc: recipientListSchema.optional(),
	Cc: recipientListSchema.optional(),
	bcc: recipientListSchema.optional(),
	Bcc: recipientListSchema.optional(),

	// Reply-To variants
	reply_to: z.union([z.string(), z.array(z.string()), recipientObjectSchema]).optional(),
	replyTo: z.union([z.string(), z.array(z.string()), recipientObjectSchema]).optional(),
	"Reply-To": z.union([z.string(), z.array(z.string()), recipientObjectSchema]).optional(),

	// Threading
	in_reply_to: z.string().max(998).optional(),
	inReplyTo: z.string().max(998).optional(),
	"In-Reply-To": z.string().max(998).optional(),
	references: z.union([z.string(), z.array(z.string())]).optional(),
	References: z.union([z.string(), z.array(z.string())]).optional(),

	// Attachments
	attachments: z.array(attachmentInputSchema).max(25).optional(),
	attachment: z.array(attachmentInputSchema).max(25).optional(),

	// Headers & Tags
	headers: z.record(z.string(), z.string()).optional(),
	Headers: z.record(z.string(), z.string()).optional(),
	tags: z.union([z.array(tagSchema), z.record(z.string(), z.string())]).optional(),

	// Scheduling & Orbitflare specific
	scheduled_at: z.string().optional(),
	scheduledAt: z.string().optional(),
	mailboxId: z.string().max(200).optional(),
	mailbox_id: z.string().max(200).optional(),
	split: z.boolean().optional(),

	// Raw RFC 5322 MIME
	raw: z.any().optional(),
}).refine(
	(data) => !!(data.from || data.sender || data.From || data.raw),
	{ message: "The 'from' field is required" },
).refine(
	(data) => !!(data.to || data.To || data.raw),
	{ message: "The 'to' field is required" },
).refine(
	(data) => !!(data.subject !== undefined || data.Subject !== undefined || data.raw),
	{ message: "The 'subject' field is required" },
);

export const batchEmailSchema = z.array(singleEmailSchema).min(1).max(100);

export const ingestionPayloadSchema = z.union([
	batchEmailSchema,
	singleEmailSchema,
]);

/**
 * Format a Zod validation error into a Resend-compatible error response
 */
export function formatZodError(error: z.ZodError): ResendErrorResponse {
	const firstIssue = error.issues[0];
	const field = firstIssue?.path.join(".") || "payload";
	const message = firstIssue?.message || "Invalid email payload";
	const detailedMessage = field && field !== "payload" ? `${field}: ${message}` : message;

	return {
		name: "validation_error",
		message: detailedMessage,
		statusCode: 422,
		error: detailedMessage,
	};
}
