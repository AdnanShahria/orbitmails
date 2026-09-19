/**
 * MailHub Drop-in Compatible Ingestion API - Payload Normalizer
 * Normalizes Resend, Brevo, and RFC 5322 payloads into a canonical internal format.
 */

import { formatEmailAddress, getEmailAddress, splitEmailAddressList } from "@/lib/email/address";
import { decodeBase64Content, sanitizeFilename } from "@/lib/email/attachments";
import type {
	BrevoRecipient,
	BrevoSender,
	NormalizedAttachment,
	NormalizedSendPayload,
	RecipientInput,
	ResendAttachmentInput,
	ResendTag,
} from "./types";

/**
 * Decode various attachment content encodings into a standard ArrayBuffer
 */
export function normalizeAttachmentContent(
	rawContent: unknown,
	contentBase64?: string,
	path?: string,
): ArrayBuffer {
	// 1. Direct base64 string provided
	if (contentBase64 && typeof contentBase64 === "string") {
		return decodeBase64Content(contentBase64);
	}

	// 2. Data URI provided in content or path (e.g. "data:image/png;base64,iVBORw0KGgo...")
	const stringCandidate = typeof rawContent === "string" ? rawContent : typeof path === "string" ? path : null;
	if (stringCandidate && stringCandidate.startsWith("data:")) {
		const base64Index = stringCandidate.indexOf(";base64,");
		if (base64Index !== -1) {
			const b64Data = stringCandidate.slice(base64Index + 8);
			return decodeBase64Content(b64Data);
		}
	}

	// 3. ArrayBuffer directly
	if (rawContent instanceof ArrayBuffer) {
		return rawContent;
	}

	// 4. Uint8Array or Node.js Buffer
	if (rawContent instanceof Uint8Array) {
		return rawContent.buffer.slice(
			rawContent.byteOffset,
			rawContent.byteOffset + rawContent.byteLength,
		) as ArrayBuffer;
	}

	// 5. Node.js Buffer JSON representation: { type: "Buffer", data: [...] }
	if (
		typeof rawContent === "object" &&
		rawContent !== null &&
		"data" in rawContent &&
		Array.isArray((rawContent as any).data)
	) {
		const bytes = new Uint8Array((rawContent as any).data);
		return bytes.buffer;
	}

	// 6. Plain string: Check if base64 or encode as utf-8
	if (typeof rawContent === "string") {
		const trimmed = rawContent.trim();
		// If it looks like base64 without spaces/newlines
		if (/^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length % 4 === 0 && trimmed.length > 20) {
			try {
				return decodeBase64Content(trimmed);
			} catch {
				// Fallback to utf-8 if atob fails
			}
		}
		return new TextEncoder().encode(rawContent).buffer;
	}

	return new ArrayBuffer(0);
}

/**
 * Normalize an attachment input into canonical form
 */
export function normalizeAttachment(attachment: ResendAttachmentInput): NormalizedAttachment {
	const filename = sanitizeFilename(attachment.filename || attachment.name || "attachment");
	const type = attachment.type || attachment.content_type || "application/octet-stream";
	const disposition = attachment.disposition || (attachment.content_id || attachment.cid ? "inline" : "attachment");
	const contentId = attachment.content_id || attachment.cid || null;
	const content = normalizeAttachmentContent(attachment.content, attachment.contentBase64, attachment.path);

	return {
		filename,
		type,
		content,
		disposition,
		contentId,
	};
}

/**
 * Normalizes recipient inputs (strings, array of strings, or Brevo object arrays)
 * into a clean list of formatted email addresses ("Name <email@domain.com>" or "email@domain.com")
 */
export function normalizeRecipientList(recipients?: RecipientInput): string[] {
	if (!recipients) return [];

	if (typeof recipients === "string") {
		return splitEmailAddressList(recipients).map((r) => r.trim()).filter(Boolean);
	}

	if (Array.isArray(recipients)) {
		const result: string[] = [];
		for (const item of recipients) {
			if (typeof item === "string") {
				const split = splitEmailAddressList(item);
				result.push(...split.map((s) => s.trim()).filter(Boolean));
			} else if (typeof item === "object" && item !== null && "email" in item) {
				const email = (item as BrevoRecipient).email.trim();
				const name = (item as BrevoRecipient).name?.trim();
				if (email) {
					result.push(name ? formatEmailAddress(email, name) : email);
				}
			}
		}
		return result;
	}

	return [];
}

