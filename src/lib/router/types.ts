/**
 * MailHub Project Routing & Authentication Types
 * Designed for WP-03: Routing Authentication & Key Management
 */

export type RoutingEnvironment = "live" | "test";

export type ProjectStatus = "active" | "suspended" | "disabled";

export type RoutingKeyStatus = "active" | "revoked";

/**
 * Resolved and verified project context attached to incoming requests
 */
export interface AuthenticatedProject {
	id: string; // e.g. "proj_aurelia"
	slug: string; // e.g. "aurelia"
	name: string; // e.g. "Aurelia"
	environment: RoutingEnvironment; // "live" | "test"
	keyId: string; // e.g. "rkey_01jh..."
	keyPrefix: string; // e.g. "om_live_aurelia_8f3a"
	rateLimitRps: number; // Configured requests per minute limit
}

/**
 * Parsed components of an inbound routing key
 */
export interface ParsedRoutingKey {
	raw: string;
	environment: RoutingEnvironment;
	projectSlug: string;
	entropy: string;
	prefix: string;
}

/**
 * Result of generating a new project routing key
 */
export interface GeneratedRoutingKey {
	fullKey: string; // Plaintext key (only displayed once upon creation)
	keyId: string; // ID for DB record
	prefix: string; // Prefix stored for fast indexed lookups and UI masking
	displayPrefix: string; // Masked string for dashboard display: "om_live_aurelia_8f3a••••••••"
	keyHash: string; // Hex-encoded SHA-256 hash
	environment: RoutingEnvironment;
	projectSlug: string;
	createdAt: Date;
}

/**
 * Database record shape for project_routing_keys
 */
export interface ProjectRoutingKeyRow {
	id: string;
	projectId: string;
	name: string;
	prefix: string;
	keyHash: string;
	environment: RoutingEnvironment;
	status: RoutingKeyStatus;
	rateLimitRps: number;
	createdAt: Date | number;
	lastUsedAt: Date | number | null;
	expiresAt: Date | number | null;
}

/**
 * Cached key entry stored in Cloudflare KV for ultra-fast sub-millisecond edge validation
 */
export interface CachedRoutingKey {
	projectId: string;
	projectSlug: string;
	projectName: string;
	projectStatus: ProjectStatus;
	environment: RoutingEnvironment;
	keyId: string;
	keyPrefix: string;
	keyStatus: RoutingKeyStatus;
	rateLimitRps: number;
	lastUsedAt?: number;
	cachedAt: number;
}

/**
 * Rate limit outcome
 */
export interface RateLimitResult {
	allowed: boolean;
	limit: number;
	remaining: number;
	reset: number; // Unix timestamp in seconds
	retryAfter?: number; // Seconds until next permitted request
}

/**
 * Middleware options for routing auth
 */
export interface AuthMiddlewareOptions {
	/** If set, strictly requires either "live" or "test" keys */
	requireEnvironment?: RoutingEnvironment;
	/** Custom rate limit override (requests per minute) */
	rateLimitRpm?: number;
	/** Optional pepper/salt for HMAC verification */
	pepper?: string;
}

/**
 * Authentication error response payload
 */
export interface AuthErrorResponse {
	error: {
		message: string;
		type: "authentication_error" | "rate_limit_error" | "forbidden_error";
		code: number;
	};
}

/**
 * Framework-agnostic authentication result
 */
export type ProjectAuthResult =
	| {
			success: true;
			project: AuthenticatedProject;
			routingKey: ParsedRoutingKey;
			rateLimit: RateLimitResult;
			headers: Record<string, string>;
	  }
	| {
			success: false;
			statusCode: 401 | 403 | 429;
			errorBody: AuthErrorResponse;
			headers: Record<string, string>;
			response: Response;
	  };

