/**
 * OrbitMails / MailHub - Webhook Payload Normalizer Suite
 * @module lib/mailhub/webhooks/normalizer
 *
 * Normalizes vendor-specific webhook payloads from Resend, Brevo, SES, Mailgun, and ZeptoMail
 * into the standardized OrbitMails / MailHub event format:
 * { eventType: "delivered" | "bounced" | "complaint" | "opened" | "clicked", providerMessageId, recipient, timestamp, reason }
 */

import type {
	BounceSeverity,
	NormalizedWebhookEvent,
	NormalizedWebhookEventType,
	SupportedWebhookProvider,
} from "./types";

/**
 * Strips angle brackets from message IDs if present (<id@domain> -> id@domain).
 */
export function cleanMessageId(id?: string | null): string {
	if (!id) return "";
	return id.trim().replace(/^<|>$/g, "");
}

/**
 * Sanitizes and normalizes an email address.
 */
export function sanitizeEmail(email?: string | null): string {
	if (!email) return "";
	return email.trim().toLowerCase();
}

/**
 * Resend Webhook Payload Normalizer
 */
export function normalizeResendPayload(payload: any): NormalizedWebhookEvent[] {
	if (!payload || typeof payload !== "object") return [];

	const eventTypeStr = String(payload.type || "").toLowerCase();
	const data = payload.data || {};
	const providerMessageId = cleanMessageId(data.email_id || data.id || payload.id);
	const timestamp = payload.created_at ? new Date(payload.created_at) : new Date();

	// Resolve recipient
	const rawRecipients: string[] = Array.isArray(data.to)
		? data.to
		: typeof data.to === "string"
			? [data.to]
			: data.recipient
				? [data.recipient]
				: [];

	// Extract project id from tags or headers if available
	let projectId: string | undefined;
	if (data.tags && typeof data.tags === "object") {
		projectId = data.tags.project_id || data.tags.projectId;
	}
	if (!projectId && Array.isArray(data.headers)) {
		const headerObj = data.headers.find(
			(h: any) => h.name?.toLowerCase() === "x-project-id" || h.key?.toLowerCase() === "x-project-id",
		);
		if (headerObj) projectId = headerObj.value;
	}

	let eventType: NormalizedWebhookEventType;
	let subType: string | undefined;
	let reason: string | undefined;

	switch (eventTypeStr) {
		case "email.delivered":
			eventType = "delivered";
			break;

		case "email.bounced": {
			eventType = "bounced";
			const bounceType = data.bounce?.type?.toLowerCase();
			subType = bounceType === "permanent" || bounceType === "hard" ? "hard" : "soft";
			reason = data.bounce?.message || data.bounce?.sub_type || "Recipient email bounced";
			break;
		}

		case "email.complained":
			eventType = "complaint";
			subType = data.complaint?.type || "abuse";
			reason = data.complaint?.message || "Recipient flagged email as spam";
			break;

		case "email.opened":
			eventType = "opened";
			break;

		case "email.clicked":
			eventType = "clicked";
			break;

		default:
			// Non-monitored events (e.g. email.sent)
			return [];
	}

	const recipients = rawRecipients.length > 0 ? rawRecipients : ["unknown@recipient.local"];

	return recipients.map((r) => ({
		eventType,
		provider: "resend",
		providerMessageId,
		recipient: sanitizeEmail(r),
		timestamp,
		reason,
		subType,
		projectId,
		metadata: {
			clickLink: data.click?.link,
			userAgent: data.click?.user_agent || data.open?.user_agent,
		},
		rawEvent: payload,
	}));
}

/**
 * Brevo (Sendinblue) Webhook Payload Normalizer
 */
