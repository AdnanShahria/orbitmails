/**
 * OrbitMails / MailHub - Webhook Cryptographic Signature Verification
 * @module lib/mailhub/webhooks/verify
 *
 * Implements strict signature and authenticity verification for:
 * - Resend (Svix HMAC-SHA256)
 * - Amazon SES (Amazon SNS X.509 Certificate & Freshness Window)
 * - Brevo (X-Sib-Signature HMAC-SHA256 or secure shared token)
 * - Mailgun (HMAC-SHA256 timestamp+token signature with 15-min freshness window)
 */

import { verifySvixSignature } from "@/lib/email/svix";
import { verifySnsSignature } from "@/lib/aws/sns-signature";
import type { SnsEnvelope } from "@/lib/aws/ses-notification";
import type { SupportedWebhookProvider, WebhookVerificationResult } from "./types";

/**
 * Constant-time comparison between two strings to prevent timing attacks.
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
	if (a.length !== b.length) {
		return false;
	}
	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return result === 0;
}

/**
 * Calculates HMAC-SHA256 hex digest using Web Crypto API.
 */
export async function hmacSha256Hex(keyString: string, message: string): Promise<string> {
	const encoder = new TextEncoder();
	const keyData = encoder.encode(keyString);
	const messageData = encoder.encode(message);

	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		keyData,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);

	const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
	const hashArray = Array.from(new Uint8Array(signatureBuffer));
	return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Verifies Resend Svix signature.
 */
export async function verifyResendWebhook(
	secret: string,
	headers: { id?: string | null; timestamp?: string | null; signature?: string | null },
	rawBody: string,
): Promise<WebhookVerificationResult> {
	if (!secret) {
		return { valid: false, error: "Missing Resend webhook signing secret" };
	}
	const svixId = headers.id ?? null;
	const svixTimestamp = headers.timestamp ?? null;
	const svixSignature = headers.signature ?? null;

	if (!svixId || !svixTimestamp || !svixSignature) {
		return { valid: false, error: "Missing Svix signature headers (svix-id, svix-timestamp, svix-signature)" };
	}

	const isValid = await verifySvixSignature(
		secret,
		{ id: svixId, timestamp: svixTimestamp, signature: svixSignature },
		rawBody,
	);

	return isValid ? { valid: true } : { valid: false, error: "Invalid Svix signature" };
}

/**
 * Verifies Mailgun webhook signature.
 * Mailgun signs the concatenation of timestamp and token using HMAC-SHA256.
 */
export async function verifyMailgunWebhook(
	signingKey: string,
	signatureObj?: { timestamp?: string | number; token?: string; signature?: string },
	toleranceSeconds = 15 * 60, // 15 minutes max age
): Promise<WebhookVerificationResult> {
	if (!signingKey) {
		return { valid: false, error: "Missing Mailgun webhook signing key" };
	}
	if (!signatureObj || !signatureObj.timestamp || !signatureObj.token || !signatureObj.signature) {
		return { valid: false, error: "Missing Mailgun signature object (timestamp, token, signature)" };
	}

	const timestampNum = Number(signatureObj.timestamp);
	if (!Number.isFinite(timestampNum)) {
		return { valid: false, error: "Invalid Mailgun timestamp" };
	}

	// Verify freshness window
	const nowSec = Math.floor(Date.now() / 1000);
	if (Math.abs(nowSec - timestampNum) > toleranceSeconds) {
		return { valid: false, error: "Mailgun webhook timestamp expired (replay attack prevention)" };
	}

	const message = `${signatureObj.timestamp}${signatureObj.token}`;
	const expectedSignature = await hmacSha256Hex(signingKey, message);

	const isValid = timingSafeEqualStrings(expectedSignature.toLowerCase(), signatureObj.signature.toLowerCase());
	return isValid ? { valid: true } : { valid: false, error: "Invalid Mailgun signature" };
}

/**
 * Verifies Brevo webhook.
 * Checks either HMAC signature (X-Sib-Signature) or configured webhook token.
 */
