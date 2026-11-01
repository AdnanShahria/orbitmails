import type { OutboundProviderMessage } from "@/lib/email/outbound-provider-types";
import { ProviderError } from "./error";
import type {
	CloudflareCredentials,
	ProviderAdapter,
	ProviderErrorCode,
	ProviderSendOptions,
	ProviderSendResult,
} from "./types";
import { mintMessageId } from "./utils";

export class CloudflareEmailAdapter implements ProviderAdapter<CloudflareCredentials> {
	readonly provider = "cloudflare" as const;

	async send(
		credentials: CloudflareCredentials,
		message: OutboundProviderMessage,
		_options?: ProviderSendOptions,
		env?: any,
	): Promise<ProviderSendResult> {
		const emailBinding = credentials?.emailBinding || env?.EMAIL;
		if (!emailBinding || typeof emailBinding.send !== "function") {
			throw new ProviderError({
				message: "Cloudflare EMAIL binding is not available in environment or credentials",
				code: "AUTHENTICATION_ERROR",
				provider: this.provider,
			});
		}

		const startTime = performance.now();
		const messageId = message.headers?.["Message-ID"] ?? mintMessageId(message.from);

		try {
			const response = await emailBinding.send({
				from: message.from,
				to: message.to,
				...(message.cc?.length ? { cc: message.cc } : {}),
				...(message.bcc?.length ? { bcc: message.bcc } : {}),
				subject: message.subject,
				headers: message.headers && Object.keys(message.headers).length ? message.headers : undefined,
				html: message.html,
				text: message.text,
				attachments: message.attachments?.map((attachment) =>
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
				),
			});

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
			throw this.parseError(err);
		}
	}

	parseError(error: unknown, responseStatus?: number, responseBody?: unknown): ProviderError {
		const message = error instanceof Error ? error.message : String(error);
		const lower = message.toLowerCase();

		let code: ProviderErrorCode = "TRANSIENT_SERVER_ERROR";

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
		// 3. Domain not verified / Invalid sender / Unverified destination
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
