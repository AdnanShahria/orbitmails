import { getEmailAddress, getEmailDisplayName } from "@/lib/email/address";
import type { OutboundProviderMessage } from "@/lib/email/outbound-provider-types";
import { ProviderError } from "./error";
import type {
	BrevoCredentials,
	ProviderAdapter,
	ProviderErrorCode,
	ProviderSendOptions,
	ProviderSendResult,
} from "./types";
import { fetchWithTimeout, mintMessageId, toBase64 } from "./utils";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export class BrevoAdapter implements ProviderAdapter<BrevoCredentials> {
	readonly provider = "brevo" as const;

	async send(
		credentials: BrevoCredentials,
		message: OutboundProviderMessage,
		options?: ProviderSendOptions,
	): Promise<ProviderSendResult> {
		if (!credentials?.apiKey) {
			throw new ProviderError({
				message: "Brevo API key is missing or empty",
				code: "AUTHENTICATION_ERROR",
				provider: this.provider,
			});
		}

		const senderEmail = getEmailAddress(message.from);
		const senderName = getEmailDisplayName(message.from);
		const messageId = message.headers?.["Message-ID"] ?? mintMessageId(message.from);

		const tags = options?.tags ? Object.values(options.tags) : undefined;

		const payload: Record<string, any> = {
			sender: { email: senderEmail, ...(senderName ? { name: senderName } : {}) },
			to: message.to.map((addr) => ({ email: getEmailAddress(addr) })),
			...(message.cc?.length ? { cc: message.cc.map((addr) => ({ email: getEmailAddress(addr) })) } : {}),
			...(message.bcc?.length ? { bcc: message.bcc.map((addr) => ({ email: getEmailAddress(addr) })) } : {}),
			subject: message.subject,
			htmlContent: message.html,
			textContent: message.text,
			headers: { ...message.headers, "Message-ID": messageId },
			...(message.attachments?.length
				? {
						attachment: message.attachments.map((attachment) => ({
							name: attachment.filename,
							content: toBase64(attachment.content),
						})),
				  }
				: {}),
			...(tags?.length ? { tags } : {}),
		};

		const startTime = performance.now();
		let response: Response;

		try {
			response = await fetchWithTimeout(
				BREVO_ENDPOINT,
				{
					method: "POST",
					headers: {
						"api-key": credentials.apiKey.trim(),
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
				message?: string;
				code?: string;
			} | null;
			throw this.parseError(
				new Error(body?.message ?? `Brevo HTTP error ${response.status}`),
				response.status,
				body,
			);
		}

		const data = (await response.json().catch(() => null)) as { messageId?: string } | null;
		const providerMessageId = data?.messageId ?? messageId;

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
		const raw = (responseBody || {}) as { message?: string; code?: string };
		const status = responseStatus;
		const brevoCode = (raw.code || "").toLowerCase();
		const errMessage = raw.message || (error instanceof Error ? error.message : String(error));

		let code: ProviderErrorCode = "TRANSIENT_SERVER_ERROR";

		// 1. Quota / Credits / Rate Limit
		if (
			status === 402 ||
			status === 429 ||
			brevoCode === "not_enough_credits" ||
			brevoCode === "quota_exceeded" ||
			brevoCode === "reseller_permission_denied" ||
			errMessage.toLowerCase().includes("credit") ||
			errMessage.toLowerCase().includes("quota")
		) {
			code = "QUOTA_EXCEEDED";
		}
		// 2. Authentication / Permissions
		else if (
			status === 401 ||
			status === 403 ||
			brevoCode === "unauthorized" ||
			brevoCode === "bad_api_key" ||
			brevoCode === "account_suspended"
		) {
			code = "AUTHENTICATION_ERROR";
		}
		// 3. Invalid Payload / Bad recipient / Bad domain
		else if (
			status === 400 ||
			status === 422 ||
			brevoCode === "invalid_parameter" ||
			brevoCode === "missing_parameter" ||
			brevoCode === "duplicate_parameter"
		) {
			code = "INVALID_PAYLOAD";
		}
		// 4. Server Error / Network Timeout
		else if (!status || status >= 500 || errMessage.includes("abort") || errMessage.includes("timeout")) {
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
