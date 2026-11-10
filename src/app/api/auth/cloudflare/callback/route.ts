import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { syncCloudflareDomains } from "@/lib/domains/cloudflare-sync";
import type { CfAuth } from "@/lib/cloudflare-api.types";

export async function GET(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	const url = new URL(request.url);
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const error = url.searchParams.get("error");
	const errorDescription = url.searchParams.get("error_description");

	const cookieStore = await cookies();
	const storedState = cookieStore.get("cf_oauth_state")?.value;

	const renderResult = (title: string, message: string, success: boolean, domains: string[] = []) => {
		const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f9fafb; color: #111827; }
    .card { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1); max-width: 440px; width: 90%; text-align: center; }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; }
    p { font-size: 0.875rem; color: #6b7280; line-height: 1.5; margin: 0 0 1rem; }
    .list { background: #f3f4f6; border-radius: 0.5rem; padding: 0.75rem 1rem; margin-bottom: 1rem; text-align: left; font-size: 0.8125rem; max-height: 120px; overflow-y: auto; }
    .list-item { padding: 0.25rem 0; color: #374151; font-family: monospace; }
    .btn { display: inline-block; padding: 0.625rem 1.25rem; font-size: 0.875rem; font-weight: 500; border-radius: 0.5rem; border: none; cursor: pointer; text-decoration: none; }
    .btn-primary { background: #f38020; color: white; }
    .btn-secondary { background: #e5e7eb; color: #374151; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${success ? "🎉" : "⚠️"}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    ${domains.length > 0 ? `
      <div class="list">
        <strong>Imported Domains:</strong>
        ${domains.map((d) => `<div class="list-item">✓ ${d}</div>`).join("")}
      </div>
    ` : ""}
    <button class="btn ${success ? "btn-primary" : "btn-secondary"}" onclick="window.close()">Close window</button>
  </div>
  ${success ? `
  <script>
    if (window.opener) {
      window.opener.postMessage({
        type: "CLOUDFLARE_AUTH_SUCCESS",
        domains: ${JSON.stringify(domains)}
      }, "*");
    }
    setTimeout(() => { window.close(); }, 2000);
  </script>
  ` : ""}
</body>
</html>`;
		return new NextResponse(html, {
			headers: { "Content-Type": "text/html; charset=utf-8" },
		});
	};

	if (error) {
		return renderResult("Authorization Cancelled", errorDescription || error, false);
	}

	if (!code) {
		return renderResult("Authorization Failed", "No authorization code returned from Cloudflare.", false);
	}

	if (storedState && state && storedState !== state) {
		return renderResult("Security Verification Failed", "Invalid state parameter. Please try again.", false);
	}

	const db = getDb(env);
	const [settings] = await db
		.select({
			clientId: appSettings.cfOauthClientId,
			clientSecret: appSettings.cfOauthClientSecret,
		})
		.from(appSettings)
		.where(eq(appSettings.id, "default"))
		.limit(1);

	const envRecord = env as unknown as Record<string, string | undefined>;
	const envClientId = envRecord.CLOUDFLARE_CLIENT_ID?.trim() ||
		envRecord.CF_OAUTH_CLIENT_ID?.trim();
	const envClientSecret = envRecord.CLOUDFLARE_CLIENT_SECRET?.trim() ||
		envRecord.CF_OAUTH_CLIENT_SECRET?.trim();

	const clientId = envClientId || settings?.clientId;
	const clientSecret = envClientSecret || settings?.clientSecret;

	if (!clientId || !clientSecret) {
		return renderResult("Missing OAuth Configuration", "Cloudflare OAuth client credentials not found in settings.", false);
	}

	const origin = new URL(request.url).origin;
	const redirectUri = `${origin}/api/auth/cloudflare/callback`;

	try {
		const tokenRes = await fetch("https://dash.cloudflare.com/oauth2/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code,
				redirect_uri: redirectUri,
				client_id: clientId,
				client_secret: clientSecret,
			}),
		});

		const tokenData = (await tokenRes.json().catch(() => null)) as {
			access_token?: string;
			refresh_token?: string;
			error?: string;
			error_description?: string;
		} | null;

		if (!tokenRes.ok || !tokenData?.access_token) {
			return renderResult(
				"Token Exchange Failed",
				tokenData?.error_description || tokenData?.error || "Could not exchange code for access token.",
				false
			);
		}

		// Store tokens in app_settings
		await db
			.insert(appSettings)
			.values({
				id: "default",
				cfToken: tokenData.access_token,
				cfOauthRefreshToken: tokenData.refresh_token,
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: appSettings.id,
				set: {
					cfToken: tokenData.access_token,
					cfOauthRefreshToken: tokenData.refresh_token,
					updatedAt: new Date(),
				},
			});

		// Auto-import all domains from the authorized Cloudflare account
		let importedDomains: string[] = [];
		if (user) {
			const auth: CfAuth = { kind: "token", token: tokenData.access_token };
			const syncResult = await syncCloudflareDomains(env, user.id, auth);
			importedDomains = [...syncResult.added, ...syncResult.updated];
		}

		return renderResult(
			"Cloudflare Connected!",
			`Your Cloudflare account was connected successfully. ${importedDomains.length} domain(s) have been imported and configured.`,
			true,
			importedDomains
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unexpected error during Cloudflare authorization";
		return renderResult("Authorization Failed", message, false);
	}
}

