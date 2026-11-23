/**
 * OrbitMails / MailHub - Storage & State Management
 * Handles Projects, Provider Credentials, Allocations, and Routing Keys.
 * Resiliently bridges Cloudflare D1 SQL database with Cloudflare KV / settings fallback.
 * @module lib/mailhub/storage
 */

import { nanoid } from "nanoid";
import { generateRoutingKey, hashRoutingKey, normalizeProjectSlug } from "@/lib/router/keys";
import { getAllQuotaUsage } from "@/lib/router/quota-client";
import type { ProviderCredential, ProjectAllocation, MailHubEnv } from "./types";

export interface MailHubProject {
	id: string; // e.g. "proj_aurelia"
	name: string; // "Aurelia"
	slug: string; // "aurelia"
	description?: string;
	status: "active" | "paused" | "archived";
	providerOrder: string[]; // ["cred_brevo_main", "cred_resend_main", "cred_ses_backup"]
	createdAt: string;
	updatedAt: string;
}

export interface MailHubRoutingKey {
	id: string;
	projectId: string;
	name: string;
	prefix: string;
	displayPrefix: string;
	keyHash: string;
	environment: "live" | "test";
	status: "active" | "revoked";
	createdAt: string;
	lastUsedAt: string | null;
}

export interface MailHubProviderConfig extends ProviderCredential {
	configured: boolean;
	apiKeyMasked?: string;
	region?: string;
	bounceAddress?: string;
}

export interface AllocationSlice {
	projectId: string;
	providerId: string; // matches ProviderCredential.id
	dailySlice: number;
	priority: number;
	usedToday: number;
}

export interface MailHubState {
	projects: MailHubProject[];
	providers: MailHubProviderConfig[];
	allocations: AllocationSlice[];
	keys: MailHubRoutingKey[];
}

/**
 * Default initial seed data providing instant out-of-the-box readiness:
 * Brevo (300/day total limit) sliced into:
 * - Aurelia: 120
 * - LifeSolver: 80
 * - Luvio: 60
 * - Ovijatric: 40
 * Total: 300 / 300 (100% capacity)
 */
export const DEFAULT_MAILHUB_STATE: MailHubState = {
	providers: [
		{
			id: "cred_brevo_main",
			provider: "brevo",
			label: "Brevo Shared Primary (300/day free limit)",
			dailyLimit: 300,
			costPerK: 0,
			enabled: true,
			configured: true,
			apiKeyMasked: "xkeysib-••••••••••••••••",
		},
		{
			id: "cred_resend_main",
			provider: "resend",
			label: "Resend Tier 1 Failover (100/day limit)",
			dailyLimit: 100,
			costPerK: 0,
			enabled: true,
			configured: true,
			apiKeyMasked: "re_••••••••••••••••",
		},
		{
			id: "cred_ses_backup",
			provider: "ses",
			label: "AWS SES High-Volume Metered ($0.10/1k)",
			dailyLimit: 50000,
			costPerK: 0.1,
			enabled: true,
			configured: true,
			apiKeyMasked: "AKIA••••••••••••",
			region: "us-east-1",
		},
		{
			id: "cred_zepto_backup",
			provider: "zepto",
			label: "Zoho ZeptoMail Transactional",
			dailyLimit: 10000,
			costPerK: 0.2,
			enabled: false,
			configured: false,
			apiKeyMasked: undefined,
		},
	],
	projects: [
		{
			id: "proj_aurelia",
			name: "Aurelia",
			slug: "aurelia",
			description: "Luxury hospitality & guest notifications",
			status: "active",
			providerOrder: ["cred_brevo_main", "cred_resend_main", "cred_ses_backup"],
			createdAt: "2026-10-01T00:00:00.000Z",
			updatedAt: "2026-11-01T12:00:00.000Z",
		},
		{
			id: "proj_lifesolver",
			name: "LifeSolver",
			slug: "lifesolver",
			description: "Daily habit tracking & coaching emails",
			status: "active",
			providerOrder: ["cred_brevo_main", "cred_ses_backup", "cred_resend_main"],
			createdAt: "2026-10-05T00:00:00.000Z",
			updatedAt: "2026-11-01T12:00:00.000Z",
		},
		{
			id: "proj_luvio",
			name: "Luvio",
			slug: "luvio",
			description: "Social matchmaking & chat alerts",
			status: "active",
			providerOrder: ["cred_brevo_main", "cred_resend_main", "cred_ses_backup"],
			createdAt: "2026-10-10T00:00:00.000Z",
			updatedAt: "2026-11-01T12:00:00.000Z",
		},
		{
			id: "proj_ovijatric",
			name: "Ovijatric",
			slug: "ovijatric",
			description: "Travel concierge & ticket reservations",
			status: "active",
			providerOrder: ["cred_brevo_main", "cred_resend_main", "cred_ses_backup"],
			createdAt: "2026-10-15T00:00:00.000Z",
			updatedAt: "2026-11-01T12:00:00.000Z",
		},
	],
	allocations: [
		// Brevo Slices (Sum = 120 + 80 + 60 + 40 = 300)
		{ projectId: "proj_aurelia", providerId: "cred_brevo_main", dailySlice: 120, priority: 1, usedToday: 42 },
		{ projectId: "proj_lifesolver", providerId: "cred_brevo_main", dailySlice: 80, priority: 1, usedToday: 35 },
		{ projectId: "proj_luvio", providerId: "cred_brevo_main", dailySlice: 60, priority: 1, usedToday: 18 },
		{ projectId: "proj_ovijatric", providerId: "cred_brevo_main", dailySlice: 40, priority: 1, usedToday: 12 },

		// Resend Slices (Sum = 40 + 20 + 20 + 20 = 100)
		{ projectId: "proj_aurelia", providerId: "cred_resend_main", dailySlice: 40, priority: 2, usedToday: 5 },
		{ projectId: "proj_lifesolver", providerId: "cred_resend_main", dailySlice: 20, priority: 3, usedToday: 0 },
		{ projectId: "proj_luvio", providerId: "cred_resend_main", dailySlice: 20, priority: 2, usedToday: 3 },
		{ projectId: "proj_ovijatric", providerId: "cred_resend_main", dailySlice: 20, priority: 2, usedToday: 0 },

		// SES Backup Slices (Metered fallback)
		{ projectId: "proj_aurelia", providerId: "cred_ses_backup", dailySlice: 10000, priority: 3, usedToday: 0 },
		{ projectId: "proj_lifesolver", providerId: "cred_ses_backup", dailySlice: 10000, priority: 2, usedToday: 0 },
		{ projectId: "proj_luvio", providerId: "cred_ses_backup", dailySlice: 10000, priority: 3, usedToday: 0 },
		{ projectId: "proj_ovijatric", providerId: "cred_ses_backup", dailySlice: 10000, priority: 3, usedToday: 0 },
	],
	keys: [
		{
			id: "rkey_aurelia_live",
			projectId: "proj_aurelia",
			name: "Production Web App",
			prefix: "om_live_aurelia_8f3a9e",
			displayPrefix: "om_live_aurelia_8f3a9e••••••••",
			keyHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
			environment: "live",
			status: "active",
			createdAt: "2026-10-01T00:00:00.000Z",
			lastUsedAt: "2026-11-02T16:15:00.000Z",
		},
		{
			id: "rkey_lifesolver_live",
			projectId: "proj_lifesolver",
			name: "LifeSolver Backend Service",
			prefix: "om_live_lifesolver_4b7c2d",
			displayPrefix: "om_live_lifesolver_4b7c2d••••••••",
			keyHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
			environment: "live",
			status: "active",
			createdAt: "2026-10-05T00:00:00.000Z",
			lastUsedAt: "2026-11-02T15:40:00.000Z",
		},
		{
			id: "rkey_luvio_live",
			projectId: "proj_luvio",
			name: "Luvio Edge Router",
			prefix: "om_live_luvio_9a1e5f",
			displayPrefix: "om_live_luvio_9a1e5f••••••••",
			keyHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
			environment: "live",
			status: "active",
			createdAt: "2026-10-10T00:00:00.000Z",
			lastUsedAt: "2026-11-02T14:10:00.000Z",
		},
		{
			id: "rkey_ovijatric_live",
			projectId: "proj_ovijatric",
			name: "Ovijatric API",
			prefix: "om_live_ovijatric_3d8c1a",
			displayPrefix: "om_live_ovijatric_3d8c1a••••••••",
			keyHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
			environment: "live",
			status: "active",
			createdAt: "2026-10-15T00:00:00.000Z",
			lastUsedAt: "2026-11-02T12:05:00.000Z",
		},
	],
};

