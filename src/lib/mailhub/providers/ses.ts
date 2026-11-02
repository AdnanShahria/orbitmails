import { AwsError } from "@/lib/aws/client";
import { sendSesEmail } from "@/lib/aws/ses";
import type { OutboundProviderMessage } from "@/lib/email/outbound-provider-types";
import { ProviderError } from "./error";
import type {
	ProviderAdapter,
	ProviderErrorCode,
	ProviderSendOptions,
	ProviderSendResult,
	SesCredentials,
} from "./types";
import { mintMessageId } from "./utils";

export class SesAdapter implements ProviderAdapter<SesCredentials> {
	readonly provider = "ses" as const;

	async send(
		credentials: SesCredentials,
		message: OutboundProviderMessage,
		_options?: ProviderSendOptions,
	): Promise<ProviderSendResult> {
		if (!credentials?.accessKeyId || !credentials?.secretAccessKey || !credentials?.region) {
			throw new ProviderError({
				message: "AWS SES credentials incomplete (missing accessKeyId, secretAccessKey, or region)",
				code: "AUTHENTICATION_ERROR",
				provider: this.provider,
			});
		}

		const startTime = performance.now();
		const messageId = message.headers?.["Message-ID"] ?? mintMessageId(message.from);

		try {
			const result = await sendSesEmail(credentials, {
				from: message.from,
				to: message.to,
				cc: message.cc,
				bcc: message.bcc,
				subject: message.subject,
				html: message.html,
				text: message.text,
				headers: { ...message.headers, "Message-ID": messageId },
				attachments: message.attachments?.map((attachment) => ({
					filename: attachment.filename,
					type: attachment.type,
					content: attachment.content,
					disposition: attachment.disposition,
					contentId: attachment.contentId,
				})),
			});

			const latencyMs = Math.round(performance.now() - startTime);

			return {
				success: true,
				provider: this.provider,
				messageId: result.messageId || messageId,
				providerMessageId: result.messageId,
				timestamp: Date.now(),
				latencyMs,
				raw: result,
			};
		} catch (err) {
			throw this.parseError(err);
		}
	}

	parseError(error: unknown, responseStatus?: number, responseBody?: unknown): ProviderError {
		const isAwsErr = error instanceof AwsError;
		const anyErr = error as any;
		const status = responseStatus || (isAwsErr ? error.status : anyErr?.status);
		const awsCode = (isAwsErr ? error.code : anyErr?.code) || "";
		const message = error instanceof Error ? error.message : String(error);
		const lower = message.toLowerCase();

		let code: ProviderErrorCode = "TRANSIENT_SERVER_ERROR";

		// 1. Quota / Sending limits / Throttling
		if (
			status === 429 ||
			/LimitExceeded|AccountSendingPaused|SendingPaused|Throttling|DailyQuotaExceeded/i.test(awsCode) ||
			lower.includes("daily sending quota exceeded") ||
			lower.includes("rate limit") ||
			lower.includes("throttling")
		) {
			code = "QUOTA_EXCEEDED";
		}
		// 2. Authentication / Permissions
		else if (
			(isAwsErr && error.accessDenied) ||
			anyErr?.accessDenied ||
			status === 401 ||
			status === 403 ||
			/InvalidClientTokenId|SignatureDoesNotMatch|AccessDenied|AuthFailure|NotAuthorized/i.test(awsCode) ||
			lower.includes("security token") ||
			lower.includes("access denied") ||
			lower.includes("signature")
		) {
			code = "AUTHENTICATION_ERROR";
		}
		// 3. Invalid Payload / Unverified identity / Bad recipient
		else if (
			status === 400 ||
			/MessageRejected|MailFromDomainNotVerified|NotFoundException|ValidationException/i.test(awsCode) ||
			lower.includes("unverified") ||
			lower.includes("rejected") ||
			lower.includes("illegal") ||
			lower.includes("invalid parameter")
		) {
			code = "INVALID_PAYLOAD";
		}
		// 4. Transient AWS Server / Network Error
		else if (!status || status >= 500 || /ServiceUnavailable|InternalServiceError/i.test(awsCode)) {
			code = "TRANSIENT_SERVER_ERROR";
		}

		return new ProviderError({
			message,
			code,
			provider: this.provider,
			statusCode: status,
			rawResponse: responseBody,
			cause: error,
		});
	}
}
