"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/auth/client";
import { AddProjectModal } from "@/components/mailhub/add-project-modal";
import { ActivityFeed } from "./activity-feed";
import { MailHubNavTabs } from "./mailhub-nav-tabs";
import { ProjectsTable } from "./projects-table";
import { ProviderStatusRow } from "./provider-status-row";
import { QuotaSliceModal } from "./quota-slice-modal";
import { StatsCards } from "./stats-cards";
import { TestSendDialog } from "./test-send-dialog";
import type {
  MailHubActivityItem,
  MailHubProject,
  MailHubProvider,
  MailHubSummaryStats,
  ProviderId,
} from "./types";
import {
  getProviderBrand,
  getProviderDisplayName,
  normalizeProviderId,
} from "./utils";

// Dynamic project visual palette generator based on project name
function getProjectVisual(name: string, idx: number) {
  const words = name.trim().split(/\s+/);
  const initials =
    words.length >= 2
      ? (words[0][0] + words[1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();
  const colors = [
    "bg-indigo-600",
    "bg-emerald-600",
    "bg-rose-600",
    "bg-amber-600",
    "bg-cyan-600",
    "bg-violet-600",
    "bg-fuchsia-600",
    "bg-teal-600",
  ];
  return {
    brandColor: colors[idx % colors.length],
    avatarInitials: initials || "OM",
  };
}

export default function MailHubDashboardPage() {
  const queryClient = useQueryClient();

  // Modals and filters state
  const [activeProjectForTest, setActiveProjectForTest] = useState<MailHubProject | null>(null);
  const [isTestSendOpen, setIsTestSendOpen] = useState(false);
  const [isQuotaModalOpen, setIsQuotaModalOpen] = useState(false);
  const [isAddProjectOpen, setIsAddProjectOpen] = useState(false);
  const [projectFilterForLogs, setProjectFilterForLogs] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  // 1. Fetch Real-Time Today Stats from Live API (rate-optimized to protect Cloudflare quotas)
  const {
    data: statsResponse,
    isLoading: isStatsLoading,
    refetch: refetchStats,
  } = useQuery({
    queryKey: ["mailhub-stats"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/mailhub/stats");
      if (!res.ok) throw new Error("Failed to fetch MailHub stats");
      return res.json() as Promise<{
        success: boolean;
        stats: {
          totalSentToday: number;
          deliveredToday: number;
          failedToday: number;
          failoversTriggeredToday: number;
          activeProjects: number;
          activeProviders: number;
          averageLatencyMs: number;
          quotaUtilizationPct: number;
        };
        providers: any[];
      }>;
    },
    refetchInterval: isStreaming ? 30000 : false,
    refetchIntervalInBackground: false,
    staleTime: 15000,
  });

  // 2. Fetch Live Project Allocations (fetched on demand / mutation, no aggressive polling)
  const {
    data: allocationsResponse,
    isLoading: isAllocationsLoading,
    refetch: refetchAllocations,
  } = useQuery({
    queryKey: ["mailhub-allocations"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/mailhub/allocations");
      if (!res.ok) throw new Error("Failed to fetch MailHub allocations");
      return res.json() as Promise<{
        providers: any[];
        projects: Array<{
          id: string;
          name: string;
          slug: string;
          description?: string;
          status: string;
          providerOrder: string[];
        }>;
        allocations: Array<{
          projectId: string;
          providerId: string;
          dailySlice: number;
          priority: number;
          usedToday: number;
        }>;
        keys: Array<{
          id: string;
          projectId: string;
          name: string;
          prefix: string;
          displayPrefix: string;
        }>;
        summary: {
          totalDailyCapacity: number;
          totalAllocated: number;
          totalUsedToday: number;
          providerCount: number;
          projectCount: number;
        };
      }>;
    },
    refetchInterval: false,
    refetchIntervalInBackground: false,
    staleTime: 60000,
  });

  // 3. Fetch Live Activity Stream from Ingestion / Send Logs (poll only when stream is active)
  const {
    data: activitiesResponse,
    isLoading: isActivitiesLoading,
    refetch: refetchActivities,
  } = useQuery({
    queryKey: ["mailhub-activities", projectFilterForLogs],
    queryFn: async () => {
      const queryParams = new URLSearchParams();
      if (projectFilterForLogs) {
        queryParams.set("projectId", projectFilterForLogs);
      }
      queryParams.set("limit", "50");

      const url = `/api/admin/mailhub/activities?${queryParams.toString()}`;
      const res = await authFetch(url);
      if (!res.ok) throw new Error("Failed to fetch MailHub activities");
      return res.json() as Promise<{
        success: boolean;
        activities: MailHubActivityItem[];
      }>;
    },
    refetchInterval: isStreaming ? 30000 : false,
    refetchIntervalInBackground: false,
    staleTime: 15000,
  });

  // Global manual refresh handler
  const handleGlobalRefresh = () => {
    refetchStats();
    refetchAllocations();
    refetchActivities();
  };

  // Derive Summary Metrics from Live Server Data
  const stats: MailHubSummaryStats = useMemo(() => {
    const raw = statsResponse?.stats;
    const summary = allocationsResponse?.summary;
    const totalSent = raw?.totalSentToday ?? summary?.totalUsedToday ?? 0;
    const failed = raw?.failedToday ?? 0;
    const deliveryRate =
      totalSent > 0
        ? Math.max(0, Math.min(100, Math.round(((totalSent - failed) / totalSent) * 100)))
        : 100;

    const healthyCount = (statsResponse?.providers || []).filter(
      (p: any) => p.health === "active"
    ).length;

    return {
      totalSentToday: totalSent,
      sentDeltaPercent: 0,
      activeProjectsCount: raw?.activeProjects ?? allocationsResponse?.projects?.length ?? 0,
      totalProjectsCount: allocationsResponse?.projects?.length ?? 0,
      healthyProvidersCount: healthyCount || (statsResponse?.providers?.length ?? 0),
      totalProvidersCount: statsResponse?.providers?.length ?? 0,
      failoversTriggeredToday: raw?.failoversTriggeredToday ?? 0,
      overallDeliveryRate: deliveryRate,
      avgLatencyMs: raw?.averageLatencyMs ?? 0,
    };
  }, [statsResponse, allocationsResponse]);

  // Derive Provider Fleets from Live Server Data
  const providers: MailHubProvider[] = useMemo(() => {
    if (statsResponse?.providers && statsResponse.providers.length > 0) {
      return statsResponse.providers.map((p: any) => {
        const id = normalizeProviderId(p.provider || p.id);
        const brand = getProviderBrand(id);
        const displayName = getProviderDisplayName(id);

        return {
          id,
          name: displayName,
          tier:
            p.dailyLimit > 0
              ? `${p.dailyLimit.toLocaleString()}/day pool`
              : "Direct routing",
          dailyLimit: p.dailyLimit || 0,
          usedToday: p.usedToday || 0,
          health: p.health || "active",
          consecutiveFailures: p.consecutiveFailures || 0,
          maxStrikes: p.maxStrikes || 3,
          lastIncident: p.lastIncident || null,
          avgLatencyMs: p.avgLatencyMs || 0,
          deliveryRatePercent: p.deliveryRatePercent || 100,
          brandBg: brand.bg,
          brandFg: brand.fg,
        };
      });
    }

    // Default Provider Layout while query loads
    const defaultIds: ProviderId[] = ["brevo", "resend", "ses", "zepto"];
    return defaultIds.map((id) => {
      const brand = getProviderBrand(id);
      return {
        id,
        name: getProviderDisplayName(id),
        tier: "Direct routing",
        dailyLimit: 0,
        usedToday: 0,
        health: "active",
        consecutiveFailures: 0,
        maxStrikes: 3,
        lastIncident: null,
        avgLatencyMs: 0,
        deliveryRatePercent: 100,
        brandBg: brand.bg,
        brandFg: brand.fg,
      };
    });
  }, [statsResponse]);

  // Derive Projects Table Data from Live Allocations and Keys
  const projects: MailHubProject[] = useMemo(() => {
    if (allocationsResponse?.projects && allocationsResponse.projects.length > 0) {
      return allocationsResponse.projects.map((proj, idx) => {
        const visual = getProjectVisual(proj.name, idx);

        const matchedKey = allocationsResponse.keys?.find((k) => k.projectId === proj.id);
        const projAllocations = (allocationsResponse.allocations || []).filter(
          (a) => a.projectId === proj.id
        );

        const dailyQuotaSlice =
          projAllocations.reduce((sum, a) => sum + (a.dailySlice || 0), 0) || 75;
        const sentToday = projAllocations.reduce((sum, a) => sum + (a.usedToday || 0), 0);

        const primaryProvider = proj.providerOrder?.[0]
          ? normalizeProviderId(proj.providerOrder[0])
          : "brevo";
        const fallbackChain = (proj.providerOrder || []).slice(1).map(normalizeProviderId);

        return {
          id: proj.id,
          slug: proj.slug,
          name: proj.name,
          description: proj.description || "",
          apiKey: matchedKey
            ? `${matchedKey.displayPrefix || matchedKey.prefix || "om_live_" + proj.slug}••••••••`
            : `om_live_${proj.slug}_sec`,
          apiKeyPrefix: matchedKey?.prefix || "om_live_",
          primaryProvider,
          fallbackChain: fallbackChain.length > 0 ? fallbackChain : ["resend", "ses", "zepto"],
          dailyQuotaSlice,
          sentToday,
          failoverCount: 0,
          status: (proj.status as any) || "active",
          brandColor: visual.brandColor,
          avatarInitials: visual.avatarInitials,
          lastSentAt: null,
        };
      });
    }

    return [];
  }, [allocationsResponse]);

  // Live Activities List
  const activities: MailHubActivityItem[] = useMemo(() => {
    return activitiesResponse?.activities || [];
  }, [activitiesResponse]);

  // Handlers for Live Actions
  const handleTestSendSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["mailhub-stats"] });
    queryClient.invalidateQueries({ queryKey: ["mailhub-activities"] });
    queryClient.invalidateQueries({ queryKey: ["mailhub-allocations"] });
  };

  const handleResetBreaker = () => {
    queryClient.invalidateQueries({ queryKey: ["mailhub-stats"] });
  };

  const handleSaveSlices = () => {
    queryClient.invalidateQueries({ queryKey: ["mailhub-allocations"] });
    queryClient.invalidateQueries({ queryKey: ["mailhub-stats"] });
  };

  const handleAddProject = async (data: {
    name: string;
    slug?: string;
    description?: string;
  }): Promise<{ project: any; key: string }> => {
    const res = await authFetch("/api/admin/mailhub/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", ...data }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as Record<string, any>;
      throw new Error(err.error || "Failed to create project");
    }
    return res.json() as Promise<{ project: any; key: string }>;
  };

  const handleProjectCreated = () => {
    queryClient.invalidateQueries({ queryKey: ["mailhub-allocations"] });
    queryClient.invalidateQueries({ queryKey: ["mailhub-stats"] });
    setIsAddProjectOpen(false);
  };

  return (
    <div className="space-y-6 pb-14">
      {/* 1. Page Header & Primary Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pt-1">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900 md:text-3xl dark:text-neutral-50">
              MailHub Routing Engine
            </h1>
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200/60 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900/50">
              v1.0 Live
            </span>
          </div>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
            Unified multi-provider email infrastructure, quota slicing, and intelligent failover across all projects.
          </p>
        </div>

        {/* Global Quick Action Buttons */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsAddProjectOpen(true)}
            className="min-h-[40px] gap-2 rounded-xl border-neutral-200/90 bg-white px-3.5 text-xs font-semibold text-neutral-800 shadow-2xs hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 transition-colors"
          >
            <Plus className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span>New Project</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsQuotaModalOpen(true)}
            className="min-h-[40px] gap-2 rounded-xl border-neutral-200/90 bg-white px-3.5 text-xs font-semibold text-neutral-800 shadow-2xs hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 transition-colors"
          >
            <Settings2 className="h-4 w-4 text-neutral-500" />
            <span>Rebalance Slices</span>
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={() => {
              setActiveProjectForTest(projects[0] || null);
              setIsTestSendOpen(true);
            }}
            className="min-h-[40px] gap-2 rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
          >
            <Send className="h-4 w-4" />
            <span>Trigger Test Email</span>
          </Button>
        </div>
      </div>

      {/* 2. Apple HIG Segmented Navigation Tabs */}
      <MailHubNavTabs />

      {/* 3. Summary Statistics Cards */}
      <StatsCards stats={stats} />

      {/* 4. Provider Fleets & Daily Limit Ceilings */}
      <ProviderStatusRow
        providers={providers}
        onResetBreaker={handleResetBreaker}
      />

      {/* 5. Projects Usage & Quota Slice Allocations */}
      <ProjectsTable
        projects={projects}
        onOpenTestSend={(project) => {
          setActiveProjectForTest(project);
          setIsTestSendOpen(true);
        }}
        onOpenQuotaModal={() => setIsQuotaModalOpen(true)}
        onFilterProjectLogs={(projectId) => setProjectFilterForLogs(projectId)}
        onOpenAddProject={() => setIsAddProjectOpen(true)}
      />

      {/* 6. Live Activity Stream & Diagnostic Waterfall */}
      <ActivityFeed
        activities={activities}
        projects={projects}
        selectedProjectFilter={projectFilterForLogs}
        onSelectProjectFilter={setProjectFilterForLogs}
        onRefresh={handleGlobalRefresh}
        isStreaming={isStreaming}
        onToggleStreaming={() => setIsStreaming(!isStreaming)}
      />

      {/* Modals with Live Backend Binding */}
      <TestSendDialog
        isOpen={isTestSendOpen}
        onClose={() => setIsTestSendOpen(false)}
        project={activeProjectForTest}
        onSuccessSend={handleTestSendSuccess}
      />

      <QuotaSliceModal
        isOpen={isQuotaModalOpen}
        onClose={() => setIsQuotaModalOpen(false)}
        projects={projects}
        onSaveSlices={handleSaveSlices}
      />

      <AddProjectModal
        isOpen={isAddProjectOpen}
        onClose={() => setIsAddProjectOpen(false)}
        onAddProject={handleAddProject}
        onProjectCreated={handleProjectCreated}
      />
    </div>
  );
}