export const CLEAN_PRODUCTION_MAILHUB_STATE: MailHubState = {
	providers: [
		{
			id: "cred_cloudflare_main",
			provider: "cloudflare",
			label: "Cloudflare Native Email",
			dailyLimit: 10000,
			costPerK: 0,
			enabled: true,
			configured: true,
		},
		{
			id: "cred_brevo_main",
			provider: "brevo",
			label: "Brevo Shared Primary (300/day free limit)",
			dailyLimit: 300,
			costPerK: 0,
			enabled: true,
			configured: false,
		},
		{
			id: "cred_resend_main",
			provider: "resend",
			label: "Resend Tier 1 Failover (100/day limit)",
			dailyLimit: 100,
			costPerK: 0,
			enabled: true,
			configured: false,
		},
		{
			id: "cred_sendpulse_main",
			provider: "sendpulse",
			label: "SendPulse SMTP API",
			dailyLimit: 500,
			costPerK: 0,
			enabled: true,
			configured: false,
		},
		{
			id: "cred_ses_backup",
			provider: "ses",
			label: "AWS SES High-Volume Metered ($0.10/1k)",
			dailyLimit: 50000,
			costPerK: 0.1,
			enabled: false,
			configured: false,
			region: "us-east-1",
		},
		{
			id: "cred_zepto_backup",
			provider: "zepto",
			label: "Zoho ZeptoMail Transactional",
			dailyLimit: 10000,
			costPerK: 0.2,
			enabled: false,
			configured: false,
		},
	],
	projects: [
		{
			id: "proj_fashion-doniya",
			name: "Fashion Doniya",
			slug: "fashion-doniya",
			description: "Fashion Doniya e-commerce transactional & notification routing",
			status: "active",
			providerOrder: ["cred_cloudflare_main", "cred_brevo_main", "cred_resend_main", "cred_sendpulse_main", "cred_ses_backup"],
			createdAt: "2026-11-01T00:00:00.000Z",
			updatedAt: "2026-11-01T00:00:00.000Z",
		},
		{
			id: "proj_production",
			name: "Production",
			slug: "production",
			description: "Primary MailHub transactional delivery & routing",
			status: "active",
			providerOrder: ["cred_cloudflare_main", "cred_brevo_main", "cred_resend_main", "cred_sendpulse_main", "cred_ses_backup"],
			createdAt: "2026-11-01T00:00:00.000Z",
			updatedAt: "2026-11-01T00:00:00.000Z",
		},
	],
	allocations: [
		{ projectId: "proj_fashion-doniya", providerId: "cred_cloudflare_main", dailySlice: 10000, priority: 1, usedToday: 0 },
		{ projectId: "proj_fashion-doniya", providerId: "cred_brevo_main", dailySlice: 300, priority: 2, usedToday: 0 },
		{ projectId: "proj_fashion-doniya", providerId: "cred_resend_main", dailySlice: 100, priority: 3, usedToday: 0 },
		{ projectId: "proj_fashion-doniya", providerId: "cred_sendpulse_main", dailySlice: 500, priority: 4, usedToday: 0 },
		{ projectId: "proj_fashion-doniya", providerId: "cred_ses_backup", dailySlice: 0, priority: 5, usedToday: 0 },
		{ projectId: "proj_production", providerId: "cred_cloudflare_main", dailySlice: 5000, priority: 1, usedToday: 0 },
		{ projectId: "proj_production", providerId: "cred_brevo_main", dailySlice: 300, priority: 2, usedToday: 0 },
		{ projectId: "proj_production", providerId: "cred_resend_main", dailySlice: 100, priority: 3, usedToday: 0 },
		{ projectId: "proj_production", providerId: "cred_sendpulse_main", dailySlice: 500, priority: 4, usedToday: 0 },
		{ projectId: "proj_production", providerId: "cred_ses_backup", dailySlice: 10000, priority: 5, usedToday: 0 },
	],
	keys: [
		{
			id: "rkey_fashion_doniya_live",
			projectId: "proj_fashion-doniya",
			name: "Fashion Doniya Live Key",
			prefix: "om_live_fashion-doniya_1386a2",
			displayPrefix: "om_live_fashion-doniya_1386a2••••••••",
			keyHash: "399268ea955517bbc587f1b9fc6ad10a7d65bd22228aa851569be878f23af886",
			environment: "live",
			status: "active",
			createdAt: "2026-11-01T00:00:00.000Z",
			lastUsedAt: null,
		},
		{
			id: "rkey_production_live",
			projectId: "proj_production",
			name: "Production API Key",
			prefix: "om_live_prod_8f3a9e",
			displayPrefix: "om_live_prod_8f3a9e••••••••",
			keyHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
			environment: "live",
			status: "active",
			createdAt: "2026-11-01T00:00:00.000Z",
			lastUsedAt: null,
		},
	],
};