export function normalizeBrevoPayload(payload: any): NormalizedWebhookEvent[] {
	if (!payload) return [];

	// Brevo can send either a single object or an array of event objects
	const items = Array.isArray(payload) ? payload : [payload];
	const results: NormalizedWebhookEvent[] = [];

	for (const item of items) {
		if (!item || typeof item !== "object") continue;

		const eventStr = String(item.event || "").toLowerCase();
		const providerMessageId = cleanMessageId(item["message-id"] || item.message_id || item.id);
		const recipient = sanitizeEmail(item.email || item.recipient);
		const timestamp = item.date ? new Date(item.date) : new Date();

		// Extract project tag
		let projectId: string | undefined;
		if (typeof item.tag === "string") {
			projectId = item.tag;
		} else if (Array.isArray(item.tags) && item.tags.length > 0) {
			projectId = item.tags[0];
		} else if (typeof item["X-Mailin-custom"] === "string") {
			projectId = item["X-Mailin-custom"];
		}

		let eventType: NormalizedWebhookEventType;
		let subType: string | undefined;
		let reason: string | undefined = item.reason || item.description || undefined;

		switch (eventStr) {
			case "delivered":
				eventType = "delivered";
				break;

			case "hard_bounce":
			case "blocked":
			case "invalid_email":
				eventType = "bounced";
				subType = "hard";
				reason = reason || `Brevo bounce: ${eventStr}`;
				break;

			case "soft_bounce":
			case "deferred":
				eventType = "bounced";
				subType = "soft";
				reason = reason || `Brevo soft bounce: ${eventStr}`;
				break;

			case "spam":
			case "complaint":
				eventType = "complaint";
				subType = "abuse";
				reason = reason || "Spam complaint reported on Brevo";
				break;

			case "unsubscribed":
				eventType = "complaint";
				subType = "unsubscribe";
				reason = reason || "Recipient clicked unsubscribe";
				break;

			case "opened":
			case "unique_opened":
				eventType = "opened";
				break;

			case "click":
			case "clicked":
				eventType = "clicked";
				break;

			default:
				// Skip "request", "sent", etc.
				continue;
		}

		results.push({
			eventType,
			provider: "brevo",
			providerMessageId,
			recipient,
			timestamp,
			reason,
			subType,
			projectId,
			metadata: {
				ip: item.ip,
				link: item.link,
				ts_event: item.ts_event,
			},
			rawEvent: item,
		});
	}

	return results;
}

/**
 * Amazon SES (via SNS or Event Destination) Webhook Payload Normalizer
 */
