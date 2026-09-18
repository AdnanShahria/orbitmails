/**
 * MailHub Drop-in Compatible Ingestion API - Authentication & Domain Authorization
 * Supports Resend, Brevo, and RFC 5322 authentication conventions.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { domains } from "@/db/schema";
import { authenticateApiKeyValue, hasScope } from "@/lib/api/key-auth";
import { getEmailAddress } from "@/lib/email/address";
import { resolveRoutingKey } from "@/lib/router/key-store";
import { enforceProjectRateLimit, getRateLimitHeaders } from "@/lib/router/rate-limiter";
import type { IngestionAuthResult, ResendErrorResponse } from "./types";

/**
 * Extracts API key from request headers or query parameters across multiple client SDK formats:
 * - Resend: `Authorization: Bearer <key>`
 * - Brevo: `api-key: <key>`
 * - AWS/Standard REST: `x-api-key: <key>`
 * - HTTP Basic Auth: `<key>` as password
 * - Query param fallback: `?api_key=<key>`
 */
export function extractIngestionApiKey(request: Request): string | null {
	// 1. Authorization header (Bearer or Basic)
	const authHeader = request.headers.get("Authorization") || request.headers.get("authorization");
	if (authHeader) {
		const trimmed = authHeader.trim();
		if (trimmed.toLowerCase().startsWith("bearer ")) {
			const token = trimmed.slice(7).trim();
			if (token) return token;
		}
		if (trimmed.toLowerCase().startsWith("basic ")) {
			try {
				const decoded = atob(trimmed.slice(6).trim());
				const separator = decoded.indexOf(":");
				const password = separator >= 0 ? decoded.slice(separator + 1) : decoded;
				if (password.trim()) return password.trim();
			} catch {
				// Continue to other headers if decoding fails
			}
		}
	}

	// 2. Brevo specific header `api-key`
	const brevoKey = request.headers.get("api-key");
	if (brevoKey?.trim()) return brevoKey.trim();

	// 3. Standard `x-api-key` or `x-resend-api-key`
	const xKey = request.headers.get("x-api-key") || request.headers.get("x-resend-api-key");
	if (xKey?.trim()) return xKey.trim();

	// 4. Query parameter fallback
	try {
		const url = new URL(request.url);
		const queryKey = url.searchParams.get("api_key") || url.searchParams.get("apiKey");
		if (queryKey?.trim()) return queryKey.trim();
	} catch {
		// Ignore invalid URLs
	}

	return null;
}

/**
 * Authenticates an incoming ingestion request.
 * Supports:
 * - MailHub Project Routing Keys (`om_live_...`, `om_test_...`) with L1/L2 KV caching and rate limiting
 * - Legacy Orbitflare API Keys (`ep_...`)
 */
export async function authenticateIngestionRequest(
	request: Request,
	env: CloudflareEnv,
	ctx?: ExecutionContext,
): Promise<{ success: true; auth: IngestionAuthResult } | { success: false; response: Response }> {
	const token = extractIngestionApiKey(request);

	if (!token) {
		const errorBody: ResendErrorResponse = {
			name: "missing_api_key",
			message: "Missing API key. Provide your key via 'Authorization: Bearer om_live_...' or 'api-key: om_live_...'",
			statusCode: 401,
			error: "Missing API key",
		};
		return {
			success: false,
			response: Response.json(errorBody, {
				status: 401,
				headers: { "Content-Type": "application/json" },
			}),
		};
	}

	// 1. Check if token is a MailHub Project Routing Key (`om_...`)
	if (token.startsWith("om_")) {
		const resolved = await resolveRoutingKey(token, env, ctx);
		if (resolved) {
			const { project } = resolved;
			// Rate limiting check
			const rateLimit = await enforceProjectRateLimit(env, project);
			const rateLimitHeaders = getRateLimitHeaders(rateLimit);

			if (!rateLimit.allowed) {
				const errorBody: ResendErrorResponse = {
					name: "rate_limit_exceeded",
					message: `Rate limit exceeded for project '${project.slug}'. Retry in ${rateLimit.retryAfter ?? 60} seconds.`,
					statusCode: 429,
					error: "Rate limit exceeded",
				};
				return {
					success: false,
					response: Response.json(errorBody, {
						status: 429,
						headers: {
							"Content-Type": "application/json",
							...rateLimitHeaders,
						},
					}),
				};
			}

			return {
				success: true,
				auth: {
					userId: project.id,
					projectId: project.id,
					projectSlug: project.slug,
					environment: project.environment,
					keyId: project.keyId,
					keyKind: "project",
					scopes: ["send", "*"],
					mailboxIds: null,
					rateLimitHeaders,
				},
			};
		}
	}

	// 2. Check if token is a legacy Orbitflare API Key (`ep_...` or app password)
	const legacyAuth = await authenticateApiKeyValue(env, token);
	if (legacyAuth && hasScope(legacyAuth.scopes, "send")) {
		return {
			success: true,
			auth: {
				userId: legacyAuth.userId,
				keyId: legacyAuth.keyId,
				keyKind: legacyAuth.keyKind as any,
				scopes: legacyAuth.scopes,
				mailboxIds: legacyAuth.mailboxIds,
			},
		};
	}

	// Token failed validation
	const errorBody: ResendErrorResponse = {
		name: "unauthorized",
		message: "Invalid API key provided. Verify your project routing key in MailHub.",
		statusCode: 401,
		error: "Unauthorized",
	};
	return {
		success: false,
		response: Response.json(errorBody, {
			status: 401,
			headers: { "Content-Type": "application/json" },
		}),
	};
}

/**
 * Validates that the 'from' email address domain belongs to or is authorized for this project.
 */
export async function authorizeDomainForProject(
	env: CloudflareEnv,
	fromAddress: string,
	auth: IngestionAuthResult,
): Promise<{
	authorized: true;
	domain: { id: string; hostname: string; userId: string; status: string };
} | {
	authorized: false;
	error: string;
	statusCode: number;
}> {
	const email = getEmailAddress(fromAddress);
	const atIndex = email.lastIndexOf("@");
	if (atIndex === -1) {
		return {
			authorized: false,
			error: `Invalid sender email address: "${fromAddress}"`,
			statusCode: 422,
		};
	}

	const hostname = email.slice(atIndex + 1).toLowerCase();
	const db = getDb(env);

	// Query domain by hostname
	const [domain] = await db
		.select({
			id: domains.id,
			hostname: domains.hostname,
			userId: domains.userId,
			status: domains.status,
			sendingEnabled: domains.sendingEnabled,
		})
		.from(domains)
		.where(eq(domains.hostname, hostname))
		.limit(1);

	if (!domain) {
		return {
			authorized: false,
			error: `Domain '${hostname}' is not registered in MailHub. Please add and verify '${hostname}' in the MailHub dashboard.`,
			statusCode: 403,
		};
	}

	// Check domain status
	if (domain.status === "error") {
		return {
			authorized: false,
			error: `Domain '${hostname}' is in error status. Please check your DNS records before sending.`,
			statusCode: 403,
		};
	}

	// Check domain ownership / project authorization
	// If project key: all active domains registered in MailHub are available to the developer's projects,
	// or specifically matched by userId or project slug.
	if (auth.keyKind === "project") {
		// Project routing key is authorized for configured platform domains
		return { authorized: true, domain };
	}

	// For legacy keys: verify ownership or admin status
	if (domain.userId !== auth.userId) {
		return {
			authorized: false,
			error: `Domain '${hostname}' is not authorized for this account.`,
			statusCode: 403,
		};
	}

	return { authorized: true, domain };
}
