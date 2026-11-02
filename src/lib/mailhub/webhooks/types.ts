/**
 * OrbitMails / MailHub - Webhook Normalization & Bounce/Complaint Tracking Types
 * @module lib/mailhub/webhooks/types
 */

export type NormalizedWebhookEventType =
	| "delivered"
	| "bounced"
	| "complaint"
	| "opened"
	| "clicked";

export type BounceSeverity = "hard" | "soft";

export type SupportedWebhookProvider =
	| "resend"
	| "brevo"
	| "ses"
	| "mailgun"
	| "zeptomail";

export interface NormalizedWebhookEvent {
	/** Unified event type */
	eventType: NormalizedWebhookEventType;
	/** Upstream email service provider that emitted the event */
	provider: SupportedWebhookProvider;
	/** Unique Message-ID assigned by the upstream provider or mail platform */
	providerMessageId: string;
	/** Lowercased, sanitized recipient email address */
	recipient: string;
	/** Timestamp when the event occurred */
	timestamp: Date;
	/** Diagnostic reason, error message, or SMTP reply code (if applicable) */
	reason?: string;
	/** Detailed classification (e.g. 'hard' | 'soft' bounce, 'abuse' complaint, 'unsubscribe') */
	subType?: string;
	/** Project ID associated with the email (e.g. 'proj_aurelia') if present in tags/headers */
	projectId?: string;
	/** Optional metadata (links clicked, user-agent, IP, custom tags) */
	metadata?: Record<string, unknown>;
	/** Raw original event object from provider */
	rawEvent?: unknown;
}

export interface WebhookVerificationResult {
	valid: boolean;
	error?: string;
}

export interface WebhookProcessingResult {
	success: boolean;
	provider: SupportedWebhookProvider;
	processedCount: number;
	events: NormalizedWebhookEvent[];
	suppressionsAdded: number;
	healthUpdated: boolean;
	alerts?: string[];
	error?: string;
}

export interface SuppressionRecord {
	id: string;
	recipient: string;
	projectId?: string | null;
	reason: "hard_bounce" | "complaint" | "manual" | "unsubscribe";
	subType?: string | null;
	provider?: string | null;
	details?: string | null;
	createdAt: Date;
}

export interface ProviderHealthMetrics {
	provider: string;
	period: string; // e.g. "2026-11-02"
	totalSent: number;
	deliveredCount: number;
	bounceCount: number;
	hardBounceCount: number;
	softBounceCount: number;
	complaintCount: number;
	openedCount: number;
	clickedCount: number;
	bounceRate: number; // 0.0 to 1.0 (e.g. 0.05 = 5%)
	complaintRate: number; // 0.0 to 1.0 (e.g. 0.001 = 0.1%)
	healthScore: number; // 0.0 to 1.0
	status: "healthy" | "degraded" | "circuit_broken";
	alertTriggered?: boolean;
	alertMessage?: string;
}
