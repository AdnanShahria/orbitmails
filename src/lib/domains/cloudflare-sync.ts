import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { domains } from "@/db/schema";
import { cfRequest } from "@/lib/cloudflare-api";
import { addDomainForUser } from "@/lib/domains/service";
import type { CfAuth } from "@/lib/cloudflare-api.types";

export type CloudflareZone = {
	id: string;
	name: string;
	status: string;
	paused: boolean;
	type: string;
};

export type ImportDomainsResult = {
	totalZones: number;
	added: string[];
	updated: string[];
	existing: string[];
	failed: { hostname: string; error: string }[];
};

export async function fetchCloudflareZones(env: CloudflareEnv, auth?: CfAuth): Promise<CloudflareZone[]> {
	return cfRequest<CloudflareZone[]>(env, "/zones?status=active&per_page=50", undefined, auth);
}

export async function syncCloudflareDomains(
	env: CloudflareEnv,
	userId: string,
	auth?: CfAuth,
): Promise<ImportDomainsResult> {
	const zones = await fetchCloudflareZones(env, auth);
	const db = getDb(env);

	const added: string[] = [];
	const updated: string[] = [];
	const existing: string[] = [];
	const failed: { hostname: string; error: string }[] = [];

	for (const zone of zones) {
		const hostname = zone.name.toLowerCase().trim();
		try {
			// Check if domain exists in database
			const [current] = await db
				.select()
				.from(domains)
				.where(eq(domains.hostname, hostname))
				.limit(1);

			if (current) {
				// If it belonged to another user, skip
				if (current.userId !== userId) {
					continue;
				}
				// If it was registered as manual zone, upgrade it to the real Cloudflare zone!
				if (current.zoneId === "manual") {
					await db
						.update(domains)
						.set({
							zoneId: zone.id,
							status: "active",
							routingEnabled: true,
							dnsSkipped: false,
						})
						.where(eq(domains.id, current.id));
					updated.push(hostname);
				} else {
					existing.push(hostname);
				}
				continue;
			}

			// Add new domain for user with automatic Cloudflare provisioning
			await addDomainForUser(env, userId, hostname, {
				enableRouting: true,
				enableSending: true,
				skipDns: false,
				receivingProvider: "cloudflare",
				sendingProvider: "cloudflare",
			});
			added.push(hostname);
		} catch (error) {
			console.warn(`Failed to auto-import Cloudflare zone ${hostname}:`, error);
			failed.push({
				hostname,
				error: error instanceof Error ? error.message : "Failed to import domain",
			});
		}
	}

	return {
		totalZones: zones.length,
		added,
		updated,
		existing,
		failed,
	};
}

