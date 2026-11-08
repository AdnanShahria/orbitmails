import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";

export async function POST(request: Request) {
	const env = getEnv();
	const user = await requireUser(env, request);
	if (!user.canManageDomains && !user.isPrimaryAdmin) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	const body = (await request.json().catch(() => ({}))) as { clientId?: string; clientSecret?: string };
	const clientId = body.clientId?.trim();
	const clientSecret = body.clientSecret?.trim();

	if (!clientId || !clientSecret) {
		return NextResponse.json({ error: "Client ID and Client Secret are required" }, { status: 400 });
	}

	const db = getDb(env);
	await db
		.insert(appSettings)
		.values({
			id: "default",
			cfOauthClientId: clientId,
			cfOauthClientSecret: clientSecret,
			updatedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: appSettings.id,
			set: {
				cfOauthClientId: clientId,
				cfOauthClientSecret: clientSecret,
				updatedAt: new Date(),
			},
		});

	const origin = new URL(request.url).origin;
	const redirectUri = `${origin}/api/auth/cloudflare/callback`;
	const state = crypto.randomUUID();

	const authUrl = `https://dash.cloudflare.com/oauth2/auth?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent("offline_access zone:read dns:edit email_routing:edit")}&state=${state}`;

	const response = NextResponse.json({ ok: true, authUrl });
	response.cookies.set("cf_oauth_state", state, {
		httpOnly: true,
		secure: origin.startsWith("https"),
		sameSite: "lax",
		maxAge: 600,
		path: "/",
	});

	return response;
}

