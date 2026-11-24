import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { domains } from "@/db/schema";
import { cfRequest, getEmailRoutingSettings, listSendingSubdomains } from "@/lib/cloudflare-api";
import { findSendingSubdomain } from "@/lib/domains/sending-status";
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
				// If it was registered as manual zone, upgrade it to the real Cloudflare zone and sync live routing/sending state.
				if (current.zoneId === "manual") {
					const [routingSettings, sendingSubdomains] = await Promise.all([
						getEmailRoutingSettings(env, zone.id, auth).catch(() => null),
						listSendingSubdomains(env, zone.id, auth).catch(() => []),
					]);
					const sendingSubdomain = findSendingSubdomain(hostname, sendingSubdomains);
					const routingEnabled = routingSettings?.enabled ?? false;
					const nextReceivingProvider =
						current.receivingProvider === "none" && routingEnabled
							? ("cloudflare" as const)
							: current.receivingProvider;
					const nextSendingProvider =
						current.sendingProvider === "none" && sendingSubdomain?.enabled
							? ("cloudflare" as const)
							: current.sendingProvider;
					const nextSendingEnabled = sendingSubdomain?.enabled ?? current.sendingEnabled;
					const nextStatus =
						routingEnabled ||
						nextSendingEnabled ||
						nextReceivingProvider !== "none" ||
						nextSendingProvider !== "none"
							? ("active" as const)
							: current.status;

					await db
						.update(domains)
						.set({
							zoneId: zone.id,
							status: nextStatus,
							receivingProvider: nextReceivingProvider,
							routingEnabled: nextReceivingProvider === "cloudflare" ? routingEnabled : current.routingEnabled,
							routingStatus: routingSettings?.status ?? current.routingStatus,
							sendingProvider: nextSendingProvider,
							sendingSubdomainTag: sendingSubdomain?.tag ?? current.sendingSubdomainTag,
							sendingEnabled: nextSendingEnabled,
							sendingRequested: sendingSubdomain ? true : current.sendingRequested,
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

