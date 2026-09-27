"use client";

import React, { useState } from "react";
import {
	Bot,
	Check,
	Copy,
	FileCode,
	KeyRound,
	Plus,
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
	const [activeTab, setActiveTab] = useState<"ai_prompt" | "resend_code" | "env_file" | "cf_secrets" | "curl">("ai_prompt");
	
	const [copiedKey, setCopiedKey] = useState(false);
	const [copiedSnippet, setCopiedSnippet] = useState(false);
	const [copiedPrompt, setCopiedPrompt] = useState(false);
	const [copiedEnv, setCopiedEnv] = useState(false);
	const [copiedGithub, setCopiedGithub] = useState(false);
	const [copiedCurl, setCopiedCurl] = useState(false);

	const projectKeys = keys.filter((k) => k.projectId === projectId);

	const hostUrl = typeof window !== "undefined" && window.location.host
		? `https://${window.location.host}`
		: "https://mail.orbitsaas.cloud";

	const copyToClipboard = async (text: string, type: "key" | "prompt" | "snippet" | "env" | "github" | "curl") => {
		try {
			await navigator.clipboard.writeText(text);
			if (type === "key") {
				setCopiedKey(true);
				setTimeout(() => setCopiedKey(false), 2000);
			} else if (type === "prompt") {
				setCopiedPrompt(true);
				setTimeout(() => setCopiedPrompt(false), 2000);
			} else if (type === "snippet") {
				setCopiedSnippet(true);
				setTimeout(() => setCopiedSnippet(false), 2000);
			} else if (type === "env") {
				setCopiedEnv(true);
				setTimeout(() => setCopiedEnv(false), 2000);
			} else if (type === "github") {
				setCopiedGithub(true);
				setTimeout(() => setCopiedGithub(false), 2000);
			} else if (type === "curl") {
				setCopiedCurl(true);
				setTimeout(() => setCopiedCurl(false), 2000);
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
			setActiveTab("ai_prompt");
		} catch (err) {
			console.error("Failed to generate routing key:", err);
		} finally {
			setIsGenerating(false);
		}
	};

	const activeKeyForGuide = newlyCreatedKey || viewingGuideKey || `orb_live_${projectSlug}_...`;

	const aiAgentPrompt = (key: string) => `### TASK: Connect Email Delivery to OrbitMails (MailHub)
We are using OrbitMails (hosted at ${hostUrl}) as our centralized email routing and failover infrastructure.

Please configure email delivery in this codebase with the following instructions:

1. Environment Variables:
   Add these to \`.env\` and \`.env.local\` (or your secrets manager):
   MAILHUB_URL="${hostUrl}/v1"
   MAILHUB_API_KEY="${key}"
   MAIL_FROM="notifications@${projectSlug}.com"

2. Integration Strategy (Choose whichever fits our architecture):

   Option A ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Drop-in Resend SDK (Recommended if @resend/node or resend is installed):
   \`\`\`typescript
   import { Resend } from "resend";

   export const resend = new Resend(process.env.MAILHUB_API_KEY, {
     baseUrl: process.env.MAILHUB_URL || "${hostUrl}/v1",
   });

   // Send email helper
   export async function sendEmail({
     to,
     subject,
     html,
   }: {
     to: string | string[];
     subject: string;
     html: string;
   }) {
     return await resend.emails.send({
       from: process.env.MAIL_FROM || "notifications@${projectSlug}.com",
       to,
       subject,
       html,
     });
   }
   \`\`\`

   Option B ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Zero-Dependency Native Fetch:
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
     const res = await fetch(\`\${process.env.MAILHUB_URL || "${hostUrl}/v1"}/send\`, {
       method: "POST",
       headers: {
         "Content-Type": "application/json",
         Authorization: \`Bearer \${process.env.MAILHUB_API_KEY}\`,
       },
       body: JSON.stringify({
         from: process.env.MAIL_FROM || "notifications@${projectSlug}.com",
         to: Array.isArray(to) ? to : [to],
         subject,
         html,
       }),
     });

     if (!res.ok) {
       const err = await res.text();
       throw new Error(\`OrbitMails send failed (\${res.status}): \${err}\`);
     }

     return await res.json(); // { id: "msg_...", status: "accepted" }
   }
   \`\`\`

3. Verification:
   Create a small verification script or test to send one email to verify delivery. Expect HTTP 200/202 with a valid message \`id\`.`;

	const envSnippet = (key: string) => `MAILHUB_URL="${hostUrl}/v1"
MAILHUB_API_KEY="${key}"
MAIL_FROM="notifications@${projectSlug}.com"`;

	const resendSnippet = (key: string) => `import { Resend } from "resend";

// Drop-in compatible with Resend SDK!
const resend = new Resend(process.env.MAILHUB_API_KEY, {
  baseUrl: process.env.MAILHUB_URL || "${hostUrl}/v1",
});

await resend.emails.send({
  from: process.env.MAIL_FROM || "notifications@${projectSlug}.com",
  to: "user@example.com",
  subject: "Welcome to ${projectName}!",
  html: "<p>Your email delivered through OrbitMails.</p>",
});`;

	const curlSnippet = (key: string) => `curl -X POST "${hostUrl}/v1/send" \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "notifications@${projectSlug}.com",
    "to": ["user@example.com"],
    "subject": "Testing OrbitMails Routing",
    "html": "<p>Hello from OrbitMails MailHub!</p>"
  }'`;

	const githubSnippet = (key: string) => `# ============================================================
# OPTION A: Cloudflare Secrets (Recommended for CF Workers / Pages)
# ============================================================
# Run these once in your terminal (no GitHub needed):
#   npx wrangler secret put ORBITMAIL_ROUTING_KEY
#   # When prompted, paste: ${key}
#   npx wrangler secret put ORBITMAIL_BASE_URL
#   # When prompted, paste: ${hostUrl}/v1
#
# Or via Cloudflare Dashboard:
#   Workers & Pages â†’ Your Project â†’ Settings â†’ Variables & Secrets
#   Add: ORBITMAIL_ROUTING_KEY = ${key}
#   Add: ORBITMAIL_BASE_URL    = ${hostUrl}/v1

# ============================================================
# OPTION B: GitHub Repository Secrets (for CI/CD pipelines)
# ============================================================
# In your repo: Settings â†’ Secrets and variables â†’ Actions
# Add secret: ORBITMAIL_ROUTING_KEY = ${key}
# Add secret: ORBITMAIL_BASE_URL    = ${hostUrl}/v1

# GitHub Actions workflow (.github/workflows/deploy.yml):
name: Deploy Application
on: [push]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build & Deploy
        env:
          ORBITMAIL_ROUTING_KEY: \${{ secrets.ORBITMAIL_ROUTING_KEY }}
          ORBITMAIL_BASE_URL: \${{ secrets.ORBITMAIL_BASE_URL }}
          MAIL_FROM: "notifications@${projectSlug}.com"
        run: npm run deploy`;

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
									This secret key will <strong>never be shown again</strong>. Store it securely in your project&apos;s environment variables (<code className="font-mono">.env</code>) or use the guided AI prompt below to have your AI agent configure it.
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
									Integration Guide & AI Agent Prompt
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

						{/* Tabs */}
						<div className="flex items-center gap-1 rounded-xl bg-neutral-200/60 p-1 text-xs dark:bg-neutral-800">
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
								<FileCode className="h-3.5 w-3.5" />
								<span>Resend SDK</span>
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
								onClick={() => setActiveTab("cf_secrets")}
								className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors ${
									activeTab === "cf_secrets"
										? "bg-white text-blue-700 shadow-2xs dark:bg-neutral-900 dark:text-blue-400 font-semibold"
										: "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
								}`}
							>
								<span>Secrets & CI/CD</span>
							</button>

							<button
								type="button"
								onClick={() => setActiveTab("curl")}
								className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors ${
									activeTab === "curl"
										? "bg-white text-blue-700 shadow-2xs dark:bg-neutral-900 dark:text-blue-400 font-semibold"
										: "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
								}`}
							>
								<span>cURL Test</span>
							</button>
						</div>

						{/* Tab 1: AI Agent Prompt */}
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
								<pre className="max-h-48 overflow-y-auto rounded-xl bg-neutral-950 p-3 font-mono text-[11px] leading-relaxed text-neutral-200">
									<code>{aiAgentPrompt(activeKeyForGuide)}</code>
								</pre>
							</div>
						)}

						{/* Tab 2: Resend SDK */}
						{activeTab === "resend_code" && (
							<div className="space-y-2">
								<div className="flex items-center justify-between text-xs">
									<p className="text-neutral-600 dark:text-neutral-300">
										Drop-in replacement for Resend ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â just point <code className="font-mono">baseUrl</code> to OrbitMails:
									</p>
									<Button
										size="sm"
										variant="outline"
										onClick={() => copyToClipboard(resendSnippet(activeKeyForGuide), "snippet")}
										className="h-7 gap-1.5 border-neutral-300 bg-white text-xs font-medium text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
									>
										{copiedSnippet ? (
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
								<pre className="max-h-48 overflow-y-auto rounded-xl bg-neutral-950 p-3 font-mono text-[11px] leading-relaxed text-neutral-200">
									<code>{resendSnippet(activeKeyForGuide)}</code>
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

						{/* Tab 4: Cloudflare Secrets & CI/CD */}
						{activeTab === "cf_secrets" && (
							<div className="space-y-3">
								<div className="flex items-center justify-between text-xs">
									<p className="text-neutral-600 dark:text-neutral-300">
										<strong>Cloudflare Secrets or GitHub Secrets:</strong> Save your routing key wherever your project runs — no GitHub required:
									</p>
									<Button
										size="sm"
										variant="outline"
										onClick={() => copyToClipboard(githubSnippet(activeKeyForGuide), "github")}
										className="h-7 gap-1.5 border-neutral-300 bg-white text-xs font-medium text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
									>
										{copiedGithub ? (
											<>
												<Check className="h-3 w-3 text-emerald-500" />
												<span>Copied!</span>
											</>
										) : (
											<>
												<Copy className="h-3 w-3" />
												<span>Copy Secrets & Action</span>
											</>
										)}
									</Button>
								</div>
								<div className="rounded-xl border border-blue-200/80 bg-blue-50/60 p-3 text-xs text-blue-900 dark:border-blue-800/60 dark:bg-blue-950/40 dark:text-blue-200 leading-relaxed">
									ÃƒÂ°Ã…Â¸Ã¢â‚¬â„¢Ã‚Â¡ <strong>Zero Provider Secrets in Client Repos:</strong> Do not scatter raw AWS SES, Resend, or Brevo keys across your projects. Keep them encrypted and centralized in OrbitMails. Downstream projects only need their scoped <code className="font-mono font-semibold">ORBITMAIL_ROUTING_KEY</code>.
								</div>
								<pre className="max-h-52 overflow-y-auto rounded-xl bg-neutral-950 p-3 font-mono text-[11px] leading-relaxed text-neutral-200">
									<code>{githubSnippet(activeKeyForGuide)}</code>
								</pre>
							</div>
						)}

						{/* Tab 4: cURL */}
						{activeTab === "curl" && (
							<div className="space-y-2">
								<div className="flex items-center justify-between text-xs">
									<p className="text-neutral-600 dark:text-neutral-300">
										Test directly from your terminal or deployment script:
									</p>
									<Button
										size="sm"
										variant="outline"
										onClick={() => copyToClipboard(curlSnippet(activeKeyForGuide), "curl")}
										className="h-7 gap-1.5 border-neutral-300 bg-white text-xs font-medium text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
									>
										{copiedCurl ? (
											<>
												<Check className="h-3 w-3 text-emerald-500" />
												<span>Copied cURL!</span>
											</>
										) : (
											<>
												<Copy className="h-3 w-3" />
												<span>Copy cURL</span>
											</>
										)}
									</Button>
								</div>
								<pre className="max-h-48 overflow-y-auto rounded-xl bg-neutral-950 p-3 font-mono text-[11px] leading-relaxed text-neutral-200">
									<code>{curlSnippet(activeKeyForGuide)}</code>
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
								placeholder="e.g. Aurelia Production Server"
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
								onClick={() => setViewingGuideKey(`orb_live_${projectSlug}_...`)}
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
											<span>ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢</span>
											<span>Created {new Date(k.createdAt).toLocaleDateString()}</span>
											{k.lastUsedAt && (
												<>
													<span>ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢</span>
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
												setActiveTab("ai_prompt");
											}}
											title="View AI Agent Prompt & Integration Code"
											className="h-7 gap-1 text-xs text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:text-blue-400 dark:hover:bg-blue-950/40"
										>
											<Bot className="h-3.5 w-3.5" />
											<span>AI Prompt</span>
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
