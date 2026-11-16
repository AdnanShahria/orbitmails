import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { isPrimaryAdmin } from "@/lib/auth/admin";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";
import { sendWithFailover } from "@/lib/mailhub/failover";
import { getMailHubState } from "@/lib/mailhub/storage";
import { createSendLogEntry, flushBatchToD1, recordSendLogAsync } from "@/lib/mailhub/logging";
import {
	buildDeliveryDiagnostics,
	cleanProviderErrorMessage,
	formatAttemptsErrorSummary,
	resolveAttemptHttpStatus,
} from "@/lib/mailhub/diagnostics";
import { CANONICAL_OUTBOUND_SENDER, resolveCanonicalOutboundSender } from "@/lib/mailhub/providers/utils";
import type { OutboundProviderMessage } from "@/lib/email/outbound-provider-types";
import type { RoutingOptions } from "@/lib/mailhub/types";

async function authorize(request: Request, isMutation = false) {
	const env = getEnv();
	let auth: any;
	try {
		auth = await requireSessionUser(env, request);
	} catch {
		auth = { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), user: null };
	}
	if (auth.error) {
		if (process.env.NODE_ENV === "development") {
			return { env, user: { id: "dev-admin", role: "admin" }, error: null };
		}
		return { env, user: null, error: auth.error };
	}
	if (!isPrimaryAdmin(auth.user) && auth.user?.role !== "admin") {
		return { env, user: null, error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
	}
	if (isMutation && !hasValidSessionMutationOrigin(request)) {
		if (process.env.NODE_ENV !== "development") {
			return { env, user: null, error: NextResponse.json({ error: "Invalid origin" }, { status: 403 }) };
		}
	}
	return { env, user: auth.user, error: null };
}

const testSendSchema = z.object({
	projectId: z.string().min(1),
	recipient: z.string().email(),
	subject: z.string().min(1).max(500),
	senderAddress: z.string().email().optional(),
	routingMode: z.string().optional(),
});

