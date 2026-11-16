import type { InboundQueueMessage } from "./src/lib/email/inbound";
import type { OutboundQueueMessage } from "./src/lib/email/send";
import type { WebhookRetryMessage } from "./src/lib/email/webhooks";
import type { ImportJobMessage } from "./src/lib/import/jobs-types";
import type { QueuedEmailJob } from "./src/lib/mailhub/high-throughput/types";

export function isInboundQueueMessage(payload: unknown): payload is InboundQueueMessage {
	return (
		typeof payload === "object" &&
		payload !== null &&
		"rawR2Key" in payload &&
		"from" in payload &&
		"to" in payload
	);
}

export function isWebhookRetryMessage(payload: unknown): payload is WebhookRetryMessage {
	return (
		typeof payload === "object" &&
		payload !== null &&
		(payload as { kind?: unknown }).kind === "webhook.retry" &&
		typeof (payload as { deliveryId?: unknown }).deliveryId === "string"
	);
}

export function isImportJobMessage(payload: unknown): payload is ImportJobMessage {
	return (
		typeof payload === "object" &&
		payload !== null &&
		(payload as { kind?: unknown }).kind === "import.run" &&
		typeof (payload as { jobId?: unknown }).jobId === "string"
	);
}

export function isOutboundEmailMessage(payload: unknown): payload is OutboundQueueMessage {
	if (typeof payload !== "object" || payload === null) return false;
	const kind = (payload as { kind?: unknown }).kind;
	return (kind === "email.scheduled" || kind === "email.retry") && typeof (payload as { jobId?: unknown }).jobId === "string";
}

export function isQueuedEmailJob(payload: unknown): payload is QueuedEmailJob {
	return (
		typeof payload === "object" &&
		payload !== null &&
		typeof (payload as { jobId?: unknown }).jobId === "string" &&
		typeof (payload as { projectId?: unknown }).projectId === "string" &&
		typeof (payload as { payload?: unknown }).payload === "object" &&
		(payload as { payload?: unknown }).payload !== null
	);
}
