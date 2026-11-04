import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { isPrimaryAdmin } from "@/lib/auth/admin";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";
import { sendWithFailover } from "@/lib/mailhub/failover";
import { getMailHubState } from "@/lib/mailhub/storage";
import { createSendLogEntry, recordSendLogAsync } from "@/lib/mailhub/logging";
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

		const projectName = project?.name || "MailHub Test Relay";
		const projectSlug = project?.slug || data.projectId.replace(/^proj_/, "");
		const fromAddress = `relay@${projectSlug}.mailhub.internal`;

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
			from: `${projectName} <${fromAddress}>`,
			to: [data.recipient],
			subject: data.subject,
			html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; background: #ffffff;">
  <h3 style="margin: 0 0 8px 0; color: #111827; font-size: 16px;">${data.subject}</h3>
  <p style="margin: 0 0 12px 0; color: #4b5563; font-size: 13px;">Test dispatch from OrbitMails MailHub engine.</p>
  <div style="background: #f8fafc; padding: 12px; border-radius: 8px; font-size: 12px; color: #334155;">
    <strong>Recipient:</strong> ${data.recipient}<br/>
    <strong>Project:</strong> ${projectName} (${projectSlug})
  </div>
</div>`,
			text: `${data.subject}\n\nTest dispatch from OrbitMails MailHub engine.\nRecipient: ${data.recipient}\nProject: ${projectName} (${projectSlug})`,
		};

		const failoverResult = await sendWithFailover({
			projectId: project ? project.id : data.projectId,
			message: outboundMessage,
			routingOptions,
			env: access.env as any,
		});

		const attempts = failoverResult.success
			? failoverResult.attempts
			: (failoverResult as any).failedAttempts || [];
		const waterfall = attempts.map((att) => ({
			provider: att.provider,
			status: att.code === "SUCCESS" ? 200 : att.code === "QUOTA_EXCEEDED" ? 429 : 500,
			message:
				att.message ||
				(att.code === "SUCCESS" ? "Dispatched successfully" : `Attempt failed: ${att.code}`),
		}));

		const providerUsed =
			(failoverResult as any).provider ||
			(attempts.length > 0 ? attempts[attempts.length - 1].provider : "brevo");
		const latencyMs = (failoverResult as any).latencyMs || 0;
		const messageId =
			(failoverResult as any).messageId ||
			(failoverResult as any).providerMessageId ||
			failoverResult.deliveryId;

		// Asynchronously record this send to logging pipeline
		try {
			const logEntry = createSendLogEntry({
				projectId: project ? project.id : data.projectId,
				providerCredId: (failoverResult as any).providerCredId || `cred_${providerUsed}_main`,
				provider: providerUsed,
				toAddress: data.recipient,
				subject: data.subject,
				status: failoverResult.success ? "sent" : "failed",
				providerMessageId: messageId,
				errorMessage: failoverResult.success ? undefined : "All failover attempts failed or queued",
				latencyMs,
				htmlSnippet: outboundMessage.html,
				textContent: outboundMessage.text,
			});
			recordSendLogAsync(logEntry, access.env as any);
		} catch (logErr) {
			console.warn("[POST /api/admin/mailhub/test-send] Failed to write send log:", logErr);
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
