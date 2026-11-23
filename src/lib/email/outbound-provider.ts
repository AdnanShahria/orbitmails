import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings, domains } from "@/db/schema";
import { requireAwsConfig } from "@/lib/aws/config";
import { getEmailAddress } from "@/lib/email/address";
import type { OutboundProviderConfig, OutboundProviderMessage, ResendKeyStatus } from "@/lib/email/outbound-provider-types";
import { getMailHubState } from "@/lib/mailhub/storage";
import {
	BrevoAdapter,
	CloudflareEmailAdapter,
	MailgunAdapter,
	type MailHubProviderType,
	ResendAdapter,
	SesAdapter,
	ZeptoMailAdapter,
	resolveCanonicalOutboundSender,
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
	const envAny = env as unknown as Record<string, any>;
	const procEnv: Record<string, string | undefined> =
		typeof process !== "undefined" && process.env ? process.env : {};
	const hasCloudflareSender = Boolean(
		(envAny.EMAIL && typeof envAny.EMAIL.send === "function") ||
			((envAny.CF_ACCOUNT_ID || procEnv.CF_ACCOUNT_ID) && (envAny.CF_TOKEN || procEnv.CF_TOKEN)),
	);

	const hostname = getEmailAddress(fromAddress).split("@")[1]?.toLowerCase();
	const [domain] = hostname
		? await getDb(env).select({ provider: domains.sendingProvider }).from(domains).where(eq(domains.hostname, hostname)).limit(1)
		: [];

	if (domain?.provider === "cloudflare") {
		return { provider: "cloudflare" };
	}
	if (domain?.provider === "resend") return { provider: "resend", apiKey: await getResendApiKey(env) };
	if (domain?.provider === "ses") return { provider: "ses", config: await requireAwsConfig(env) };

	if (hasCloudflareSender) {
		return { provider: "cloudflare" };
	}

	const brevoApiKey = envAny.BREVO_API_KEY?.trim() || procEnv.BREVO_API_KEY?.trim();
	const zeptoApiKey = envAny.ZEPTOMAIL_API_KEY?.trim() || envAny.ZEPTO_API_KEY?.trim() || procEnv.ZEPTOMAIL_API_KEY?.trim() || procEnv.ZEPTO_API_KEY?.trim();
	const zeptoBounceAddress = envAny.ZEPTOMAIL_BOUNCE_ADDRESS?.trim() || procEnv.ZEPTOMAIL_BOUNCE_ADDRESS?.trim();

	if (brevoApiKey || zeptoApiKey) {
		return {
			provider: "brevo_zepto",
			brevoApiKey: brevoApiKey || "",
			zeptoApiKey: zeptoApiKey || undefined,
			zeptoBounceAddress: zeptoBounceAddress || undefined,
		};
	}

	const fallbacks = await resolveConfiguredMailHubFallbacks(env);
	if (fallbacks.length > 0) {
		return { provider: "cloudflare" };
	}
	throw new Error(`Sending is not set up for ${hostname ?? "this domain"}. Choose a sending provider on the Domains page or configure Cloudflare Email Service.`);
}

type FallbackCandidate = {
	provider: Exclude<MailHubProviderType, "cloudflare">;
	credentials: Record<string, any>;
};

const FALLBACK_PROVIDER_ORDER: Array<FallbackCandidate["provider"]> = [
	"brevo",
	"resend",
	"sendpulse",
	"zeptomail",
	"mailgun",
	"ses",
];

function normalizeFallbackProvider(raw: string): FallbackCandidate["provider"] | null {
	const lower = raw.trim().toLowerCase();
	if (lower === "zepto" || lower === "zeptomail") return "zeptomail";
	if (
		lower === "brevo" ||
		lower === "resend" ||
		lower === "sendpulse" ||
		lower === "mailgun" ||
		lower === "ses"
	) {
		return lower;
	}
	return null;
}

