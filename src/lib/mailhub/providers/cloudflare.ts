import type { OutboundProviderMessage } from "@/lib/email/outbound-provider-types";
import { ProviderError } from "./error";
import type {
	CloudflareCredentials,
	ProviderAdapter,
	ProviderErrorCode,
	ProviderSendOptions,
	ProviderSendResult,
} from "./types";
import { CANONICAL_OUTBOUND_SENDER, fetchWithTimeout, mintMessageId, resolveCanonicalOutboundSender, toBase64 } from "./utils";

async function sendViaCloudflareRestApi(
	accountId: string,
	token: string,
	payload: {
		from: string;
		to: string[];
		cc?: string[];
		bcc?: string[];
		subject: string;
		headers?: Record<string, string>;
		html?: string;
		text?: string;
		attachments?: Array<{
			filename: string;
			type: string;
			content: ArrayBuffer;
			disposition: "attachment" | "inline";
			contentId?: string;
		}>;
	},
	messageId: string,
	timeoutMs = 15000,
): Promise<{ messageId: string }> {
	const replyTo = payload.headers?.["Reply-To"] || payload.headers?.["reply-to"];
	const response = await fetchWithTimeout(
		`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/sending/send`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				from: payload.from,
				to: payload.to,
				...(payload.cc?.length ? { cc: payload.cc } : {}),
				...(payload.bcc?.length ? { bcc: payload.bcc } : {}),
				...(replyTo ? { reply_to: replyTo } : {}),
				subject: payload.subject,
				text: payload.text,
				html: payload.html,
				headers: { ...(payload.headers ?? {}), "Message-ID": messageId },
				attachments: payload.attachments?.map((attachment) => ({
					filename: attachment.filename,
					type: attachment.type,
					content: toBase64(attachment.content),
					disposition: attachment.disposition,
					...(attachment.contentId ? { content_id: attachment.contentId } : {}),
				})),
			}),
		},
		timeoutMs,
	);

	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		const error = new Error(`Cloudflare Email Sending failed (${response.status}): ${detail.slice(0, 300)}`);
		(error as any).statusCode = response.status;
		throw error;
	}

	return { messageId };
}

export class CloudflareEmailAdapter implements ProviderAdapter<CloudflareCredentials> {
	readonly provider = "cloudflare" as const;

