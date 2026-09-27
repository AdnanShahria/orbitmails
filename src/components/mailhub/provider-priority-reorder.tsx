"use client";

import React, { useState } from "react";
import { ArrowDown, ArrowUp, Check, Route, Server, ShieldCheck } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface ProviderItem {
	id: string;
	name: string;
	type: string;
	dailyLimit: number;
	costPerK: number;
	configured: boolean;
	enabled: boolean;
}

interface ProviderPriorityReorderProps {
	projectId: string;
	projectName: string;
	initialOrder: string[]; // array of provider IDs in priority order
	allProviders: ProviderItem[];
	onSaveOrder: (projectId: string, newOrder: string[]) => Promise<void>;
}

export function ProviderPriorityReorder({
	projectId,
	projectName,
	initialOrder,
	allProviders,
	onSaveOrder,
}: ProviderPriorityReorderProps) {
	// Reconcile order ensuring all enabled providers are present
	const sanitizeOrder = (order: string[]) => {
		const existing = new Set(order);
		const filtered = order.filter((id) => allProviders.some((p) => p.id === id));
		for (const p of allProviders) {
			if (!existing.has(p.id)) filtered.push(p.id);
		}
		return filtered;
	};

	const [order, setOrder] = useState<string[]>(sanitizeOrder(initialOrder));
	const [isSaving, setIsSaving] = useState(false);
	const [hasChanges, setHasChanges] = useState(false);
	const [savedRecently, setSavedRecently] = useState(false);

	const moveUp = (index: number) => {
		if (index <= 0) return;
		const next = [...order];
		const temp = next[index - 1];
		next[index - 1] = next[index];
		next[index] = temp;
		setOrder(next);
		setHasChanges(true);
		setSavedRecently(false);
	};

	const moveDown = (index: number) => {
		if (index >= order.length - 1) return;
		const next = [...order];
		const temp = next[index + 1];
		next[index + 1] = next[index];
		next[index] = temp;
		setOrder(next);
		setHasChanges(true);
		setSavedRecently(false);
	};

	const handleSave = async () => {
		try {
			setIsSaving(true);
			await onSaveOrder(projectId, order);
			setHasChanges(false);
			setSavedRecently(true);
			setTimeout(() => setSavedRecently(false), 3000);
		} catch (err) {
			console.error("Failed to save provider priority order:", err);
		} finally {
			setIsSaving(false);
		}
	};

	const getProvider = (id: string) => allProviders.find((p) => p.id === id);

	return (
		<div className="space-y-4 rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-xs dark:border-neutral-800 dark:bg-neutral-900">
			<div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-3 dark:border-neutral-800">
				<div>
					<div className="flex items-center gap-2">
						<Route className="h-4 w-4 text-neutral-500" />
						<h3 className="font-semibold text-neutral-900 dark:text-neutral-100">
							Provider Failover Waterfall: {projectName}
						</h3>
					</div>
					<p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
						When Rank 1 exhausts its daily quota or triggers a circuit breaker, MailHub seamlessly cascades down this sequence.
					</p>
				</div>

				<div className="flex items-center gap-2">
					{savedRecently && (
						<span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
							<Check className="h-3.5 w-3.5" />
							Saved!
						</span>
					)}
					<Button
						size="sm"
						onClick={handleSave}
						disabled={!hasChanges || isSaving}
						className="h-8 gap-1.5 text-xs font-semibold"
					>
						{isSaving ? "Saving..." : "Save Waterfall"}
					</Button>
				</div>
			</div>

			{/* Waterfall Chain List */}
			<div className="space-y-2">
				{order.map((provId, index) => {
					const prov = getProvider(provId);
					if (!prov) return null;

					const isPrimary = index === 0;

					return (
						<div
							key={prov.id}
							className={`flex items-center justify-between gap-3 rounded-xl border p-3 transition-all ${
								isPrimary
									? "border-blue-200 bg-blue-50/40 dark:border-blue-900/60 dark:bg-blue-950/20"
									: "border-neutral-200/70 bg-white dark:border-neutral-800 dark:bg-neutral-900/60"
							}`}
						>
							<div className="flex items-center gap-3">
								<div
									className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold ${
										isPrimary
											? "bg-blue-600 text-white shadow-xs"
											: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
									}`}
								>
									#{index + 1}
								</div>

								<div>
									<div className="flex items-center gap-2">
										<span className="font-semibold text-neutral-900 dark:text-neutral-100">
											{prov.name}
										</span>
										{isPrimary && (
											<span className="inline-flex items-center rounded-md bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800 dark:bg-blue-900/60 dark:text-blue-300">
												Primary Attempt
											</span>
										)}
										<span className="inline-flex items-center rounded-md bg-neutral-100 px-1.5 py-0.2 text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
											{prov.costPerK === 0 ? "Free Tier" : `$${prov.costPerK.toFixed(2)}/1k`}
										</span>
									</div>
									<div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
										<span>Capacity: {prov.dailyLimit.toLocaleString()} /day</span>
										<span>•</span>
										<span>Status: {prov.configured ? "Configured" : "Needs API Key"}</span>
									</div>
								</div>
							</div>

							{/* Reorder Buttons */}
							<div className="flex items-center gap-1">
								<button
									type="button"
									onClick={() => moveUp(index)}
									disabled={index === 0}
									className="flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
									title="Move Higher Priority"
								>
									<ArrowUp className="h-3.5 w-3.5" />
								</button>
								<button
									type="button"
									onClick={() => moveDown(index)}
									disabled={index === order.length - 1}
									className="flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
									title="Move Lower Priority"
								>
									<ArrowDown className="h-3.5 w-3.5" />
								</button>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