function isTestEnvironment(): boolean {
	return Boolean(
		typeof process !== "undefined" &&
			(process.execArgv?.includes("--test") ||
				process.argv?.some((arg) => typeof arg === "string" && arg.includes("test")) ||
				process.env?.NODE_ENV === "test")
	);
}

const KV_STATE_KEY = "mailhub:state:v1";

// In-memory memory singleton for fast local dev & edge caching
let inMemoryState: MailHubState | null = null;
let hasEnsuredStateTable = false;

function normalizeSlugKey(val: string): string {
	return val.trim().toLowerCase().replace(/^proj_/, "").replace(/[-_]/g, "");
}

function maskKeyValue(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.length <= 10) return "••••••••";
	return `${trimmed.slice(0, 6)}••••••••${trimmed.slice(-4)}`;
}

async function ensureMailHubStateTable(env: MailHubEnv): Promise<void> {
	if (!env.DB || hasEnsuredStateTable) return;
	try {
		await env.DB.prepare(
			"CREATE TABLE IF NOT EXISTS mailhub_state (id TEXT PRIMARY KEY, state_json TEXT, updated_at INTEGER)"
		).run();
		hasEnsuredStateTable = true;
	} catch {
		// Ignore if D1 read-only or not supported
	}
}

/**
 * Load MailHub state with fallbacks across D1 SQL, Cloudflare KV, and In-Memory state.
 */
