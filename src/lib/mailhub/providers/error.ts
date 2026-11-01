import type { MailHubProviderType, ProviderErrorCode } from "./types";

export type SuggestedAction =
	| "FAILOVER"
	| "ALERT_UNHEALTHY"
	| "REJECT_NO_FAILOVER";

export class ProviderError extends Error {
	readonly code: ProviderErrorCode;
	readonly provider: MailHubProviderType;
	readonly statusCode?: number;
	readonly rawResponse?: unknown;
	readonly retryable: boolean;
	readonly suggestedAction: SuggestedAction;

	constructor(params: {
		message: string;
		code: ProviderErrorCode;
		provider: MailHubProviderType;
		statusCode?: number;
		rawResponse?: unknown;
		cause?: unknown;
	}) {
		super(`[MailHub:${params.provider.toUpperCase()}] ${params.code}: ${params.message}`);
		this.name = "ProviderError";
		this.code = params.code;
		this.provider = params.provider;
		this.statusCode = params.statusCode;
		this.rawResponse = params.rawResponse;
		if (params.cause) {
			this.cause = params.cause;
		}

		switch (params.code) {
			case "QUOTA_EXCEEDED":
				this.retryable = true;
				this.suggestedAction = "FAILOVER";
				break;
			case "TRANSIENT_SERVER_ERROR":
				this.retryable = true;
				this.suggestedAction = "FAILOVER";
				break;
			case "AUTHENTICATION_ERROR":
				this.retryable = false;
				this.suggestedAction = "ALERT_UNHEALTHY";
				break;
			case "INVALID_PAYLOAD":
				this.retryable = false;
				this.suggestedAction = "REJECT_NO_FAILOVER";
				break;
		}
	}
}

export function isQuotaExceeded(error: unknown): boolean {
	return error instanceof ProviderError && error.code === "QUOTA_EXCEEDED";
}

export function isAuthError(error: unknown): boolean {
	return error instanceof ProviderError && error.code === "AUTHENTICATION_ERROR";
}

export function isTransientError(error: unknown): boolean {
	return error instanceof ProviderError && error.code === "TRANSIENT_SERVER_ERROR";
}

export function isInvalidPayload(error: unknown): boolean {
	return error instanceof ProviderError && error.code === "INVALID_PAYLOAD";
}

export function shouldFailover(error: unknown): boolean {
	if (error instanceof ProviderError) {
		return error.suggestedAction === "FAILOVER";
	}
	// Unknown errors default to transient so they can failover rather than crashing
	return true;
}

export function wrapAsProviderError(
	error: unknown,
	provider: MailHubProviderType,
	fallbackCode: ProviderErrorCode = "TRANSIENT_SERVER_ERROR",
): ProviderError {
	if (error instanceof ProviderError) {
		return error;
	}

	const message = error instanceof Error ? error.message : String(error);
	const lower = message.toLowerCase();

	// Check common patterns in message string if unclassified
	if (
		lower.includes("rate limit") ||
		lower.includes("quota") ||
		lower.includes("too many requests") ||
		lower.includes("not_enough_credits") ||
		lower.includes("429")
	) {
		return new ProviderError({
			message,
			code: "QUOTA_EXCEEDED",
			provider,
			cause: error,
		});
	}

	if (
		lower.includes("unauthorized") ||
		lower.includes("forbidden") ||
		lower.includes("api key") ||
		lower.includes("invalid key") ||
		lower.includes("invalid token") ||
		lower.includes("401") ||
		lower.includes("403")
	) {
		return new ProviderError({
			message,
			code: "AUTHENTICATION_ERROR",
			provider,
			cause: error,
		});
	}

	if (
		lower.includes("invalid email") ||
		lower.includes("bad recipient") ||
		lower.includes("invalid parameter") ||
		lower.includes("syntax error") ||
		lower.includes("400") ||
		lower.includes("422")
	) {
		return new ProviderError({
			message,
			code: "INVALID_PAYLOAD",
			provider,
			cause: error,
		});
	}

	return new ProviderError({
		message,
		code: fallbackCode,
		provider,
		cause: error,
	});
}