export async function POST(request: Request) {
	const access = await authorize(request, true);
	if (access.error) return access.error;

	try {
		const body = await request.json().catch(() => null);
		const parsed = testSendSchema.safeParse(body);
		if (!parsed.success) {
			return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
		}

		const data = parsed.data;
		const state = await getMailHubState(access.env as any);
		const project = state.projects.find(
			(p) => p.id === data.projectId || p.slug === data.projectId
		);

		const effectiveProjectId = project ? project.id : data.projectId;
		const projectName = project?.name || "MailHub Test Relay";
		const projectSlug = project?.slug || data.projectId.replace(/^proj_/, "");

		const requestedSender = data.senderAddress?.trim();
		const canonicalSender = resolveCanonicalOutboundSender(
			requestedSender ? `${projectName} <${requestedSender}>` : `${projectName} <${CANONICAL_OUTBOUND_SENDER}>`
		);
		const fromAddress = CANONICAL_OUTBOUND_SENDER;

		const routingOptions: RoutingOptions = {};
		if (data.routingMode && data.routingMode !== "auto") {
			const matchedProvider = state.providers.find(
				(p) => p.id === data.routingMode || p.provider === data.routingMode
			);
			if (matchedProvider) {
				routingOptions.forceProviderCredId = matchedProvider.id;
			}
		}

		const outboundMessage: OutboundProviderMessage = {
			from: canonicalSender.from,
			to: [data.recipient],
			subject: data.subject,
			headers: Object.keys(canonicalSender.headers).length ? canonicalSender.headers : undefined,
			html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; background: #ffffff;">
  <h3 style="margin: 0 0 8px 0; color: #111827; font-size: 16px;">${data.subject}</h3>
  <p style="margin: 0 0 12px 0; color: #4b5563; font-size: 13px;">Test dispatch from OrbitMails MailHub engine.</p>
  <div style="background: #f8fafc; padding: 12px; border-radius: 8px; font-size: 12px; color: #334155;">
    <strong>Recipient:</strong> ${data.recipient}<br/>
    <strong>Project:</strong> ${projectName} (${projectSlug})<br/>
    <strong>From:</strong> ${fromAddress}
  </div>
</div>`,
			text: `${data.subject}\n\nTest dispatch from OrbitMails MailHub engine.\nRecipient: ${data.recipient}\nProject: ${projectName} (${projectSlug})\nFrom: ${fromAddress}`,
		};

		const dispatchStart = Date.now();
		let failoverResult: Awaited<ReturnType<typeof sendWithFailover>>;

		try {
			failoverResult = await sendWithFailover({
				projectId: effectiveProjectId,
				message: outboundMessage,
				routingOptions,
				env: access.env as any,
			});
		} catch (sendErr: any) {
			const elapsedMs = Math.max(1, Date.now() - dispatchStart);
			const providerUsed =
				sendErr?.provider ||
				(data.routingMode && data.routingMode !== "auto" ? data.routingMode : project?.providerOrder?.[0] || "cloudflare")
					.replace(/^cred_/, "")
					.replace(/_(main|backup|default)$/, "");

			const diagnostics = buildDeliveryDiagnostics({
				fallbackError: sendErr,
				fallbackProvider: providerUsed,
				stage: sendErr?.code === "INVALID_PAYLOAD" ? "validation" : "provider_attempt",
				fromAddress: canonicalSender.from,
				totalLatencyMs: elapsedMs,
			});

			const realError =
				diagnostics.summaryError ||
				cleanProviderErrorMessage(sendErr?.message) ||
				"Failed to execute test send";

			try {
				const logEntry = createSendLogEntry({
					projectId: effectiveProjectId,
					providerCredId: diagnostics.providerCredId || `cred_${providerUsed}_main`,
					provider: providerUsed,
					toAddress: data.recipient,
					subject: data.subject,
					status: "failed",
					errorMessage: realError,
					latencyMs: elapsedMs,
					htmlSnippet: outboundMessage.html,
					textContent: outboundMessage.text,
					diagnostics,
				});
				const flushRes = await flushBatchToD1([logEntry], access.env as any);
				if (flushRes.flushedCount === 0 && !access.env?.DB) {
					recordSendLogAsync(logEntry, access.env as any);
				}
			} catch (logErr) {
				console.warn("[POST /api/admin/mailhub/test-send] Failed to write thrown error send log:", logErr);
			}

			const waterfall = diagnostics.attempts.map((att) => ({
				provider: att.provider,
				status: att.status,
				code: att.code,
				latencyMs: att.latencyMs,
				message: att.error || att.rawError || "Attempt failed",
				rawError: att.rawError,
				hint: att.hint,
			}));

			const httpStatus =
				typeof sendErr?.statusCode === "number" && sendErr.statusCode >= 400 && sendErr.statusCode < 600
					? sendErr.statusCode
					: sendErr?.code === "INVALID_PAYLOAD"
					? 400
					: 502;

			return NextResponse.json(
				{
					success: false,
					error: realError,
					errorCode: diagnostics.errorCode,
					diagnosticHint: diagnostics.diagnosticHint,
					result: {
						providerUsed,
						latencyMs: elapsedMs,
						attempts: diagnostics.attempts,
						waterfall,
					},
				},
				{ status: httpStatus },
			);
		}

		const elapsedMs = Math.max(1, Date.now() - dispatchStart);
		const attempts = failoverResult.success
			? failoverResult.attempts
			: (failoverResult as any).failedAttempts || [];

		const attemptsLatencySum = attempts.reduce((sum: number, a: any) => sum + (Number(a?.latencyMs) || 0), 0);
		const latencyMs = failoverResult.success
			? failoverResult.latencyMs || attemptsLatencySum || elapsedMs
			: attemptsLatencySum || elapsedMs;

		const waterfall = attempts.map((att: any) => {
			const status = resolveAttemptHttpStatus(att);
			const cleanMsg = cleanProviderErrorMessage(att.message);
			return {
				provider: att.provider,
				status,
				code: att.code,
				latencyMs: att.latencyMs ?? 0,
				message:
					att.code === "SUCCESS"
						? att.message || "Dispatched successfully"
						: cleanMsg || att.message || `Attempt failed: ${att.code}`,
				rawError: att.code === "SUCCESS" ? undefined : att.message,
			};
		});

		const providerUsed =
			(failoverResult as any).provider ||
			(attempts.length > 0 ? attempts[attempts.length - 1].provider : "cloudflare");
		const messageId =
			(failoverResult as any).messageId ||
			(failoverResult as any).providerMessageId ||
			failoverResult.deliveryId;

		const diagnostics = buildDeliveryDiagnostics({
			deliveryId: failoverResult.deliveryId,
			attempts,
			fallbackError: failoverResult.success ? undefined : (failoverResult as any).message,
			fallbackProvider: providerUsed,
			fallbackProviderCredId: (failoverResult as any).providerCredId,
			fromAddress: canonicalSender.from,
			totalLatencyMs: latencyMs,
			stage: failoverResult.success ? "delivered" : "failover_exhausted",
		});

		const realErrorSummary = failoverResult.success
			? undefined
			: diagnostics.summaryError ||
				formatAttemptsErrorSummary(attempts) ||
				(failoverResult as any).message ||
				"Delivery failed across all candidate providers";

		// Persist send log & diagnostics synchronously when possible so immediate dashboard refresh reflects real error
		try {
			const logEntry = createSendLogEntry({
				projectId: effectiveProjectId,
				providerCredId:
					(failoverResult as any).providerCredId ||
					attempts[attempts.length - 1]?.providerCredId ||
					`cred_${providerUsed}_main`,
				provider: providerUsed,
				toAddress: data.recipient,
				subject: data.subject,
				status: failoverResult.success ? "sent" : "failed",
				providerMessageId: messageId,
				errorMessage: realErrorSummary,
				latencyMs,
				htmlSnippet: outboundMessage.html,
				textContent: outboundMessage.text,
				diagnostics,
			});
			const flushRes = await flushBatchToD1([logEntry], access.env as any);
			if (flushRes.flushedCount === 0 && !access.env?.DB) {
				recordSendLogAsync(logEntry, access.env as any);
			}
		} catch (logErr) {
			console.warn("[POST /api/admin/mailhub/test-send] Failed to write send log:", logErr);
		}

		if (!failoverResult.success) {
			const failedStep = waterfall.find((w: any) => w.status !== 200);
			const primaryErrorMessage =
				realErrorSummary ||
				failedStep?.message ||
				attempts[attempts.length - 1]?.message ||
				attempts[0]?.message ||
				(failoverResult as any).message ||
				"Delivery failed across all candidate providers";

			return NextResponse.json({
				success: false,
				error: primaryErrorMessage,
				errorCode: diagnostics.errorCode,
				diagnosticHint: diagnostics.diagnosticHint,
				result: {
					providerUsed,
					latencyMs,
					messageId,
					deliveryId: failoverResult.deliveryId,
					attempts: diagnostics.attempts,
					waterfall: diagnostics.attempts.map((a) => ({
						provider: a.provider,
						status: a.status,
						code: a.code,
						latencyMs: a.latencyMs,
						message: a.error || a.rawError || "Attempt failed",
						rawError: a.rawError,
						hint: a.hint,
					})),
				},
			});
		}

		return NextResponse.json({
			success: failoverResult.success,
			result: {
				providerUsed,
				latencyMs,
				messageId,
				deliveryId: failoverResult.deliveryId,
				attempts,
				waterfall,
			},
		});
	} catch (err: any) {
		console.error("[POST /api/admin/mailhub/test-send] Error:", err);
		return NextResponse.json(
			{ error: err.message || "Failed to execute test send" },
			{ status: 500 }
		);
	}
}
