import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { processInboundWebhook } from "@/lib/mailhub/webhooks/processor";
import type { SupportedWebhookProvider } from "@/lib/mailhub/webhooks/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

const SUPPORTED_PROVIDERS: readonly SupportedWebhookProvider[] = [
	"resend",
	"brevo",
	"ses",
	"mailgun",
	"zeptomail",
];

function isSupportedProvider(provider: string): provider is SupportedWebhookProvider {
	return (SUPPORTED_PROVIDERS as readonly string[]).includes(provider.toLowerCase());
}

/**
 * GET /api/v1/webhooks/:provider
 * Endpoint health, handshake, and provider ping check.
 */
export async function GET(request: Request, { params }: Params) {
	const { provider: rawProvider } = await params;
	const provider = rawProvider?.toLowerCase();

	if (!isSupportedProvider(provider)) {
		return NextResponse.json(
			{ error: `Unsupported webhook provider: ${rawProvider}. Supported: ${SUPPORTED_PROVIDERS.join(", ")}` },
			{ status: 400 },
		);
	}

	return NextResponse.json({
		ok: true,
		service: "MailHub Webhook Receiver",
		provider,
		endpoint: `/api/v1/webhooks/${provider}`,
		status: "listening",
	});
}

/**
 * POST /api/v1/webhooks/:provider
 * Centralized multi-provider inbound webhook receiver.
 * Handles signature verification, payload normalization, send log status updates,
 * suppression list additions for hard bounces/complaints, and provider health down-ranking.
 */
export async function POST(request: Request, { params }: Params) {
	const { provider: rawProvider } = await params;
	const provider = rawProvider?.toLowerCase();

	if (!isSupportedProvider(provider)) {
		return NextResponse.json(
			{ error: `Unsupported webhook provider: ${rawProvider}. Supported: ${SUPPORTED_PROVIDERS.join(", ")}` },
			{ status: 400 },
		);
	}

	const env = getEnv();
	const rawBody = await request.text();

	if (!rawBody || rawBody.trim().length === 0) {
		return NextResponse.json({ error: "Empty request body" }, { status: 400 });
	}

	// 1. Amazon SES SNS SubscriptionConfirmation handling
	if (provider === "ses") {
		try {
			const envelope = JSON.parse(rawBody);
			if (envelope.Type === "SubscriptionConfirmation") {
				const subscribeUrl = envelope.SubscribeURL ? new URL(envelope.SubscribeURL) : null;
				if (
					!subscribeUrl ||
					subscribeUrl.protocol !== "https:" ||
					!/^sns\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/.test(subscribeUrl.hostname)
				) {
					return NextResponse.json({ error: "Invalid SNS subscription URL" }, { status: 400 });
				}
				const confirmRes = await fetch(subscribeUrl);
				return NextResponse.json({
					confirmed: confirmRes.ok,
					type: "SubscriptionConfirmation",
					message: "SNS Topic subscription confirmed successfully",
				});
			}
		} catch {
			// Not a valid JSON envelope, let processor handle error
		}
	}

	// 2. Process webhook event pipeline
	const result = await processInboundWebhook(provider, request, rawBody, env);

	if (!result.success) {
		const isAuthError =
			result.error?.toLowerCase().includes("signature") ||
			result.error?.toLowerCase().includes("authentication") ||
			result.error?.toLowerCase().includes("secret") ||
			result.error?.toLowerCase().includes("token");

		return NextResponse.json(
			{ error: result.error || "Webhook processing failed" },
			{ status: isAuthError ? 401 : 400 },
		);
	}

	return NextResponse.json({
		success: true,
		provider: result.provider,
		processedCount: result.processedCount,
		suppressionsAdded: result.suppressionsAdded,
		events: result.events.map((e) => ({
			eventType: e.eventType,
			providerMessageId: e.providerMessageId,
			recipient: e.recipient,
			timestamp: e.timestamp.toISOString(),
			subType: e.subType,
			reason: e.reason,
			projectId: e.projectId,
		})),
		alerts: result.alerts,
	});
}