export async function resolveConfiguredMailHubFallbacks(env: CloudflareEnv): Promise<FallbackCandidate[]> {
	const envAny = env as unknown as Record<string, any>;
	const procEnv: Record<string, string | undefined> =
		typeof process !== "undefined" && process.env ? process.env : {};
	const byProvider = new Map<FallbackCandidate["provider"], Record<string, any>>();

	const register = (provider: FallbackCandidate["provider"] | null, credentials: Record<string, any> | null) => {
		if (!provider || !credentials || byProvider.has(provider)) return;
		byProvider.set(provider, credentials);
	};

	// 1. Environment variables / Worker secrets
	const brevoKey = String(envAny.BREVO_API_KEY || procEnv.BREVO_API_KEY || "").trim();
	if (brevoKey) register("brevo", { apiKey: brevoKey });

	const resendKey = String(envAny.RESEND_API_KEY || procEnv.RESEND_API_KEY || "").trim();
	if (resendKey) register("resend", { apiKey: resendKey });

	const sendpulseKey = String(envAny.SENDPULSE_API_KEY || procEnv.SENDPULSE_API_KEY || "").trim();
	if (sendpulseKey) register("sendpulse", { apiKey: sendpulseKey });

	const zeptoKey = String(
		envAny.ZEPTOMAIL_API_KEY || envAny.ZEPTO_API_KEY || procEnv.ZEPTOMAIL_API_KEY || procEnv.ZEPTO_API_KEY || "",
	).trim();
	if (zeptoKey) {
		register("zeptomail", {
			sendMailToken: zeptoKey,
			bounceAddress: envAny.ZEPTOMAIL_BOUNCE_ADDRESS || procEnv.ZEPTOMAIL_BOUNCE_ADDRESS,
		});
	}

	const mailgunKey = String(envAny.MAILGUN_API_KEY || procEnv.MAILGUN_API_KEY || "").trim();
	if (mailgunKey) {
		register("mailgun", {
			apiKey: mailgunKey,
			domain: envAny.MAILGUN_DOMAIN || procEnv.MAILGUN_DOMAIN || "mg.orbitsaas.cloud",
			region: envAny.MAILGUN_REGION || procEnv.MAILGUN_REGION || "us",
		});
	}

	const awsKeyId = String(envAny.AWS_ACCESS_KEY_ID || envAny.S3_ACCESS_KEY_ID || procEnv.AWS_ACCESS_KEY_ID || "").trim();
	const awsSecret = String(
		envAny.AWS_SECRET_ACCESS_KEY || envAny.S3_SECRET_ACCESS_KEY || procEnv.AWS_SECRET_ACCESS_KEY || "",
	).trim();
	if (awsKeyId && awsSecret) {
		register("ses", {
			accessKeyId: awsKeyId,
			secretAccessKey: awsSecret,
			region: String(envAny.AWS_REGION || envAny.S3_REGION || procEnv.AWS_REGION || "us-east-1").trim(),
		});
	}

	// 2. D1 provider_credentials table
	const d1Db = (env as unknown as { DB?: D1Database }).DB;
	if (d1Db) {
		try {
			const res = await d1Db
				.prepare("SELECT provider, credentials_encrypted as creds, enabled FROM provider_credentials WHERE enabled = 1")
				.all();
			for (const row of (res?.results ?? []) as Array<{ provider?: string; creds?: unknown }>) {
				const prov = normalizeFallbackProvider(String(row.provider || ""));
				if (!prov || !row.creds) continue;
				let parsed: Record<string, any> = {};
				try {
					const raw = typeof row.creds === "string" ? JSON.parse(row.creds) : row.creds;
					if (raw && typeof raw === "object") parsed = raw;
					else if (typeof raw === "string" && raw.trim()) parsed = { apiKey: raw.trim() };
				} catch {
					if (typeof row.creds === "string" && row.creds.trim()) parsed = { apiKey: row.creds.trim() };
				}
				if (prov === "zeptomail") {
					const token = String(parsed.sendMailToken || parsed.apiKey || "").trim();
					if (token) register("zeptomail", { sendMailToken: token, bounceAddress: parsed.bounceAddress });
				} else if (prov === "ses") {
					const accessKeyId = String(parsed.accessKeyId || parsed.apiKey || "").trim();
					const secretAccessKey = String(parsed.secretAccessKey || "").trim();
					if (accessKeyId && secretAccessKey) {
						register("ses", {
							accessKeyId,
							secretAccessKey,
							region: String(parsed.region || "us-east-1").trim(),
						});
					}
				} else if (prov === "mailgun") {
					const apiKey = String(parsed.apiKey || "").trim();
					if (apiKey) {
						register("mailgun", {
							apiKey,
							domain: parsed.domain || envAny.MAILGUN_DOMAIN || "mg.orbitsaas.cloud",
							region: parsed.region || envAny.MAILGUN_REGION || "us",
						});
					}
				} else {
					const apiKey = String(parsed.apiKey || "").trim();
					if (apiKey) register(prov, { apiKey });
				}
			}
		} catch {
			// provider_credentials table may not exist
		}

		// 3. D1 app_settings (Resend / AWS SES)
		try {
			const [settings] = await getDb(env)
				.select({ resendApiKey: appSettings.resendApiKey, awsConfig: appSettings.awsConfig })
				.from(appSettings)
				.where(eq(appSettings.id, "default"))
				.limit(1);
			if (settings?.resendApiKey?.trim()) {
				register("resend", { apiKey: settings.resendApiKey.trim() });
			}
			if (settings?.awsConfig) {
				const parsedAws =
					typeof settings.awsConfig === "string" ? JSON.parse(settings.awsConfig) : settings.awsConfig;
				if (parsedAws?.accessKeyId && parsedAws?.secretAccessKey) {
					register("ses", {
						accessKeyId: String(parsedAws.accessKeyId).trim(),
						secretAccessKey: String(parsedAws.secretAccessKey).trim(),
						region: String(parsedAws.region || "us-east-1").trim(),
					});
				}
			}
		} catch {
			// app_settings query best-effort
		}
	}

	// 4. MailHub state (KV / D1 mailhub_state / memory)
	try {
		const state = await getMailHubState(env as any);
		for (const provConfig of state.providers || []) {
			if (!provConfig.enabled) continue;
			const prov = normalizeFallbackProvider(provConfig.provider);
			if (!prov) continue;
			const rawKey = String(provConfig.apiKeyEnc || (provConfig as any).apiKey || "").trim();
			if (!rawKey) continue;
			if (prov === "zeptomail") {
				register("zeptomail", { sendMailToken: rawKey, bounceAddress: provConfig.bounceAddress });
			} else if (prov === "ses") {
				const secretKey = String((provConfig as any).secretKey || "").trim();
				if (secretKey) {
					register("ses", {
						accessKeyId: rawKey,
						secretAccessKey: secretKey,
						region: provConfig.region || "us-east-1",
					});
				}
			} else if (prov === "mailgun") {
				register("mailgun", {
					apiKey: rawKey,
					domain: (provConfig as any).domain || envAny.MAILGUN_DOMAIN || "mg.orbitsaas.cloud",
					region: (provConfig as any).region || envAny.MAILGUN_REGION || "us",
				});
			} else {
				register(prov, { apiKey: rawKey });
			}
		}
	} catch {
		// MailHub state lookup best-effort
	}

	return FALLBACK_PROVIDER_ORDER.filter((p) => byProvider.has(p)).map((p) => ({
		provider: p,
		credentials: byProvider.get(p)!,
	}));
}

