import { getEmailAddress, getEmailDisplayName } from "@/lib/email/address";
import type { OutboundProviderMessage } from "@/lib/email/outbound-provider-types";
import { ProviderError } from "./error";
import type {
	ProviderAdapter,
	ProviderErrorCode,
	ProviderSendOptions,
	ProviderSendResult,
	ZeptoMailCredentials,
} from "./types";
import { fetchWithTimeout, mintMessageId, toBase64 } from "./utils";

const ZEPTOMAIL_ENDPOINT = "https://api.zeptomail.com/v1.1/email";

export class ZeptoMailAdapter implements ProviderAdapter<ZeptoMailCredentials> {
	readonly provider = "zeptomail" as const;

	async send(
		credentials: ZeptoMailCredentials,
		message: OutboundProviderMessage,
		options?: ProviderSendOptions,
	): Promise<ProviderSendResult> {
		if (!credentials?.sendMailToken) {
			throw new ProviderError({
				message: "ZeptoMail send token is missing or empty",
				code: "AUTHENTICATION_ERROR",
				provider: this.provider,
			});
		}

		const senderEmail = getEmailAddress(message.from);
		const senderName = getEmailDisplayName(message.from);
		const domain = senderEmail.split("@")[1] || "orbitsaas.cloud";
		const effectiveBounce = credentials.bounceAddress || `bounce@${domain}`;
		const messageId = message.headers?.["Message-ID"] ?? mintMessageId(message.from);

		const token = credentials.sendMailToken.trim();
		const authHeader = token.startsWith("Zoho-enczapikey ")
			? token
			: `Zoho-enczapikey ${token}`;

		const payload: Record<string, any> = {
			bounce_address: effectiveBounce,
			from: { address: senderEmail, ...(senderName ? { name: senderName } : {}) },
			to: message.to.map((addr) => ({ email_address: { address: getEmailAddress(addr) } })),
			...(message.cc?.length
				? { cc: message.cc.map((addr) => ({ email_address: { address: getEmailAddress(addr) } })) }
				: {}),
			...(message.bcc?.length
				? { bcc: message.bcc.map((addr) => ({ email_address: { address: getEmailAddress(addr) } })) }
				: {}),
			subject: message.subject,
			htmlbody: message.html,
			textbody: message.text,
			...(message.attachments?.length
				? {
						attachments: message.attachments.map((attachment) => ({
							name: attachment.filename,
							mime_type: attachment.type,
							content: toBase64(attachment.content),
						})),
				  }
				: {}),
		};

		const startTime = performance.now();
		let response: Response;

		try {
			response = await fetchWithTimeout(
				ZEPTOMAIL_ENDPOINT,
				{
					method: "POST",
					headers: {
						Authorization: authHeader,
						"Content-Type": "application/json",
						Accept: "application/json",
					},
					body: JSON.stringify(payload),
				},
				options?.timeoutMs ?? 15000,
			);
		} catch (err) {
			const latencyMs = Math.round(performance.now() - startTime);
			throw this.parseError(err, undefined, { latencyMs });
		}

		const latencyMs = Math.round(performance.now() - startTime);

		if (!response.ok) {
			const body = (await response.json().catch(() => null)) as {
				error?: { message?: string; code?: string };
				message?: string;
			} | null;
			throw this.parseError(
				new Error(body?.error?.message ?? body?.message ?? `ZeptoMail HTTP error ${response.status}`),
				response.status,
				body,
			);
		}

		const data = (await response.json().catch(() => null)) as {
			data?: Array<{ response?: { message_id?: string } }>;
		} | null;
		const returnedId = data?.data?.[0]?.response?.message_id;
		const providerMessageId = returnedId ?? messageId;

		return {
			success: true,
			provider: this.provider,
			messageId,
			providerMessageId,
			timestamp: Date.now(),
			latencyMs,
			raw: data,
		};
	}

	parseError(error: unknown, responseStatus?: number, responseBody?: unknown): ProviderError {
		const raw = (responseBody || {}) as {
			error?: { message?: string; code?: string };
			message?: string;
		};
		const status = responseStatus;
		const zeptoCode = (raw.error?.code || "").toUpperCase();
		const errMessage =
			raw.error?.message ?? raw.message ?? (error instanceof Error ? error.message : String(error));
		const lowerMsg = errMessage.toLowerCase();

		let code: ProviderErrorCode = "TRANSIENT_SERVER_ERROR";

		// 1. Quota / Credits / Rate Limit
		if (
			status === 429 ||
			zeptoCode.includes("LIMIT") ||
			zeptoCode.includes("QUOTA") ||
			zeptoCode.includes("CREDIT") ||
			lowerMsg.includes("rate limit") ||
			lowerMsg.includes("quota exceeded") ||
			lowerMsg.includes("credits")
		) {
			code = "QUOTA_EXCEEDED";
		}
		// 2. Authentication
		else if (
			status === 401 ||
			status === 403 ||
			zeptoCode.includes("UNAUTHORIZED") ||
			zeptoCode.includes("TOKEN") ||
			zeptoCode.includes("AUTH") ||
			lowerMsg.includes("token") ||
			lowerMsg.includes("unauthorized")
		) {
			code = "AUTHENTICATION_ERROR";
		}
		// 3. Invalid payload
		else if (
			status === 400 ||
			status === 422 ||
			zeptoCode.includes("DATA") ||
			zeptoCode.includes("BAD_REQUEST") ||
			zeptoCode.includes("INVALID") ||
			lowerMsg.includes("invalid") ||
			lowerMsg.includes("format")
		) {
			code = "INVALID_PAYLOAD";
		}
		// 4. Server error
		else if (!status || status >= 500 || lowerMsg.includes("timeout") || lowerMsg.includes("abort")) {
			code = "TRANSIENT_SERVER_ERROR";
		}

		return new ProviderError({
			message: errMessage,
			code,
			provider: this.provider,
			statusCode: status,
			rawResponse: responseBody,
			cause: error,
		});
	}
}