export function normalizeSesPayload(payload: any): NormalizedWebhookEvent[] {
	if (!payload || typeof payload !== "object") return [];

	// If this is an SNS Envelope, parse the inner JSON Message
	let data = payload;
	if (payload.Type === "Notification" && typeof payload.Message === "string") {
		try {
			data = JSON.parse(payload.Message);
		} catch {
			return [];
		}
	}

	const eventTypeStr = String(data.eventType || data.notificationType || "").toLowerCase();
	const mail = data.mail || {};
	const providerMessageId = cleanMessageId(mail.messageId);

	// Extract project id from mail tags or headers
	let projectId: string | undefined;
	if (mail.tags && typeof mail.tags === "object") {
		const tagVal = mail.tags.project_id || mail.tags.projectId;
		projectId = Array.isArray(tagVal) ? tagVal[0] : tagVal;
	}
	if (!projectId && Array.isArray(mail.headers)) {
		const h = mail.headers.find(
			(x: any) => x.name?.toLowerCase() === "x-project-id" || x.name?.toLowerCase() === "project-id",
		);
		if (h) projectId = h.value;
	}

	const results: NormalizedWebhookEvent[] = [];

	if (eventTypeStr === "delivery") {
		const recipients: string[] = data.delivery?.recipients || mail.destination || [];
		const timestamp = data.delivery?.timestamp ? new Date(data.delivery.timestamp) : new Date();

		for (const r of recipients) {
			results.push({
				eventType: "delivered",
				provider: "ses",
				providerMessageId,
				recipient: sanitizeEmail(r),
				timestamp,
				projectId,
				metadata: {
					processingTimeMillis: data.delivery?.processingTimeMillis,
					smtpResponse: data.delivery?.smtpResponse,
				},
				rawEvent: data,
			});
		}
	} else if (eventTypeStr === "bounce") {
		const bounce = data.bounce || {};
		const isHard = bounce.bounceType?.toLowerCase() === "permanent";
		const subType: BounceSeverity = isHard ? "hard" : "soft";
		const timestamp = bounce.timestamp ? new Date(bounce.timestamp) : new Date();

		const bouncedRecipients: Array<{ emailAddress?: string; diagnosticCode?: string }> =
			bounce.bouncedRecipients || [];

		if (bouncedRecipients.length > 0) {
			for (const bRec of bouncedRecipients) {
				results.push({
					eventType: "bounced",
					provider: "ses",
					providerMessageId,
					recipient: sanitizeEmail(bRec.emailAddress),
					timestamp,
					reason: bRec.diagnosticCode || bounce.bounceSubType || "Amazon SES Bounce",
					subType,
					projectId,
					metadata: {
						bounceType: bounce.bounceType,
						bounceSubType: bounce.bounceSubType,
						feedbackId: bounce.feedbackId,
					},
					rawEvent: data,
				});
			}
		} else {
			// Fallback to mail destination if bouncedRecipients is empty
			const recipients: string[] = mail.destination || [];
			for (const r of recipients) {
				results.push({
					eventType: "bounced",
					provider: "ses",
					providerMessageId,
					recipient: sanitizeEmail(r),
					timestamp,
					reason: bounce.bounceSubType || "Amazon SES Bounce",
					subType,
					projectId,
					rawEvent: data,
				});
			}
		}
	} else if (eventTypeStr === "complaint") {
		const complaint = data.complaint || {};
		const timestamp = complaint.timestamp ? new Date(complaint.timestamp) : new Date();
		const complainedRecipients: Array<{ emailAddress?: string }> = complaint.complainedRecipients || [];
		const recipients = complainedRecipients.length > 0
			? complainedRecipients.map((c) => c.emailAddress || "")
			: mail.destination || [];

		for (const r of recipients) {
			results.push({
				eventType: "complaint",
				provider: "ses",
				providerMessageId,
				recipient: sanitizeEmail(r),
				timestamp,
				reason: complaint.complaintFeedbackType || "Amazon SES Complaint",
				subType: complaint.complaintFeedbackType || "abuse",
				projectId,
				metadata: {
					userAgent: complaint.userAgent,
					feedbackId: complaint.feedbackId,
				},
				rawEvent: data,
			});
		}
	} else if (eventTypeStr === "open") {
		const recipients: string[] = mail.destination || [];
		const timestamp = data.open?.timestamp ? new Date(data.open.timestamp) : new Date();
		for (const r of recipients) {
			results.push({
				eventType: "opened",
				provider: "ses",
				providerMessageId,
				recipient: sanitizeEmail(r),
				timestamp,
				projectId,
				metadata: {
					ipAddress: data.open?.ipAddress,
					userAgent: data.open?.userAgent,
				},
				rawEvent: data,
			});
		}
	} else if (eventTypeStr === "click") {
		const recipients: string[] = mail.destination || [];
		const timestamp = data.click?.timestamp ? new Date(data.click.timestamp) : new Date();
		for (const r of recipients) {
			results.push({
				eventType: "clicked",
				provider: "ses",
				providerMessageId,
				recipient: sanitizeEmail(r),
				timestamp,
				projectId,
				metadata: {
					link: data.click?.link,
					ipAddress: data.click?.ipAddress,
					userAgent: data.click?.userAgent,
				},
				rawEvent: data,
			});
		}
	}

	return results;
}

/**
 * Mailgun Webhook Payload Normalizer
 */
