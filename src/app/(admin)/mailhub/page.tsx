"use client";

import { useCallback, useState } from "react";
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
import { ActivityFeed } from "./activity-feed";
import {
  INITIAL_ACTIVITIES,
  INITIAL_PROJECTS,
  INITIAL_PROVIDERS,
  INITIAL_SUMMARY,
} from "./mock-data";
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

export default function MailHubDashboardPage() {
  const [stats, setStats] = useState<MailHubSummaryStats>(INITIAL_SUMMARY);
  const [projects, setProjects] = useState<MailHubProject[]>(INITIAL_PROJECTS);
  const [providers, setProviders] = useState<MailHubProvider[]>(INITIAL_PROVIDERS);
  const [activities, setActivities] = useState<MailHubActivityItem[]>(INITIAL_ACTIVITIES);

  // Modals state
  const [activeProjectForTest, setActiveProjectForTest] = useState<MailHubProject | null>(null);
  const [isTestSendOpen, setIsTestSendOpen] = useState(false);
  const [isQuotaModalOpen, setIsQuotaModalOpen] = useState(false);
  const [projectFilterForLogs, setProjectFilterForLogs] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Manual or timer-based refresh
  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    // Simulate real-time fetch from API / Durable Objects
    setTimeout(() => {
      // Simulate new incoming sends periodically
      const randomProject = projects[Math.floor(Math.random() * projects.length)];
      const isFailover = randomProject.sentToday >= randomProject.dailyQuotaSlice - 5;
      const providerUsed = isFailover ? randomProject.fallbackChain[0] : randomProject.primaryProvider;
      const actId = `send_${Date.now().toString().slice(-5)}`;
      const digestNum = Math.floor(Math.random() * 80) + 1;
      const recipient = `user_${Math.floor(Math.random() * 900) + 100}@example.com`;
      const subject = `${randomProject.name} Notification Digest #${digestNum}`;
      const fromAddress = `notifications@${randomProject.slug}.internal`;
      const messageId = `<${randomProject.slug}-${actId}@orbitmails.internal>`;

      const newActivity: MailHubActivityItem = {
        id: actId,
        timestamp: new Date().toISOString(),
        projectId: randomProject.id,
        projectName: randomProject.name,
        fromAddress,
        recipient,
        subject,
        messageId,
        headers: {
          "From": `${randomProject.name} <${fromAddress}>`,
          "To": recipient,
          "Subject": subject,
          "Message-ID": messageId,
          "X-Mailer": "Orbitmails MailHub/1.0",
        },
        htmlSnippet: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px; background: #ffffff;">
  <h3 style="margin: 0 0 8px 0; color: #111827; font-size: 16px;">${subject}</h3>
  <p style="margin: 0 0 12px 0; color: #4b5563; font-size: 13px;">Automated system digest from ${randomProject.name}.</p>
  <div style="background: #f8fafc; padding: 12px; border-radius: 8px; font-size: 12px; color: #334155;">Status: Normal &middot; System healthy &middot; Delivered via ${providerUsed.toUpperCase()}</div>
</div>`,
        textContent: `${subject}\n\nAutomated system digest from ${randomProject.name}.\nDelivered via ${providerUsed.toUpperCase()}`,
        provider: providerUsed,
        wasFailover: isFailover,
        failoverFrom: isFailover ? randomProject.primaryProvider : undefined,
        failoverReason: isFailover ? "Project quota slice exceeded" : undefined,
        status: "delivered",
        latencyMs: 145 + Math.floor(Math.random() * 120),
        routeAttempts: [
          ...(isFailover
            ? [
                {
                  provider: randomProject.primaryProvider,
                  status: 429,
                  latencyMs: 42,
                  error: "Slice quota saturated",
                  timestamp: new Date().toISOString(),
                },
              ]
            : []),
          {
            provider: providerUsed,
            status: 200,
            latencyMs: 145 + Math.floor(Math.random() * 120),
            timestamp: new Date().toISOString(),
          },
        ],
      };

      setActivities((prev) => [newActivity, ...prev.slice(0, 24)]);
      setStats((prev) => ({
        ...prev,
        totalSentToday: prev.totalSentToday + 1,
        failoversTriggeredToday: isFailover ? prev.failoversTriggeredToday + 1 : prev.failoversTriggeredToday,
      }));
      setIsRefreshing(false);
    }, 400);
  }, [projects]);

  // Handle successful test send
  function handleTestSendSuccess(sentData: {
    projectId: string;
    recipient: string;
    subject: string;
    provider: ProviderId;
    latencyMs: number;
  }) {
    const proj = projects.find((p) => p.id === sentData.projectId);
    if (!proj) return;

    const isFailover = sentData.provider !== proj.primaryProvider;
    const testId = `test_${Date.now().toString().slice(-5)}`;
    const fromAddress = `relay@${proj.slug}.mailhub.internal`;
    const messageId = `<${testId}@mailhub.orbitmails.com>`;

    const newActivity: MailHubActivityItem = {
      id: testId,
      timestamp: new Date().toISOString(),
      projectId: proj.id,
      projectName: proj.name,
      fromAddress,
      recipient: sentData.recipient,
      subject: sentData.subject,
      messageId,
      headers: {
        "From": `${proj.name} Test Relay <${fromAddress}>`,
        "To": sentData.recipient,
        "Subject": sentData.subject,
        "Message-ID": messageId,
        "X-Mailer": "Orbitmails MailHub/1.0",
      },
      htmlSnippet: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px; background: #ffffff;">
  <h3 style="margin: 0 0 8px 0; color: #111827; font-size: 16px;">Test Message via ${sentData.provider.toUpperCase()}</h3>
  <p style="margin: 0 0 12px 0; color: #4b5563; font-size: 13px;">This test delivery was transmitted through the Orbitmails MailHub waterfall.</p>
  <div style="background: #f8fafc; padding: 12px; border-radius: 8px; font-family: monospace; font-size: 12px; color: #374151;">Recipient: ${sentData.recipient}<br/>Latency: ${sentData.latencyMs}ms</div>
</div>`,
      textContent: `Test Message via ${sentData.provider.toUpperCase()}\n\nThis test delivery was transmitted through the Orbitmails MailHub waterfall.\nRecipient: ${sentData.recipient}\nLatency: ${sentData.latencyMs}ms`,
      provider: sentData.provider,
      wasFailover: isFailover,
      failoverFrom: isFailover ? proj.primaryProvider : undefined,
      failoverReason: isFailover ? "Test waterfall override" : undefined,
      status: "delivered",
      latencyMs: sentData.latencyMs,
      routeAttempts: [
        {
          provider: sentData.provider,
          status: 200,
          latencyMs: sentData.latencyMs,
          timestamp: new Date().toISOString(),
        },
      ],
    };

    setActivities((prev) => [newActivity, ...prev]);
    setStats((prev) => ({
      ...prev,
      totalSentToday: prev.totalSentToday + 1,
    }));
    setProjects((prev) =>
      prev.map((p) =>
        p.id === proj.id ? { ...p, sentToday: p.sentToday + 1 } : p
      )
    );
  }

  // Handle reset circuit breaker
  function handleResetBreaker(providerId: ProviderId) {
    setProviders((prev) =>
      prev.map((pr) =>
        pr.id === providerId
          ? {
              ...pr,
              consecutiveFailures: 0,
              health: pr.health === "circuit_broken" ? "active" : pr.health,
              lastIncident: null,
            }
          : pr
      )
    );
  }

  // Handle saving quota slices
  function handleSaveSlices(updatedSlices: Record<string, number>) {
    setProjects((prev) =>
      prev.map((p) =>
        updatedSlices[p.id] !== undefined
          ? { ...p, dailyQuotaSlice: updatedSlices[p.id] }
          : p
      )
    );
  }

  return (
    <div className="space-y-8 pb-12">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900 md:text-3xl dark:text-neutral-50">
              MailHub Routing Engine
            </h1>
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-400">
              v1.0 Internal
            </span>
          </div>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Unified multi-provider email infrastructure, quota slicing, and intelligent failover for Aurelia, LifeSolver, Luvio & Ovijatric.
          </p>
        </div>

        {/* Global Quick Action Buttons */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsQuotaModalOpen(true)}
            className="gap-1.5 rounded-xl border-neutral-200 bg-white text-xs font-medium text-neutral-700 shadow-2xs hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
          >
            <Settings2 className="h-3.5 w-3.5 text-neutral-500" />
            Rebalance Slices
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={() => {
              setActiveProjectForTest(projects[0]);
              setIsTestSendOpen(true);
            }}
            className="gap-1.5 rounded-xl bg-blue-600 text-xs font-semibold text-white shadow-xs hover:bg-blue-700"
          >
            <Send className="h-3.5 w-3.5" />
            Trigger Test Email
          </Button>
        </div>
      </div>

      {/* 1. Summary Statistics Cards */}
      <StatsCards stats={stats} />

      {/* 2. Provider Fleets & Daily Limit Ceilings */}
      <ProviderStatusRow
        providers={providers}
        onResetBreaker={handleResetBreaker}
      />

      {/* 3. Projects Usage & Quota Slice Allocations */}
      <ProjectsTable
        projects={projects}
        onOpenTestSend={(project) => {
          setActiveProjectForTest(project);
          setIsTestSendOpen(true);
        }}
        onOpenQuotaModal={() => setIsQuotaModalOpen(true)}
        onFilterProjectLogs={(projectId) => setProjectFilterForLogs(projectId)}
      />

      {/* 4. Live Activity Stream & Diagnostic Waterfall */}
      <ActivityFeed
        activities={activities}
        selectedProjectFilter={projectFilterForLogs}
        onSelectProjectFilter={setProjectFilterForLogs}
        onRefresh={handleRefresh}
      />

      {/* Modals */}
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
    </div>
  );
}
