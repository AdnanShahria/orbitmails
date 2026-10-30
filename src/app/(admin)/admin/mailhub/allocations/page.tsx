"use client";

import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
	Activity,
	AlertTriangle,
	Check,
	CheckCircle2,
	KeyRound,
	Plus,
	RefreshCw,
	Route,
	Save,
	Server,
	Settings,
	ShieldCheck,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { authFetch } from "@/lib/auth/client";
import { BudgetAllocatorBar, type ProjectSliceBarItem } from "@/components/mailhub/budget-allocator-bar";
import { AllocationSlider } from "@/components/mailhub/allocation-slider";
import { ProviderPriorityReorder, type ProviderItem } from "@/components/mailhub/provider-priority-reorder";
import { RoutingKeyModal, type KeyItem } from "@/components/mailhub/routing-key-modal";
import { ProviderCredentialsModal, type ProviderConfigItem } from "@/components/mailhub/provider-credentials-modal";
import { AddProjectModal } from "@/components/mailhub/add-project-modal";

// Distinct color assignments for top projects
const PROJECT_COLORS: Record<string, { bar: string; badge: string; text: string }> = {
	proj_aurelia: { bar: "bg-indigo-500", badge: "bg-indigo-50 dark:bg-indigo-950/60", text: "text-indigo-600 dark:text-indigo-400" },
	proj_lifesolver: { bar: "bg-emerald-500", badge: "bg-emerald-50 dark:bg-emerald-950/60", text: "text-emerald-600 dark:text-emerald-400" },
	proj_luvio: { bar: "bg-rose-500", badge: "bg-rose-50 dark:bg-rose-950/60", text: "text-rose-600 dark:text-rose-400" },
	proj_ovijatric: { bar: "bg-amber-500", badge: "bg-amber-50 dark:bg-amber-950/60", text: "text-amber-600 dark:text-amber-400" },
};

const FALLBACK_COLORS = [
	{ bar: "bg-cyan-500", badge: "bg-cyan-50", text: "text-cyan-600" },
	{ bar: "bg-violet-500", badge: "bg-violet-50", text: "text-violet-600" },
	{ bar: "bg-fuchsia-500", badge: "bg-fuchsia-50", text: "text-fuchsia-600" },
	{ bar: "bg-teal-500", badge: "bg-teal-50", text: "text-teal-600" },
];

