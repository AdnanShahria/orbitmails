/**
 * OrbitMails / MailHub - Webhook Central Processing Pipeline
 * @module lib/mailhub/webhooks/processor
 *
 * Orchestrates the complete end-to-end webhook ingestion lifecycle:
 * 1. Cryptographic Signature Verification
 * 2. Multi-Vendor Payload Normalization
 * 3. Send Log Status Updates in D1 (`send_log` and `messages`)
 * 4. Automatic Suppression List Maintenance (Hard Bounces & Complaints)
 * 5. Real-Time Provider Health Tracking & Down-Ranking (>5% Bounce Rate alerts)
 * 6. Audit Logging in `mailhub_webhook_events`
 */

import { newId } from "@/lib/ids";
import { normalizeWebhookPayload } from "./normalizer";
import { recordSuppression } from "./suppression";
import { trackProviderEventHealth } from "./health-tracker";
import { verifyProviderWebhook } from "./verify";
import type {
	NormalizedWebhookEvent,
	SupportedWebhookProvider,
	WebhookProcessingResult,
} from "./types";

/**
 * Ensures audit webhook events table exists in D1.
 */
export async function ensureWebhookEventsTable(db: any): Promise<void> {
	if (!db) return;
	try {
		await db.exec(`
			CREATE TABLE IF NOT EXISTS mailhub_webhook_events (
				id TEXT PRIMARY KEY,
				provider TEXT NOT NULL,
				event_type TEXT NOT NULL,
				provider_message_id TEXT,
				recipient TEXT NOT NULL,
				reason TEXT,
				sub_type TEXT,
				project_id TEXT,
				raw_payload TEXT,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
			);
			CREATE INDEX IF NOT EXISTS mailhub_webhook_events_msg_idx ON mailhub_webhook_events(provider_message_id);
			CREATE INDEX IF NOT EXISTS mailhub_webhook_events_recipient_idx ON mailhub_webhook_events(recipient);
		`);
	} catch {}
}

/**
 * Updates send log and messages tables in D1.
 */
export async function updateSendLogStatus(
	db: any,
	event: NormalizedWebhookEvent,
): Promise<{ updatedSendLog: boolean; updatedMessages: boolean }> {
	if (!db || !event.providerMessageId) {
		return { updatedSendLog: false, updatedMessages: false };
	}

	let updatedSendLog = false;
	let updatedMessages = false;

	// Map unified eventType to send_log status string
	let logStatus = event.eventType as string;
	if (event.eventType === "bounced") {
		logStatus = event.subType === "hard" ? "hard_bounce" : "soft_bounce";
	}

	// 1. Update MailHub `send_log` table
	try {
		const res = await db
			.prepare(`
				UPDATE send_log 
				SET status = ?, error = coalesce(?, error), updated_at = CURRENT_TIMESTAMP
				WHERE provider_message_id = ? OR id = ?
			`)
			.bind(logStatus, event.reason ?? null, event.providerMessageId, event.providerMessageId)
			.run();

		if (res && res.changes && res.changes > 0) {
			updatedSendLog = true;
		}
	} catch (err) {
		// Table may not exist yet or running in migration mode
	}

	// 2. Update OrbitMails core `messages` table
	try {
		const messageStatus = event.eventType === "delivered" ? "sent" : event.eventType;
		const res = await db
			.prepare(`
				UPDATE messages 
				SET status = ? 
				WHERE provider_message_id = ? OR id = ?
			`)
			.bind(messageStatus, event.providerMessageId, event.providerMessageId)
			.run();

		if (res && res.changes && res.changes > 0) {
			updatedMessages = true;
		}
	} catch (err) {
		// Ignore if column doesn't match
	}

	return { updatedSendLog, updatedMessages };
}

/**
 * Main Webhook Processing Pipeline
 */
export async function processInboundWebhook(
	provider: SupportedWebhookProvider,
	request: Request,
	rawBody: string,
	env: any,
	options?: { skipVerification?: boolean },
): Promise<WebhookProcessingResult> {
	// 1. Verify Signature
	if (!options?.skipVerification) {
		const verification = await verifyProviderWebhook(provider, request, rawBody, env);
		if (!verification.valid) {
			return {
				success: false,
				provider,
				processedCount: 0,
				events: [],
				suppressionsAdded: 0,
				healthUpdated: false,
				error: verification.error || "Webhook signature verification failed",
			};
		}
	}

	// 2. Parse Raw JSON Payload
	let parsedBody: any;
	try {
		parsedBody = JSON.parse(rawBody);
	} catch {
		return {
			success: false,
			provider,
			processedCount: 0,
			events: [],
			suppressionsAdded: 0,
			healthUpdated: false,
			error: "Malformed JSON payload",
		};
	}

	// 3. Normalize Events
	const events = normalizeWebhookPayload(provider, parsedBody);
	if (events.length === 0) {
		return {
			success: true,
			provider,
			processedCount: 0,
			events: [],
			suppressionsAdded: 0,
			healthUpdated: false,
		};
	}

	const db = env?.DB;
	if (db) {
		await ensureWebhookEventsTable(db);
	}

	let suppressionsAdded = 0;
	const alerts: string[] = [];

	// 4. Process Each Normalized Event
	for (const event of events) {
		// A. Update Send Log Status in D1
		if (db) {
			await updateSendLogStatus(db, event);

			// Record in mailhub_webhook_events audit table
			try {
				const auditId = newId("whe");
				await db
					.prepare(`
						INSERT INTO mailhub_webhook_events (
							id, provider, event_type, provider_message_id, recipient,
							reason, sub_type, project_id, raw_payload, created_at
						) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
					`)
					.bind(
						auditId,
						event.provider,
						event.eventType,
						event.providerMessageId || null,
						event.recipient,
						event.reason || null,
						event.subType || null,
						event.projectId || null,
						JSON.stringify(event.rawEvent || {}),
					)
					.run();
			} catch {}
		}

		// B. Automatic Suppression (Hard Bounces & Complaints)
		const isHardBounce = event.eventType === "bounced" && event.subType === "hard";
		const isComplaint = event.eventType === "complaint";

		if (isHardBounce || isComplaint) {
			const reason = isHardBounce ? "hard_bounce" : "complaint";
			await recordSuppression(env, {
				recipient: event.recipient,
				reason,
				subType: event.subType,
				projectId: event.projectId ?? null,
				provider: event.provider,
				details: event.reason,
			});
			suppressionsAdded += 1;
		}

		// C. Track Provider Health & Down-ranking (>5% Bounce Rate)
		try {
			const health = await trackProviderEventHealth(
				env,
				event.provider,
				event.eventType,
				event.subType,
			);
			if (health.alertTriggered && health.alertMessage) {
				alerts.push(health.alertMessage);
			}
		} catch (err) {
			console.warn("[MailHub Webhook] Health tracking error:", err);
		}
	}

	return {
		success: true,
		provider,
		processedCount: events.length,
		events,
		suppressionsAdded,
		healthUpdated: true,
		alerts: alerts.length > 0 ? alerts : undefined,
	};
}
