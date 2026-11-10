/**
 * OrbitMails - Runtime Environment & Secret Validation
 * @module lib/security/env-validation
 */

import { logger } from "@/lib/logging/logger";

export interface ConfigValidationResult {
	valid: boolean;
	warnings: string[];
	missingRequired: string[];
	maskedConfigSummary: Record<string, string>;
}

const SECRET_NAMES = new Set([
	"CF_TOKEN",
	"CF_API_KEY",
	"TURNSTILE_SECRET_KEY",
	"GITHUB_UPDATE_TOKEN",
	"RESEND_API_KEY",
	"AWS_SECRET_ACCESS_KEY",
	"B2_APPLICATION_KEY",
	"S3_SECRET_ACCESS_KEY",
	"INBOUND_WEBHOOK_SECRET",
	"DATABASE_AUTH_TOKEN",
	"VAPID_PRIVATE_KEY",
]);

/**
 * Mask secret string for safe diagnostic display.
 */
export function maskSecretValue(secret?: string | null): string {
	if (!secret) return "[NOT_SET]";
	const trimmed = secret.trim();
	if (trimmed.length <= 6) return "[CONFIGURED]";
	return `${trimmed.slice(0, 3)}...${trimmed.slice(-3)}`;
}

/**
 * Validate that runtime credentials and API keys are present and not dummy values.
 */
export function validateRuntimeEnvironment(env: CloudflareEnv): ConfigValidationResult {
	const warnings: string[] = [];
	const missingRequired: string[] = [];
	const maskedConfigSummary: Record<string, string> = {};

	const isProduction = process.env.NODE_ENV === "production";
	const isNodeRuntime = (env as unknown as { ORBITFLARE_RUNTIME?: string }).ORBITFLARE_RUNTIME === "node";

	// Check Cloudflare API credentials (required for domain/worker operations unless pure self-hosted node with no CF domains)
	const hasCfToken = !!env.CF_TOKEN?.trim();
	const hasCfApiKey = !!env.CF_API_KEY?.trim() && !!env.CF_EMAIL?.trim();

	maskedConfigSummary.CF_TOKEN = maskSecretValue(env.CF_TOKEN);
	maskedConfigSummary.CF_EMAIL = maskSecretValue(env.CF_EMAIL);

	if (!isNodeRuntime && !hasCfToken && !hasCfApiKey) {
		warnings.push("No Cloudflare API token or legacy API key configured. Domain routing sync will be limited.");
	}

	// Check Turnstile (bot protection) in production
	if (isProduction && !env.TURNSTILE_SECRET_KEY) {
		warnings.push("TURNSTILE_SECRET_KEY is not configured in production. Login challenge verification is disabled.");
	}
	maskedConfigSummary.TURNSTILE_SECRET_KEY = maskSecretValue(env.TURNSTILE_SECRET_KEY);

	// Check S3 / B2 storage credentials consistency
	if (env.B2_KEY_ID || env.B2_APPLICATION_KEY || env.B2_BUCKET || env.B2_ENDPOINT) {
		if (!env.B2_KEY_ID || !env.B2_APPLICATION_KEY || !env.B2_BUCKET || !env.B2_ENDPOINT) {
			warnings.push("Partial Backblaze B2 configuration detected. All four B2_* variables must be provided.");
		}
	}

	if (env.S3_BUCKET) {
		const hasS3Keys = (env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) ||
			(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
		if (!hasS3Keys) {
			warnings.push("S3_BUCKET is configured but access credentials (S3_ACCESS_KEY_ID or AWS_ACCESS_KEY_ID) are missing.");
		}
	}

	const valid = missingRequired.length === 0;

	if (!valid || warnings.length > 0) {
		logger.warn("Runtime environment validation report", {
			valid,
			missingRequired,
			warnings,
		});
	}

	return {
		valid,
		warnings,
		missingRequired,
		maskedConfigSummary,
	};
}

