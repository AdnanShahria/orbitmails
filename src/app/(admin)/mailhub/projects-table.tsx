"use client";

import { useState } from "react";
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Play,
  RefreshCw,
  Send,
  Settings2,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { MailHubProject, ProviderId } from "./types";
import {
  getProviderDisplayName,
  getQuotaProgressColor,
  maskApiKey,
} from "./utils";

interface ProjectsTableProps {
  projects: MailHubProject[];
  onOpenTestSend: (project: MailHubProject) => void;
  onOpenQuotaModal: (project: MailHubProject) => void;
  onFilterProjectLogs: (projectId: string) => void;
}

export function ProjectsTable({
  projects,
  onOpenTestSend,
  onOpenQuotaModal,
  onFilterProjectLogs,
}: ProjectsTableProps) {
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  async function handleCopyKey(project: MailHubProject) {
    try {
      await navigator.clipboard.writeText(project.apiKey);
      setCopiedKeyId(project.id);
      setTimeout(() => setCopiedKeyId(null), 2000);
    } catch {
      // fallback
    }
  }

  return (
    <div className="space-y-3.5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 tracking-tight">
            Project Quota Slices
          </h2>
          <p className="text-xs text-neutral-600 dark:text-neutral-300">
            Per-project daily volume allocations, primary routing, and automatic failover metrics
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-neutral-200/80 bg-white/90 shadow-xs dark:border-neutral-800/80 dark:bg-neutral-900/90 backdrop-blur-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="border-b border-neutral-100 bg-neutral-50/80 text-[11px] font-semibold uppercase tracking-wider text-neutral-600 dark:border-neutral-800 dark:bg-neutral-800/50 dark:text-neutral-300">
              <tr>
                <th scope="col" className="px-5 py-4">
                  Project
                </th>
                <th scope="col" className="px-4 py-4">
                  Today's Usage &amp; Quota Slice
                </th>
                <th scope="col" className="px-4 py-4">
                  Primary &amp; Fallback Chain
                </th>
                <th scope="col" className="px-4 py-4 text-center">
                  Failovers
                </th>
                <th scope="col" className="px-5 py-4 text-right">
                  Quick Actions
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {projects.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-xs text-neutral-500 dark:text-neutral-400">
                    No active projects registered in MailHub.
                  </td>
                </tr>
              ) : (
                projects.map((project) => {
                  const quota = getQuotaProgressColor(
                    project.sentToday,
                    project.dailyQuotaSlice
                  );
                  const isKeyCopied = copiedKeyId === project.id;

                  return (
                    <tr
                      key={project.id}
                      className="group transition-colors hover:bg-neutral-50/60 dark:hover:bg-neutral-800/40"
                    >
                      {/* 1. Project Info */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xs font-bold text-white shadow-xs ${project.brandColor}`}
                          >
                            {project.avatarInitials}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-neutral-900 dark:text-neutral-100 text-sm">
                                {project.name}
                              </span>
                              <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 border border-neutral-200/50 dark:border-neutral-700/50">
                                {project.slug}
                              </span>
                            </div>

                            <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                              <span className="font-mono text-[11px]">
                                {maskApiKey(project.apiKey)}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleCopyKey(project)}
                                title="Copy API key"
                                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center -m-2 text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors"
                              >
                                {isKeyCopied ? (
                                  <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                              </button>
                              {isKeyCopied && (
                                <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 animate-in fade-in">
                                  Copied!
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* 2. Today's Usage & Progress Bar */}
                      <td className="px-4 py-4 min-w-56">
                        <div className="space-y-1.5">
                          <div className="flex items-baseline justify-between text-xs">
                            <span className="font-semibold text-neutral-900 tabular-nums dark:text-neutral-100">
                              {project.sentToday}{" "}
                              <span className="font-normal text-neutral-500 dark:text-neutral-400">
                                / {project.dailyQuotaSlice} daily slice
                              </span>
                            </span>

                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${quota.pillClass}`}
                            >
                              {quota.percentage}%
                            </span>
                          </div>

                          {/* Progress Bar with Apple rounded glow */}
                          <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-neutral-150 dark:bg-neutral-800">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ease-out ${quota.barColor} ${quota.glow}`}
                              style={{
                                width: `${Math.max(2, quota.percentage)}%`,
                              }}
                            />
                          </div>

                          <div className="flex justify-between text-[11px] text-neutral-500 dark:text-neutral-400 font-medium">
                            <span>
                              {project.dailyQuotaSlice - project.sentToday > 0
                                ? `${project.dailyQuotaSlice - project.sentToday} sends remaining`
                                : "Slice exhausted"}
                            </span>
                            {quota.level === "danger" && (
                              <span className="font-semibold text-rose-600 dark:text-rose-400">
                                Auto-failover active
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* 3. Primary & Fallback Chain */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-1.5">
                          <span className="inline-flex items-center rounded-xl border border-neutral-200/80 bg-neutral-50 px-2.5 py-1 text-xs font-semibold text-neutral-800 shadow-2xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                            {getProviderDisplayName(project.primaryProvider)}
                          </span>

                          <span className="text-neutral-400 dark:text-neutral-600">
                            <ArrowRight className="h-3 w-3" />
                          </span>

                          <div className="flex items-center gap-1">
                            {project.fallbackChain.slice(0, 2).map((fb, idx) => (
                              <span
                                key={idx}
                                title={`Fallback tier ${idx + 1}: ${getProviderDisplayName(fb)}`}
                                className="rounded-lg bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700 dark:bg-neutral-800/80 dark:text-neutral-300 border border-neutral-200/50 dark:border-neutral-700/50"
                              >
                                {getProviderDisplayName(fb)}
                              </span>
                            ))}
                            {project.fallbackChain.length > 2 && (
                              <span className="text-[11px] font-medium text-neutral-500">
                                +{project.fallbackChain.length - 2}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* 4. Failover Count */}
                      <td className="px-4 py-4 text-center">
                        {project.failoverCount > 0 ? (
                          <span
                            title={`${project.failoverCount} automated failovers triggered today`}
                            className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                          >
                            <RefreshCw className="h-3 w-3" />
                            {project.failoverCount} rerouted
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400 font-medium">
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                            0
                          </span>
                        )}
                      </td>

                      {/* 5. Quick Actions with Accessible >=44px Targets */}
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onOpenTestSend(project)}
                            className="min-h-[44px] gap-2 rounded-xl border-neutral-200/90 bg-white px-3.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 shadow-2xs transition-colors"
                          >
                            <Send className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                            <span>Test Send</span>
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onOpenQuotaModal(project)}
                            title="Adjust Quota Allocation Slice"
                            className="flex h-11 w-11 items-center justify-center rounded-xl p-0 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200 transition-colors"
                          >
                            <Settings2 className="h-4 w-4" />
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onFilterProjectLogs(project.id)}
                            title="Filter live activity stream for this project"
                            className="flex h-11 w-11 items-center justify-center rounded-xl p-0 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200 transition-colors"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
