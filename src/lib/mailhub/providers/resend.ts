import type { OutboundProviderMessage } from "@/lib/email/outbound-provider-types";
import { ProviderError } from "./error";
import type {
	ProviderAdapter,
	ProviderErrorCode,
	ProviderSendOptions,
	ProviderSendResult,
	ResendCredentials,
} from "./types";
import { fetchWithTimeout, mintMessageId, toBase64 } from "./utils";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export class ResendAdapter implements ProviderAdapter<ResendCredentials> {
	readonly provider = "resend" as const;

	async send(
		credentials: ResendCredentials,
		message: OutboundProviderMessage,
		options?: ProviderSendOptions,
	): Promise<ProviderSendResult> {
		if (!credentials?.apiKey) {
			throw new ProviderError({
				message: "Resend API key is missing or empty",
				code: "AUTHENTICATION_ERROR",
				provider: this.provider,
			});
		}

		const messageId = message.headers?.["Message-ID"] ?? mintMessageId(message.from);

		const tags = options?.tags
			? Object.entries(options.tags).map(([name, value]) => ({ name, value }))
			: undefined;

		const payload: Record<string, any> = {
			from: message.from,
			to: message.to,
			...(message.cc?.length ? { cc: message.cc } : {}),
			...(message.bcc?.length ? { bcc: message.bcc } : {}),
			subject: message.subject,
			html: message.html,
			text: message.text,
			headers: { ...message.headers, "Message-ID": messageId },
			attachments: message.attachments?.map((attachment) => ({
				filename: attachment.filename,
				content: toBase64(attachment.content),
				content_type: attachment.type,
				...(attachment.disposition === "inline" && attachment.contentId
					? { content_id: attachment.contentId }
					: {}),
			})),
			...(tags?.length ? { tags } : {}),
		};

		const startTime = performance.now();
		let response: Response;

		try {
			response = await fetchWithTimeout(
				RESEND_ENDPOINT,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${credentials.apiKey.trim()}`,
						"Content-Type": "application/json",
						...(options?.idempotencyKey
							? { "Idempotency-Key": options.idempotencyKey }
							: {}),
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
				name?: string;
				statusCode?: number;
			} | null;
			throw this.parseError(
				new Error(body?.message ?? `Resend HTTP error ${response.status}`),
				response.status,
				body,
			);
		}

		const data = (await response.json().catch(() => null)) as { id?: string } | null;
		const providerMessageId = data?.id ? `<${data.id}@resend.com>` : messageId;

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
			message?: string;
			name?: string;
			statusCode?: number;
		};
		const status = responseStatus || raw.statusCode;
		const name = (raw.name || "").toLowerCase();
		const errMessage = raw.message || (error instanceof Error ? error.message : String(error));
		const lowerMsg = errMessage.toLowerCase();

		let code: ProviderErrorCode = "TRANSIENT_SERVER_ERROR";

		// 1. Quota / Rate limit
		if (
			status === 429 ||
			name === "rate_limit_exceeded" ||
			name === "daily_quota_exceeded" ||
			lowerMsg.includes("rate limit") ||
			lowerMsg.includes("quota")
		) {
			code = "QUOTA_EXCEEDED";
		}
		// 2. Authentication
		else if (
			status === 401 ||
			status === 403 ||
			name === "invalid_api_key" ||
			name === "missing_api_key" ||
			name === "restricted_api_key" ||
			lowerMsg.includes("api key")
		) {
			code = "AUTHENTICATION_ERROR";
		}
		// 3. Validation / Invalid Payload
		else if (
			status === 400 ||
			status === 422 ||
			name === "validation_error" ||
			name === "missing_required_field" ||
			name === "invalid_from_address" ||
			name === "domain_not_verified" ||
			lowerMsg.includes("validation") ||
			lowerMsg.includes("verify")
		) {
			code = "INVALID_PAYLOAD";
		}
		// 4. Server error or timeout
		else if (!status || status >= 500 || lowerMsg.includes("abort") || lowerMsg.includes("timeout")) {
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
