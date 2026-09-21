/**
 * MailHub Hono & Cloudflare Workers Authentication Middleware
 * Designed for WP-03: Routing Authentication & Key Management
 *
 * Capabilities:
 * 1. Extracts `Authorization: Bearer om_...` header.
 * 2. Parses and validates routing key via 3-tier cache (L1 Memory -> L2 KV -> L3 DB).
 * 3. Enforces environment constraints (live vs test).
 * 4. Enforces per-project sliding-window rate limiting.
 * 5. Attaches authenticated project context to `c.var.project` (Hono) or returns typed result (Workers/Next.js).
 * 6. Emits standard rate limit headers (X-RateLimit-*, Retry-After).
 */

import { enforceProjectRateLimit, getRateLimitHeaders } from "./rate-limiter";
import { resolveRoutingKey } from "./key-store";
import type {
	AuthenticatedProject,
	AuthErrorResponse,
	AuthMiddlewareOptions,
	ParsedRoutingKey,
	ProjectAuthResult,
} from "./types";

/**
 * Generic Context shape compatible with Hono Context without hard coupling
 */
export interface HonoCompatibleContext {
	req: {
		header: (name: string) => string | undefined;
		raw?: Request;
	};
	env?: unknown;
	set: (key: string, value: unknown) => void;
	var?: Record<string, unknown>;
	header: (name: string, value: string) => void;
	json: (data: unknown, status?: number, headers?: Record<string, string>) => Response;
	executionCtx?: ExecutionContext;
}

/**
 * Extract bearer token from an Authorization header value
 */
export function extractBearerToken(authHeader: string | null | undefined): string | null {
	if (!authHeader) return null;
	const trimmed = authHeader.trim();
	if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
	const token = trimmed.slice(7).trim();
	return token.length > 0 ? token : null;
}

/**
 * Build standard JSON error response object
 */
export function createAuthError(
	message: string,
	type: "authentication_error" | "rate_limit_error" | "forbidden_error",
	code: 401 | 403 | 429,
): AuthErrorResponse {
	return {
		error: {
			message,
			type,
			code,
		},
	};
}

/**
 * Core validation routine for a raw bearer token or request
 */
export async function authenticateToken(
	token: string | null,
	env: CloudflareEnv,
	ctx?: ExecutionContext,
	options?: AuthMiddlewareOptions,
): Promise<ProjectAuthResult> {
	if (!token) {
		const errorBody = createAuthError(
			"Missing or invalid Authorization header. Expected 'Authorization: Bearer om_<env>_<project>_<secret>'",
			"authentication_error",
			401,
		);
		const headers = { "Content-Type": "application/json" };
		return {
			success: false,
			statusCode: 401,
			errorBody,
			headers,
			response: new Response(JSON.stringify(errorBody), { status: 401, headers }),
		};
	}

	// 1. Resolve key through L1/L2/L3 cache
	const resolved = await resolveRoutingKey(token, env, ctx, options?.pepper);
	if (!resolved) {
		const errorBody = createAuthError(
			"Invalid or inactive project routing key.",
			"authentication_error",
			401,
		);
		const headers = { "Content-Type": "application/json" };
		return {
			success: false,
			statusCode: 401,
			errorBody,
			headers,
			response: new Response(JSON.stringify(errorBody), { status: 401, headers }),
		};
	}

	const { project, routingKey } = resolved;

	// 2. Check environment constraint if configured
	if (options?.requireEnvironment && project.environment !== options.requireEnvironment) {
		const errorBody = createAuthError(
			`Environment mismatch: This endpoint requires a '${options.requireEnvironment}' routing key, but received a '${project.environment}' key.`,
			"forbidden_error",
			403,
		);
		const headers = { "Content-Type": "application/json" };
		return {
			success: false,
			statusCode: 403,
			errorBody,
			headers,
			response: new Response(JSON.stringify(errorBody), { status: 403, headers }),
		};
	}

	// 3. Enforce per-project rate limiting
	const rateLimit = await enforceProjectRateLimit(env, project, options?.rateLimitRpm);
	const rateLimitHeaders = getRateLimitHeaders(rateLimit);

	if (!rateLimit.allowed) {
		const errorBody = createAuthError(
			`Rate limit exceeded for project '${project.slug}' (${rateLimit.limit} req/min). Please retry in ${rateLimit.retryAfter ?? 60} seconds.`,
			"rate_limit_error",
			429,
		);
		const headers = {
			"Content-Type": "application/json",
			...rateLimitHeaders,
		};
		return {
			success: false,
			statusCode: 429,
			errorBody,
			headers,
			response: new Response(JSON.stringify(errorBody), { status: 429, headers }),
		};
	}

	return {
		success: true,
		project,
		routingKey,
		rateLimit,
		headers: rateLimitHeaders,
	};
}

/**
 * Framework-agnostic Request Authenticator
 * Use in standard Cloudflare Worker fetch handlers, Next.js Route Handlers, etc.
 *
 * Example:
 * ```ts
 * export async function POST(request: Request) {
 *   const auth = await authenticateProjectRequest(request, env, ctx);
 *   if (!auth.success) return auth.response;
 *   const { project } = auth;
 *   // Process outbound send...
 * }
 * ```
 */
export async function authenticateProjectRequest(
	request: Request,
	env: CloudflareEnv,
	ctx?: ExecutionContext,
	options?: AuthMiddlewareOptions,
): Promise<ProjectAuthResult> {
	const authHeader = request.headers.get("Authorization");
	const token = extractBearerToken(authHeader);
	return authenticateToken(token, env, ctx, options);
}

/**
 * Hono Middleware for MailHub Project Routing Authentication
 *
 * Example:
 * ```ts
 * import { Hono } from "hono";
 * import { projectAuthMiddleware } from "@/lib/router/auth-middleware";
 *
 * const app = new Hono<{
 *   Bindings: CloudflareEnv;
 *   Variables: {
 *     project: AuthenticatedProject;
 *     routingKey: ParsedRoutingKey;
 *   };
 * }>();
 *
 * app.use("/v1/*", projectAuthMiddleware());
 *
 * app.post("/v1/send", async (c) => {
 *   const project = c.var.project;
 *   return c.json({ success: true, project: project.slug });
 * });
 * ```
 */
export function projectAuthMiddleware(options?: AuthMiddlewareOptions) {
	return async (c: HonoCompatibleContext, next: () => Promise<void>): Promise<Response | void> => {
		const authHeader = c.req.header("Authorization") ?? c.req.header("authorization");
		const token = extractBearerToken(authHeader);
		const env = (c.env ?? {}) as CloudflareEnv;
		const ctx = c.executionCtx;

		const result = await authenticateToken(token, env, ctx, options);

		if (!result.success) {
			if (typeof c.json === "function") {
				return c.json(result.errorBody, result.statusCode, result.headers);
			}
			return result.response;
		}

		// Attach context to Hono variables
		c.set("project", result.project);
		c.set("routingKey", result.routingKey);
		if (c.var) {
			c.var.project = result.project;
			c.var.routingKey = result.routingKey;
		}

		// Set rate limit headers on response
		if (result.headers && typeof c.header === "function") {
			for (const [key, value] of Object.entries(result.headers)) {
				c.header(key, value);
			}
		}

		await next();
	};
}

