import { withDatabase } from "./src/db/with-database";
import { withStorage } from "./src/lib/storage";
import vinextHandler from "vinext/server/fetch-handler";
import {
	processInboundMessage,
	storeRawToR2,
	type InboundQueueMessage,
} from "./src/lib/email/inbound";
import { processOutboundQueue, type OutboundQueueMessage } from "./src/lib/email/send";
import { isImportJobMessage, isInboundQueueMessage, isWebhookRetryMessage } from "./worker-utils";
import { sweepOrphanedRawMail } from "./src/lib/email/raw-sweeper";
import { processImportJob, sweepImportJobs } from "./src/lib/import/jobs";
import { processWebhookRetry, type WebhookRetryMessage } from "./src/lib/email/webhooks";
import { resolveIncomingMail, forwardMessage } from "./src/lib/email/incoming";
import { getUserFromSession } from "./src/lib/auth/session";
import { getSessionTokenFromRequest } from "./src/lib/realtime/utils";
import { inboundAttachmentLimitReasonFromRaw } from "./src/lib/email/inbound-attachments";
import { hasValidSessionMutationOrigin } from "./src/lib/auth/origin";
import {
	getAccountForwardingDestination,
	isForwardedMarkerValid,
	ORBITFLARE_FORWARDED_HEADER,
} from "./src/lib/email/account-forwarding";
import { runScheduledDatabaseBackup } from "./src/lib/backups/runner";
import { processAgentDraftJob } from "./src/lib/agent/jobs/utils";
import { runAgentMaintenance } from "./src/lib/agent/maintenance";
import { runTrashRetention } from "./src/lib/email/trash-retention";
import { runDriveTrashRetention } from "./src/lib/drive/retention";
import { runAccountRetention } from "./src/lib/accounts/deletion";
import { runJmapChangeRetention } from "./src/lib/jmap/changes";
import { runFollowUpReminders } from "./src/lib/follow-ups/service";
import { runCalendarReminders } from "./src/lib/calendar/reminders";
export { RealtimeHub } from "./src/lib/realtime/hub";
export { QuotaCoordinator } from "./src/lib/router/quota-durable-object";
import { runHealthMonitoringJob, runDailyDigestJob } from "./src/lib/mailhub/monitoring";
import { processParallelQueueBatch, type QueuedEmailJob } from "./src/lib/mailhub/high-throughput";

