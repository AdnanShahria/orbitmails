/**
 * OrbitMails / MailHub - Alert Dispatcher & Deduplication Engine
 * @module lib/mailhub/monitoring/alert-sender
 */

import { getDb } from "@/db";
import { users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { pickSystemSender } from "@/lib/email/system-mail";
import { openMailer, type Mailer } from "@/../server/runtime/mailer";
import type { AlertSendResult } from "./types";

/** In-memory fallback deduping cache for Node runtime or unit tests without KV */
const localAlertCache = new Map<string, number>();

/**
 * Checks if an alert has already been dispatched within the deduping TTL window.
 */
export async function isAlertSuppressed(
	key: string,
	env: CloudflareEnv,
): Promise<boolean> {
	// 1. Check Cloudflare KV if bound
	const kv = (env as any).KV;
	if (kv) {
		try {
			const existing = await kv.get(`suppression:${key}`);
			if (existing) return true;
		} catch {
			// Fallback to local
		}
	}

	// 2. Check local memory cache
	const expiresAt = localAlertCache.get(key);
	if (expiresAt && Date.now() < expiresAt) {
		return true;
	}

	return false;
}

/**
 * Records that an alert was dispatched to prevent repeat spam.
 */
export async function markAlertDispatched(
	key: string,
	ttlSeconds: number,
	env: CloudflareEnv,
): Promise<void> {
	// 1. Write to Cloudflare KV
	const kv = (env as any).KV;
	if (kv) {
		try {
			await kv.put(`suppression:${key}`, "dispatched", { expirationTtl: ttlSeconds });
		} catch {
			// Fallback to local
		}
	}

	// 2. Write to local memory cache
	localAlertCache.set(key, Date.now() + ttlSeconds * 1000);
}

/**
 * Resolves the target administrator email address for health notifications.
 */
export async function resolveAdminAlertRecipient(env: CloudflareEnv): Promise<string> {
	const envAny = env as unknown as Record<string, string | undefined>;
	const explicit =
		envAny.MAILHUB_ADMIN_EMAIL?.trim() ||
		envAny.ADMIN_ALERT_EMAIL?.trim() ||
		(typeof process !== "undefined" ? process.env?.MAILHUB_ADMIN_EMAIL?.trim() || process.env?.ADMIN_ALERT_EMAIL?.trim() : undefined);

	if (explicit) return explicit;

	// Query first active admin from D1 / Database
	try {
		const db = getDb(env);
		const [adminUser] = await db
			.select({ email: users.email, resetEmail: users.resetEmail })
			.from(users)
			.where(and(eq(users.role, "admin"), eq(users.disabled, false)))
			.limit(1);

		if (adminUser?.resetEmail) return adminUser.resetEmail;
		if (adminUser?.email) return adminUser.email;
	} catch {
		// Table query fallback
	}

	return "admin@orbitsaas.cloud";
}

/**
 * Dispatches an alert email to the admin using openMailer / env.EMAIL.
 */
export async function dispatchAlertEmail(
	env: CloudflareEnv,
	payload: {
		dedupKey?: string;
		dedupTtlSeconds?: number;
		to?: string;
		subject: string;
		html: string;
		text: string;
	},
): Promise<AlertSendResult> {
	const recipient = payload.to || (await resolveAdminAlertRecipient(env));

	// Deduplication check
	if (payload.dedupKey) {
		const suppressed = await isAlertSuppressed(payload.dedupKey, env);
		if (suppressed) {
			return {
				sent: false,
				suppressed: true,
				recipient,
			};
		}
	}

	// Resolve sender identity
	let fromAddress = "MailHub Alerts <noreply@orbitsaas.cloud>";
	try {
		const systemSender = await pickSystemSender(env);
		if (systemSender) {
			fromAddress = systemSender.name ? `"${systemSender.name} Monitoring" <${systemSender.address}>` : systemSender.address;
		}
	} catch {
		// Use default
	}

	const emailMessage = {
		from: fromAddress,
		to: recipient,
		subject: payload.subject,
		html: payload.html,
		text: payload.text,
		headers: {
			"Auto-Submitted": "auto-generated",
			"X-MailHub-Alert": "true",
			"X-Auto-Response-Suppress": "All",
		},
	};

	try {
		let messageId = `<mailhub-${crypto.randomUUID()}@orbitsaas.cloud>`;

		// 1. Cloudflare Workers SendEmail binding if present
		if (env.EMAIL && typeof (env.EMAIL as any).send === "function") {
			try {
				const res = await env.EMAIL.send(emailMessage as any);
				messageId = (res as any)?.messageId || messageId;
			} catch (cfErr) {
				// Fallback to openMailer if cf binding throws in dev
				console.warn("[MailHub Alerts] env.EMAIL send failed, attempting openMailer fallback:", cfErr);
				const mailer = openMailer({
					kind: (env as any).SMTP_URL ? "smtp" : (env as any).CF_TOKEN && (env as any).CF_ACCOUNT_ID ? "cloudflare" : "none",
					...(env as any).SMTP_URL ? { url: (env as any).SMTP_URL } : {},
					...(env as any).CF_TOKEN ? { accountId: (env as any).CF_ACCOUNT_ID, token: (env as any).CF_TOKEN } : {},
				} as any);
				if (mailer.configured) {
					const res = await mailer.send(emailMessage);
					messageId = res.messageId;
				} else {
					throw cfErr;
				}
			}
		} else {
			// 2. Node.js runtime / Standalone openMailer
			const mailer = openMailer({
				kind: process.env.SMTP_URL ? "smtp" : process.env.CF_TOKEN && process.env.CF_ACCOUNT_ID ? "cloudflare" : "none",
				url: process.env.SMTP_URL,
				accountId: process.env.CF_ACCOUNT_ID,
				token: process.env.CF_TOKEN,
			} as any);

			if (mailer.configured) {
				const res = await mailer.send(emailMessage);
				messageId = res.messageId;
			} else {
				console.warn("[MailHub Alerts] Outbound mail not configured. Alert logged to console:\n" + payload.text);
			}
		}

		// Mark deduped after successful transmission
		if (payload.dedupKey) {
			const ttl = payload.dedupTtlSeconds || 86400; // 24 hours default
			await markAlertDispatched(payload.dedupKey, ttl, env);
		}

		return {
			sent: true,
			messageId,
			recipient,
		};
	} catch (error) {
		const errorMsg = (error as Error).message || String(error);
		console.error("[MailHub Alerts] Failed to deliver alert email:", errorMsg);
		return {
			sent: false,
			recipient,
			error: errorMsg,
		};
	}
}
