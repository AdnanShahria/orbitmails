import { getEmailAddress } from "@/lib/email/address";
import type { OutboundProviderMessage } from "@/lib/email/outbound-provider-types";
import { ProviderError } from "./error";
import type {
	MailgunCredentials,
	ProviderAdapter,
	ProviderErrorCode,
	ProviderSendOptions,
	ProviderSendResult,
} from "./types";
import { fetchWithTimeout, mintMessageId } from "./utils";

const MAILGUN_US_BASE = "https://api.mailgun.net/v3";
const MAILGUN_EU_BASE = "https://api.eu.mailgun.net/v3";

export class MailgunAdapter implements ProviderAdapter<MailgunCredentials> {
	readonly provider = "mailgun" as const;

	async send(
		credentials: MailgunCredentials,
		message: OutboundProviderMessage,
		options?: ProviderSendOptions,
	): Promise<ProviderSendResult> {
		if (!credentials?.apiKey) {
			throw new ProviderError({
				message: "Mailgun API key is missing or empty",
				code: "AUTHENTICATION_ERROR",
				provider: this.provider,
			});
		}

		const domain = credentials.domain?.trim() || getEmailAddress(message.from).split("@")[1];
		if (!domain) {
			throw new ProviderError({
				message: "Mailgun domain could not be determined from credentials or sender address",
				code: "INVALID_PAYLOAD",
				provider: this.provider,
			});
		}

		const baseUrl = credentials.region === "eu" ? MAILGUN_EU_BASE : MAILGUN_US_BASE;
		const endpoint = `${baseUrl}/${domain}/messages`;
		const messageId = message.headers?.["Message-ID"] ?? mintMessageId(message.from);

		const formData = new FormData();
		formData.append("from", message.from);
		for (const to of message.to) {
			formData.append("to", to);
		}
		if (message.cc?.length) {
			for (const cc of message.cc) {
				formData.append("cc", cc);
			}
		}
		if (message.bcc?.length) {
			for (const bcc of message.bcc) {
				formData.append("bcc", bcc);
			}
		}
		formData.append("subject", message.subject);
		if (message.text) formData.append("text", message.text);
		if (message.html) formData.append("html", message.html);

		// Headers
		formData.append("h:Message-ID", messageId);
		if (message.headers) {
			for (const [k, v] of Object.entries(message.headers)) {
				if (k.toLowerCase() !== "message-id") {
					formData.append(`h:${k}`, v);
				}
			}
		}

		// Tags & Tracking
		if (options?.tags) {
			for (const tag of Object.values(options.tags)) {
				formData.append("o:tag", tag);
			}
		}
		if (options?.trackOpens !== undefined) {
			formData.append("o:tracking-opens", options.trackOpens ? "yes" : "no");
		}
		if (options?.trackClicks !== undefined) {
			formData.append("o:tracking-clicks", options.trackClicks ? "yes" : "no");
		}

		// Attachments
		if (message.attachments?.length) {
			for (const attachment of message.attachments) {
				const blob = new Blob([attachment.content], { type: attachment.type });
				const field = attachment.disposition === "inline" ? "inline" : "attachment";
				formData.append(field, blob, attachment.filename);
			}
		}

		const basicAuth = btoa(`api:${credentials.apiKey.trim()}`);
		const startTime = performance.now();
		let response: Response;

		try {
			response = await fetchWithTimeout(
				endpoint,
				{
					method: "POST",
					headers: {
						Authorization: `Basic ${basicAuth}`,
						Accept: "application/json",
					},
					body: formData,
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
			} | null;
			throw this.parseError(
				new Error(body?.message ?? `Mailgun HTTP error ${response.status}`),
				response.status,
				body,
			);
		}

		const data = (await response.json().catch(() => null)) as {
			id?: string;
			message?: string;
		} | null;
		const providerMessageId = data?.id ?? messageId;

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
		const raw = (responseBody || {}) as { message?: string };
		const status = responseStatus;
		const errMessage = raw.message || (error instanceof Error ? error.message : String(error));
		const lowerMsg = errMessage.toLowerCase();

		let code: ProviderErrorCode = "TRANSIENT_SERVER_ERROR";

		// 1. Quota / Credits / Rate Limit
		if (
			status === 402 ||
			status === 429 ||
			lowerMsg.includes("payment required") ||
			lowerMsg.includes("credits") ||
			lowerMsg.includes("monthly limit") ||
			lowerMsg.includes("rate limit")
		) {
			code = "QUOTA_EXCEEDED";
		}
		// 2. Authentication
		else if (
			status === 401 ||
			status === 403 ||
			lowerMsg.includes("forbidden") ||
			lowerMsg.includes("unauthorized") ||
			lowerMsg.includes("invalid private key") ||
			lowerMsg.includes("disabled")
		) {
			code = "AUTHENTICATION_ERROR";
		}
		// 3. Invalid payload
		else if (
			status === 400 ||
			status === 422 ||
			lowerMsg.includes("syntax error") ||
			lowerMsg.includes("not a valid") ||
			lowerMsg.includes("parameter") ||
			lowerMsg.includes("to parameter is not")
		) {
			code = "INVALID_PAYLOAD";
		}
		// 4. Server error or timeout
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