export default {
	async fetch(request: Request, rawEnv: CloudflareEnv, ctx: ExecutionContext) {
		const env = withDatabase(withStorage(rawEnv));
		const url = new URL(request.url);
		if (url.pathname === "/api/realtime") {
			if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
				return new Response("Expected WebSocket upgrade", { status: 426 });
			}
			if (!hasValidSessionMutationOrigin(request)) {
				return new Response("Invalid origin", { status: 403 });
			}

			const user = await getUserFromSession(env, getSessionTokenFromRequest(request));
			if (!user || user.disabled) {
				return new Response("Unauthorized", { status: 401 });
			}

			const hub = env.REALTIME.getByName(user.id);
			const hubRequest = new Request("https://orbitflare-realtime/connect", request);
			hubRequest.headers.set("X-Orbitflare-Realtime-User", user.id);
			return hub.fetch(hubRequest);
		}

		// MailHub Drop-in Compatibility Rewrites:
		// Resend SDK: baseUrl = "https://mailhub.domain.com/v1" -> calls /v1/emails or /v1/emails/batch
		// Resend direct: baseUrl = "https://mailhub.domain.com" -> calls /emails or /emails/batch
		// Brevo SDK: basePath = "https://mailhub.domain.com/v3" -> calls /v3/smtp/email
		if (url.pathname.startsWith("/v1/")) {
			const rewrittenUrl = new URL(request.url);
			rewrittenUrl.pathname = `/api${url.pathname}`;
			return vinextHandler.fetch(new Request(rewrittenUrl.toString(), request), env, ctx);
		}
		if (url.pathname.startsWith("/emails")) {
			const rewrittenUrl = new URL(request.url);
			rewrittenUrl.pathname = `/api/v1${url.pathname}`;
			return vinextHandler.fetch(new Request(rewrittenUrl.toString(), request), env, ctx);
		}
		if (url.pathname === "/v3/smtp/email") {
			const rewrittenUrl = new URL(request.url);
			rewrittenUrl.pathname = "/api/v1/send";
			return vinextHandler.fetch(new Request(rewrittenUrl.toString(), request), env, ctx);
		}

		return vinextHandler.fetch(request, env, ctx);
	},

	async email(message: ForwardableEmailMessage, rawEnv: CloudflareEnv, ctx: ExecutionContext) {
		const env = withDatabase(withStorage(rawEnv));
		try {
			if (message.rawSize > 25 * 1024 * 1024) {
				message.setReject("Message rejected: raw email exceeds the 25 MiB receiving limit. Send a download link instead.");
				return;
			}
			// Domain routing rules are resolved here rather than in the queue because reject and
			// forward can only be actioned on the live ForwardableEmailMessage.
			const alreadyForwarded = await isForwardedMarkerValid(env, message.headers.get(ORBITFLARE_FORWARDED_HEADER));
			const decision = await resolveIncomingMail(env, message.from, message.to, {
				subject: message.headers.get("subject"),
				alreadyForwarded,
			});

			if (decision?.action === "reject") {
				message.setReject(decision.rejectReason ?? "Message rejected by routing rule");
				return;
			}
			const raw = await new Response(message.raw).arrayBuffer();
			const attachmentLimitReason = await inboundAttachmentLimitReasonFromRaw(raw);
			if (attachmentLimitReason) {
				message.setReject(attachmentLimitReason);
				return;
			}

			if (decision?.action === "forward" && decision.forwardTo) {
				const forwarded = await forwardMessage(env, message, decision.forwardTo);
				// A forward rule drops the message unless it was explicitly asked to keep a copy.
				// If the forward itself failed we still store it, so mail is never silently lost.
				if (forwarded && !decision.keepCopy) return;
			}

			if (!alreadyForwarded) {
				const forwardingDestination = await getAccountForwardingDestination(env, message.to);
				if (forwardingDestination) {
					await forwardMessage(env, message, forwardingDestination);
				}
			}
			const rawR2Key = await storeRawToR2(env, message.from, message.to, raw);
			const payload: InboundQueueMessage = {
				from: message.from,
				to: message.to,
				rawR2Key,
				headers: Object.fromEntries(message.headers),
			};
			await env.INBOUND_QUEUE.send(payload);
		} catch (err) {
			console.error("Inbound enqueue failed", err);
			message.setReject("Processing failed");
		}
	},

	async queue(batch: MessageBatch, rawEnv: CloudflareEnv): Promise<void> {
		const env = withDatabase(withStorage(rawEnv));

		// High-Throughput Optimization: Extract MailHub queued email jobs to process in parallel
		const mailhubJobs: { msg: Message; job: QueuedEmailJob }[] = [];
		const standardMessages: Message[] = [];
		for (const msg of batch.messages) {
			if (typeof msg.body === "object" && msg.body !== null && typeof (msg.body as any).jobId === "string" && (msg.body as any).payload && (msg.body as any).projectId) {
				mailhubJobs.push({ msg, job: msg.body as QueuedEmailJob });
			} else {
				standardMessages.push(msg);
			}
		}

		if (mailhubJobs.length > 0) {
			try {
				await processParallelQueueBatch(env, mailhubJobs.map((m) => m.job));
				for (const item of mailhubJobs) item.msg.ack();
			} catch (batchErr) {
				console.error("[MailHub HighThroughput] Queue batch processing failure, retrying messages:", batchErr);
				for (const item of mailhubJobs) item.msg.retry({ delaySeconds: 10 });
			}
		}

		for (const msg of standardMessages) {
			try {
				if (isInboundQueueMessage(msg.body)) {
					await processInboundMessage(env, msg.body);
				} else if (typeof msg.body === "object" && msg.body !== null && (msg.body as { kind?: unknown }).kind === "agent.draft" && typeof (msg.body as { jobId?: unknown }).jobId === "string") {
					await processAgentDraftJob(env, (msg.body as { jobId: string }).jobId);
				} else if (isWebhookRetryMessage(msg.body)) {
					await processWebhookRetry(env, msg.body as WebhookRetryMessage);
				} else if (isImportJobMessage(msg.body)) {
					await processImportJob(env, { ...msg.body, attempt: msg.attempts });
				} else if (typeof msg.body === "object" && msg.body !== null && (msg.body as { kind?: unknown }).kind === "email.scheduled") {
					await processOutboundQueue(env, msg.body as OutboundQueueMessage);
				} else {
					throw new Error("Unknown queue message type");
				}
				msg.ack();
			} catch (err) {
				console.error("Queue processing failed", {
					rawR2Key: isInboundQueueMessage(msg.body) ? msg.body.rawR2Key : undefined,
					recipient: isInboundQueueMessage(msg.body) ? msg.body.to : undefined,
					attempts: msg.attempts,
					error: err,
				});
				msg.retry({ delaySeconds: 10 });
			}
		}
	},

	async scheduled(controller: ScheduledController, rawEnv: CloudflareEnv, ctx: ExecutionContext) {
		const env = withDatabase(withStorage(rawEnv));
		const scheduledDate = new Date(controller.scheduledTime);
		const currentHour = scheduledDate.getUTCHours();
		const currentMinute = scheduledDate.getUTCMinutes();

		const isDaily2AM = controller.cron === "0 2 * * *" || (currentHour === 2 && currentMinute < 5);
		const isDaily8AM = controller.cron === "0 8 * * *" || (currentHour === 8 && currentMinute < 5);
		const isTenMinute = controller.cron === "*/10 * * * *" || currentMinute % 10 === 0;

		// Daily 02:00 AM UTC backup, sweeps, and deep retention
		if (isDaily2AM) {
			ctx.waitUntil(runScheduledDatabaseBackup(env, scheduledDate));
			ctx.waitUntil(runAccountRetention(env, scheduledDate));
			ctx.waitUntil(runDriveTrashRetention(env, scheduledDate));
			ctx.waitUntil(runJmapChangeRetention(env, scheduledDate));
			ctx.waitUntil(sweepOrphanedRawMail(env, scheduledDate).catch((error) => console.error("Raw mail sweep failed", error)));
		}

		// 5-Minute upkeep jobs
		ctx.waitUntil(runAgentMaintenance(env));
		ctx.waitUntil(runTrashRetention(env, scheduledDate));
		ctx.waitUntil(runFollowUpReminders(env, scheduledDate));
		ctx.waitUntil(runCalendarReminders(env, scheduledDate));
		ctx.waitUntil(sweepImportJobs(env, scheduledDate));

		// MailHub Health Monitoring: 10-minute checks for quota breaches, tripped circuit breakers, and DLQ
		if (isTenMinute) {
			ctx.waitUntil(runHealthMonitoringJob(env, scheduledDate).catch((error) => console.error("MailHub health monitoring failed", error)));
		}

		// MailHub Daily Developer Digest: 08:00 AM UTC summary
		if (isDaily8AM) {
			ctx.waitUntil(runDailyDigestJob(env, scheduledDate).catch((error) => console.error("MailHub daily digest failed", error)));
		}
	},
} satisfies ExportedHandler<CloudflareEnv>;