	async send(
		credentials: CloudflareCredentials,
		message: OutboundProviderMessage,
		options?: ProviderSendOptions,
		env?: any,
	): Promise<ProviderSendResult> {
		const emailBinding =
			credentials?.emailBinding && typeof credentials.emailBinding.send === "function"
				? credentials.emailBinding
				: env?.EMAIL && typeof env.EMAIL.send === "function"
					? env.EMAIL
					: undefined;

		const processEnv: Record<string, string | undefined> =
			typeof process !== "undefined" && process.env ? process.env : {};
		const cfAccountId = (credentials?.accountId || env?.CF_ACCOUNT_ID || processEnv.CF_ACCOUNT_ID || "").trim();
		const cfToken = (credentials?.token || credentials?.apiKey || env?.CF_TOKEN || processEnv.CF_TOKEN || "").trim();

		if (!emailBinding && !(cfAccountId && cfToken)) {
			throw new ProviderError({
				message: "Cloudflare EMAIL binding is not available in environment or credentials",
				code: "AUTHENTICATION_ERROR",
				provider: this.provider,
			});
		}

		const dispatch = (payload: Parameters<NonNullable<CloudflareCredentials["emailBinding"]>["send"]>[0], msgId: string) =>
			emailBinding
				? emailBinding.send(payload)
				: sendViaCloudflareRestApi(cfAccountId, cfToken, payload, msgId, options?.timeoutMs);

		// Normalize outbound sender to canonical verified mail.orbitsaas.cloud domain (preserving display name & Reply-To)
		const rawFrom = typeof message.from === "string" ? message.from : (message.from as any)?.address || "";
		const canonical = resolveCanonicalOutboundSender(rawFrom, message.headers, CANONICAL_OUTBOUND_SENDER);
		const normalizedHeaders = Object.keys(canonical.headers).length ? canonical.headers : undefined;

		const startTime = performance.now();
		const messageId = canonical.headers["Message-ID"] ?? mintMessageId(canonical.from);
		const attachments = message.attachments?.map((attachment) =>
			attachment.disposition === "inline" && attachment.contentId
				? {
						filename: attachment.filename,
						type: attachment.type,
						content: attachment.content,
						disposition: "inline" as const,
						contentId: attachment.contentId,
				  }
				: {
						filename: attachment.filename,
						type: attachment.type,
						content: attachment.content,
						disposition: "attachment" as const,
				  },
		);

		const sendPayload = {
			from: canonical.from,
			to: message.to,
			...(message.cc?.length ? { cc: message.cc } : {}),
			...(message.bcc?.length ? { bcc: message.bcc } : {}),
			subject: message.subject,
			headers: normalizedHeaders,
			html: message.html,
			text: message.text,
			attachments,
		};

		try {
			const response = await dispatch(sendPayload, messageId);

			const latencyMs = Math.round(performance.now() - startTime);
			const returnedId = response?.messageId ?? messageId;

			return {
				success: true,
				provider: this.provider,
				messageId: returnedId,
				providerMessageId: returnedId,
				timestamp: Date.now(),
				latencyMs,
				raw: response,
			};
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			const lowerErr = errMsg.toLowerCase();
			const isRateLimit =
				lowerErr.includes("rate limit") ||
				lowerErr.includes("quota exceeded") ||
				lowerErr.includes("too many requests") ||
				lowerErr.includes("429");

			if (emailBinding && !isRateLimit && cfAccountId && cfToken) {
				try {
					const restRes = await sendViaCloudflareRestApi(
						cfAccountId,
						cfToken,
						sendPayload,
						messageId,
						options?.timeoutMs,
					);
					const latencyMs = Math.round(performance.now() - startTime);
					const returnedId = restRes?.messageId ?? messageId;
					return {
						success: true,
						provider: this.provider,
						messageId: returnedId,
						providerMessageId: returnedId,
						timestamp: Date.now(),
						latencyMs,
						raw: restRes,
					};
				} catch {
					// Fall through to verified hostname / provider error handling
				}
			}

			if (!isRateLimit && env?.DB) {
				try {
					const row = await env.DB.prepare(
						"SELECT hostname FROM domains WHERE length(zone_id) = 32 AND status = 'active' AND sending_enabled = 1 ORDER BY CASE WHEN hostname = 'mail.orbitsaas.cloud' THEN 0 ELSE 1 END LIMIT 1",
					).first();
					const verifiedHostname = row?.hostname ? String(row.hostname).trim().toLowerCase() : "";

					if (verifiedHostname && !canonical.from.toLowerCase().includes(`@${verifiedHostname}`)) {
						const fallbackCanonical = resolveCanonicalOutboundSender(
							rawFrom,
							message.headers,
							`contact@${verifiedHostname}`,
						);
						const fallbackMsgId = fallbackCanonical.headers["Message-ID"] ?? mintMessageId(fallbackCanonical.from);
						const retryRes = await dispatch(
							{
								...sendPayload,
								from: fallbackCanonical.from,
								headers: Object.keys(fallbackCanonical.headers).length
									? fallbackCanonical.headers
									: undefined,
							},
							fallbackMsgId,
						);
						const latencyMs = Math.round(performance.now() - startTime);
						const returnedId = retryRes?.messageId ?? fallbackMsgId;
						return {
							success: true,
							provider: this.provider,
							messageId: returnedId,
							providerMessageId: returnedId,
							timestamp: Date.now(),
							latencyMs,
							raw: retryRes,
						};
					}
				} catch {
					// Fall through to throw original provider error
				}
			}

			throw this.parseError(err, (err as any)?.statusCode);
		}
	}

	parseError(error: unknown, responseStatus?: number, responseBody?: unknown): ProviderError {
		const message = error instanceof Error ? error.message : String(error);
		const lower = message.toLowerCase();

		let code: ProviderErrorCode = "TRANSIENT_SERVER_ERROR";
		const isUnverifiedDestination =
			lower.includes("destination address is not a verified address") ||
			lower.includes("not a verified address");

		// 1. Quota / Burst limit exceeded
		if (
			lower.includes("rate limit") ||
			lower.includes("quota exceeded") ||
			lower.includes("daily limit") ||
			lower.includes("too many requests") ||
			responseStatus === 429
		) {
			code = "QUOTA_EXCEEDED";
		}
		// 2. Authentication or binding missing
		else if (
			lower.includes("unauthorized") ||
			lower.includes("not enabled") ||
			lower.includes("permission denied") ||
			responseStatus === 401 ||
			responseStatus === 403
		) {
			code = "AUTHENTICATION_ERROR";
		}
		// 3. Unverified destination on Cloudflare Email Routing -> failover to transactional providers
		else if (isUnverifiedDestination) {
			code = "TRANSIENT_SERVER_ERROR";
		}
		// 4. Domain not verified / Invalid sender / Invalid recipient
		else if (
			lower.includes("not verified") ||
			lower.includes("invalid sender") ||
			lower.includes("invalid recipient") ||
			lower.includes("email routing is not configured") ||
			responseStatus === 400
		) {
			code = "INVALID_PAYLOAD";
		}

		return new ProviderError({
			message,
			code,
			provider: this.provider,
			statusCode: responseStatus,
			rawResponse: responseBody,
			cause: error,
		});
	}
}
