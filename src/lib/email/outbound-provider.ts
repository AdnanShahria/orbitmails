import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings, domains } from "@/db/schema";
import { requireAwsConfig } from "@/lib/aws/config";
import { sendSesEmail } from "@/lib/aws/ses";
import { getEmailAddress } from "@/lib/email/address";
import type { OutboundProviderConfig, OutboundProviderMessage, ResendKeyStatus } from "@/lib/email/outbound-provider-types";
import {
	BrevoAdapter,
	CloudflareEmailAdapter,
	MailgunAdapter,
	ResendAdapter,
	SesAdapter,
	ZeptoMailAdapter,
	sendWithAdapter,
	shouldFailover,
} from "@/lib/mailhub/providers";

/**
 * Outbound providers:
 * - Brevo with automatic failover to ZeptoMail (when daily limits/free tiers end)
 * - Cloudflare Email Sending
 * - Resend
 * - Amazon SES
 * - Mailgun
 */
export async function getResendKeyStatus(env: CloudflareEnv): Promise<ResendKeyStatus & { apiKey: string | null }> {
	const [settings] = await getDb(env)
		.select({ resendApiKey: appSettings.resendApiKey })
		.from(appSettings)
		.where(eq(appSettings.id, "default"))
		.limit(1);
	const saved = settings?.resendApiKey?.trim();
	const fromEnv = (env as { RESEND_API_KEY?: string }).RESEND_API_KEY?.trim();
	return {
		configured: !!(saved || fromEnv),
		source: saved ? "settings" : fromEnv ? "environment" : null,
		apiKey: saved || fromEnv || null,
	};
}

export async function getResendApiKey(env: CloudflareEnv): Promise<string> {
	const { apiKey } = await getResendKeyStatus(env);
	if (!apiKey) throw new Error("Resend is selected but no API key is configured");
	return apiKey;
}

/** The provider for the domain a message is sent from. */
export async function getOutboundProviderConfig(env: CloudflareEnv, fromAddress: string): Promise<OutboundProviderConfig> {
	const envAny = env as unknown as Record<string, string | undefined>;
	const brevoApiKey = envAny.BREVO_API_KEY?.trim() || (typeof process !== "undefined" ? process.env?.BREVO_API_KEY?.trim() : undefined);
	const zeptoApiKey = envAny.ZEPTOMAIL_API_KEY?.trim() || envAny.ZEPTO_API_KEY?.trim() || (typeof process !== "undefined" ? (process.env?.ZEPTOMAIL_API_KEY?.trim() || process.env?.ZEPTO_API_KEY?.trim()) : undefined);
	const zeptoBounceAddress = envAny.ZEPTOMAIL_BOUNCE_ADDRESS?.trim() || (typeof process !== "undefined" ? process.env?.ZEPTOMAIL_BOUNCE_ADDRESS?.trim() : undefined);

	// If Brevo or ZeptoMail is configured in environment/secrets, route via Brevo with ZeptoMail fallback
	if (brevoApiKey || zeptoApiKey) {
		return {
			provider: "brevo_zepto",
			brevoApiKey: brevoApiKey || "",
			zeptoApiKey: zeptoApiKey || undefined,
			zeptoBounceAddress: zeptoBounceAddress || undefined,
		};
	}

	const hostname = getEmailAddress(fromAddress).split("@")[1]?.toLowerCase();
	const [domain] = hostname
		? await getDb(env).select({ provider: domains.sendingProvider }).from(domains).where(eq(domains.hostname, hostname)).limit(1)
		: [];
	if (!domain || domain.provider === "none") {
		throw new Error(`Sending is not set up for ${hostname ?? "this domain"}. Choose a sending provider on the Domains page or configure BREVO_API_KEY / ZEPTOMAIL_API_KEY.`);
	}
	if (domain.provider === "resend") return { provider: "resend", apiKey: await getResendApiKey(env) };
	if (domain.provider === "ses") return { provider: "ses", config: await requireAwsConfig(env) };
	return { provider: "cloudflare" };
}

