import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { syncCloudflareDomains } from "@/lib/domains/cloudflare-sync";
import type { CfAuth } from "@/lib/cloudflare-api.types";

export async function POST(request: Request) {
	const env = getEnv();
	const user = await requireUser(env, request);
	if (!user.canManageDomains && !user.isPrimaryAdmin) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	const body = (await request.json().catch(() => ({}))) as { token?: string };
	const token = body.token?.trim();
	if (!token) {
		return NextResponse.json({ error: "Token is required" }, { status: 400 });
	}

	const auth: CfAuth = { kind: "token", token };

	// Verify token by fetching user tokens or zones
	try {
		const verifyRes = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const verifyData = (await verifyRes.json().catch(() => null)) as { success?: boolean; messages?: { message: string }[] } | null;
		if (!verifyRes.ok || !verifyData?.success) {
			// Fallback check: try listing zones directly
			const zoneRes = await fetch("https://api.cloudflare.com/client/v4/zones?per_page=1", {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (!zoneRes.ok) {
				return NextResponse.json({ error: "Invalid Cloudflare token. Please ensure it has Zone and DNS permissions." }, { status: 400 });
			}
		}
	} catch (error) {
		return NextResponse.json({ error: "Failed to connect to Cloudflare API" }, { status: 502 });
	}

	// Save token in app_settings
	const db = getDb(env);
	await db
		.insert(appSettings)
		.values({ id: "default", cfToken: token, updatedAt: new Date() })
		.onConflictDoUpdate({ target: appSettings.id, set: { cfToken: token, updatedAt: new Date() } });

	// Auto-import domains from this Cloudflare account
	try {
		const result = await syncCloudflareDomains(env, user.id, auth);
		return NextResponse.json({ ok: true, result });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to import domains";
		return NextResponse.json({ ok: true, warning: message, result: { totalZones: 0, added: [], updated: [], existing: [], failed: [] } });
	}
}