function isSenderRejectionError(error: unknown): boolean {
	const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
	return (
		msg.includes("not verified") ||
		msg.includes("unverified") ||
		msg.includes("invalid_from_address") ||
		msg.includes("domain_not_verified") ||
		msg.includes("invalid sender") ||
		(msg.includes("sender") && (msg.includes("valid") || msg.includes("verify") || msg.includes("reject")))
	);
}

const DEFAULT_FAILOVER_HOLD_MS = 1000;

function sleepHold(ms: number): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldHoldBeforeFailover(error: unknown): boolean {
	if (isSenderRejectionError(error)) return false;
	const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
	if (msg.includes("not a verified address") || msg.includes("quota_exceeded")) return false;
	return true;
}

async function tryMailHubFallbacks(
	env: CloudflareEnv,
	message: OutboundProviderMessage,
	idempotencyKey?: string,
	excludeProviders: MailHubProviderType[] = [],
	initialHoldMs = 0,
): Promise<{ messageId: string } | null> {
	const excluded = new Set(excludeProviders.map((p) => p.toLowerCase()));
	const candidates = (await resolveConfiguredMailHubFallbacks(env)).filter(
		(c) => !excluded.has(c.provider.toLowerCase()),
	);
	if (candidates.length === 0) return null;

	if (initialHoldMs > 0) {
		await sleepHold(initialHoldMs);
	}

	const canonical = resolveCanonicalOutboundSender(message.from, message.headers);
	const canRetryCanonical =
		canonical.from &&
		getEmailAddress(canonical.from).toLowerCase() !== getEmailAddress(message.from).toLowerCase();

	for (let i = 0; i < candidates.length; i++) {
		const candidate = candidates[i];
		try {
			const res = await sendWithAdapter(
				candidate.provider,
				candidate.credentials,
				message,
				{ idempotencyKey },
				env,
			);
			return { messageId: res.messageId };
		} catch (err) {
			if (canRetryCanonical && isSenderRejectionError(err)) {
				try {
					const canonicalMessage: OutboundProviderMessage = {
						...message,
						from: canonical.from,
						headers: Object.keys(canonical.headers).length ? canonical.headers : message.headers,
					};
					const retryRes = await sendWithAdapter(
						candidate.provider,
						candidate.credentials,
						canonicalMessage,
						{ idempotencyKey },
						env,
					);
					return { messageId: retryRes.messageId };
				} catch (retryErr) {
					console.warn(`[Orbitmails] Fallback provider ${candidate.provider} canonical retry failed:`, retryErr);
				}
			} else {
				console.warn(`[Orbitmails] Fallback provider ${candidate.provider} failed:`, err);
			}
			if (i + 1 < candidates.length && shouldHoldBeforeFailover(err)) {
				await sleepHold(DEFAULT_FAILOVER_HOLD_MS);
			}
		}
	}

	return null;
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
						if (shouldHoldBeforeFailover(brevoError)) {
							await sleepHold(DEFAULT_FAILOVER_HOLD_MS);
						}
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
						if (shouldFailover(zeptoError)) {
							const holdMs = shouldHoldBeforeFailover(zeptoError) ? DEFAULT_FAILOVER_HOLD_MS : 0;
							const fallbackResult = await tryMailHubFallbacks(env, message, idempotencyKey, ["brevo", "zeptomail"], holdMs);
							if (fallbackResult) return fallbackResult;
						}
						throw new Error(
							`Both primary (Brevo) and fallback (ZeptoMail) failed to send.\nBrevo: ${(brevoError as Error).message}\nZeptoMail: ${(zeptoError as Error).message}`
						);
					}
				}
				if (shouldFailover(brevoError)) {
					const holdMs = shouldHoldBeforeFailover(brevoError) ? DEFAULT_FAILOVER_HOLD_MS : 0;
					const fallbackResult = await tryMailHubFallbacks(env, message, idempotencyKey, ["brevo"], holdMs);
					if (fallbackResult) return fallbackResult;
				}
				throw brevoError;
			}
		}
		if (config.zeptoApiKey) {
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
				if (shouldFailover(zeptoError)) {
					const holdMs = shouldHoldBeforeFailover(zeptoError) ? DEFAULT_FAILOVER_HOLD_MS : 0;
					const fallbackResult = await tryMailHubFallbacks(env, message, idempotencyKey, ["zeptomail"], holdMs);
					if (fallbackResult) return fallbackResult;
				}
				throw zeptoError;
			}
		}
		throw new Error("Neither Brevo nor ZeptoMail API keys are configured for sending.");
	}

	if (config.provider === "resend") {
		try {
			const result = await sendWithAdapter("resend", { apiKey: config.apiKey }, message, { idempotencyKey }, env);
			return { messageId: result.messageId };
		} catch (resendError) {
			if (shouldFailover(resendError)) {
				const holdMs = shouldHoldBeforeFailover(resendError) ? DEFAULT_FAILOVER_HOLD_MS : 0;
				const fallbackResult = await tryMailHubFallbacks(env, message, idempotencyKey, ["resend"], holdMs);
				if (fallbackResult) return fallbackResult;
			}
			throw resendError;
		}
	}

	if (config.provider === "ses") {
		try {
			const result = await sendWithAdapter("ses", config.config, message, { idempotencyKey }, env);
			return { messageId: result.messageId };
		} catch (sesError) {
			if (shouldFailover(sesError)) {
				const holdMs = shouldHoldBeforeFailover(sesError) ? DEFAULT_FAILOVER_HOLD_MS : 0;
				const fallbackResult = await tryMailHubFallbacks(env, message, idempotencyKey, ["ses"], holdMs);
				if (fallbackResult) return fallbackResult;
			}
			throw sesError;
		}
	}

	if (config.provider === "mailgun") {
		try {
			const result = await sendWithAdapter(
				"mailgun",
				{ apiKey: config.apiKey, domain: config.domain, region: config.region },
				message,
				{ idempotencyKey },
				env,
			);
			return { messageId: result.messageId };
		} catch (mailgunError) {
			if (shouldFailover(mailgunError)) {
				const holdMs = shouldHoldBeforeFailover(mailgunError) ? DEFAULT_FAILOVER_HOLD_MS : 0;
				const fallbackResult = await tryMailHubFallbacks(env, message, idempotencyKey, ["mailgun"], holdMs);
				if (fallbackResult) return fallbackResult;
			}
			throw mailgunError;
		}
	}

	try {
		const result = await sendWithAdapter("cloudflare", {}, message, { idempotencyKey }, env);
		return { messageId: result.messageId };
	} catch (cfError) {
		const cfErrMsg = cfError instanceof Error ? cfError.message : String(cfError);
		const lowerMsg = cfErrMsg.toLowerCase();
		const isUnverifiedDestination =
			lowerMsg.includes("destination address is not a verified address") ||
			lowerMsg.includes("not a verified address");

		if (shouldFailover(cfError) || isUnverifiedDestination || (cfError as { code?: string })?.code === "AUTHENTICATION_ERROR") {
			const holdMs = !isUnverifiedDestination && shouldHoldBeforeFailover(cfError) ? DEFAULT_FAILOVER_HOLD_MS : 0;
			const fallbackResult = await tryMailHubFallbacks(env, message, idempotencyKey, ["cloudflare"], holdMs);
			if (fallbackResult) return fallbackResult;
		}

		if (isUnverifiedDestination) {
			throw new Error(
				"[MailHub:CLOUDFLARE] TRANSIENT_SERVER_ERROR: destination address is not a verified address — Cloudflare's free send_email binding only delivers to verified destination addresses in your Cloudflare account. Configure an outbound provider (Brevo, Resend, SendPulse, ZeptoMail, or SES) in MailHub Provider Keys to send to any email address.",
			);
		}

		throw cfError;
	}
}