// Legacy helper adapters for backward compatibility
const brevoAdapter = new BrevoAdapter();
const resendAdapter = new ResendAdapter();
const zeptoMailAdapter = new ZeptoMailAdapter();
const sesAdapter = new SesAdapter();
const mailgunAdapter = new MailgunAdapter();
const cloudflareAdapter = new CloudflareEmailAdapter();

export async function sendWithResend(
	apiKey: string,
	message: OutboundProviderMessage,
	idempotencyKey?: string,
): Promise<{ messageId: string }> {
	const res = await resendAdapter.send({ apiKey }, message, { idempotencyKey });
	return { messageId: res.messageId };
}

export async function sendWithBrevo(
	apiKey: string,
	message: OutboundProviderMessage,
): Promise<{ messageId: string }> {
	const res = await brevoAdapter.send({ apiKey }, message);
	return { messageId: res.messageId };
}

export async function sendWithZeptoMail(
	token: string,
	bounceAddress: string | undefined,
	message: OutboundProviderMessage,
): Promise<{ messageId: string }> {
	const res = await zeptoMailAdapter.send({ sendMailToken: token, bounceAddress }, message);
	return { messageId: res.messageId };
}

export async function sendThroughProvider(
	env: CloudflareEnv,
	config: OutboundProviderConfig,
	message: OutboundProviderMessage,
	idempotencyKey?: string,
): Promise<{ messageId: string }> {
	if (config.provider === "brevo_zepto") {
		if (config.brevoApiKey) {
			try {
				const result = await sendWithAdapter("brevo", { apiKey: config.brevoApiKey }, message, { idempotencyKey }, env);
				return { messageId: result.messageId };
			} catch (brevoError) {
				console.warn("[Orbitmails] Brevo delivery failed, assessing failover to ZeptoMail:", brevoError);
				if (config.zeptoApiKey && shouldFailover(brevoError)) {
					try {
						const result = await sendWithAdapter(
							"zeptomail",
							{ sendMailToken: config.zeptoApiKey, bounceAddress: config.zeptoBounceAddress },
							message,
							{ idempotencyKey },
							env,
						);
						return { messageId: result.messageId };
					} catch (zeptoError) {
						console.error("[Orbitmails] ZeptoMail fallback delivery also failed:", zeptoError);
						throw new Error(
							`Both primary (Brevo) and fallback (ZeptoMail) failed to send.\nBrevo: ${(brevoError as Error).message}\nZeptoMail: ${(zeptoError as Error).message}`
						);
					}
				}
				throw brevoError;
			}
		}
		if (config.zeptoApiKey) {
			const result = await sendWithAdapter(
				"zeptomail",
				{ sendMailToken: config.zeptoApiKey, bounceAddress: config.zeptoBounceAddress },
				message,
				{ idempotencyKey },
				env,
			);
			return { messageId: result.messageId };
		}
		throw new Error("Neither Brevo nor ZeptoMail API keys are configured for sending.");
	}

	if (config.provider === "resend") {
		const result = await sendWithAdapter("resend", { apiKey: config.apiKey }, message, { idempotencyKey }, env);
		return { messageId: result.messageId };
	}

	if (config.provider === "ses") {
		const result = await sendWithAdapter("ses", config.config, message, { idempotencyKey }, env);
		return { messageId: result.messageId };
	}

	if (config.provider === "mailgun") {
		const result = await sendWithAdapter(
			"mailgun",
			{ apiKey: config.apiKey, domain: config.domain, region: config.region },
			message,
			{ idempotencyKey },
			env,
		);
		return { messageId: result.messageId };
	}

	const result = await sendWithAdapter("cloudflare", {}, message, { idempotencyKey }, env);
	return { messageId: result.messageId };
}
