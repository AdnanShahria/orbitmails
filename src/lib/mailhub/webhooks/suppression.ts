/**
 * OrbitMails / MailHub - Global & Project-Level Suppression List Engine
 * @module lib/mailhub/webhooks/suppression
 *
 * Automatically tracks and suppresses recipients who have:
 * - Hard bounced (Permanent delivery failure / mailbox does not exist)
 * - Filed spam/abuse complaints
 * - Explicitly unsubscribed
 *
 * Fast multi-tier lookup:
 * - L1: In-memory LRU isolate cache (0ms)
 * - L2: Cloudflare KV `suppression:${email}` (sub-5ms)
 * - L3: D1 Database `mailhub_suppressions` (authoritative)
 */

import { newId } from "@/lib/ids";
import type { SuppressionRecord } from "./types";

const L1_SUPPRESSION_CACHE = new Map<string, { suppressed: boolean; reason?: string; expiresAt: number }>();
const L1_CACHE_TTL_MS = 60_000; // 1 minute local isolate cache

/**
 * Standard KV key generation for suppressions
 */
export function getSuppressionKvKey(recipient: string, projectId?: string | null): string {
	const sanitized = recipient.trim().toLowerCase();
	return projectId ? `suppression:${projectId}:${sanitized}` : `suppression:global:${sanitized}`;
}

/**
 * Ensures the suppression table exists in D1.
 * Idempotent migration helper for seamless zero-setup initialization.
 */
export async function ensureSuppressionTable(db: any): Promise<void> {
	if (!db) return;
	try {
		await db.exec(`
			CREATE TABLE IF NOT EXISTS mailhub_suppressions (
				id TEXT PRIMARY KEY,
				project_id TEXT,
				recipient TEXT NOT NULL,
				reason TEXT NOT NULL,
				sub_type TEXT,
				provider TEXT,
				details TEXT,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
			);
			CREATE INDEX IF NOT EXISTS mailhub_suppressions_recipient_idx ON mailhub_suppressions(recipient);
			CREATE INDEX IF NOT EXISTS mailhub_suppressions_project_recipient_idx ON mailhub_suppressions(project_id, recipient);
		`);
	} catch (err) {
		// Table may already exist or running in different dialect
	}
}

/**
 * Records an email address into the suppression list.
 */
export async function recordSuppression(
	env: any,
	params: {
		recipient: string;
		reason: "hard_bounce" | "complaint" | "manual" | "unsubscribe";
		subType?: string | null;
		projectId?: string | null;
		provider?: string | null;
		details?: string | null;
	},
): Promise<SuppressionRecord> {
	const recipient = params.recipient.trim().toLowerCase();
	const id = newId("sup");
	const now = new Date();

	const record: SuppressionRecord = {
		id,
		recipient,
		projectId: params.projectId ?? null,
		reason: params.reason,
		subType: params.subType ?? null,
		provider: params.provider ?? null,
		details: params.details ?? null,
		createdAt: now,
	};

	// 1. Update In-Memory L1 Cache
	const l1Key = `${params.projectId || "global"}:${recipient}`;
	L1_SUPPRESSION_CACHE.set(l1Key, {
		suppressed: true,
		reason: params.reason,
		expiresAt: Date.now() + L1_CACHE_TTL_MS,
	});
	// Hard bounces and complaints are toxic globally; mark global as well
	if (params.reason === "hard_bounce" || params.reason === "complaint" || !params.projectId) {
		L1_SUPPRESSION_CACHE.set(`global:${recipient}`, {
			suppressed: true,
			reason: params.reason,
			expiresAt: Date.now() + L1_CACHE_TTL_MS,
		});
	}

	// 2. Update Cloudflare KV (L2 Cache)
	const kv = env?.ROUTER_KV || env?.KV;
	if (kv) {
		try {
			const payload = JSON.stringify({
				suppressed: true,
				reason: params.reason,
				subType: params.subType,
				provider: params.provider,
				projectId: params.projectId,
				createdAt: now.toISOString(),
			});

			if (params.projectId) {
				await kv.put(getSuppressionKvKey(recipient, params.projectId), payload, { expirationTtl: 86400 * 365 });
			}
			// Hard bounces and complaints protect all projects globally
			if (params.reason === "hard_bounce" || params.reason === "complaint" || !params.projectId) {
				await kv.put(getSuppressionKvKey(recipient, null), payload, { expirationTtl: 86400 * 365 });
			}
		} catch (err) {
			console.warn("[MailHub Suppression] Could not write to KV:", err);
		}
	}

	// 3. Persist to D1 Database (L3 Authoritative Store)
	const db = env?.DB;
	if (db) {
		try {
			await ensureSuppressionTable(db);
			await db
				.prepare(`
					INSERT INTO mailhub_suppressions (id, project_id, recipient, reason, sub_type, provider, details, created_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				`)
				.bind(
					id,
					params.projectId ?? null,
					recipient,
					params.reason,
					params.subType ?? null,
					params.provider ?? null,
					params.details ?? null,
					now.toISOString(),
				)
				.run();
		} catch (err) {
			console.warn("[MailHub Suppression] Could not write to D1:", err);
		}
	}

	return record;
}

