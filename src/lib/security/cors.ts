/**
 * OrbitMails - Strict Cross-Origin Resource Sharing (CORS) Engine
 * @module lib/security/cors
 */

import { NextResponse } from "next/server";

export interface CorsConfig {
	allowedOrigins?: string[];
	allowedMethods?: string[];
	allowedHeaders?: string[];
	allowCredentials?: boolean;
	maxAge?: number;
}

const DEFAULT_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const DEFAULT_HEADERS = [
	"Authorization",
	"Content-Type",
	"X-Requested-With",
	"api-key",
	"x-api-key",
	"x-resend-api-key",
	"Idempotency-Key",
];

export function getValidatedOrigin(request: Request, allowedOrigins?: string[]): string | null {
	const origin = request.headers.get("origin");
	if (!origin) return null;

	if (!allowedOrigins || allowedOrigins.length === 0 || allowedOrigins.includes("*")) {
		// When no origin whitelist is specified, verify that the scheme is https/http
		try {
			const parsed = new URL(origin);
			if (parsed.protocol === "https:" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
				return origin;
			}
		} catch {
			return null;
		}
		return origin;
	}

	const isAllowed = allowedOrigins.some((allowed) => {
		if (allowed === origin) return true;
		if (allowed.startsWith("*.")) {
			const domain = allowed.slice(2);
			try {
				const originHost = new URL(origin).hostname;
				return originHost.endsWith(domain);
			} catch {
				return false;
			}
		}
		return false;
	});

	return isAllowed ? origin : null;
}

export function handleCorsPreflight(request: Request, config: CorsConfig = {}): NextResponse {
	const validatedOrigin = getValidatedOrigin(request, config.allowedOrigins);
	const headers: Record<string, string> = {
		"Access-Control-Allow-Methods": (config.allowedMethods ?? DEFAULT_METHODS).join(", "),
		"Access-Control-Allow-Headers": (config.allowedHeaders ?? DEFAULT_HEADERS).join(", "),
		"Access-Control-Max-Age": String(config.maxAge ?? 86400),
	};

	if (validatedOrigin) {
		headers["Access-Control-Allow-Origin"] = validatedOrigin;
		if (config.allowCredentials !== false) {
			headers["Access-Control-Allow-Credentials"] = "true";
		}
	} else if (config.allowedOrigins?.includes("*")) {
		headers["Access-Control-Allow-Origin"] = "*";
	}

	return new NextResponse(null, {
		status: 204,
		headers,
	});
}

export function applyCorsHeaders(
	response: Response,
	request: Request,
	config: CorsConfig = {},
): Response {
	const validatedOrigin = getValidatedOrigin(request, config.allowedOrigins);

	if (validatedOrigin) {
		response.headers.set("Access-Control-Allow-Origin", validatedOrigin);
		if (config.allowCredentials !== false) {
			response.headers.set("Access-Control-Allow-Credentials", "true");
		}
	} else if (config.allowedOrigins?.includes("*")) {
		response.headers.set("Access-Control-Allow-Origin", "*");
	}

	return response;
}