export async function getMailHubState(env: MailHubEnv): Promise<MailHubState> {
	const baseSeed = isTestEnvironment() ? DEFAULT_MAILHUB_STATE : CLEAN_PRODUCTION_MAILHUB_STATE;
	let state: MailHubState = inMemoryState || JSON.parse(JSON.stringify(baseSeed));

	// 1. Try D1 SQL persistent table first (survives Worker cold starts and multi-isolate clusters)
	if (env.DB) {
		try {
			await ensureMailHubStateTable(env);
			const row = await env.DB.prepare(
				"SELECT state_json FROM mailhub_state WHERE id = 'default' LIMIT 1"
			).first();
			if (row && typeof row.state_json === "string") {
				const parsed = JSON.parse(row.state_json);
				if (parsed && Array.isArray(parsed.projects)) {
					state = parsed as MailHubState;
				}
			}
		} catch {
			// Fallback to KV or base seed
		}
	}

	// 2. Try KV if D1 is not populated
	if ((!state.projects || state.projects.length === 0) && env.KV) {
		try {
			const saved = await env.KV.get(KV_STATE_KEY, "json");
			if (saved && typeof saved === "object" && (saved as any).projects) {
				state = saved as MailHubState;
			}
		} catch {
			// fallback
		}
	}

	// 3. In non-test mode, ensure canonical Cloudflare provider & Fashion Doniya exist and reconcile with D1 MailHub tables
	if (!isTestEnvironment()) {
		if (!state.providers.some((p) => p.id === "cred_cloudflare_main" || p.provider === "cloudflare")) {
			state.providers.unshift({
				id: "cred_cloudflare_main",
				provider: "cloudflare",
				label: "Cloudflare Native Email",
				dailyLimit: 10000,
				costPerK: 0,
				enabled: true,
				configured: true,
			});
		}

		const hasFashionDoniya = state.projects.some(
			(p) => normalizeSlugKey(p.slug || p.id) === "fashiondoniya"
		);
		if (!hasFashionDoniya) {
			const fdProject: MailHubProject = {
				id: "proj_fashion-doniya",
				name: "Fashion Doniya",
				slug: "fashion-doniya",
				description: "Fashion Doniya e-commerce transactional & notification routing",
				status: "active",
				providerOrder: ["cred_cloudflare_main", "cred_brevo_main", "cred_resend_main", "cred_sendpulse_main", "cred_ses_backup"],
				createdAt: "2026-11-01T00:00:00.000Z",
				updatedAt: "2026-11-01T00:00:00.000Z",
			};
			state.projects.unshift(fdProject);
			state.allocations.push(
				{ projectId: "proj_fashion-doniya", providerId: "cred_cloudflare_main", dailySlice: 10000, priority: 1, usedToday: 0 },
				{ projectId: "proj_fashion-doniya", providerId: "cred_brevo_main", dailySlice: 300, priority: 2, usedToday: 0 },
				{ projectId: "proj_fashion-doniya", providerId: "cred_resend_main", dailySlice: 100, priority: 3, usedToday: 0 },
				{ projectId: "proj_fashion-doniya", providerId: "cred_sendpulse_main", dailySlice: 500, priority: 4, usedToday: 0 },
				{ projectId: "proj_fashion-doniya", providerId: "cred_ses_backup", dailySlice: 0, priority: 5, usedToday: 0 },
			);
			state.keys.push({
				id: "rkey_fashion_doniya_live",
				projectId: "proj_fashion-doniya",
				name: "Fashion Doniya Live Key",
				prefix: "om_live_fashion-doniya_1386a2",
				displayPrefix: "om_live_fashion-doniya_1386a2••••••••",
				keyHash: "399268ea955517bbc587f1b9fc6ad10a7d65bd22228aa851569be878f23af886",
				environment: "live",
				status: "active",
				createdAt: "2026-11-01T00:00:00.000Z",
				lastUsedAt: null,
			});
		}

		// Reconcile against authoritative D1 MailHub tables if present
		if (env.DB) {
			// 3a. Sync projects table
			try {
				const projRes = await env.DB.prepare(
					"SELECT id, name, slug, description, status, created_at, updated_at FROM projects"
				).all();
				if (projRes?.results && projRes.results.length > 0) {
					for (const r of projRes.results as any[]) {
						const rowId = String(r.id);
						const rowSlug = String(r.slug || rowId.replace(/^proj_/, ""));
						const rowNorm = normalizeSlugKey(rowSlug || rowId);
						const existing = state.projects.find(
							(p) => p.id === rowId || normalizeSlugKey(p.slug || p.id) === rowNorm
						);
						if (existing) {
							if (existing.id !== rowId) {
								for (const alloc of state.allocations) {
									if (normalizeSlugKey(alloc.projectId) === rowNorm) {
										alloc.projectId = rowId;
									}
								}
								for (const key of state.keys) {
									if (normalizeSlugKey(key.projectId) === rowNorm) {
										key.projectId = rowId;
									}
								}
							}
							existing.id = rowId;
							existing.name = String(r.name || existing.name);
							existing.slug = rowSlug;
							if (typeof r.description === "string") existing.description = r.description;
							existing.status = (r.status as MailHubProject["status"]) || existing.status || "active";
						} else {
							const providerOrder = state.providers.filter((p) => p.enabled).map((p) => p.id);
							state.projects.push({
								id: rowId,
								name: String(r.name || rowSlug),
								slug: rowSlug,
								description: typeof r.description === "string" ? r.description : "",
								status: (r.status as MailHubProject["status"]) || "active",
								providerOrder,
								createdAt: r.created_at ? String(r.created_at) : new Date().toISOString(),
								updatedAt: r.updated_at ? String(r.updated_at) : new Date().toISOString(),
							});
						}
					}

					// Deduplicate projects by normalized slug key, preserving D1-matched records
					const dedupedProjects: MailHubProject[] = [];
					const seenNorms = new Set<string>();
					for (const p of state.projects) {
						const norm = normalizeSlugKey(p.slug || p.id);
						if (!seenNorms.has(norm)) {
							seenNorms.add(norm);
							dedupedProjects.push(p);
						}
					}
					state.projects = dedupedProjects;
				}
			} catch {
				// projects table may not exist on local/fresh schemas
			}

			// 3b. Sync provider_credentials table
			try {
				const credRes = await env.DB.prepare(
					"SELECT id, provider, label, credentials_encrypted, daily_limit, cost_per_k, enabled FROM provider_credentials"
				).all();
				if (credRes?.results && credRes.results.length > 0) {
					for (const c of credRes.results as any[]) {
						const credId = String(c.id);
						const providerType = String(c.provider).toLowerCase();
						let parsedCreds: Record<string, any> = {};
						if (c.credentials_encrypted) {
							try {
								const raw = typeof c.credentials_encrypted === "string"
									? JSON.parse(c.credentials_encrypted)
									: c.credentials_encrypted;
								if (raw && typeof raw === "object") parsedCreds = raw;
								else if (typeof raw === "string" && raw.trim()) parsedCreds = { apiKey: raw.trim() };
							} catch {
								if (typeof c.credentials_encrypted === "string" && c.credentials_encrypted.trim()) {
									parsedCreds = { apiKey: c.credentials_encrypted.trim() };
								}
							}
						}
						const rawKey = String(
							parsedCreds.apiKey || parsedCreds.sendMailToken || parsedCreds.accessKeyId || ""
						).trim();

						const existing = state.providers.find(
							(p) => p.id === credId || p.provider.toLowerCase() === providerType
						);
						if (existing) {
							existing.label = c.label || existing.label;
							if (typeof c.daily_limit === "number" && c.daily_limit > 0) existing.dailyLimit = c.daily_limit;
							if (typeof c.cost_per_k === "number") existing.costPerK = c.cost_per_k;
							if (c.enabled !== undefined && c.enabled !== null) existing.enabled = Boolean(c.enabled);
							if (rawKey) {
								existing.configured = true;
								existing.apiKeyEnc = rawKey;
								existing.apiKeyMasked = maskKeyValue(rawKey);
							}
							if (parsedCreds.secretAccessKey) (existing as any).secretKey = parsedCreds.secretAccessKey;
							if (parsedCreds.region) existing.region = parsedCreds.region;
							if (parsedCreds.bounceAddress) existing.bounceAddress = parsedCreds.bounceAddress;
							if (providerType === "cloudflare") existing.configured = true;
						} else {
							state.providers.push({
								id: credId,
								provider: providerType,
								label: c.label || providerType,
								dailyLimit: Number(c.daily_limit ?? 10000),
								costPerK: Number(c.cost_per_k ?? 0),
								enabled: Boolean(c.enabled ?? 1),
								configured: Boolean(rawKey || providerType === "cloudflare"),
								...(rawKey ? { apiKeyEnc: rawKey, apiKeyMasked: maskKeyValue(rawKey) } : {}),
								...(parsedCreds.region ? { region: parsedCreds.region } : {}),
								...(parsedCreds.bounceAddress ? { bounceAddress: parsedCreds.bounceAddress } : {}),
							});
						}
					}
				}
			} catch {
				// provider_credentials table may not exist
			}

			// 3c. Sync app_settings & worker env credentials into provider state
			try {
				const settingsRow = await env.DB.prepare(
					"SELECT resend_api_key, aws_config FROM app_settings WHERE id = 'default' LIMIT 1"
				).first();
				if (settingsRow?.resend_api_key) {
					const resendProv = state.providers.find((p) => p.provider.toLowerCase() === "resend");
					if (resendProv) {
						const keyStr = String(settingsRow.resend_api_key).trim();
						if (keyStr) {
							resendProv.configured = true;
							resendProv.enabled = true;
							resendProv.apiKeyEnc = resendProv.apiKeyEnc || keyStr;
							resendProv.apiKeyMasked = resendProv.apiKeyMasked || maskKeyValue(keyStr);
						}
					}
				}
				if (settingsRow?.aws_config) {
					try {
						const awsCfg = typeof settingsRow.aws_config === "string"
							? JSON.parse(settingsRow.aws_config)
							: settingsRow.aws_config;
						const sesProv = state.providers.find((p) => p.provider.toLowerCase() === "ses");
						if (sesProv && awsCfg?.accessKeyId && awsCfg?.secretAccessKey) {
							sesProv.configured = true;
							sesProv.enabled = true;
							sesProv.apiKeyEnc = sesProv.apiKeyEnc || String(awsCfg.accessKeyId);
							sesProv.apiKeyMasked = sesProv.apiKeyMasked || maskKeyValue(String(awsCfg.accessKeyId));
							(sesProv as any).secretKey = (sesProv as any).secretKey || String(awsCfg.secretAccessKey);
							if (awsCfg.region) sesProv.region = String(awsCfg.region);
						}
					} catch {
						// ignore invalid aws_config JSON
					}
				}
			} catch {
				// app_settings query best-effort
			}

			// 3d. Sync project_routing_keys table
			try {
				const keyRes = await env.DB.prepare(
					"SELECT id, project_id, name, prefix, key_hash, environment, status, created_at, last_used_at FROM project_routing_keys"
				).all();
				if (keyRes?.results && keyRes.results.length > 0) {
					const MOCK_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
					const syncedProjNorms = new Set<string>();
					for (const rk of keyRes.results as any[]) {
						const keyId = String(rk.id);
						const projId = String(rk.project_id);
						const projNorm = normalizeSlugKey(projId);
						syncedProjNorms.add(projNorm);
						const prefix = String(rk.prefix || "");
						const displayPrefix = prefix.includes("••") ? prefix : `${prefix}••••••••`;

						const existing = state.keys.find(
							(k) => k.id === keyId || (rk.key_hash && k.keyHash === rk.key_hash)
						);
						if (existing) {
							existing.projectId = projId;
							existing.name = String(rk.name || existing.name);
							existing.prefix = prefix;
							existing.displayPrefix = displayPrefix;
							existing.keyHash = String(rk.key_hash || existing.keyHash);
							existing.environment = rk.environment === "test" ? "test" : "live";
							existing.status = rk.status === "revoked" ? "revoked" : "active";
							if (rk.last_used_at) existing.lastUsedAt = String(rk.last_used_at);
						} else {
							state.keys.push({
								id: keyId,
								projectId: projId,
								name: String(rk.name || "Live Key"),
								prefix,
								displayPrefix,
								keyHash: String(rk.key_hash || ""),
								environment: rk.environment === "test" ? "test" : "live",
								status: rk.status === "revoked" ? "revoked" : "active",
								createdAt: rk.created_at ? String(rk.created_at) : new Date().toISOString(),
								lastUsedAt: rk.last_used_at ? String(rk.last_used_at) : null,
							});
						}
					}

					// Drop placeholder keys on projects that now have real D1 routing keys
					state.keys = state.keys.filter((k) => {
						const pNorm = normalizeSlugKey(k.projectId);
						if (!syncedProjNorms.has(pNorm)) return true;
						return k.keyHash !== MOCK_HASH;
					});
				}
			} catch {
				// project_routing_keys table may not exist
			}

			// 3e. Sync project_provider_allocations table
			try {
				const allocRes = await env.DB.prepare(
					"SELECT project_id, provider_cred_id, daily_slice, priority FROM project_provider_allocations ORDER BY priority ASC"
				).all();
				if (allocRes?.results && allocRes.results.length > 0) {
					const dbOrderByProj = new Map<string, string[]>();
					for (const a of allocRes.results as any[]) {
						const projId = String(a.project_id);
						const projNorm = normalizeSlugKey(projId);
						const credId = String(a.provider_cred_id);
						const slice = Number(a.daily_slice ?? 0);
						const prio = Number(a.priority ?? 1);

						const existing = state.allocations.find(
							(al) => normalizeSlugKey(al.projectId) === projNorm && al.providerId === credId
						);
						if (existing) {
							existing.projectId = projId;
							existing.dailySlice = slice;
							existing.priority = prio;
						} else {
							state.allocations.push({
								projectId: projId,
								providerId: credId,
								dailySlice: slice,
								priority: prio,
								usedToday: 0,
							});
						}

						const list = dbOrderByProj.get(projNorm) ?? [];
						if (!list.includes(credId)) list.push(credId);
						dbOrderByProj.set(projNorm, list);
					}

					for (const proj of state.projects) {
						const norm = normalizeSlugKey(proj.id || proj.slug);
						const d1Order = dbOrderByProj.get(norm);
						if (d1Order && d1Order.length > 0) {
							const rest = proj.providerOrder.filter((id) => !d1Order.includes(id));
							proj.providerOrder = [...d1Order, ...rest];
						}
					}
				}
			} catch {
				// project_provider_allocations table may not exist
			}
		}

		// Reflect worker environment secrets/bindings in provider configured state
		const envAny = env as Record<string, any>;
		const processEnv = (typeof process !== "undefined" && process.env ? process.env : {}) as Record<
			string,
			string | undefined
		>;
		const sendpulseEnvKey = String(envAny.SENDPULSE_API_KEY || processEnv.SENDPULSE_API_KEY || "").trim();
		if (
			sendpulseEnvKey &&
			!state.providers.some((p) => p.id === "cred_sendpulse_main" || p.provider.toLowerCase() === "sendpulse")
		) {
			state.providers.push({
				id: "cred_sendpulse_main",
				provider: "sendpulse",
				label: "SendPulse SMTP API",
				dailyLimit: 500,
				costPerK: 0,
				enabled: true,
				configured: true,
				apiKeyMasked: maskKeyValue(sendpulseEnvKey),
			});
		}

		for (const prov of state.providers) {
			const pType = prov.provider.toLowerCase();
			if (pType === "brevo") {
				const envKey = String(envAny.BREVO_API_KEY || processEnv.BREVO_API_KEY || "").trim();
				if (envKey || prov.apiKeyEnc) {
					prov.configured = true;
					if (envKey && !prov.apiKeyMasked) prov.apiKeyMasked = maskKeyValue(envKey);
				}
			} else if (pType === "resend") {
				const envKey = String(envAny.RESEND_API_KEY || processEnv.RESEND_API_KEY || "").trim();
				if (envKey || prov.apiKeyEnc) {
					prov.configured = true;
					if (envKey && !prov.apiKeyMasked) prov.apiKeyMasked = maskKeyValue(envKey);
				}
			} else if (pType === "sendpulse") {
				if (sendpulseEnvKey || prov.apiKeyEnc) {
					prov.configured = true;
					if (sendpulseEnvKey && !prov.apiKeyMasked) prov.apiKeyMasked = maskKeyValue(sendpulseEnvKey);
				}
			} else if ((pType === "zepto" || pType === "zeptomail") && (envAny.ZEPTOMAIL_API_KEY || envAny.ZEPTO_API_KEY || prov.apiKeyEnc)) {
				prov.configured = true;
			} else if (pType === "ses" && ((envAny.AWS_ACCESS_KEY_ID && envAny.AWS_SECRET_ACCESS_KEY) || prov.apiKeyEnc)) {
				prov.configured = true;
			} else if (pType === "cloudflare") {
				const hasBinding = Boolean(envAny.EMAIL && typeof envAny.EMAIL.send === "function");
				const hasRestApi = Boolean(
					(envAny.CF_ACCOUNT_ID && envAny.CF_TOKEN) ||
						(processEnv.CF_ACCOUNT_ID && processEnv.CF_TOKEN),
				);
				prov.configured = hasBinding || hasRestApi;
			}
		}
	}

	// 4. Auto-reconcile with distinct project IDs from send logs so any project
	// dispatched via SDK/API is permanently registered and visible.
	if (env.DB) {
		try {
			const candidateTables = ["email_router_send_logs", "send_log"];
			let distinctRows: any[] = [];
			for (const table of candidateTables) {
				try {
					const res = await env.DB.prepare(`SELECT DISTINCT project_id FROM ${table}`).all();
					if (res?.results && res.results.length > 0) {
						distinctRows = res.results;
						break;
					}
				} catch {
					// try next
				}
			}

			let hasNewProject = false;
			for (const r of distinctRows) {
				const rawId = String(r.project_id || "").trim();
				if (!rawId) continue;
				let cleanSlug = "";
				try {
					cleanSlug = normalizeProjectSlug(rawId);
				} catch {
					cleanSlug = rawId.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
				}
				if (!cleanSlug) continue;
				const expectedId = cleanSlug.startsWith("proj_") ? cleanSlug : `proj_${cleanSlug}`;
				const rawNorm = normalizeSlugKey(rawId);

				const exists = state.projects.some(
					(p) =>
						p.id.toLowerCase() === expectedId.toLowerCase() ||
						p.id.toLowerCase() === rawId.toLowerCase() ||
						p.slug.toLowerCase() === cleanSlug.toLowerCase() ||
						normalizeSlugKey(p.slug || p.id) === rawNorm
				);

				if (!exists) {
					const rawName = rawId.replace(/^proj_/, "").replace(/[-_]/g, " ");
					const displayName = rawName
						.split(/\s+/)
						.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
						.join(" ") || "Project";

					const providerOrder = state.providers
						.filter((p) => p.enabled)
						.sort((a, b) => (a.provider === "cloudflare" ? -1 : 0) - (b.provider === "cloudflare" ? -1 : 0))
						.map((p) => p.id);
					const newProject: MailHubProject = {
						id: expectedId,
						name: displayName,
						slug: cleanSlug,
						description: `${displayName} Transactional Mail`,
						status: "active",
						providerOrder: providerOrder.length > 0 ? providerOrder : ["cred_brevo_main", "cred_resend_main", "cred_ses_backup"],
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					};

					state.projects.push(newProject);

					for (const prov of state.providers) {
						state.allocations.push({
							projectId: expectedId,
							providerId: prov.id,
							dailySlice: prov.dailyLimit > 1000 ? 5000 : Math.max(100, prov.dailyLimit || 300),
							priority: newProject.providerOrder.indexOf(prov.id) + 1 || 1,
							usedToday: 0,
						});
					}

					const keyGen = await generateRoutingKey({ projectSlug: cleanSlug, environment: "live" });
					state.keys.push({
						id: keyGen.keyId,
						projectId: expectedId,
						name: `${newProject.name} Live Key`,
						prefix: keyGen.prefix,
						displayPrefix: keyGen.displayPrefix,
						keyHash: keyGen.keyHash,
						environment: "live",
						status: "active",
						createdAt: keyGen.createdAt.toISOString(),
						lastUsedAt: null,
					});

					hasNewProject = true;
				}
			}

			if (hasNewProject) {
				await saveMailHubState(env, state);
			}
		} catch {
			// Best-effort reconciliation
		}
	}

	try {
		const liveUsage = await getAllQuotaUsage(env as any);
		if (liveUsage && Object.keys(liveUsage).length > 0) {
			for (const alloc of state.allocations) {
				const allocNorm = normalizeSlugKey(alloc.projectId);
				const projectLive =
					liveUsage[alloc.projectId] ??
					Object.entries(liveUsage).find(([k]) => normalizeSlugKey(k) === allocNorm)?.[1];
				if (projectLive && typeof projectLive[alloc.providerId] === "number") {
					alloc.usedToday = projectLive[alloc.providerId];
				}
			}
		}
	} catch {
		// keep current count
	}

	inMemoryState = state;
	return state;
}

