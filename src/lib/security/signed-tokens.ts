/**
 * OrbitMails - Signed Short-Lived Token & RBAC Service
 * @module lib/security/signed-tokens
 *
 * Implements cryptographically signed, short-lived bearer tokens (HMAC-SHA256)
 * using Web Crypto API. Native to both Cloudflare Workers and Node.js.
 */

import { getServerSecret } from "./server-secret";

export interface TokenClaims {
	sub: string;
	email: string;
	role: "admin" | "user";
	scopes?: string[];
	isPrimaryAdmin?: boolean;
	canManageDomains?: boolean;
	canManageUsers?: boolean;
	iat: number;
	exp: number;
	iss: string;
}

export interface CreateTokenOptions {
	expiresInSeconds?: number; // default: 900 (15 minutes)
}

function base64UrlEncode(buffer: ArrayBuffer | Uint8Array | string): string {
	const bytes = typeof buffer === "string"
		? new TextEncoder().encode(buffer)
		: buffer instanceof Uint8Array
			? buffer
			: new Uint8Array(buffer);

	let binary = "";
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array<ArrayBuffer> {
	let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
	while (base64.length % 4 !== 0) {
		base64 += "=";
	}
	const binary = atob(base64);
	const buffer = new ArrayBuffer(binary.length);
	const bytes = new Uint8Array(buffer);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

/**
 * Creates a signed, short-lived token for an authenticated user with RBAC claims.
 */
export async function createSignedToken(
	user: {
		id: string;
		email: string;
		role: "admin" | "user";
		scopes?: string[];
		isPrimaryAdmin?: boolean;
		canManageDomains?: boolean;
		canManageUsers?: boolean;
	},
	secret: string,
	options: CreateTokenOptions = {},
): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const ttl = options.expiresInSeconds ?? 900; // 15 minutes default

	const header = {
		alg: "HS256",
		typ: "JWT",
	};

	const claims: TokenClaims = {
		sub: user.id,
		email: user.email,
		role: user.role,
		scopes: user.scopes ?? [],
		isPrimaryAdmin: user.isPrimaryAdmin ?? false,
		canManageDomains: user.canManageDomains ?? false,
		canManageUsers: user.canManageUsers ?? false,
		iat: now,
		exp: now + ttl,
		iss: "orbitmails",
	};

	const encodedHeader = base64UrlEncode(JSON.stringify(header));
	const encodedPayload = base64UrlEncode(JSON.stringify(claims));
	const dataToSign = `${encodedHeader}.${encodedPayload}`;

	const key = await getHmacKey(secret);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(dataToSign),
	);

	const encodedSignature = base64UrlEncode(signature);
	return `${dataToSign}.${encodedSignature}`;
}

/**
 * Verifies a signed short-lived token and returns its claims if valid and not expired.
 */
export async function verifySignedToken(
	token: string,
	secret: string,
): Promise<{ valid: true; claims: TokenClaims } | { valid: false; error: string }> {
	const parts = token.split(".");
	if (parts.length !== 3) {
		return { valid: false, error: "Malformed token" };
	}

	const [encodedHeader, encodedPayload, encodedSignature] = parts;

	try {
		const key = await getHmacKey(secret);
		const dataToVerify = `${encodedHeader}.${encodedPayload}`;
		const signatureBytes = base64UrlDecode(encodedSignature);

		const isSignatureValid = await crypto.subtle.verify(
			"HMAC",
			key,
			signatureBytes,
			new TextEncoder().encode(dataToVerify),
		);

		if (!isSignatureValid) {
			return { valid: false, error: "Invalid signature" };
		}

		const payloadJson = new TextDecoder().decode(base64UrlDecode(encodedPayload));
		const claims = JSON.parse(payloadJson) as TokenClaims;

		const now = Math.floor(Date.now() / 1000);
		if (claims.exp && claims.exp < now) {
			return { valid: false, error: "Token expired" };
		}

		return { valid: true, claims };
	} catch (err) {
		return { valid: false, error: err instanceof Error ? err.message : "Token verification failed" };
	}
}

/**
 * Validates request authorization using signed short-lived bearer token or fallback.
 */
export async function authenticateSignedTokenRequest(
	env: CloudflareEnv,
	request: Request,
): Promise<{ user: TokenClaims | null; error: string | null }> {
	const authHeader = request.headers.get("authorization");
	if (!authHeader?.startsWith("Bearer ")) {
		return { user: null, error: "Missing or invalid authorization header" };
	}

	const token = authHeader.slice(7).trim();
	const secret = await getServerSecret(env);
	const result = await verifySignedToken(token, secret);

	if (!result.valid) {
		return { user: null, error: result.error };
	}

	return { user: result.claims, error: null };
}

/**
 * Enforces Role-Based Access Control (RBAC) on token claims.
 */
export function assertTokenRole(claims: TokenClaims, requiredRole: "admin" | "user"): void {
	if (requiredRole === "admin" && claims.role !== "admin") {
		throw new Error("Forbidden: requires admin role");
	}
}

export function assertTokenScope(claims: TokenClaims, requiredScope: string): void {
	if (!claims.scopes?.includes(requiredScope) && claims.role !== "admin") {
		throw new Error(`Forbidden: missing required scope '${requiredScope}'`);
	}
}
