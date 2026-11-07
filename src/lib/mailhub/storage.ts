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
			id: "proj_production",
			name: "Production",
			slug: "production",
			description: "Primary MailHub transactional delivery & routing",
			status: "active",
			providerOrder: ["cred_brevo_main", "cred_resend_main", "cred_ses_backup"],
			createdAt: "2026-11-01T00:00:00.000Z",
			updatedAt: "2026-11-01T00:00:00.000Z",
		},
	],
	allocations: [
		{ projectId: "proj_production", providerId: "cred_brevo_main", dailySlice: 300, priority: 1, usedToday: 0 },
		{ projectId: "proj_production", providerId: "cred_resend_main", dailySlice: 100, priority: 2, usedToday: 0 },
		{ projectId: "proj_production", providerId: "cred_ses_backup", dailySlice: 10000, priority: 3, usedToday: 0 },
	],
	keys: [
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

/**
 * Load MailHub state with fallbacks across D1 SQL, Cloudflare KV, and In-Memory state.
 */
export async function getMailHubState(env: MailHubEnv): Promise<MailHubState> {
	const baseSeed = isTestEnvironment() ? DEFAULT_MAILHUB_STATE : CLEAN_PRODUCTION_MAILHUB_STATE;
	let state: MailHubState = inMemoryState || JSON.parse(JSON.stringify(baseSeed));

	if (env.KV) {
		try {
			const saved = await env.KV.get(KV_STATE_KEY, 'json');
			if (saved && typeof saved === 'object' && (saved as any).projects) {
				state = saved as MailHubState;
			}
		} catch {
			// fallback
		}
	}

	try {
		const liveUsage = await getAllQuotaUsage(env as any);
		if (liveUsage && Object.keys(liveUsage).length > 0) {
			for (const alloc of state.allocations) {
				const projectLive = liveUsage[alloc.projectId];
				if (projectLive && typeof projectLive[alloc.providerId] === 'number') {
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
 * Save MailHub state to KV and memory cache.
 */
export async function saveMailHubState(env: MailHubEnv, state: MailHubState): Promise<void> {
	inMemoryState = state;
	if (env.KV) {
		try {
			await env.KV.put(KV_STATE_KEY, JSON.stringify(state));
		} catch (err) {
			console.error("[saveMailHubState] Failed to persist to KV:", err);
		}
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
		const existing = state.allocations.find((a) => a.providerId === providerId && a.projectId === s.projectId);
		if (existing) {
			existing.dailySlice = Math.max(0, Math.floor(s.dailySlice));
		} else {
			state.allocations.push({
				projectId: s.projectId,
				providerId,
				dailySlice: Math.max(0, Math.floor(s.dailySlice)),
				priority: 1,
				usedToday: 0,
			});
		}
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
	providerOrder.forEach((provId, index) => {
		const alloc = state.allocations.find((a) => a.projectId === projectId && a.providerId === provId);
		if (alloc) {
			alloc.priority = index + 1;
		}
	});

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

	const providerOrder = state.providers.filter((p) => p.enabled).map((p) => p.id);

	const project: MailHubProject = {
		id,
		name: data.name.trim(),
		slug: cleanSlug,
		description: data.description?.trim() || "",
		status: "active",
		providerOrder,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};

	state.projects.push(project);

	// Create default allocations (e.g. 0 slice or reasonable initial balance)
	for (const prov of state.providers) {
		state.allocations.push({
			projectId: id,
			providerId: prov.id,
			dailySlice: prov.dailyLimit > 1000 ? 5000 : 0,
			priority: providerOrder.indexOf(prov.id) + 1 || 1,
			usedToday: 0,
		});
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
		provider.apiKeyMasked = `${raw.slice(0, 6)}••••••••${raw.slice(-4)}`;
	}

	await saveMailHubState(env, state);
	return provider;
}
