/**
 * MailHub Project Routing Key Generator, Parser & Validator
 * Designed for WP-03: Routing Authentication & Key Management
 *
 * Routing Key Specification:
 * - Format: om_{environment}_{projectSlug}_{randomEntropy}
 * - Examples:
 *   - om_live_aurelia_8f3a9e1b2c4d5e6f7a8b9c0d1e2f3a4b
 *   - om_test_lifesolver_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d
 *
 * Security Characteristics:
 * - 128-bit CSPRNG entropy prevents brute-force or dictionary attacks.
 * - SHA-256 via native Web Crypto API takes <0.05ms on Cloudflare Workers edge.
 * - Stored in D1 as prefix + SHA-256 hash. Plaintext key is returned only on creation.
 */

import { nanoid } from "nanoid";
import type {
	GeneratedRoutingKey,
	ParsedRoutingKey,
	RoutingEnvironment,
} from "./types";

/**
 * Regex enforcing the routing key structure:
 * 1. Prefix: "om_"
 * 2. Environment: "live" | "test"
 * 3. Project Slug: 1-32 lowercase alphanumeric characters or hyphens
 * 4. Random Entropy: at least 16 alphanumeric / hex characters
 */
export const ROUTING_KEY_REGEX = /^om_(live|test)_([a-z0-9_-]{1,32})_([a-zA-Z0-9]{16,64})$/;

/**
 * Normalize and validate a project slug
 */
export function normalizeProjectSlug(slug: string): string {
	const normalized = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
	if (!normalized || normalized.length > 32) {
		throw new Error("Project slug must be 1-32 lowercase alphanumeric characters or hyphens");
	}
	return normalized;
}

/**
 * Generate cryptographically secure random entropy
 * Uses global crypto.getRandomValues for Workers & Node compatibility
 */
export function generateSecureEntropy(byteLength = 16): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Compute SHA-256 hash using native Web Crypto API
 * Optionally salted with an application pepper
 */
export async function hashRoutingKey(key: string, pepper?: string): Promise<string> {
	const payload = pepper ? `${pepper}:${key.trim()}` : key.trim();
	const data = new TextEncoder().encode(payload);
	const digestBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(digestBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Timing-safe string comparison to protect against timing side-channel attacks
 */
export function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) {
		mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return mismatch === 0;
}

/**
 * Parse a presented routing key string into its components.
 * Returns null if the format is invalid.
 */
export function parseRoutingKey(rawKey: string): ParsedRoutingKey | null {
	const trimmed = rawKey.trim();
	const match = ROUTING_KEY_REGEX.exec(trimmed);
	if (!match) return null;

	const [, environment, projectSlug, entropy] = match;
	// Prefix includes om_{env}_{slug}_ and the first 6 characters of entropy
	const prefix = `om_${environment}_${projectSlug}_${entropy.slice(0, 6)}`;

	return {
		raw: trimmed,
		environment: environment as RoutingEnvironment,
		projectSlug,
		entropy,
		prefix,
	};
}

/**
 * Generate a new project routing key for a project.
 */
export async function generateRoutingKey(options: {
	projectSlug: string;
	environment?: RoutingEnvironment;
	pepper?: string;
	keyId?: string;
}): Promise<GeneratedRoutingKey> {
	const environment = options.environment ?? "live";
	const projectSlug = normalizeProjectSlug(options.projectSlug);
	const entropy = generateSecureEntropy(16); // 32 hex characters = 128 bits entropy

	const fullKey = `om_${environment}_${projectSlug}_${entropy}`;
	const prefix = `om_${environment}_${projectSlug}_${entropy.slice(0, 6)}`;
	const displayPrefix = `${prefix}••••••••`;
	const keyHash = await hashRoutingKey(fullKey, options.pepper);
	const keyId = options.keyId ?? `rkey_${nanoid()}`;

	return {
		fullKey,
		keyId,
		prefix,
		displayPrefix,
		keyHash,
		environment,
		projectSlug,
		createdAt: new Date(),
	};
}

/**
 * Verify whether a presented key matches a known stored SHA-256 hash.
 */
export async function verifyRoutingKeyHash(
	presentedKey: string,
	storedHash: string,
	pepper?: string,
): Promise<boolean> {
	const computedHash = await hashRoutingKey(presentedKey, pepper);
	return timingSafeEqual(computedHash, storedHash);
}

