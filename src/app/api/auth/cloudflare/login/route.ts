import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";

export async function GET(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) {
		return new NextResponse("Unauthorized. Please log in to Orbitmails first.", { status: 401 });
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
	const clientId = envClientId || settings?.clientId?.trim();

	const origin = new URL(request.url).origin;
	const redirectUri = `${origin}/api/auth/cloudflare/callback`;

	// If OAuth is configured, initiate Cloudflare OAuth consent redirect directly
	if (clientId) {
		const state = crypto.randomUUID();
		const scope = encodeURIComponent("offline_access zone:read dns:edit email_routing:edit");
		const authUrl = `https://dash.cloudflare.com/oauth2/auth?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${state}`;

		const response = NextResponse.redirect(authUrl);
		response.cookies.set("cf_oauth_state", state, {
			httpOnly: true,
			secure: origin.startsWith("https"),
			sameSite: "lax",
			maxAge: 600,
			path: "/",
		});
		return response;
	}

	// If OAuth is not configured yet, present a streamlined connection assistant in the popup
	const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Connect Cloudflare - Orbitmails</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f9fafb; color: #111827; margin: 0; padding: 1.5rem; display: flex; justify-content: center; }
    .container { max-width: 520px; width: 100%; background: white; border-radius: 1rem; border: 1px solid #e5e7eb; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); padding: 1.75rem; }
    .header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; }
    .logo { width: 36px; height: 36px; border-radius: 8px; background: #fff3e6; display: flex; align-items: center; justify-content: center; color: #f38020; font-weight: bold; font-size: 1.25rem; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0; }
    p.subtitle { font-size: 0.875rem; color: #6b7280; margin: 0.25rem 0 1.25rem; line-height: 1.4; }
    .tabs { display: flex; border-bottom: 1px solid #e5e7eb; margin-bottom: 1.25rem; gap: 0.5rem; }
    .tab { padding: 0.5rem 1rem; font-size: 0.875rem; font-weight: 500; cursor: pointer; border-bottom: 2px solid transparent; color: #6b7280; }
    .tab.active { color: #f38020; border-bottom-color: #f38020; }
    .panel { display: none; }
    .panel.active { display: block; }
    .form-group { margin-bottom: 1rem; }
    label { display: block; font-size: 0.8125rem; font-weight: 500; margin-bottom: 0.375rem; color: #374151; }
    input { width: 100%; padding: 0.625rem 0.75rem; font-size: 0.875rem; border: 1px solid #d1d5db; border-radius: 0.5rem; outline: none; transition: border-color 0.15s; }
    input:focus { border-color: #f38020; box-shadow: 0 0 0 1px #f38020; }
    .help { font-size: 0.75rem; color: #6b7280; margin-top: 0.25rem; line-height: 1.4; }
    .help a { color: #f38020; text-decoration: none; font-weight: 500; }
    .help a:hover { text-decoration: underline; }
    .code-box { background: #f3f4f6; padding: 0.5rem 0.75rem; border-radius: 0.375rem; font-family: monospace; font-size: 0.75rem; word-break: break-all; margin: 0.25rem 0 0.5rem; display: flex; justify-content: space-between; align-items: center; }
    .copy-btn { font-size: 0.75rem; background: white; border: 1px solid #d1d5db; border-radius: 4px; padding: 2px 6px; cursor: pointer; }
    .btn { width: 100%; padding: 0.75rem; font-size: 0.875rem; font-weight: 600; border-radius: 0.5rem; border: none; cursor: pointer; transition: background-color 0.15s; }
    .btn-primary { background: #f38020; color: white; }
    .btn-primary:hover { background: #e06d10; }
    .btn-primary:disabled { background: #fed7aa; cursor: not-allowed; }
    .alert { padding: 0.75rem; border-radius: 0.5rem; font-size: 0.8125rem; margin-bottom: 1rem; display: none; }
    .alert-error { background: #fee2e2; color: #991b1b; }
    .alert-success { background: #dcfce7; color: #166534; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">⚡</div>
      <div>
        <h1>Connect Cloudflare</h1>
      </div>
    </div>
    <p class="subtitle">Connect your Cloudflare account to auto-import all your domains and manage DNS & Email Routing automatically.</p>

    <div class="tabs">
      <div class="tab active" onclick="switchTab('token')">Instant Connect (API Token)</div>
      <div class="tab" onclick="switchTab('oauth')">1-Click OAuth Setup</div>
    </div>

    <div id="errorAlert" class="alert alert-error"></div>
    <div id="successAlert" class="alert alert-success"></div>

    <!-- Panel 1: Instant API Token -->
    <div id="tokenPanel" class="panel active">
      <div class="form-group">
        <label for="cfToken">Cloudflare API Token</label>
        <input type="password" id="cfToken" placeholder="Paste your Cloudflare API token here" />
        <div class="help">
          Don't have a token? <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">Click here to create a Cloudflare Token</a>. Ensure permissions include <strong>Zone:Read</strong>, <strong>DNS:Edit</strong>, and <strong>Email Routing:Edit</strong>.
        </div>
      </div>
      <button class="btn btn-primary" id="tokenBtn" onclick="submitToken()">Authorize & Import Domains</button>
    </div>

    <!-- Panel 2: 1-Click OAuth Setup -->
    <div id="oauthPanel" class="panel">
      <div class="help" style="margin-bottom: 1rem;">
        1. Open <a href="https://dash.cloudflare.com/?to=/:account/oauth-apps" target="_blank" rel="noreferrer">Cloudflare OAuth Apps</a> in your dashboard.<br />
        2. Create an OAuth client with this Redirect URL:
        <div class="code-box">
          <span id="redirectUriText">${redirectUri}</span>
          <button class="copy-btn" onclick="copyRedirectUri()">Copy</button>
        </div>
        3. Paste the generated Client ID & Secret below:
      </div>

      <div class="form-group">
        <label for="oauthClientId">Client ID</label>
        <input type="text" id="oauthClientId" placeholder="e.g. 54d11594-..." />
      </div>

      <div class="form-group">
        <label for="oauthClientSecret">Client Secret</label>
        <input type="password" id="oauthClientSecret" placeholder="Paste Client Secret" />
      </div>

      <button class="btn btn-primary" id="oauthBtn" onclick="submitOauth()">Save & Open Cloudflare Authorize</button>
    </div>
  </div>

  <script>
    function switchTab(tab) {
      document.querySelectorAll('.tab').forEach((el, idx) => el.classList.toggle('active', (tab === 'token' ? idx === 0 : idx === 1)));
      document.getElementById('tokenPanel').classList.toggle('active', tab === 'token');
      document.getElementById('oauthPanel').classList.toggle('active', tab === 'oauth');
      hideAlerts();
    }

    function hideAlerts() {
      document.getElementById('errorAlert').style.display = 'none';
      document.getElementById('successAlert').style.display = 'none';
    }

    function showError(msg) {
      const el = document.getElementById('errorAlert');
      el.textContent = msg;
      el.style.display = 'block';
      document.getElementById('successAlert').style.display = 'none';
    }

    function showSuccess(msg) {
      const el = document.getElementById('successAlert');
      el.textContent = msg;
      el.style.display = 'block';
      document.getElementById('errorAlert').style.display = 'none';
    }

    function copyRedirectUri() {
      const text = document.getElementById('redirectUriText').textContent;
      navigator.clipboard.writeText(text);
      alert('Copied redirect URL to clipboard!');
    }

    async function submitToken() {
      const token = document.getElementById('cfToken').value.trim();
      if (!token) return showError('Please paste your Cloudflare API token');

      const btn = document.getElementById('tokenBtn');
      btn.disabled = true;
      btn.textContent = 'Verifying and importing domains...';
      hideAlerts();

      try {
        const res = await fetch('/api/auth/cloudflare/token-connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'Failed to connect');

        const count = (data.result?.added?.length || 0) + (data.result?.updated?.length || 0);
        showSuccess('Cloudflare connected! Imported ' + count + ' domain(s). Closing...');

        if (window.opener) {
          window.opener.postMessage({
            type: 'CLOUDFLARE_AUTH_SUCCESS',
            domains: [...(data.result?.added || []), ...(data.result?.updated || [])]
          }, '*');
        }
        setTimeout(() => window.close(), 1800);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Authorize & Import Domains';
        showError(err.message);
      }
    }

    async function submitOauth() {
      const clientId = document.getElementById('oauthClientId').value.trim();
      const clientSecret = document.getElementById('oauthClientSecret').value.trim();
      if (!clientId || !clientSecret) return showError('Please fill in both Client ID and Client Secret');

      const btn = document.getElementById('oauthBtn');
      btn.disabled = true;
      btn.textContent = 'Redirecting to Cloudflare...';
      hideAlerts();

      try {
        const res = await fetch('/api/auth/cloudflare/save-oauth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, clientSecret })
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'Failed to save configuration');

        // Redirect to Cloudflare OAuth authorization consent screen
        window.location.href = data.authUrl;
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Save & Open Cloudflare Authorize';
        showError(err.message);
      }
    }
  </script>
</body>
</html>`;

	return new NextResponse(html, {
		headers: { "Content-Type": "text/html; charset=utf-8" },
	});
}