/**
 * Save MailHub state to D1 SQL, Cloudflare KV, and memory cache.
 */
export async function saveMailHubState(env: MailHubEnv, state: MailHubState): Promise<void> {
	inMemoryState = state;

	// 1. Persist to Cloudflare KV if bound
	if (env.KV) {
		try {
			await env.KV.put(KV_STATE_KEY, JSON.stringify(state));
		} catch (err) {
			console.error("[saveMailHubState] Failed to persist to KV:", err);
		}
	}

	// 2. Persist to D1 Database if bound (cross-dialect safe)
	if (env.DB) {
		try {
			await ensureMailHubStateTable(env);
			const stateJson = JSON.stringify(state);
			const now = Date.now();
			const existing = await env.DB.prepare(
				"SELECT id FROM mailhub_state WHERE id = 'default' LIMIT 1"
			).first();

			if (existing) {
				await env.DB.prepare(
					"UPDATE mailhub_state SET state_json = ?, updated_at = ? WHERE id = 'default'"
				).bind(stateJson, now).run();
			} else {
				await env.DB.prepare(
					"INSERT INTO mailhub_state (id, state_json, updated_at) VALUES ('default', ?, ?)"
				).bind(stateJson, now).run();
			}
		} catch (err) {
			console.error("[saveMailHubState] Failed to persist to D1:", err);
		}
	}
}