export function normalizeMailgunPayload(payload: any): NormalizedWebhookEvent[] {
	if (!payload || typeof payload !== "object") return [];

	const eventData = payload["event-data"] || payload;
	const eventStr = String(eventData.event || "").toLowerCase();
	const headers = eventData.message?.headers || {};
	const providerMessageId = cleanMessageId(headers["message-id"] || eventData.id);
	const recipient = sanitizeEmail(eventData.recipient);
	const timestamp = eventData.timestamp
		? new Date(typeof eventData.timestamp === "number" ? eventData.timestamp * 1000 : eventData.timestamp)
		: new Date();

	// Extract project id from user-variables
	let projectId: string | undefined;
	const userVars = eventData["user-variables"] || eventData.user_variables;
	if (userVars && typeof userVars === "object") {
		projectId = userVars.project_id || userVars.projectId;
	}

	let eventType: NormalizedWebhookEventType;
	let subType: string | undefined;
	let reason: string | undefined;

	switch (eventStr) {
		case "delivered":
			eventType = "delivered";
			break;

		case "failed": {
			eventType = "bounced";
			const severity = String(eventData.severity || "").toLowerCase();
			subType = severity === "permanent" ? "hard" : "soft";
			const deliveryStatus = eventData["delivery-status"] || {};
			reason = deliveryStatus.message || deliveryStatus.description || eventData.reason || "Mailgun delivery failed";
			break;
		}

		case "complained":
			eventType = "complaint";
			subType = "abuse";
			reason = "Recipient filed a spam complaint on Mailgun";
			break;

		case "opened":
			eventType = "opened";
			break;

		case "clicked":
			eventType = "clicked";
			break;

		case "unsubscribed":
			eventType = "complaint";
			subType = "unsubscribe";
			reason = "Recipient unsubscribed";
			break;

		default:
			// Non-monitored event (e.g. accepted, routed)
			return [];
	}

	return [
		{
			eventType,
			provider: "mailgun",
			providerMessageId,
			recipient,
			timestamp,
			reason,
			subType,
			projectId,
			metadata: {
				clientInfo: eventData["client-info"],
				geolocation: eventData.geolocation,
				url: eventData.url,
			},
			rawEvent: payload,
		},
	];
}

/**
 * ZeptoMail Webhook Payload Normalizer
 */
export function normalizeZeptoMailPayload(payload: any): NormalizedWebhookEvent[] {
	if (!payload || typeof payload !== "object") return [];

	const eventStr = String(payload.event_name || payload.event || "").toLowerCase();
	const mailDetails = payload.mail_details || {};
	const providerMessageId = cleanMessageId(mailDetails.message_id || payload.message_id);
	const recipient = sanitizeEmail(payload.email_address || payload.recipient);
	const timestamp = payload.timestamp ? new Date(payload.timestamp) : new Date();

	let projectId: string | undefined;
	if (Array.isArray(mailDetails.tags)) {
		const tag = mailDetails.tags.find((t: any) => t.name === "project_id");
		if (tag) projectId = tag.value;
	}

	let eventType: NormalizedWebhookEventType;
	let subType: string | undefined;
	let reason: string | undefined = payload.reason || payload.diagnostic_code;

	switch (eventStr) {
		case "delivered":
			eventType = "delivered";
			break;

		case "hard_bounce":
		case "bounce":
			eventType = "bounced";
			subType = "hard";
			reason = reason || "Hard bounce";
			break;

		case "soft_bounce":
			eventType = "bounced";
			subType = "soft";
			reason = reason || "Soft bounce";
			break;

		case "spam":
			eventType = "complaint";
			subType = "abuse";
			reason = reason || "ZeptoMail spam complaint";
			break;

		case "open":
		case "opened":
			eventType = "opened";
			break;

		case "click":
		case "clicked":
			eventType = "clicked";
			break;

		default:
			return [];
	}

	return [
		{
			eventType,
			provider: "zeptomail",
			providerMessageId,
			recipient,
			timestamp,
			reason,
			subType,
			projectId,
			metadata: {
				url: payload.url,
				ip: payload.ip,
			},
			rawEvent: payload,
		},
	];
}

/**
 * Unified Payload Normalization Dispatcher
 */
export function normalizeWebhookPayload(
	provider: SupportedWebhookProvider,
	rawPayload: any,
): NormalizedWebhookEvent[] {
	switch (provider) {
		case "resend":
			return normalizeResendPayload(rawPayload);
		case "brevo":
			return normalizeBrevoPayload(rawPayload);
		case "ses":
			return normalizeSesPayload(rawPayload);
		case "mailgun":
			return normalizeMailgunPayload(rawPayload);
		case "zeptomail":
			return normalizeZeptoMailPayload(rawPayload);
		default:
			return [];
	}
}
