import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { getCloudflareAuth } from "@/lib/cloudflare-api-utils";
import type { CfAuth } from "@/lib/cloudflare-api.types";

export async function resolveCloudflareAuth(env: CloudflareEnv): Promise<CfAuth> {
	try {
		return getCloudflareAuth(env);
	} catch {
		try {
			const db = getDb(env);
			const [row] = await db
				.select({ cfToken: appSettings.cfToken })
				.from(appSettings)
				.where(eq(appSettings.id, "default"))
				.limit(1);
			if (row?.cfToken?.trim()) {
				return { kind: "token", token: row.cfToken.trim() };
			}
		} catch {}
		throw new Error("Cloudflare is not connected. Connect your Cloudflare account to manage domains and DNS.");
	}
}

export async function hasConfiguredCloudflare(env: CloudflareEnv): Promise<boolean> {
	if (env.CF_TOKEN?.trim() || (env.CF_API_KEY?.trim() && env.CF_EMAIL?.trim())) {
		return true;
	}
	try {
		const db = getDb(env);
		const [row] = await db
			.select({ cfToken: appSettings.cfToken })
			.from(appSettings)
			.where(eq(appSettings.id, "default"))
			.limit(1);
		return !!row?.cfToken?.trim();
	} catch {
		return false;
	}
}