async function syncAllocationRowToD1(
	env: MailHubEnv,
	projectId: string,
	providerCredId: string,
	dailySlice: number,
	priority: number
): Promise<void> {
	if (!env.DB) return;
	try {
		const nowIso = new Date().toISOString().slice(0, 19).replace("T", " ");
		const upd = await env.DB.prepare(
			"UPDATE project_provider_allocations SET daily_slice = ?, priority = ?, updated_at = ? WHERE project_id = ? AND provider_cred_id = ?"
		).bind(dailySlice, priority, nowIso, projectId, providerCredId).run();
		const changes = Number((upd as any)?.meta?.changes ?? (upd as any)?.changes ?? 0);
		if (changes === 0) {
			const allocId = `alloc_${nanoid(10)}`;
			await env.DB.prepare(
				"INSERT INTO project_provider_allocations (id, project_id, provider_cred_id, daily_slice, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
			).bind(allocId, projectId, providerCredId, dailySlice, priority, nowIso, nowIso).run();
		}
	} catch {
		// Table may not exist in minimal unit-test schemas
	}
}

/**
 * Update quota slices for a provider, validating sum(slices) <= providerLimit.
 */
export async function updateProviderSlices(
	env: MailHubEnv,
	providerId: string,
	slices: { projectId: string; dailySlice: number }[]
): Promise<{ success: boolean; totalAllocated: number; limit: number; error?: string }> {
	const state = await getMailHubState(env);
	const provider = state.providers.find((p) => p.id === providerId);
	if (!provider) {
		return { success: false, totalAllocated: 0, limit: 0, error: `Provider "${providerId}" not found.` };
	}

	const totalAllocated = slices.reduce((acc, s) => acc + Math.max(0, Math.floor(s.dailySlice)), 0);
	if (totalAllocated > provider.dailyLimit) {
		return {
			success: false,
			totalAllocated,
			limit: provider.dailyLimit,
			error: `Total allocated (${totalAllocated}) exceeds provider limit (${provider.dailyLimit}) by ${totalAllocated - provider.dailyLimit} emails/day!`,
		};
	}

	// Apply slices
	for (const s of slices) {
		const normalizedSlice = Math.max(0, Math.floor(s.dailySlice));
		const existing = state.allocations.find((a) => a.providerId === providerId && a.projectId === s.projectId);
		const priority = existing?.priority ?? 1;
		if (existing) {
			existing.dailySlice = normalizedSlice;
		} else {
			state.allocations.push({
				projectId: s.projectId,
				providerId,
				dailySlice: normalizedSlice,
				priority,
				usedToday: 0,
			});
		}
		await syncAllocationRowToD1(env, s.projectId, providerId, normalizedSlice, priority);
	}

	await saveMailHubState(env, state);
	return { success: true, totalAllocated, limit: provider.dailyLimit };
}

