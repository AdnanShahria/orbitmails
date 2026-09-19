/**
 * MailHub Drop-in Compatible Ingestion API - Type Definitions
 * Compatible with Resend, Brevo, and RFC 5322 payloads.
 */

import type { AttachmentContent } from "@/lib/email/attachment-types";

export interface ResendAttachmentInput {
	filename?: string;
	name?: string;
	content?: string | ArrayBuffer | Uint8Array | { type: "Buffer"; data: number[] };
	contentBase64?: string;
	path?: string;
	type?: string;
	content_type?: string;
	disposition?: "attachment" | "inline";
	content_id?: string;
	cid?: string;
	id?: string;
}

export type RecipientInput =
	| string
	| string[]
	| Array<{ email: string; name?: string }>;

export interface ResendTag {
	name: string;
	value: string;
}

export interface ResendSendPayload {
	from: string;
	to: RecipientInput;
	subject: string;
	html?: string;
	text?: string;
	cc?: RecipientInput;
	bcc?: RecipientInput;
	reply_to?: string | string[] | { email: string; name?: string };
	replyTo?: string | string[] | { email: string; name?: string };
	attachments?: ResendAttachmentInput[];
	headers?: Record<string, string>;
	tags?: ResendTag[] | Record<string, string> | string[];
	scheduled_at?: string;
	scheduledAt?: string;
	mailboxId?: string;
	mailbox_id?: string;
	split?: boolean;
}

export interface BrevoSender {
	name?: string;
	email: string;
}

export interface BrevoRecipient {
	name?: string;
	email: string;
}

export interface BrevoAttachment {
	name?: string;
	filename?: string;
	content?: string;
	url?: string;
}

export interface BrevoSendPayload {
	sender?: BrevoSender;
	from?: string;
	to: BrevoRecipient[] | string | string[];
	subject: string;
	htmlContent?: string;
	textContent?: string;
	html?: string;
	text?: string;
	cc?: BrevoRecipient[] | string | string[];
	bcc?: BrevoRecipient[] | string | string[];
	replyTo?: BrevoSender | string | string[];
	reply_to?: BrevoSender | string | string[];
	attachment?: BrevoAttachment[];
	attachments?: ResendAttachmentInput[];
	headers?: Record<string, string>;
	tags?: string[] | ResendTag[];
	params?: Record<string, any>;
}

export interface Rfc5322SendPayload {
	From?: string;
	To?: RecipientInput;
	Subject?: string;
	Cc?: RecipientInput;
	Bcc?: RecipientInput;
	"Reply-To"?: string | string[];
	"In-Reply-To"?: string;
	References?: string | string[];
	Headers?: Record<string, string>;
	raw?: string | ArrayBuffer | Uint8Array;
}

export interface NormalizedAttachment {
	filename: string;
	type: string;
	content: ArrayBuffer;
	disposition: "attachment" | "inline";
	contentId?: string | null;
}

export interface NormalizedSendPayload {
	from: string;
	to: string[];
	cc: string[];
	bcc: string[];
	subject: string;
	html?: string;
	text?: string;
	attachments: NormalizedAttachment[];
	headers: Record<string, string>;
	replyTo?: string;
	inReplyTo?: string;
	references?: string | string[];
	tags?: ResendTag[];
	scheduledAt?: string;
	mailboxId?: string;
	splitRecipients?: boolean;
	rawMime?: string;
}

export interface IngestionAuthResult {
	userId: string;
	projectId?: string;
	projectSlug?: string;
	environment?: "live" | "test";
	keyId?: string;
	keyKind: "project" | "legacy" | "mcp" | "device";
	scopes: string[];
	mailboxIds: string[] | null;
	rateLimitHeaders?: Record<string, string>;
}

export interface ResendSuccessResponse {
	id: string;
	messageId?: string;
	scheduled?: boolean;
	scheduledAt?: string;
}

export interface ResendBatchSuccessResponse {
	data: ResendSuccessResponse[];
}

export interface ResendErrorResponse {
	name: string;
	message: string;
	statusCode: number;
	error?: string;
}