export async function verifyBrevoWebhook(
	secretOrToken: string,
	headers: {
		signature?: string | null;
		tokenHeader?: string | null;
	},
	queryToken?: string | null,
	rawBody?: string,
): Promise<WebhookVerificationResult> {
	if (!secretOrToken) {
		return { valid: false, error: "Missing Brevo webhook secret or token" };
	}

	// 1. If X-Sib-Signature header is provided, verify HMAC-SHA256
	if (headers.signature && rawBody) {
		const expectedHex = await hmacSha256Hex(secretOrToken, rawBody);
		if (timingSafeEqualStrings(headers.signature.toLowerCase(), expectedHex.toLowerCase())) {
			return { valid: true };
		}
	}

	// 2. Check token header or query parameter
	const providedToken = headers.tokenHeader || queryToken;
	if (providedToken) {
		if (timingSafeEqualStrings(secretOrToken, providedToken)) {
			return { valid: true };
		}
	}

	return { valid: false, error: "Invalid Brevo webhook authentication" };
}

/**
 * Verifies Amazon SES (SNS) webhook signature.
 */
export async function verifySesWebhook(
	envelope: SnsEnvelope,
): Promise<WebhookVerificationResult> {
	try {
		const isValid = await verifySnsSignature(envelope);
		return isValid ? { valid: true } : { valid: false, error: "Invalid Amazon SNS signature" };
	} catch (err) {
		return {
			valid: false,
			error: err instanceof Error ? err.message : "SNS signature validation failed",
		};
	}
}

/**
 * Master verification dispatcher for inbound provider webhooks.
 */
export async function verifyProviderWebhook(
	provider: SupportedWebhookProvider,
	request: Request,
	rawBody: string,
	env: any,
): Promise<WebhookVerificationResult> {
	// Bypass verification in explicit test mode
	if (env.SKIP_WEBHOOK_VERIFICATION === "true" || env.NODE_ENV === "test") {
		const skipHeader = request.headers.get("x-skip-webhook-verify");
		if (skipHeader === "true" || env.SKIP_WEBHOOK_VERIFICATION === "true") {
			return { valid: true };
		}
	}

	const url = new URL(request.url);

	switch (provider) {
		case "resend": {
			const secret = env.RESEND_WEBHOOK_SECRET || env.RESEND_API_KEY || "";
			return verifyResendWebhook(
				secret,
				{
					id: request.headers.get("svix-id"),
					timestamp: request.headers.get("svix-timestamp"),
					signature: request.headers.get("svix-signature"),
				},
				rawBody,
			);
		}

		case "mailgun": {
			const signingKey = env.MAILGUN_WEBHOOK_SIGNING_KEY || env.MAILGUN_API_KEY || "";
			let parsed: any;
			try {
				parsed = JSON.parse(rawBody);
			} catch {
				return { valid: false, error: "Invalid JSON body for Mailgun webhook" };
			}
			return verifyMailgunWebhook(signingKey, parsed?.signature);
		}

		case "brevo": {
			const secretOrToken = env.BREVO_WEBHOOK_SECRET || env.BREVO_WEBHOOK_TOKEN || env.BREVO_API_KEY || "";
			return verifyBrevoWebhook(
				secretOrToken,
				{
					signature: request.headers.get("x-sib-signature") || request.headers.get("x-brevo-signature"),
					tokenHeader: request.headers.get("x-mailhub-token") || request.headers.get("x-webhook-token"),
				},
				url.searchParams.get("token"),
				rawBody,
			);
		}

		case "ses": {
			let envelope: SnsEnvelope;
			try {
				envelope = JSON.parse(rawBody) as SnsEnvelope;
			} catch {
				return { valid: false, error: "Invalid JSON body for SES/SNS webhook" };
			}
			return verifySesWebhook(envelope);
		}

		case "zeptomail": {
			const token = env.ZEPTOMAIL_WEBHOOK_TOKEN || env.ZEPTOMAIL_API_KEY || "";
			const headerToken = request.headers.get("x-zeptomail-token") || request.headers.get("authorization");
			const queryToken = url.searchParams.get("token");
			if (!token) return { valid: false, error: "Missing ZeptoMail webhook token" };
			const provided = headerToken?.replace(/^Bearer\s+/i, "") || queryToken;
			if (provided && timingSafeEqualStrings(token, provided)) {
				return { valid: true };
			}
			return { valid: false, error: "Invalid ZeptoMail webhook authentication" };
		}

		default:
			return { valid: false, error: `Unsupported webhook provider: ${provider}` };
	}
}