/**
 * Normalizes sender into "Name <email@domain.com>" or "email@domain.com"
 */
export function normalizeSender(
	from?: string,
	sender?: BrevoSender | null,
	fromCapital?: string,
): string {
	if (from && typeof from === "string") {
		return from.trim();
	}
	if (fromCapital && typeof fromCapital === "string") {
		return fromCapital.trim();
	}
	if (sender && typeof sender === "object" && sender.email) {
		const email = sender.email.trim();
		const name = sender.name?.trim();
		return name ? formatEmailAddress(email, name) : email;
	}
	return "";
}

/**
 * Normalizes Reply-To field
 */
export function normalizeReplyTo(replyTo?: unknown): string | undefined {
	if (!replyTo) return undefined;
	if (typeof replyTo === "string") {
		return replyTo.trim();
	}
	if (Array.isArray(replyTo)) {
		return replyTo.map((r) => (typeof r === "string" ? r.trim() : (r as any).email)).filter(Boolean).join(", ");
	}
	if (typeof replyTo === "object" && replyTo !== null && "email" in replyTo) {
		const email = (replyTo as any).email.trim();
		const name = (replyTo as any).name?.trim();
		return name ? formatEmailAddress(email, name) : email;
	}
	return undefined;
}

/**
 * Normalizes tags into an array of { name, value } objects
 */
export function normalizeTags(tags?: unknown): ResendTag[] {
	if (!tags) return [];
	if (Array.isArray(tags)) {
		const result: ResendTag[] = [];
		for (const t of tags) {
			if (typeof t === "string") {
				result.push({ name: t, value: "true" });
			} else if (typeof t === "object" && t !== null && "name" in t) {
				result.push({ name: String((t as any).name), value: String((t as any).value ?? "") });
			}
		}
		return result;
	}
	if (typeof tags === "object" && tags !== null) {
		return Object.entries(tags).map(([name, value]) => ({
			name,
			value: String(value),
		}));
	}
	return [];
}

/**
 * Normalizes any incoming email payload into canonical NormalizedSendPayload
 */
export function normalizePayload(raw: any): NormalizedSendPayload {
	if (!raw || typeof raw !== "object") {
		throw new Error("Payload must be a valid JSON object");
	}

	const from = normalizeSender(raw.from, raw.sender, raw.From);
	const to = normalizeRecipientList(raw.to || raw.To);
	const cc = normalizeRecipientList(raw.cc || raw.Cc);
	const bcc = normalizeRecipientList(raw.bcc || raw.Bcc);
	const subject = (raw.subject || raw.Subject || "").trim();

	const html = raw.html || raw.htmlContent || undefined;
	const text = raw.text || raw.textContent || undefined;

	// Normalize attachments
	const rawAttachments = raw.attachments || raw.attachment || [];
	const attachments: NormalizedAttachment[] = Array.isArray(rawAttachments)
		? rawAttachments.map(normalizeAttachment)
		: [];

	// Normalize headers
	const headers: Record<string, string> = {
		...(raw.headers || raw.Headers || {}),
	};

	// Normalizing Reply-To
	const replyTo = normalizeReplyTo(raw.reply_to || raw.replyTo || raw["Reply-To"]);
	if (replyTo && !headers["Reply-To"]) {
		headers["Reply-To"] = replyTo;
	}

	// Normalizing In-Reply-To & References
	const inReplyTo = raw.in_reply_to || raw.inReplyTo || raw["In-Reply-To"];
	const references = raw.references || raw.References;

	// Normalizing tags & injecting tag headers
	const tags = normalizeTags(raw.tags);
	for (const tag of tags) {
		headers[`X-MailHub-Tag-${tag.name}`] = tag.value;
	}

	const scheduledAt = raw.scheduled_at || raw.scheduledAt;
	const mailboxId = raw.mailboxId || raw.mailbox_id;
	const splitRecipients = !!raw.split;

	return {
		from,
		to,
		cc,
		bcc,
		subject,
		html,
		text,
		attachments,
		headers,
		replyTo,
		inReplyTo,
		references,
		tags,
		scheduledAt,
		mailboxId,
		splitRecipients,
		rawMime: typeof raw.raw === "string" ? raw.raw : undefined,
	};
}
