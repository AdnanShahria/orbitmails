import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { hasCloudflareCredentials } from "@/lib/runtime";

export async function GET(request: Request) {
	const env = getEnv();
	const user = await requireUser(env, request);
	if (!user.canManageDomains && !user.isPrimaryAdmin) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	const db = getDb(env);
	const [settings] = await db
		.select({
			cfToken: appSettings.cfToken,
			cfOauthClientId: appSettings.cfOauthClientId,
		})
		.from(appSettings)
		.where(eq(appSettings.id, "default"))
		.limit(1);

	const envToken = env.CF_TOKEN?.trim();
	const envOauthClientId = (env as Record<string, string | undefined>).CLOUDFLARE_CLIENT_ID?.trim() ||
		(env as Record<string, string | undefined>).CF_OAUTH_CLIENT_ID?.trim();

	const isEnvConnected = hasCloudflareCredentials(env);
	const isDbConnected = !!settings?.cfToken?.trim();
	const connected = isEnvConnected || isDbConnected;
	const clientId = envOauthClientId || settings?.cfOauthClientId?.trim() || null;

	return NextResponse.json({
		connected,
		source: isEnvConnected ? "environment" : isDbConnected ? "settings" : null,
		hasOauth: !!clientId,
		clientId,
	});
}