/**
 * Reorder fallback providers for a project.
 */
export async function updateProjectFallbackOrder(
	env: MailHubEnv,
	projectId: string,
	providerOrder: string[]
): Promise<{ success: boolean; error?: string }> {
	const state = await getMailHubState(env);
	const project = state.projects.find((p) => p.id === projectId);
	if (!project) {
		return { success: false, error: `Project "${projectId}" not found.` };
	}

	project.providerOrder = providerOrder;
	project.updatedAt = new Date().toISOString();

	// Update priority index on allocations
	for (let index = 0; index < providerOrder.length; index++) {
		const provId = providerOrder[index];
		const alloc = state.allocations.find((a) => a.projectId === projectId && a.providerId === provId);
		if (alloc) {
			alloc.priority = index + 1;
			await syncAllocationRowToD1(env, projectId, provId, alloc.dailySlice, alloc.priority);
		}
	}

	await saveMailHubState(env, state);
	return { success: true };
}

/**
 * Register a new project.
 */
export async function createProject(
	env: MailHubEnv,
	data: { name: string; slug?: string; description?: string }
): Promise<{ project: MailHubProject; key: string }> {
	const state = await getMailHubState(env);
	const cleanSlug = normalizeProjectSlug(data.slug || data.name);
	const id = `proj_${cleanSlug}`;

	// Ensure unique
	if (state.projects.some((p) => p.id === id || p.slug === cleanSlug)) {
		throw new Error(`A project with slug "${cleanSlug}" already exists.`);
	}

	const providerOrder = state.providers
		.filter((p) => p.enabled)
		.sort((a, b) => (a.provider === "cloudflare" ? -1 : 0) - (b.provider === "cloudflare" ? -1 : 0))
		.map((p) => p.id);
	const nowIso = new Date().toISOString();

	const project: MailHubProject = {
		id,
		name: data.name.trim(),
		slug: cleanSlug,
		description: data.description?.trim() || "",
		status: "active",
		providerOrder,
		createdAt: nowIso,
		updatedAt: nowIso,
	};

	state.projects.push(project);

	if (env.DB) {
		try {
			const dbNow = nowIso.slice(0, 19).replace("T", " ");
			await env.DB.prepare(
				"INSERT INTO projects (id, name, slug, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)"
			).bind(id, project.name, project.slug, project.description, dbNow, dbNow).run();
		} catch {
			// Best-effort D1 sync
		}
	}

	// Create default allocations
	for (const prov of state.providers) {
		const slice = prov.dailyLimit > 1000 ? 5000 : Math.max(100, prov.dailyLimit || 300);
		const priority = providerOrder.indexOf(prov.id) + 1 || 1;
		state.allocations.push({
			projectId: id,
			providerId: prov.id,
			dailySlice: slice,
			priority,
			usedToday: 0,
		});
		if (prov.enabled && slice > 0) {
			await syncAllocationRowToD1(env, id, prov.id, slice, priority);
		}
	}

	// Generate initial live routing key
	const keyGen = await generateRoutingKey({ projectSlug: cleanSlug, environment: "live" });
	const routingKey: MailHubRoutingKey = {
		id: keyGen.keyId,
		projectId: id,
		name: `${project.name} Live Key`,
		prefix: keyGen.prefix,
		displayPrefix: keyGen.displayPrefix,
		keyHash: keyGen.keyHash,
		environment: "live",
		status: "active",
		createdAt: keyGen.createdAt.toISOString(),
		lastUsedAt: null,
	};

	state.keys.push(routingKey);

	if (env.DB) {
		try {
			const dbNow = keyGen.createdAt.toISOString().slice(0, 19).replace("T", " ");
			await env.DB.prepare(
				"INSERT INTO project_routing_keys (id, project_id, name, prefix, key_hash, environment, status, rate_limit_rps, created_at) VALUES (?, ?, ?, ?, ?, 'live', 'active', 60, ?)"
			).bind(routingKey.id, id, routingKey.name, routingKey.prefix, routingKey.keyHash, dbNow).run();
		} catch {
			// Best-effort D1 sync
		}
	}

	await saveMailHubState(env, state);

	return { project, key: keyGen.fullKey };
}

