import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { domains } from "@/db/schema";
import { isManualZone } from "@/lib/domains/provision";
import { preflightDomain } from "@/lib/domains/preflight";
import type { DomainRow } from "@/lib/domains/types";
import { hasCloudflareCredentials } from "@/lib/runtime";
import { hasConfiguredCloudflare } from "@/lib/domains/cloudflare-auth";

/**
 * A domain added with DNS skipped has the "manual" zone, which every Cloudflare
 * call ignores. Choosing Cloudflare sending or receiving later swaps in the real
 * zone so the usual setup can run. Returns the row unchanged when it already has
 * one, or when there are no Cloudflare credentials to look the zone up with.
 */
export async function adoptCloudflareZone(env: CloudflareEnv, domain: DomainRow): Promise<DomainRow> {
	const hasCf = hasCloudflareCredentials(env) || await hasConfiguredCloudflare(env);
	if (!isManualZone(domain.zoneId) || !hasCf) return domain;
	const { zone } = await preflightDomain(env, domain.hostname);
	const db = getDb(env);
	const [claimed] = await db
		.select({ id: domains.id })
		.from(domains)
		.where(and(eq(domains.zoneId, zone.id), ne(domains.userId, domain.userId)))
		.limit(1);
	if (claimed) throw new Error("Cloudflare zone is already registered to another account");
	await db.update(domains).set({ zoneId: zone.id }).where(eq(domains.id, domain.id));
	return { ...domain, zoneId: zone.id };
}
