"use client";

import React, { useState } from "react";
import {
	Bot,
	Check,
	Cloud,
	Copy,
	FileCode,
	Globe2,
	KeyRound,
	Plus,
	Server,
	ShieldAlert,
	Sparkles,
	Trash2,
	X,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

export interface KeyItem {
	id: string;
	projectId: string;
	name: string;
	prefix: string;
	displayPrefix: string;
	environment: "live" | "test";
	status: "active" | "revoked";
	createdAt: string;
	lastUsedAt: string | null;
}

interface RoutingKeyModalProps {
	isOpen: boolean;
	onClose: () => void;
	projectId: string;
	projectName: string;
	projectSlug: string;
	keys: KeyItem[];
	onGenerateKey: (projectId: string, name?: string) => Promise<{ fullKey: string; routingKey: KeyItem }>;
	onRevokeKey: (keyId: string) => Promise<void>;
}

export function RoutingKeyModal({
	isOpen,
	onClose,
	projectId,
	projectName,
	projectSlug,
	keys,
	onGenerateKey,
	onRevokeKey,
}: RoutingKeyModalProps) {
	const [keyName, setKeyName] = useState("");
	const [isGenerating, setIsGenerating] = useState(false);
	const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
	const [viewingGuideKey, setViewingGuideKey] = useState<string | null>(null);
	const [activeTab, setActiveTab] = useState<"native_code" | "deploy" | "env_file" | "ai_prompt" | "resend_code">("native_code");
	const [codeLang, setCodeLang] = useState<"typescript" | "python" | "curl">("typescript");
	const [deployTarget, setDeployTarget] = useState<"vercel" | "cloudflare" | "docker" | "github">("vercel");
	
	const [copiedKey, setCopiedKey] = useState(false);
	const [copiedCode, setCopiedCode] = useState(false);
	const [copiedDeploy, setCopiedDeploy] = useState(false);
	const [copiedPrompt, setCopiedPrompt] = useState(false);
	const [copiedEnv, setCopiedEnv] = useState(false);
	const [copiedResend, setCopiedResend] = useState(false);

	const projectKeys = keys.filter((k) => k.projectId === projectId);

	const hostUrl = typeof window !== "undefined" && window.location.host
		? `https://${window.location.host}`
		: "https://mail.orbitsaas.cloud";

	const copyToClipboard = async (text: string, type: "key" | "prompt" | "code" | "deploy" | "env" | "resend") => {
		try {
			await navigator.clipboard.writeText(text);
			if (type === "key") {
				setCopiedKey(true);
				setTimeout(() => setCopiedKey(false), 2000);
			} else if (type === "prompt") {
				setCopiedPrompt(true);
				setTimeout(() => setCopiedPrompt(false), 2000);
			} else if (type === "code") {
				setCopiedCode(true);
				setTimeout(() => setCopiedCode(false), 2000);
			} else if (type === "deploy") {
				setCopiedDeploy(true);
				setTimeout(() => setCopiedDeploy(false), 2000);
			} else if (type === "env") {
				setCopiedEnv(true);
				setTimeout(() => setCopiedEnv(false), 2000);
			} else if (type === "resend") {
				setCopiedResend(true);
				setTimeout(() => setCopiedResend(false), 2000);
			}
		} catch (err) {
			console.error("Failed to copy:", err);
		}
	};

	const handleCreate = async () => {
		if (isGenerating) return;
		setIsGenerating(true);
		try {
			const result = await onGenerateKey(projectId, keyName.trim() || undefined);
			setNewlyCreatedKey(result.fullKey);
			setViewingGuideKey(null);
			setKeyName("");
			setActiveTab("native_code");
		} catch (err) {
			console.error("Failed to generate routing key:", err);
		} finally {
			setIsGenerating(false);
		}
	};

	const activeKeyForGuide = newlyCreatedKey || viewingGuideKey || `om_live_${projectSlug}_...`;

	const nativeTsSnippet = (key: string) => `// OrbitMail Native Client (Next.js App Router / Node.js / Edge)
// Works in Server Actions, Route Handlers, and Background Workers
export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string | string[];
  subject: string;
  html: string;
}) {
  const res = await fetch(process.env.ORBITMAIL_URL || "${hostUrl}/api/v1/send", {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${process.env.ORBITMAIL_API_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.ORBITMAIL_FROM || "notifications@${projectSlug}.com",
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(\`OrbitMail delivery failed (\${res.status}): \${errorText}\`);
  }

  return await res.json(); // { id: "msg_...", status: "accepted" }
}`;

	const pythonSnippet = (key: string) => `import os
import requests

# OrbitMail Native Python Client (FastAPI / Django / Flask / Background scripts)
def send_email(to, subject, html):
    url = os.getenv("ORBITMAIL_URL", "${hostUrl}/api/v1/send")
    api_key = os.environ["ORBITMAIL_API_KEY"]
    from_addr = os.getenv("ORBITMAIL_FROM", "notifications@${projectSlug}.com")

    response = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "from": from_addr,
            "to": [to] if isinstance(to, str) else to,
            "subject": subject,
            "html": html,
        },
    )
    response.raise_for_status()
    return response.json()`;

	const curlSnippet = (key: string) => `curl -X POST "${hostUrl}/api/v1/send" \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "notifications@${projectSlug}.com",
    "to": ["user@example.com"],
    "subject": "Testing OrbitMail API",
    "html": "<p>Hello from OrbitMail!</p>"
  }'`;

	const envSnippet = (key: string) => `ORBITMAIL_API_KEY="${key}"
ORBITMAIL_URL="${hostUrl}/api/v1/send"
ORBITMAIL_FROM="notifications@${projectSlug}.com"`;

	const vercelSnippet = (key: string) => `# Option 1: Vercel CLI (Run in your terminal)
vercel env add ORBITMAIL_API_KEY production
# When prompted, paste: ${key}

vercel env add ORBITMAIL_URL production
# When prompted, paste: ${hostUrl}/api/v1/send

vercel env add ORBITMAIL_FROM production
# When prompted, paste: notifications@${projectSlug}.com

# Option 2: Vercel Web Dashboard
# Go to: Project -> Settings -> Environment Variables
# Add: ORBITMAIL_API_KEY  = ${key}
# Add: ORBITMAIL_URL      = ${hostUrl}/api/v1/send
# Add: ORBITMAIL_FROM     = notifications@${projectSlug}.com

# Compatible with Vercel Serverless Functions, Server Components, Server Actions & Edge Middleware!`;

	const cfSnippet = (key: string) => `# Option 1: Wrangler CLI (Cloudflare Workers & Pages)
npx wrangler secret put ORBITMAIL_API_KEY
# When prompted, paste: ${key}

npx wrangler secret put ORBITMAIL_URL
# When prompted, paste: ${hostUrl}/api/v1/send

# Option 2: Cloudflare Dashboard
# Workers & Pages -> Your Project -> Settings -> Variables and Secrets
# Add Secret: ORBITMAIL_API_KEY = ${key}
# Add Variable: ORBITMAIL_URL = ${hostUrl}/api/v1/send
# Add Variable: ORBITMAIL_FROM = notifications@${projectSlug}.com

# In Worker code:
# await fetch(env.ORBITMAIL_URL, {
#   headers: { "Authorization": \`Bearer \${env.ORBITMAIL_API_KEY}\` },
#   ...
# });`;

	const dockerSnippet = (key: string) => `# Option 1: docker-compose.yml (VPS / AWS EC2 / DigitalOcean / Railway / Render / Fly.io)
services:
  app:
    build: .
    environment:
      - ORBITMAIL_API_KEY=${key}
      - ORBITMAIL_URL=${hostUrl}/api/v1/send
      - ORBITMAIL_FROM=notifications@${projectSlug}.com

# Option 2: Linux VPS / systemd / PM2 (/etc/environment or ecosystem.config.js)
export ORBITMAIL_API_KEY="${key}"
export ORBITMAIL_URL="${hostUrl}/api/v1/send"
export ORBITMAIL_FROM="notifications@${projectSlug}.com"`;

	const githubSnippet = (key: string) => `# In your repo: Settings -> Secrets and variables -> Actions
# Secret: ORBITMAIL_API_KEY = ${key}
# Secret: ORBITMAIL_URL = ${hostUrl}/api/v1/send

# .github/workflows/deploy.yml
name: Deploy Application
on: [push]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build & Deploy
        env:
          ORBITMAIL_API_KEY: \${{ secrets.ORBITMAIL_API_KEY }}
          ORBITMAIL_URL: \${{ secrets.ORBITMAIL_URL }}
          ORBITMAIL_FROM: "notifications@${projectSlug}.com"
        run: npm run deploy`;

	const resendSnippet = (key: string) => `import { Resend } from "resend";

// Optional: OrbitMail is 100% wire-compatible if your app already has the Resend SDK:
const resend = new Resend(process.env.ORBITMAIL_API_KEY, {
  baseUrl: "${hostUrl}/v1",
});

await resend.emails.send({
  from: "notifications@${projectSlug}.com",
  to: "user@example.com",
  subject: "Welcome to ${projectName}!",
  html: "<p>Your email delivered through OrbitMail.</p>",
});`;

	const aiAgentPrompt = (key: string) => `### TASK: Connect Email Delivery to OrbitMail
We are using OrbitMail (hosted at ${hostUrl}) as our centralized email infrastructure.

Please configure email delivery in this codebase with the following instructions:

1. Environment Variables:
   Add these to \`.env\` and your deployment platform (Vercel, Cloudflare, Docker, or VPS):
   ORBITMAIL_API_KEY="${key}"
   ORBITMAIL_URL="${hostUrl}/api/v1/send"
   ORBITMAIL_FROM="notifications@${projectSlug}.com"

2. Integration Strategy (Zero external SDK required - Native Fetch):
   \`\`\`typescript
   export async function sendEmail({
     to,
     subject,
     html,
   }: {
     to: string | string[];
     subject: string;
     html: string;
   }) {
     const res = await fetch(process.env.ORBITMAIL_URL || "${hostUrl}/api/v1/send", {
       method: "POST",
       headers: {
         "Authorization": \`Bearer \${process.env.ORBITMAIL_API_KEY}\`,
         "Content-Type": "application/json",
       },
       body: JSON.stringify({
         from: process.env.ORBITMAIL_FROM || "notifications@${projectSlug}.com",
         to: Array.isArray(to) ? to : [to],
         subject,
         html,
       }),
     });

     if (!res.ok) {
       const err = await res.text();
       throw new Error(\`OrbitMail send failed (\${res.status}): \${err}\`);
     }

     return await res.json();
   }
   \`\`\`

3. Verification:
   Send a test email to verify delivery. Expect HTTP 200 with message \`id\`.`;

	const getDeploySnippet = () => {
		switch (deployTarget) {
			case "vercel":
				return vercelSnippet(activeKeyForGuide);
			case "cloudflare":
				return cfSnippet(activeKeyForGuide);
			case "docker":
				return dockerSnippet(activeKeyForGuide);
			case "github":
				return githubSnippet(activeKeyForGuide);
		}
	};

	const getCodeSnippet = () => {
		switch (codeLang) {
			case "typescript":
				return nativeTsSnippet(activeKeyForGuide);
			case "python":
				return pythonSnippet(activeKeyForGuide);
			case "curl":
				return curlSnippet(activeKeyForGuide);
		}
	};

	return (
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				if (!open) {
					setNewlyCreatedKey(null);
					setViewingGuideKey(null);
					onClose();
				}
			}}
		>
			<DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
				<DialogHeader>
					<div className="flex items-center gap-2">
						<KeyRound className="h-5 w-5 text-blue-600" />
						<DialogTitle>Project Routing Keys: {projectName}</DialogTitle>
					</div>
					<DialogDescription>
						Manage unified routing keys for {projectName} ({projectSlug}). Any service sending with these keys will be validated and balanced against {projectName}&apos;s quota slices.
					</DialogDescription>
				</DialogHeader>

				{/* Newly Created Key Alert (Reveal Once!) */}
				{newlyCreatedKey && (
					<div className="space-y-4 rounded-2xl border border-amber-300 bg-amber-50/80 p-4.5 dark:border-amber-800 dark:bg-amber-950/40">
						<div className="flex items-start gap-2.5">
							<ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
							<div>
								<h4 className="font-semibold text-amber-900 dark:text-amber-200">
									Save Your Secret Routing Key Now
								</h4>
								<p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">
									This secret key will <strong>never be shown again</strong>. Store it securely in your project&apos;s environment variables (<code className="font-mono">.env</code>), Vercel, Cloudflare, or server environment.
								</p>
							</div>
						</div>

						{/* Key Display & One-click Copy */}
						<div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-white p-2.5 dark:border-amber-800 dark:bg-neutral-900">
							<code className="flex-1 select-all break-all font-mono text-xs font-semibold text-neutral-900 dark:text-neutral-100">
								{newlyCreatedKey}
							</code>
							<Button
								size="sm"
								onClick={() => copyToClipboard(newlyCreatedKey, "key")}
								className="shrink-0 gap-1.5 text-xs font-semibold"
							>
								{copiedKey ? (
									<>
										<Check className="h-3.5 w-3.5 text-emerald-400" />
										Copied!
									</>
								) : (
									<>
										<Copy className="h-3.5 w-3.5" />
										Copy Key
									</>
								)}
							</Button>
						</div>
					</div>
				)}

				{/* Integration & AI Agent Guiding Popup / Tabs */}
				{(newlyCreatedKey || viewingGuideKey) && (
					<div className="space-y-3 rounded-2xl border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900 dark:bg-blue-950/20">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" />
								<h4 className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
									Developer Integration & Deployment
								</h4>
							</div>
							{viewingGuideKey && !newlyCreatedKey && (
								<button
									type="button"
									onClick={() => setViewingGuideKey(null)}
									className="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
								>
									<X className="h-3.5 w-3.5" />
								</button>
							)}
						</div>

						{/* Top Level Tabs */}
						<div className="flex flex-wrap items-center gap-1 rounded-xl bg-neutral-200/60 p-1 text-xs dark:bg-neutral-800">
							<button
								type="button"
								onClick={() => setActiveTab("native_code")}
								className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors ${
									activeTab === "native_code"
										? "bg-white text-blue-700 shadow-2xs dark:bg-neutral-900 dark:text-blue-400 font-semibold"
										: "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
								}`}
							>
								<FileCode className="h-3.5 w-3.5" />
								<span>OrbitMail Code</span>
							</button>

							<button
								type="button"
								onClick={() => setActiveTab("deploy")}
								className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors ${
									activeTab === "deploy"
										? "bg-white text-blue-700 shadow-2xs dark:bg-neutral-900 dark:text-blue-400 font-semibold"
										: "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
								}`}
							>
								<Globe2 className="h-3.5 w-3.5" />
								<span>Deploy Anywhere (Vercel / CF / VPS)</span>
							</button>

							<button
								type="button"
								onClick={() => setActiveTab("env_file")}
								className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors ${
									activeTab === "env_file"
										? "bg-white text-blue-700 shadow-2xs dark:bg-neutral-900 dark:text-blue-400 font-semibold"
										: "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
								}`}
							>
								<span>.env File</span>
							</button>

							<button
								type="button"
								onClick={() => setActiveTab("ai_prompt")}
								className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors ${
									activeTab === "ai_prompt"
										? "bg-white text-blue-700 shadow-2xs dark:bg-neutral-900 dark:text-blue-400 font-semibold"
										: "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
								}`}
							>
								<Bot className="h-3.5 w-3.5" />
								<span>AI Agent Prompt</span>
							</button>

							<button
								type="button"
								onClick={() => setActiveTab("resend_code")}
								className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors ${
									activeTab === "resend_code"
										? "bg-white text-blue-700 shadow-2xs dark:bg-neutral-900 dark:text-blue-400 font-semibold"
										: "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
								}`}
							>
								<span>Resend SDK (Drop-in)</span>
							</button>
						</div>

						{/* Tab 1: OrbitMail Native Code */}
						{activeTab === "native_code" && (
							<div className="space-y-3">
								<div className="flex items-center justify-between text-xs">
									<div className="flex items-center gap-2">
										<span className="text-neutral-500">Language:</span>
										<div className="inline-flex rounded-lg bg-neutral-200/80 p-0.5 dark:bg-neutral-800">
											<button
												type="button"
												onClick={() => setCodeLang("typescript")}
												className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
													codeLang === "typescript" ? "bg-white shadow-2xs text-blue-700 dark:bg-neutral-900 dark:text-blue-400 font-semibold" : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400"
												}`}
											>
												TypeScript / Next.js
											</button>
											<button
												type="button"
												onClick={() => setCodeLang("python")}
												className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
													codeLang === "python" ? "bg-white shadow-2xs text-blue-700 dark:bg-neutral-900 dark:text-blue-400 font-semibold" : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400"
												}`}
											>
												Python
											</button>
											<button
												type="button"
												onClick={() => setCodeLang("curl")}
												className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
													codeLang === "curl" ? "bg-white shadow-2xs text-blue-700 dark:bg-neutral-900 dark:text-blue-400 font-semibold" : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400"
												}`}
											>
												cURL
											</button>
										</div>
									</div>
									<Button
										size="sm"
										variant="outline"
										onClick={() => copyToClipboard(getCodeSnippet(), "code")}
										className="h-7 gap-1.5 border-neutral-300 bg-white text-xs font-medium text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
									>
										{copiedCode ? (
											<>
												<Check className="h-3 w-3 text-emerald-500" />
												<span>Copied Code!</span>
											</>
										) : (
											<>
												<Copy className="h-3 w-3" />
												<span>Copy Snippet</span>
											</>
										)}
									</Button>
								</div>
								<pre className="max-h-56 overflow-y-auto rounded-xl bg-neutral-950 p-3 font-mono text-[11px] leading-relaxed text-neutral-200">
									<code>{getCodeSnippet()}</code>
								</pre>
							</div>
						)}

						{/* Tab 2: Deploy Anywhere (Vercel, Cloudflare, Docker/VPS, GitHub) */}
						{activeTab === "deploy" && (
							<div className="space-y-3">
								<div className="flex items-center justify-between text-xs">
									<div className="flex items-center gap-2">
										<span className="text-neutral-500">Platform:</span>
										<div className="inline-flex rounded-lg bg-neutral-200/80 p-0.5 dark:bg-neutral-800">
											<button
												type="button"
												onClick={() => setDeployTarget("vercel")}
												className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
													deployTarget === "vercel" ? "bg-white shadow-2xs text-blue-700 dark:bg-neutral-900 dark:text-blue-400 font-semibold" : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400"
												}`}
											>
												▲ Vercel
											</button>
											<button
												type="button"
												onClick={() => setDeployTarget("cloudflare")}
												className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
													deployTarget === "cloudflare" ? "bg-white shadow-2xs text-blue-700 dark:bg-neutral-900 dark:text-blue-400 font-semibold" : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400"
												}`}
											>
												☁ Cloudflare
											</button>
											<button
												type="button"
												onClick={() => setDeployTarget("docker")}
												className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
													deployTarget === "docker" ? "bg-white shadow-2xs text-blue-700 dark:bg-neutral-900 dark:text-blue-400 font-semibold" : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400"
												}`}
											>
												🐳 Docker / VPS
											</button>
											<button
												type="button"
												onClick={() => setDeployTarget("github")}
												className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
													deployTarget === "github" ? "bg-white shadow-2xs text-blue-700 dark:bg-neutral-900 dark:text-blue-400 font-semibold" : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400"
												}`}
											>
												🐙 CI/CD Actions
											</button>
										</div>
									</div>
									<Button
										size="sm"
										variant="outline"
										onClick={() => copyToClipboard(getDeploySnippet(), "deploy")}
										className="h-7 gap-1.5 border-neutral-300 bg-white text-xs font-medium text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
									>
										{copiedDeploy ? (
											<>
												<Check className="h-3 w-3 text-emerald-500" />
												<span>Copied Config!</span>
											</>
										) : (
											<>
												<Copy className="h-3 w-3" />
												<span>Copy Config</span>
											</>
										)}
									</Button>
								</div>
								<pre className="max-h-56 overflow-y-auto rounded-xl bg-neutral-950 p-3 font-mono text-[11px] leading-relaxed text-neutral-200">
									<code>{getDeploySnippet()}</code>
								</pre>
							</div>
						)}

						{/* Tab 3: .env Snippet */}
						{activeTab === "env_file" && (
							<div className="space-y-2">
								<div className="flex items-center justify-between text-xs">
									<p className="text-neutral-600 dark:text-neutral-300">
										Add to your downstream project&apos;s <code className="font-mono">.env</code>:
									</p>
									<Button
										size="sm"
										variant="outline"
										onClick={() => copyToClipboard(envSnippet(activeKeyForGuide), "env")}
										className="h-7 gap-1.5 border-neutral-300 bg-white text-xs font-medium text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
									>
										{copiedEnv ? (
											<>
												<Check className="h-3 w-3 text-emerald-500" />
												<span>Copied .env!</span>
											</>
										) : (
											<>
												<Copy className="h-3 w-3" />
												<span>Copy .env</span>
											</>
										)}
									</Button>
								</div>
								<pre className="rounded-xl bg-neutral-950 p-3 font-mono text-[11px] leading-relaxed text-neutral-200">
									<code>{envSnippet(activeKeyForGuide)}</code>
								</pre>
							</div>
						)}

						{/* Tab 4: AI Agent Prompt */}
						{activeTab === "ai_prompt" && (
							<div className="space-y-2">
								<div className="flex items-center justify-between text-xs">
									<p className="text-neutral-600 dark:text-neutral-300">
										Paste this prompt directly into <strong>Cursor, Claude, Antigravity, or ChatGPT</strong> to have it connect this project:
									</p>
									<Button
										size="sm"
										variant="outline"
										onClick={() => copyToClipboard(aiAgentPrompt(activeKeyForGuide), "prompt")}
										className="h-7 gap-1.5 border-blue-300 bg-white text-xs font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:bg-neutral-900 dark:text-blue-300"
									>
										{copiedPrompt ? (
											<>
												<Check className="h-3 w-3 text-emerald-500" />
												<span>Copied Prompt!</span>
											</>
										) : (
											<>
												<Copy className="h-3 w-3" />
												<span>Copy AI Prompt</span>
											</>
										)}
									</Button>
								</div>
								<pre className="max-h-56 overflow-y-auto rounded-xl bg-neutral-950 p-3 font-mono text-[11px] leading-relaxed text-neutral-200">
									<code>{aiAgentPrompt(activeKeyForGuide)}</code>
								</pre>
							</div>
						)}

						{/* Tab 5: Resend SDK (Drop-in) */}
						{activeTab === "resend_code" && (
							<div className="space-y-2">
								<div className="flex items-center justify-between text-xs">
									<p className="text-neutral-600 dark:text-neutral-300">
										Drop-in replacement for existing projects using the <code className="font-mono">resend</code> npm package:
									</p>
									<Button
										size="sm"
										variant="outline"
										onClick={() => copyToClipboard(resendSnippet(activeKeyForGuide), "resend")}
										className="h-7 gap-1.5 border-neutral-300 bg-white text-xs font-medium text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
									>
										{copiedResend ? (
											<>
												<Check className="h-3 w-3 text-emerald-500" />
												<span>Copied Code!</span>
											</>
										) : (
											<>
												<Copy className="h-3 w-3" />
												<span>Copy Code</span>
											</>
										)}
									</Button>
								</div>
								<pre className="max-h-56 overflow-y-auto rounded-xl bg-neutral-950 p-3 font-mono text-[11px] leading-relaxed text-neutral-200">
									<code>{resendSnippet(activeKeyForGuide)}</code>
								</pre>
							</div>
						)}

						{newlyCreatedKey && (
							<Button
								variant="outline"
								size="sm"
								onClick={() => setNewlyCreatedKey(null)}
								className="mt-2 w-full text-xs font-medium"
							>
								Done, I have saved my key securely
							</Button>
						)}
					</div>
				)}

				{/* Create New Key Section */}
				{!newlyCreatedKey && (
					<div className="flex items-end gap-2 border-b border-neutral-100 pb-4 dark:border-neutral-800">
						<div className="flex-1 space-y-1">
							<Label htmlFor="key-name-input" className="text-xs">
								Generate New Routing Key
							</Label>
							<Input
								id="key-name-input"
								placeholder="e.g. Production Web App"
								value={keyName}
								onChange={(e) => setKeyName(e.target.value)}
								className="h-8 text-xs"
							/>
						</div>
						<Button
							size="sm"
							onClick={handleCreate}
							disabled={isGenerating}
							className="h-8 gap-1.5 text-xs"
						>
							<Plus className="h-3.5 w-3.5" />
							{isGenerating ? "Generating..." : "Generate Key"}
						</Button>
					</div>
				)}

				{/* Existing Keys List */}
				<div className="space-y-2 pt-2">
					<div className="flex items-center justify-between">
						<h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
							Active & Historical Keys ({projectKeys.length})
						</h4>
						{!newlyCreatedKey && !viewingGuideKey && (
							<button
								type="button"
								onClick={() => setViewingGuideKey(`om_live_${projectSlug}_...`)}
								className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400"
							>
								<Bot className="h-3 w-3" />
								<span>View AI Agent Prompt</span>
							</button>
						)}
					</div>

					{projectKeys.length === 0 ? (
						<p className="rounded-xl border border-dashed border-neutral-200 p-6 text-center text-xs text-neutral-400 dark:border-neutral-800">
							No routing keys generated yet for this project. Click &ldquo;Generate Key&rdquo; to create one.
						</p>
					) : (
						<div className="space-y-2">
							{projectKeys.map((k) => (
								<div
									key={k.id}
									className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200/70 bg-neutral-50/50 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-900/40"
								>
									<div>
										<div className="flex items-center gap-2">
											<span className="font-semibold text-neutral-900 dark:text-neutral-100">
												{k.name}
											</span>
											<Badge
												variant={k.status === "active" ? "default" : "secondary"}
												className="text-[10px]"
											>
												{k.status}
											</Badge>
										</div>
										<div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-neutral-500">
											<span>{k.displayPrefix}</span>
											<span>•</span>
											<span>Created {new Date(k.createdAt).toLocaleDateString()}</span>
											{k.lastUsedAt && (
												<>
													<span>•</span>
													<span>Last used {new Date(k.lastUsedAt).toLocaleDateString()}</span>
												</>
											)}
										</div>
									</div>

									<div className="flex items-center gap-2">
										<Button
											variant="ghost"
											size="sm"
											onClick={() => {
												setViewingGuideKey(`${k.prefix}...`);
												setActiveTab("native_code");
											}}
											title="View Integration Code & Deployment Config"
											className="h-7 gap-1 text-xs text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:text-blue-400 dark:hover:bg-blue-950/40"
										>
											<FileCode className="h-3.5 w-3.5" />
											<span>Integration Code</span>
										</Button>

										{k.status === "active" && (
											<Button
												variant="outline"
												size="sm"
												onClick={() => onRevokeKey(k.id)}
												className="h-7 text-xs text-rose-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/40"
											>
												<Trash2 className="mr-1 h-3 w-3" />
												Revoke
											</Button>
										)}
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
