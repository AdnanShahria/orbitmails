import { NextResponse } from "next/server";
import { logger } from "@/lib/logging/logger";

export interface ApiErrorOptions {
	status?: number;
	code?: string;
	details?: unknown;
	headers?: Record<string, string>;
}

/**
 * Standard API error response helper.
 * - In production: strips verbose error messages, internal SQL errors, and stack traces.
 * - Strips server signatures (X-Powered-By, Server).
 * - Emits structured JSON log with sanitized error context.
 */
export function createErrorResponse(
	errorOrMessage: unknown,
	options: ApiErrorOptions = {},
): NextResponse {
	const status = options.status ?? 500;
	const isProd = process.env.NODE_ENV === "production";

	let publicMessage = "An unexpected error occurred.";
	let internalMessage = "";

	if (typeof errorOrMessage === "string") {
		internalMessage = errorOrMessage;
		publicMessage = isProd && status >= 500 ? "Internal Server Error" : errorOrMessage;
	} else if (errorOrMessage instanceof Error) {
		internalMessage = errorOrMessage.message;
		publicMessage = isProd && status >= 500 ? "Internal Server Error" : errorOrMessage.message;
	}

	// Structured log with full internal details
	logger.error(`API Error [${status}]: ${internalMessage || publicMessage}`, {
		status,
		code: options.code,
		details: options.details,
	}, errorOrMessage);

	const body: { error: string; code?: string; details?: unknown } = {
		error: publicMessage,
	};

	if (options.code) {
		body.code = options.code;
	}

	if (!isProd && options.details) {
		body.details = options.details;
	}

	const response = NextResponse.json(body, {
		status,
		headers: {
			"Cache-Control": "no-store, no-cache, must-revalidate",
			...options.headers,
		},
	});

	// Strip server headers
	response.headers.delete("x-powered-by");
	response.headers.delete("server");

	return response;
}

