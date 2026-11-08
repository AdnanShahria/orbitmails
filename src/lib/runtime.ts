/**
 * Where the app is running. On Cloudflare Workers the bindings come from
 * cloudflare:workers; the self-hosted Node server builds an equivalent env object and
 * publishes it on globalThis before Next starts, so route handlers reach it
 * the same way.
 */
declare global {
	var __orbitflareNodeEnv: CloudflareEnv | undefined;
}

export function getNodeEnv(): CloudflareEnv | undefined {
	return globalThis.__orbitflareNodeEnv;
}

export function isNodeRuntime(env?: Pick<CloudflareEnv, "ORBITFLARE_RUNTIME">): boolean {
	return (env ?? getNodeEnv())?.ORBITFLARE_RUNTIME === "node";
}

/** True when the app can talk to the Cloudflare API to manage zones and routing. */
export function hasCloudflareCredentials(env: Pick<CloudflareEnv, "CF_TOKEN" | "CF_API_KEY" | "CF_EMAIL">): boolean {
	return !!env.CF_TOKEN?.trim() || (!!env.CF_API_KEY?.trim() && !!env.CF_EMAIL?.trim());
}

export async function hasConfiguredCloudflare(env: CloudflareEnv): Promise<boolean> {
	if (hasCloudflareCredentials(env)) return true;
	try {
		const { getDb } = await import("@/db");
		const { appSettings } = await import("@/db/schema");
		const { eq } = await import("drizzle-orm");
		const [row] = await getDb(env)
			.select({ cfToken: appSettings.cfToken })
			.from(appSettings)
			.where(eq(appSettings.id, "default"))
			.limit(1);
		return !!row?.cfToken?.trim();
	} catch {
		return false;
	}
}