/**
 * Checks if a recipient email is suppressed (globally or within a project).
 * Fast fail: L1 Cache -> L2 KV -> L3 D1.
 */
export async function isEmailSuppressed(
	env: any,
	recipient: string,
	projectId?: string | null,
): Promise<{ suppressed: boolean; reason?: string; details?: string }> {
	const sanitized = recipient.trim().toLowerCase();
	const now = Date.now();

	// 1. Check L1 Memory Cache
	// Check global suppression first
	const globalL1 = L1_SUPPRESSION_CACHE.get(`global:${sanitized}`);
	if (globalL1 && now < globalL1.expiresAt && globalL1.suppressed) {
		return { suppressed: true, reason: globalL1.reason };
	}
	// Check project-level suppression
	if (projectId) {
		const projectL1 = L1_SUPPRESSION_CACHE.get(`${projectId}:${sanitized}`);
		if (projectL1 && now < projectL1.expiresAt && projectL1.suppressed) {
			return { suppressed: true, reason: projectL1.reason };
		}
	}

	// 2. Check Cloudflare KV (L2 Cache)
	const kv = env?.ROUTER_KV || env?.KV;
	if (kv) {
		try {
			// Check global KV key
			const globalVal = await kv.get(getSuppressionKvKey(sanitized, null), "json");
			if (globalVal && typeof globalVal === "object" && (globalVal as any).suppressed) {
				return {
					suppressed: true,
					reason: (globalVal as any).reason,
					details: (globalVal as any).details,
				};
			}

			// Check project KV key
			if (projectId) {
				const projectVal = await kv.get(getSuppressionKvKey(sanitized, projectId), "json");
				if (projectVal && typeof projectVal === "object" && (projectVal as any).suppressed) {
					return {
						suppressed: true,
						reason: (projectVal as any).reason,
						details: (projectVal as any).details,
					};
				}
			}
		} catch {
			// Fall through to D1
		}
	}

	// 3. Check D1 Database (L3 Authoritative Store)
	const db = env?.DB;
	if (db) {
		try {
			let query = `
				SELECT id, reason, details 
				FROM mailhub_suppressions 
				WHERE recipient = ? AND (project_id IS NULL`;
			const bindings: any[] = [sanitized];

			if (projectId) {
				query += ` OR project_id = ?`;
				bindings.push(projectId);
			}
			query += `) LIMIT 1`;

			const row = await db.prepare(query).bind(...bindings).first();
			if (row) {
				// Populate L1 cache
				const cacheKey = `${projectId || "global"}:${sanitized}`;
				L1_SUPPRESSION_CACHE.set(cacheKey, {
					suppressed: true,
					reason: row.reason,
					expiresAt: now + L1_CACHE_TTL_MS,
				});
				return {
					suppressed: true,
					reason: row.reason,
					details: row.details,
				};
			}
		} catch {
			// Table may not exist yet
		}
	}

	return { suppressed: false };
}

/**
 * Removes an email from the suppression list (admin unsuppress / pardon).
 */
export async function removeSuppression(
	env: any,
	recipient: string,
	projectId?: string | null,
): Promise<boolean> {
	const sanitized = recipient.trim().toLowerCase();

	// Clear L1 Cache
	L1_SUPPRESSION_CACHE.delete(`global:${sanitized}`);
	if (projectId) {
		L1_SUPPRESSION_CACHE.delete(`${projectId}:${sanitized}`);
	}

	// Clear KV
	const kv = env?.ROUTER_KV || env?.KV;
	if (kv) {
		try {
			await kv.delete(getSuppressionKvKey(sanitized, projectId));
			if (!projectId) {
				await kv.delete(getSuppressionKvKey(sanitized, null));
			}
		} catch {}
	}

	// Clear D1
	const db = env?.DB;
	if (db) {
		try {
			let query = `DELETE FROM mailhub_suppressions WHERE recipient = ?`;
			const bindings: any[] = [sanitized];
			if (projectId) {
				query += ` AND project_id = ?`;
				bindings.push(projectId);
			} else {
				query += ` AND project_id IS NULL`;
			}
			await db.prepare(query).bind(...bindings).run();
			return true;
		} catch {
			return false;
		}
	}

	return true;
}
