import type { AwsConfig } from "@/lib/aws/aws-types";
import type {
	OutboundProviderAttachment,
	OutboundProviderMessage,
} from "@/lib/email/outbound-provider-types";

export type MailHubProviderType =
	| "brevo"
	| "resend"
	| "ses"
	| "zeptomail"
	| "mailgun"
	| "cloudflare";

export type ProviderErrorCode =
	| "QUOTA_EXCEEDED"
	| "AUTHENTICATION_ERROR"
	| "TRANSIENT_SERVER_ERROR"
	| "INVALID_PAYLOAD";

export interface ProviderSendOptions {
	idempotencyKey?: string;
	timeoutMs?: number;
	tags?: Record<string, string>;
	metadata?: Record<string, string>;
	trackOpens?: boolean;
	trackClicks?: boolean;
}

export interface ProviderSendResult {
	success: true;
	provider: MailHubProviderType;
	messageId: string;
	providerMessageId?: string;
	timestamp: number;
	latencyMs: number;
	raw?: unknown;
}

export interface BrevoCredentials {
	apiKey: string;
}

export interface ResendCredentials {
	apiKey: string;
}

export interface ZeptoMailCredentials {
	sendMailToken: string;
	bounceAddress?: string;
}

export interface SesCredentials extends AwsConfig {}

export interface MailgunCredentials {
	apiKey: string;
	domain: string;
	region?: "us" | "eu";
}

export interface CloudflareCredentials {
	emailBinding?: {
		send(message: {
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
		}): Promise<{ messageId: string }>;
	};
}

export type AnyProviderCredentials =
	| ({ provider: "brevo" } & BrevoCredentials)
	| ({ provider: "resend" } & ResendCredentials)
	| ({ provider: "ses" } & SesCredentials)
	| ({ provider: "zeptomail" } & ZeptoMailCredentials)
	| ({ provider: "mailgun" } & MailgunCredentials)
	| ({ provider: "cloudflare" } & CloudflareCredentials);

export interface ProviderAdapter<TCreds = any> {
	readonly provider: MailHubProviderType;
	send(
		credentials: TCreds,
		message: OutboundProviderMessage,
		options?: ProviderSendOptions,
		env?: any,
	): Promise<ProviderSendResult>;
	parseError(
		error: unknown,
		responseStatus?: number,
		responseBody?: unknown,
	): import("./error").ProviderError;
}