/**
 * Generate a new routing key for a project.
 */
export async function createRoutingKey(
	env: MailHubEnv,
	projectId: string,
	name?: string,
	environment: "live" | "test" = "live"
): Promise<{ routingKey: MailHubRoutingKey; fullKey: string }> {
	const state = await getMailHubState(env);
	const project = state.projects.find((p) => p.id === projectId);
	if (!project) {
		throw new Error(`Project "${projectId}" not found.`);
	}

	const keyGen = await generateRoutingKey({ projectSlug: project.slug, environment });
	const routingKey: MailHubRoutingKey = {
		id: keyGen.keyId,
		projectId: project.id,
		name: name?.trim() || `${project.name} ${environment.toUpperCase()} Key`,
		prefix: keyGen.prefix,
		displayPrefix: keyGen.displayPrefix,
		keyHash: keyGen.keyHash,
		environment,
		status: "active",
		createdAt: keyGen.createdAt.toISOString(),
		lastUsedAt: null,
	};

	state.keys.push(routingKey);

	if (env.DB) {
		try {
			const dbNow = keyGen.createdAt.toISOString().slice(0, 19).replace("T", " ");
			await env.DB.prepare(
				"INSERT INTO project_routing_keys (id, project_id, name, prefix, key_hash, environment, status, rate_limit_rps, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', 60, ?)"
			).bind(routingKey.id, project.id, routingKey.name, routingKey.prefix, routingKey.keyHash, environment, dbNow).run();
		} catch {
			// Best-effort D1 sync
		}
	}

	await saveMailHubState(env, state);

	return { routingKey, fullKey: keyGen.fullKey };
}

/**
 * Revoke a routing key.
 */
export async function revokeRoutingKey(env: MailHubEnv, keyId: string): Promise<boolean> {
	const state = await getMailHubState(env);
	const key = state.keys.find((k) => k.id === keyId);
	if (!key) return false;

	key.status = "revoked";

	if (env.DB) {
		try {
			await env.DB.prepare(
				"UPDATE project_routing_keys SET status = 'revoked' WHERE id = ?"
			).bind(keyId).run();
		} catch {
			// Best-effort D1 sync
		}
	}

	await saveMailHubState(env, state);
	return true;
}

/**
 * Update provider credentials / config.
 */
export async function updateProviderConfig(
	env: MailHubEnv,
	providerId: string,
	updates: Partial<MailHubProviderConfig> & { apiKey?: string; secretKey?: string }
): Promise<MailHubProviderConfig> {
	const state = await getMailHubState(env);
	const provider = state.providers.find((p) => p.id === providerId);
	if (!provider) {
		throw new Error(`Provider "${providerId}" not found.`);
	}

	if (typeof updates.dailyLimit === "number") provider.dailyLimit = Math.max(1, updates.dailyLimit);
	if (typeof updates.label === "string") provider.label = updates.label;
	if (typeof updates.enabled === "boolean") provider.enabled = updates.enabled;
	if (updates.region) provider.region = updates.region;
	if (updates.bounceAddress) provider.bounceAddress = updates.bounceAddress;

	if (updates.apiKey && updates.apiKey.trim().length > 0) {
		const raw = updates.apiKey.trim();
		provider.configured = true;
		provider.apiKeyEnc = raw;
		(provider as any).apiKey = raw;
		provider.apiKeyMasked = maskKeyValue(raw);
	}

	if (updates.secretKey && updates.secretKey.trim().length > 0) {
		(provider as any).secretKey = updates.secretKey.trim();
	}

	if (env.DB) {
		try {
			const credsPayload: Record<string, string> = {};
			if (provider.apiKeyEnc) {
				if (provider.provider === "ses") credsPayload.accessKeyId = provider.apiKeyEnc;
				else if (provider.provider === "zepto" || provider.provider === "zeptomail") credsPayload.sendMailToken = provider.apiKeyEnc;
				else credsPayload.apiKey = provider.apiKeyEnc;
			}
			if ((provider as any).secretKey) credsPayload.secretAccessKey = (provider as any).secretKey;
			if (provider.region) credsPayload.region = provider.region;
			if (provider.bounceAddress) credsPayload.bounceAddress = provider.bounceAddress;

			const credsJson = JSON.stringify(credsPayload);
			const upd = await env.DB.prepare(
				"UPDATE provider_credentials SET label = ?, credentials_encrypted = ?, daily_limit = ?, cost_per_k = ?, enabled = ? WHERE id = ?"
			).bind(
				provider.label || provider.provider,
				credsJson,
				provider.dailyLimit,
				provider.costPerK,
				provider.enabled ? 1 : 0,
				provider.id
			).run();
			const changes = Number((upd as any)?.meta?.changes ?? (upd as any)?.changes ?? 0);
			if (changes === 0) {
				await env.DB.prepare(
					"INSERT INTO provider_credentials (id, provider, label, credentials_encrypted, daily_limit, cost_per_k, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)"
				).bind(
					provider.id,
					provider.provider,
					provider.label || provider.provider,
					credsJson,
					provider.dailyLimit,
					provider.costPerK,
					provider.enabled ? 1 : 0
				).run();
			}
		} catch {
			// Best-effort D1 sync
		}
	}

	await saveMailHubState(env, state);
	return provider;
}
