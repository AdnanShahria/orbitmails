"use client";

import { useState } from "react";
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  MoreVertical,
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
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            Project Quota Slices
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Per-project daily volume allocations, primary routing, and automatic failover metrics
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-neutral-200/70 bg-white shadow-xs dark:border-neutral-800/80 dark:bg-neutral-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-neutral-100 bg-neutral-50/70 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800 dark:bg-neutral-800/40 dark:text-neutral-400">
              <tr>
                <th scope="col" className="px-5 py-3.5">
                  Project
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Today's Usage & Quota Slice
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Primary & Fallback Chain
                </th>
                <th scope="col" className="px-4 py-3.5 text-center">
                  Failovers
                </th>
                <th scope="col" className="px-5 py-3.5 text-right">
                  Quick Actions
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {projects.map((project) => {
                const quota = getQuotaProgressColor(
                  project.sentToday,
                  project.dailyQuotaSlice
                );
                const isKeyCopied = copiedKeyId === project.id;

                return (
                  <tr
                    key={project.id}
                    className="group transition-colors hover:bg-neutral-50/50 dark:hover:bg-neutral-800/30"
                  >
                    {/* 1. Project Info */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-xs font-bold text-white shadow-xs ${project.brandColor}`}
                        >
                          {project.avatarInitials}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                              {project.name}
                            </span>
                            <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-mono text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                              {project.slug}
                            </span>
                          </div>

                          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500">
                            <span className="font-mono text-[11px]">
                              {maskApiKey(project.apiKey)}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopyKey(project)}
                              title="Copy API key"
                              className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                            >
                              {isKeyCopied ? (
                                <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </button>
                            {isKeyCopied && (
                              <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
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
                            <span className="font-normal text-neutral-400 dark:text-neutral-500">
                              / {project.dailyQuotaSlice} daily slice
                            </span>
                          </span>

                          <span
                            className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold tabular-nums ${quota.pillClass}`}
                          >
                            {quota.percentage}%
                          </span>
                        </div>

                        {/* Progress Bar with Apple rounded glow */}
                        <div className="relative h-2 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ease-out ${quota.barColor} ${quota.glow}`}
                            style={{
                              width: `${Math.max(2, quota.percentage)}%`,
                            }}
                          />
                        </div>

                        <div className="flex justify-between text-[10px] text-neutral-400 dark:text-neutral-500">
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
                        <span className="inline-flex items-center rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-semibold text-neutral-800 shadow-2xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                          {getProviderDisplayName(project.primaryProvider)}
                        </span>

                        <span className="text-neutral-300 dark:text-neutral-600">
                          <ArrowRight className="h-3 w-3" />
                        </span>

                        <div className="flex items-center gap-1">
                          {project.fallbackChain.slice(0, 2).map((fb, idx) => (
                            <span
                              key={idx}
                              title={`Fallback tier ${idx + 1}: ${getProviderDisplayName(fb)}`}
                              className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600 dark:bg-neutral-800/80 dark:text-neutral-400"
                            >
                              {getProviderDisplayName(fb)}
                            </span>
                          ))}
                          {project.fallbackChain.length > 2 && (
                            <span className="text-[10px] text-neutral-400">
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
                          title={`${project.failoverCount} automated failovers triggered today without dropping mail`}
                          className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                        >
                          <RefreshCw className="h-3 w-3" />
                          {project.failoverCount} rerouted
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-neutral-400 dark:text-neutral-500">
                          <Check className="h-3 w-3 text-neutral-300 dark:text-neutral-600" />
                          0
                        </span>
                      )}
                    </td>

                    {/* 5. Quick Actions */}
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onOpenTestSend(project)}
                          className="h-8 gap-1.5 rounded-xl border-neutral-200 bg-white text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                        >
                          <Send className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                          <span>Test Send</span>
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onOpenQuotaModal(project)}
                          title="Adjust Quota Allocation Slice"
                          className="h-8 w-8 rounded-xl p-0 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                        >
                          <Settings2 className="h-3.5 w-3.5" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onFilterProjectLogs(project.id)}
                          title="View project send stream"
                          className="h-8 w-8 rounded-xl p-0 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
