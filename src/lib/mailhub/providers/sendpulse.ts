import { getEmailAddress, getEmailDisplayName } from "@/lib/email/address";
import type { OutboundProviderMessage } from "@/lib/email/outbound-provider-types";
import { ProviderError } from "./error";
import type {
	ProviderAdapter,
	ProviderErrorCode,
	ProviderSendOptions,
	ProviderSendResult,
	SendPulseCredentials,
} from "./types";
import { fetchWithTimeout, mintMessageId, toBase64 } from "./utils";

const SENDPULSE_ENDPOINT = "https://api.sendpulse.com/smtp/emails";

function toSendPulseRecipient(addr: string): { email: string; name?: string } {
	const email = getEmailAddress(addr);
	const name = getEmailDisplayName(addr);
	return name ? { email, name } : { email };
}

/**
 * SendPulse transactional SMTP REST adapter.
 * Uses a static API key (e.g. `sp_apikey_...`) as a Bearer token against `/smtp/emails`.
 */
export class SendPulseAdapter implements ProviderAdapter<SendPulseCredentials> {
	readonly provider = "sendpulse" as const;

	async send(
		credentials: SendPulseCredentials,
		message: OutboundProviderMessage,
		options?: ProviderSendOptions,
	): Promise<ProviderSendResult> {
		if (!credentials?.apiKey?.trim()) {
			throw new ProviderError({
				message: "SendPulse API key is missing or empty",
				code: "AUTHENTICATION_ERROR",
				provider: this.provider,
			});
		}

		const senderEmail = getEmailAddress(message.from);
		const senderName = getEmailDisplayName(message.from);
		const messageId = message.headers?.["Message-ID"] ?? mintMessageId(message.from);

		const emailPayload: Record<string, any> = {
			subject: message.subject,
			from: senderName ? { name: senderName, email: senderEmail } : { email: senderEmail },
			to: message.to.map(toSendPulseRecipient),
			...(message.cc?.length ? { cc: message.cc.map(toSendPulseRecipient) } : {}),
			...(message.bcc?.length ? { bcc: message.bcc.map(toSendPulseRecipient) } : {}),
			...(message.text ? { text: message.text } : {}),
			...(message.html
				? { html: toBase64(new TextEncoder().encode(message.html).buffer as ArrayBuffer) }
				: {}),
			...(message.attachments?.length
				? {
						attachments_binary: Object.fromEntries(
							message.attachments.map((att) => [att.filename, toBase64(att.content)]),
						),
					}
				: {}),
		};

		const startTime = performance.now();
		let response: Response;

		try {
			response = await fetchWithTimeout(
				SENDPULSE_ENDPOINT,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${credentials.apiKey.trim()}`,
						"Content-Type": "application/json",
						Accept: "application/json",
					},
					body: JSON.stringify({ email: emailPayload }),
				},
				options?.timeoutMs ?? 15000,
			);
		} catch (err) {
			const latencyMs = Math.round(performance.now() - startTime);
			throw this.parseError(err, undefined, { latencyMs });
		}

		const latencyMs = Math.round(performance.now() - startTime);
		const data = (await response.json().catch(() => null)) as {
			result?: boolean;
			id?: string;
			message?: string;
			error_code?: number;
		} | null;

		if (!response.ok || data?.result === false) {
			throw this.parseError(
				new Error(data?.message ?? `SendPulse HTTP error ${response.status}`),
				response.status,
				data,
			);
		}

		return {
			success: true,
			provider: this.provider,
			messageId,
			providerMessageId: data?.id ? String(data.id) : messageId,
			timestamp: Date.now(),
			latencyMs,
			raw: data,
		};
	}

	parseError(error: unknown, responseStatus?: number, responseBody?: unknown): ProviderError {
		const raw = (responseBody || {}) as {
			message?: string;
			error?: string;
			error_code?: number;
		};
		const status = responseStatus;
		const errMessage = raw.message || raw.error || (error instanceof Error ? error.message : String(error));
		const lowerMsg = errMessage.toLowerCase();

		let code: ProviderErrorCode = "TRANSIENT_SERVER_ERROR";

		if (
			status === 429 ||
			status === 402 ||
			lowerMsg.includes("quota") ||
			lowerMsg.includes("limit") ||
			lowerMsg.includes("too many requests")
		) {
			code = "QUOTA_EXCEEDED";
		} else if (
			status === 401 ||
			status === 403 ||
			lowerMsg.includes("unauthorized") ||
			lowerMsg.includes("invalid token") ||
			lowerMsg.includes("api key") ||
			lowerMsg.includes("authentication")
		) {
			code = "AUTHENTICATION_ERROR";
		} else if (
			status === 400 ||
			status === 422 ||
			lowerMsg.includes("invalid") ||
			lowerMsg.includes("sender") ||
			lowerMsg.includes("recipient") ||
			lowerMsg.includes("empty")
		) {
			code = "INVALID_PAYLOAD";
		} else if (!status || status >= 500 || lowerMsg.includes("abort") || lowerMsg.includes("timeout")) {
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