export default function MailHubAllocationsPage() {
	const queryClient = useQueryClient();

	// Active selected provider tab
	const [activeProviderId, setActiveProviderId] = useState<string>("cred_brevo_main");

	// Local dirty slices state for real-time slider manipulation before save
	const [localSlices, setLocalSlices] = useState<Record<string, Record<string, number>>>({});

	// Modals state
	const [keyModalProject, setKeyModalProject] = useState<{ id: string; name: string; slug: string } | null>(null);
	const [credentialsModalProvider, setCredentialsModalProvider] = useState<ProviderConfigItem | null>(null);
	const [isAddProjectOpen, setIsAddProjectOpen] = useState(false);
	const [createdProjectBanner, setCreatedProjectBanner] = useState<{ project: any; key: string } | null>(null);
	const [saveSuccessNotice, setSaveSuccessNotice] = useState(false);

	// 1. Load Allocations Dataset
	const { data, isLoading, isError, refetch } = useQuery({
		queryKey: ["mailhub-allocations"],
		queryFn: async () => {
			const res = await authFetch("/api/admin/mailhub/allocations");
			if (!res.ok) throw new Error("Failed to load MailHub allocations");
			return res.json() as Promise<{
				providers: (ProviderConfigItem & {
					totalAllocated: number;
					totalUsedToday: number;
					remainingBuffer: number;
					isOverAllocated: boolean;
					overAllocatedBy: number;
				})[];
				projects: {
					id: string;
					name: string;
					slug: string;
					description?: string;
					status: string;
					providerOrder: string[];
				}[];
				allocations: {
					projectId: string;
					providerId: string;
					dailySlice: number;
					priority: number;
					usedToday: number;
				}[];
				keys: KeyItem[];
				summary: {
					totalDailyCapacity: number;
					totalAllocated: number;
					totalUsedToday: number;
					providerCount: number;
					projectCount: number;
				};
			}>;
		},
	});

	// Active Provider definition
	const currentProvider = useMemo(() => {
		if (!data?.providers) return null;
		return data.providers.find((p) => p.id === activeProviderId) || data.providers[0];
	}, [data?.providers, activeProviderId]);

	// Current provider slices
	const currentSlices = useMemo(() => {
		if (!data || !currentProvider) return [];

		return data.projects.map((proj, idx) => {
			const color = PROJECT_COLORS[proj.id] || FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
			const serverAlloc = data.allocations.find(
				(a) => a.providerId === currentProvider.id && a.projectId === proj.id
			);

			const sliceValue =
				localSlices[currentProvider.id]?.[proj.id] !== undefined
					? localSlices[currentProvider.id][proj.id]
					: serverAlloc?.dailySlice ?? 0;

			return {
				projectId: proj.id,
				projectName: proj.name,
				projectSlug: proj.slug,
				slice: sliceValue,
				usedToday: serverAlloc?.usedToday ?? 0,
				colorClass: color.bar,
				badgeBgClass: color.badge,
				textColorClass: color.text,
			};
		});
	}, [data, currentProvider, localSlices]);

	// Total allocated on active provider
	const totalAllocatedOnActive = useMemo(() => {
		return currentSlices.reduce((sum, s) => sum + s.slice, 0);
	}, [currentSlices]);

	const isOverAllocated = currentProvider ? totalAllocatedOnActive > currentProvider.dailyLimit : false;
	const overAllocatedBy = currentProvider && isOverAllocated ? totalAllocatedOnActive - currentProvider.dailyLimit : 0;

	// Slices formatted for the progress bar
	const barSlices: ProjectSliceBarItem[] = useMemo(() => {
		if (!currentProvider) return [];
		return currentSlices.map((s) => ({
			projectId: s.projectId,
			projectName: s.projectName,
			slice: s.slice,
			percentage: Math.round((s.slice / currentProvider.dailyLimit) * 100),
			colorClass: s.colorClass,
			textColorClass: s.textColorClass,
		}));
	}, [currentSlices, currentProvider]);

	// Handlers for interactive slider changes
	const handleSliceChange = (projectId: string, newSlice: number) => {
		if (!currentProvider) return;
		setLocalSlices((prev) => ({
			...prev,
			[currentProvider.id]: {
				...(prev[currentProvider.id] || {}),
				[projectId]: newSlice,
			},
		}));
		setSaveSuccessNotice(false);
	};

	// Auto-balance remaining unallocated buffer evenly
	const handleEvenlyDistribute = () => {
		if (!currentProvider || currentSlices.length === 0) return;
		const perProject = Math.floor(currentProvider.dailyLimit / currentSlices.length);
		const remainder = currentProvider.dailyLimit % currentSlices.length;

		const newMap: Record<string, number> = {};
		currentSlices.forEach((s, idx) => {
			newMap[s.projectId] = perProject + (idx === 0 ? remainder : 0);
		});

		setLocalSlices((prev) => ({
			...prev,
			[currentProvider.id]: newMap,
		}));
		setSaveSuccessNotice(false);
	};

	// Reset to original 300 Brevo configuration (Aurelia: 120, LifeSolver: 80, Luvio: 60, Ovijatric: 40)
	const handleResetDefaults = () => {
		if (!currentProvider) return;
		if (currentProvider.provider === "brevo") {
			setLocalSlices((prev) => ({
				...prev,
				[currentProvider.id]: {
					proj_aurelia: 120,
					proj_lifesolver: 80,
					proj_luvio: 60,
					proj_ovijatric: 40,
				},
			}));
		} else {
			handleEvenlyDistribute();
		}
		setSaveSuccessNotice(false);
	};

	// 2. Mutations
	// Save Slices Mutation
	const saveSlicesMutation = useMutation({
		mutationFn: async () => {
			if (!currentProvider) return;
			const slicesPayload = currentSlices.map((s) => ({
				projectId: s.projectId,
				dailySlice: s.slice,
			}));

			const res = await authFetch("/api/admin/mailhub/allocations", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					providerId: currentProvider.id,
					slices: slicesPayload,
				}),
			});

			const json = (await res.json()) as any;
			if (!res.ok) throw new Error(json.error || "Failed to save slices");
			return json;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["mailhub-allocations"] });
			setSaveSuccessNotice(true);
			setTimeout(() => setSaveSuccessNotice(false), 3000);
		},
	});

	// Reorder Provider Priority Waterfall Mutation
	const updateOrderMutation = useMutation({
		mutationFn: async ({ projectId, providerOrder }: { projectId: string; providerOrder: string[] }) => {
			const res = await authFetch("/api/admin/mailhub/projects", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					action: "update_order",
					projectId,
					providerOrder,
				}),
			});
			if (!res.ok) throw new Error("Failed to reorder providers");
			return (await res.json()) as any;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["mailhub-allocations"] });
		},
	});

	// Add Project Mutation
	const addProjectMutation = useMutation({
		mutationFn: async (data: { name: string; slug?: string; description?: string }) => {
			const res = await authFetch("/api/admin/mailhub/projects", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "create", ...data }),
			});
			const json = (await res.json()) as any;
			if (!res.ok) throw new Error(json.error || "Failed to create project");
			return json as { project: any; key: string };
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["mailhub-allocations"] });
		},
	});

	// Generate Key Mutation
	const generateKeyMutation = useMutation({
		mutationFn: async ({ projectId, name }: { projectId: string; name?: string }) => {
			const res = await authFetch("/api/admin/mailhub/keys", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "generate", projectId, name }),
			});
			const json = (await res.json()) as any;
			if (!res.ok) throw new Error(json.error || "Failed to generate key");
			return json as { fullKey: string; routingKey: import("@/components/mailhub/routing-key-modal").KeyItem };
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["mailhub-allocations"] });
		},
	});

	// Revoke Key Mutation
	const revokeKeyMutation = useMutation({
		mutationFn: async (keyId: string) => {
			const res = await authFetch("/api/admin/mailhub/keys", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "revoke", keyId }),
			});
			if (!res.ok) throw new Error("Failed to revoke key");
			return (await res.json()) as any;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["mailhub-allocations"] });
		},
	});

	// Update Provider Credentials Mutation
	const updateProviderMutation = useMutation({
		mutationFn: async ({ providerId, updates }: { providerId: string; updates: any }) => {
			const res = await authFetch("/api/admin/mailhub/providers", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ providerId, ...updates }),
			});
			const json = (await res.json()) as any;
			if (!res.ok) throw new Error(json.error || "Failed to update provider");
			return json;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["mailhub-allocations"] });
		},
	});

	if (isLoading) {
		return (
			<div className="space-y-6">
				<div className="h-8 w-64 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />
				<div className="h-28 w-full animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-800/60" />
				<div className="grid gap-4 md:grid-cols-2">
					<div className="h-44 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800/60" />
					<div className="h-44 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800/60" />
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-8 pb-12">
			{/* Page Header */}
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div>
					<div className="flex items-center gap-2.5">
						<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white shadow-xs">
							<Activity className="h-4 w-4" />
						</div>
						<h1 className="text-2xl font-bold tracking-tight text-neutral-900 md:text-3xl dark:text-neutral-100">
							MailHub Allocations
						</h1>
					</div>
					<p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
						Slice shared provider daily limits across your web projects and configure intelligent failover waterfalls.
					</p>
				</div>

				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => setIsAddProjectOpen(true)}
						className="h-9 gap-1.5 text-xs font-semibold"
					>
						<Plus className="h-4 w-4" />
						Add Project
					</Button>

					<Button
						size="sm"
						onClick={() => saveSlicesMutation.mutate()}
						disabled={isOverAllocated || saveSlicesMutation.isPending}
						className="h-9 gap-1.5 text-xs font-semibold shadow-xs"
					>
						{saveSuccessNotice ? (
							<>
								<Check className="h-4 w-4 text-emerald-400" />
								Saved!
							</>
						) : saveSlicesMutation.isPending ? (
							"Saving..."
						) : (
							<>
								<Save className="h-4 w-4" />
								Save Allocations
							</>
						)}
					</Button>
				</div>
			</div>

			{/* Project Created Banner (if new project created) */}
			{createdProjectBanner && (
				<div className="flex items-center justify-between gap-4 rounded-xl border border-emerald-300 bg-emerald-50/80 p-4 text-xs dark:border-emerald-800 dark:bg-emerald-950/40">
					<div>
						<h4 className="font-semibold text-emerald-900 dark:text-emerald-200">
							Project &quot;{createdProjectBanner.project.name}&quot; successfully registered!
						</h4>
						<p className="mt-0.5 text-emerald-800 dark:text-emerald-300">
							Initial routing key generated: <code className="font-mono">{createdProjectBanner.key}</code>
						</p>
					</div>
					<Button
						size="sm"
						variant="outline"
						onClick={() => setCreatedProjectBanner(null)}
						className="h-7 text-xs"
					>
						Dismiss
					</Button>
				</div>
			)}

			{/* Provider Tabs / Selector Rail */}
			<div className="space-y-3">
				<div className="flex items-center justify-between">
					<h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
						Outbound Sending Providers
					</h2>
					{currentProvider && (
						<button
							type="button"
							onClick={() => setCredentialsModalProvider(currentProvider)}
							className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400"
						>
							<Settings className="h-3.5 w-3.5" />
							Configure Credentials & Limit
						</button>
					)}
				</div>

				<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
					{data?.providers.map((prov) => {
						const isSelected = prov.id === activeProviderId;
						const pct = Math.min(100, Math.round((prov.totalAllocated / prov.dailyLimit) * 100));

						return (
							<button
								key={prov.id}
								type="button"
								onClick={() => {
									setActiveProviderId(prov.id);
									setSaveSuccessNotice(false);
								}}
								className={`group relative flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all ${
									isSelected
										? "border-blue-600 bg-blue-50/30 shadow-xs ring-1 ring-blue-600 dark:border-blue-500 dark:bg-blue-950/20"
										: "border-neutral-200/80 bg-white hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900/60 dark:hover:border-neutral-700"
								}`}
							>
								<div>
									<div className="flex items-center justify-between gap-1">
										<span className="font-semibold text-neutral-900 capitalize dark:text-neutral-100">
											{prov.provider}
										</span>
										<Badge
											variant={prov.configured ? "default" : "secondary"}
											className="text-[10px]"
										>
											{prov.configured ? "Ready" : "No Key"}
										</Badge>
									</div>
									<div className="mt-1 font-mono text-xs text-neutral-500 dark:text-neutral-400">
										{prov.dailyLimit.toLocaleString()} /day
									</div>
								</div>

								<div className="mt-3">
									<div className="flex items-center justify-between text-[11px] text-neutral-400">
										<span>Allocated:</span>
										<span className="font-semibold text-neutral-700 dark:text-neutral-300">
											{prov.totalAllocated} ({pct}%)
										</span>
									</div>
									<div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
										<div
											style={{ width: `${pct}%` }}
											className={`h-full transition-all ${
												prov.isOverAllocated ? "bg-rose-500" : pct === 100 ? "bg-emerald-500" : "bg-blue-500"
											}`}
										/>
									</div>
								</div>
							</button>
						);
					})}
				</div>
			</div>

			{/* Section 1: Visual Budget Allocator Bar */}
			{currentProvider && (
				<BudgetAllocatorBar
					providerName={currentProvider.label || currentProvider.provider.toUpperCase()}
					providerLimit={currentProvider.dailyLimit}
					slices={barSlices}
					totalAllocated={totalAllocatedOnActive}
					isOverAllocated={isOverAllocated}
					overAllocatedBy={overAllocatedBy}
				/>
			)}

			{/* Section 2: Interactive Quota Slicing Sliders */}
			<div className="space-y-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
							Quota Slices per Project
						</h2>
						<p className="text-xs text-neutral-500 dark:text-neutral-400">
							Adjust the daily quota slices allocated to each web project on {currentProvider?.label || "this provider"}.
						</p>
					</div>

					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={handleEvenlyDistribute}
							className="h-7 text-xs"
						>
							Evenly Distribute
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={handleResetDefaults}
							className="h-7 text-xs"
						>
							Reset Defaults
						</Button>
					</div>
				</div>

				<div className="grid gap-3 md:grid-cols-2">
					{currentSlices.map((slice) => (
						<AllocationSlider
							key={slice.projectId}
							projectId={slice.projectId}
							projectName={slice.projectName}
							projectSlug={slice.projectSlug}
							slice={slice.slice}
							maxLimit={currentProvider?.dailyLimit || 1000}
							usedToday={slice.usedToday}
							colorClass={slice.colorClass}
							badgeBgClass={slice.badgeBgClass}
							onChange={(newSlice) => handleSliceChange(slice.projectId, newSlice)}
						/>
					))}
				</div>
			</div>

			{/* Section 3: Project Routing Keys & Provider Priority Waterfalls */}
			<div className="space-y-4 pt-4 border-t border-neutral-200/80 dark:border-neutral-800">
				<div>
					<h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
						Project Routing Keys & Failover Waterfalls
					</h2>
					<p className="text-xs text-neutral-500 dark:text-neutral-400">
						Manage unified routing keys (<code className="font-mono">om_live_...</code>) and customize the provider failover waterfall order per project.
					</p>
				</div>

				<div className="grid gap-5 lg:grid-cols-2">
					{data?.projects.map((proj) => {
						const provItems: ProviderItem[] = (data.providers || []).map((p) => ({
							id: p.id,
							name: p.label || p.provider.toUpperCase(),
							type: p.provider,
							dailyLimit: p.dailyLimit,
							costPerK: (p as any).costPerK ?? 0,
							configured: p.configured,
							enabled: p.enabled,
						}));

						const projKeys = (data.keys || []).filter((k) => k.projectId === proj.id && k.status === "active");

						return (
							<div
								key={proj.id}
								className="flex flex-col justify-between space-y-4 rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-xs dark:border-neutral-800 dark:bg-neutral-900"
							>
								{/* Project Header */}
								<div className="flex items-start justify-between gap-3">
									<div>
										<div className="flex items-center gap-2">
											<span className="text-base font-bold text-neutral-900 dark:text-neutral-100">
												{proj.name}
											</span>
											<span className="font-mono text-xs text-neutral-400">
												({proj.slug})
											</span>
											<Badge variant="outline" className="text-[10px]">
												{proj.status}
											</Badge>
										</div>
										{proj.description && (
											<p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
												{proj.description}
											</p>
										)}
									</div>

									{/* Key Modal Button */}
									<Button
										variant="outline"
										size="sm"
										onClick={() => setKeyModalProject(proj)}
										className="h-8 gap-1.5 text-xs font-semibold"
									>
										<KeyRound className="h-3.5 w-3.5 text-blue-600" />
										Manage Keys ({projKeys.length})
									</Button>
								</div>

								{/* Provider Waterfall Component */}
								<ProviderPriorityReorder
									projectId={proj.id}
									projectName={proj.name}
									initialOrder={proj.providerOrder || []}
									allProviders={provItems}
									onSaveOrder={async (pId, newOrder) => {
										await updateOrderMutation.mutateAsync({
											projectId: pId,
											providerOrder: newOrder,
										});
									}}
								/>
							</div>
						);
					})}
				</div>
			</div>

			{/* Routing Key Management Modal */}
			{keyModalProject && (
				<RoutingKeyModal
					isOpen={Boolean(keyModalProject)}
					onClose={() => setKeyModalProject(null)}
					projectId={keyModalProject.id}
					projectName={keyModalProject.name}
					projectSlug={keyModalProject.slug}
					keys={data?.keys || []}
					onGenerateKey={async (pId, name) => {
						const result = await generateKeyMutation.mutateAsync({ projectId: pId, name });
						return result;
					}}
					onRevokeKey={async (keyId) => {
						await revokeKeyMutation.mutateAsync(keyId);
					}}
				/>
			)}

			{/* Provider Credentials Modal */}
			{credentialsModalProvider && (
				<ProviderCredentialsModal
					isOpen={Boolean(credentialsModalProvider)}
					onClose={() => setCredentialsModalProvider(null)}
					provider={credentialsModalProvider}
					onSaveProvider={async (provId, updates) => {
						await updateProviderMutation.mutateAsync({
							providerId: provId,
							updates,
						});
					}}
				/>
			)}

			{/* Add Project Modal */}
			<AddProjectModal
				isOpen={isAddProjectOpen}
				onClose={() => setIsAddProjectOpen(false)}
				onAddProject={async (projectData) => {
					return await addProjectMutation.mutateAsync(projectData);
				}}
				onProjectCreated={(created) => {
					setCreatedProjectBanner(created);
				}}
			/>
		</div>
	);
}
