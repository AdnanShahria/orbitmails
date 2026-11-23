"use client";

import React, { useEffect, useState } from "react";
import { Check, KeyRound, Server, Settings } from "@/components/icons";
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

export interface ProviderConfigItem {
	id: string;
	provider: string;
	label?: string | null;
	dailyLimit: number;
	configured: boolean;
	enabled: boolean;
	apiKeyMasked?: string;
	region?: string;
	bounceAddress?: string;
}

interface ProviderCredentialsModalProps {
	isOpen: boolean;
	onClose: () => void;
	provider: ProviderConfigItem | null;
	onSaveProvider: (
		providerId: string,
		updates: {
			dailyLimit?: number;
			label?: string;
			apiKey?: string;
			secretKey?: string;
			region?: string;
			bounceAddress?: string;
			enabled?: boolean;
		}
	) => Promise<void>;
}

export function ProviderCredentialsModal({
	isOpen,
	onClose,
	provider,
	onSaveProvider,
}: ProviderCredentialsModalProps) {
	const [dailyLimit, setDailyLimit] = useState(provider?.dailyLimit ?? 100);
	const [apiKey, setApiKey] = useState("");
	const [secretKey, setSecretKey] = useState("");
	const [region, setRegion] = useState(provider?.region || "us-east-1");
	const [bounceAddress, setBounceAddress] = useState(provider?.bounceAddress || "");
	const [isSaving, setIsSaving] = useState(false);
	const [savedSuccess, setSavedSuccess] = useState(false);

	useEffect(() => {
		if (!provider) return;
		setDailyLimit(provider.dailyLimit);
		setApiKey("");
		setSecretKey("");
		setRegion(provider.region || "us-east-1");
		setBounceAddress(provider.bounceAddress || "");
		setSavedSuccess(false);
	}, [provider?.id, provider?.dailyLimit, provider?.region, provider?.bounceAddress, isOpen]);

	if (!provider) return null;

	const handleSave = async (e: React.FormEvent) => {
		e.preventDefault();
		try {
			setIsSaving(true);
			await onSaveProvider(provider.id, {
				dailyLimit: Number(dailyLimit),
				apiKey: apiKey.trim() || undefined,
				secretKey: secretKey.trim() || undefined,
				region: region.trim() || undefined,
				bounceAddress: bounceAddress.trim() || undefined,
			});
			setSavedSuccess(true);
			setTimeout(() => {
				setSavedSuccess(false);
				onClose();
			}, 1000);
		} catch (err) {
			console.error("Failed to save provider credentials:", err);
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<div className="flex items-center gap-2">
						<Server className="h-5 w-5 text-neutral-700 dark:text-neutral-300" />
						<DialogTitle>Configure Provider: {provider.label || provider.provider.toUpperCase()}</DialogTitle>
					</div>
					<DialogDescription>
						Update API credentials and daily quota capacity for {provider.provider.toUpperCase()}.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSave} className="space-y-4 pt-2">
					{/* Daily Quota Limit */}
					<div className="space-y-1.5">
						<Label htmlFor="provider-daily-limit" className="text-xs font-semibold">
							Provider Daily Hard Quota Limit
						</Label>
						<div className="relative">
							<Input
								id="provider-daily-limit"
								type="number"
								min={1}
								value={dailyLimit}
								onChange={(e) => setDailyLimit(Math.max(1, parseInt(e.target.value, 10) || 1))}
								className="h-9 pr-14 text-sm font-semibold"
							/>
							<span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400">
								/day
							</span>
						</div>
						<p className="text-[11px] text-neutral-500">
							The maximum emails this provider allows per day across all projects combined.
						</p>
					</div>

					{/* API Key / Binding Notice */}
					{provider.provider === "cloudflare" ? (
						<div className="rounded-xl border border-blue-200/80 bg-blue-50/70 p-3 text-xs text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
							<p className="font-semibold">Cloudflare Worker Email Binding</p>
							<p className="mt-1 text-[11px] leading-relaxed opacity-90">
								Cloudflare Email Routing uses the Worker <code className="font-mono">EMAIL</code> binding automatically. Recipients always receive mail from <code className="font-mono">contact@mail.orbitsaas.cloud</code>.
							</p>
						</div>
					) : (
						<div className="space-y-1.5">
							<Label htmlFor="provider-api-key" className="text-xs font-semibold">
								{provider.provider === "ses" ? "AWS Access Key ID" : `${provider.provider.toUpperCase()} API Key`}
							</Label>
							<Input
								id="provider-api-key"
								type="password"
								placeholder={provider.apiKeyMasked || "Paste new API Key..."}
								value={apiKey}
								onChange={(e) => setApiKey(e.target.value)}
								className="h-9 font-mono text-xs"
							/>
							{provider.apiKeyMasked && (
								<p className="text-[11px] text-neutral-400">
									Currently configured: <code className="font-mono text-neutral-600 dark:text-neutral-300">{provider.apiKeyMasked}</code>
								</p>
							)}
						</div>
					)}

					{/* AWS SES Specifics */}
					{provider.provider === "ses" && (
						<>
							<div className="space-y-1.5">
								<Label htmlFor="provider-secret-key" className="text-xs font-semibold">
									AWS Secret Access Key
								</Label>
								<Input
									id="provider-secret-key"
									type="password"
									placeholder="Paste AWS Secret Access Key..."
									value={secretKey}
									onChange={(e) => setSecretKey(e.target.value)}
									className="h-9 font-mono text-xs"
								/>
							</div>

							<div className="space-y-1.5">
								<Label htmlFor="provider-region" className="text-xs font-semibold">
									AWS Region
								</Label>
								<Input
									id="provider-region"
									value={region}
									onChange={(e) => setRegion(e.target.value)}
									placeholder="e.g. us-east-1"
									className="h-9 font-mono text-xs"
								/>
							</div>
						</>
					)}

					{/* Zepto Specifics */}
					{provider.provider === "zepto" && (
						<div className="space-y-1.5">
							<Label htmlFor="provider-bounce" className="text-xs font-semibold">
								Bounce Address
							</Label>
							<Input
								id="provider-bounce"
								value={bounceAddress}
								onChange={(e) => setBounceAddress(e.target.value)}
								placeholder="e.g. bounce@yourdomain.com"
								className="h-9 text-xs"
							/>
						</div>
					)}

					<div className="flex items-center justify-end gap-2 pt-3">
						<Button type="button" variant="outline" size="sm" onClick={onClose} className="h-8 text-xs">
							Cancel
						</Button>
						<Button type="submit" size="sm" disabled={isSaving} className="h-8 gap-1.5 text-xs font-semibold">
							{savedSuccess ? (
								<>
									<Check className="h-3.5 w-3.5 text-emerald-400" />
									Saved!
								</>
							) : isSaving ? (
								"Saving..."
							) : (
								"Save Credentials"
							)}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
