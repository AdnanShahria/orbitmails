import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { domains } from "@/db/schema";
import { getEnv } from "@/lib/cloudflare";
import { requireUser } from "@/lib/auth/cookies";
import { canManageDomains } from "@/lib/auth/admin";
import { getDomainForUser, removeDomainForUser } from "@/lib/domains/service";
import { isManualZone } from "@/lib/domains/provision";
import { queryDns } from "@/lib/dns-query";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
	const { id } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	const domain = await getDomainForUser(env, user.id, id);
	if (!domain) return NextResponse.json({ error: "Not found" }, { status: 404 });
	return NextResponse.json({ domain });
}

/** Clears the "DNS skipped" warning once the operator has set the records themselves. */
export async function PATCH(request: Request, { params }: Params) {
	const { id } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	if (!canManageDomains(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	if (!hasValidSessionMutationOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
	const body = (await request.json().catch(() => null)) as { dnsSkipped?: unknown } | null;
	if (typeof body?.dnsSkipped !== "boolean") {
		return NextResponse.json({ error: "dnsSkipped must be a boolean" }, { status: 400 });
	}
	const domain = await getDomainForUser(env, user.id, id);
	if (!domain) return NextResponse.json({ error: "Not found" }, { status: 404 });
	const updates: Partial<typeof domains.$inferInsert> = { dnsSkipped: body.dnsSkipped };
	if (body.dnsSkipped === false) {
		if (domain.status === "pending") updates.status = "active";
		if (domain.receivingProvider === "cloudflare" && isManualZone(domain.zoneId) && !domain.routingEnabled) {
			try {
				const mxRecords = await queryDns(domain.hostname, "MX");
				if (mxRecords.some((v) => /\.mx\.cloudflare\.net\.?$/i.test(v.trim()))) {
					updates.routingEnabled = true;
				}
			} catch {}
		}
	}
	await getDb(env).update(domains).set(updates).where(eq(domains.id, id));
	return NextResponse.json({ domain: { ...domain, ...updates } });
}

export async function DELETE(request: Request, { params }: Params) {
	const { id } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	if (!canManageDomains(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	if (!hasValidSessionMutationOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
	try {
		await removeDomainForUser(env, user.id, id);
		return NextResponse.json({ ok: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : "Failed to remove domain";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}
