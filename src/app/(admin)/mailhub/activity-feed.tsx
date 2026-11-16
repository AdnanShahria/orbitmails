"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  FileText,
  Mail,
  RefreshCw,
  Route,
  Search,
  ShieldAlert,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { ActivityStatus, MailHubActivityItem } from "./types";
import {
  formatLatency,
  formatTimeAgo,
  getLatencyBadgeClass,
  getProviderDisplayName,
} from "./utils";

interface ActivityFeedProps {
  activities: MailHubActivityItem[];
  projects?: Array<{ id: string; name: string }>;
  selectedProjectFilter?: string | null;
  onSelectProjectFilter?: (projectId: string | null) => void;
  onRefresh?: () => void;
  isStreaming?: boolean;
  onToggleStreaming?: () => void;
}

export function ActivityFeed({
  activities,
  projects = [],
  selectedProjectFilter = null,
  onSelectProjectFilter,
  onRefresh,
  isStreaming = false,
  onToggleStreaming,
}: ActivityFeedProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ActivityStatus>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [drawerTab, setDrawerTab] = useState<"html" | "text" | "waterfall">("html");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  function handleCopy(text: string, key: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
    }
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 1800);
  }

  function handleManualRefresh() {
    setIsRefreshing(true);
    onRefresh?.();
    setTimeout(() => setIsRefreshing(false), 500);
  }

  function handleToggleRow(item: MailHubActivityItem) {
    if (expandedId === item.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(item.id);
    if (item.status === "failed" || item.status === "bounced") {
      setDrawerTab("waterfall");
    } else {
      setDrawerTab("html");
    }
  }

  // Filter activities by project, status, and search query
  const normId = (val: string) =>
    val.toLowerCase().replace(/^proj_/, "").replace(/[^a-z0-9]/g, "");

  const projectScopedActivities = activities.filter((item) => {
    if (
      selectedProjectFilter &&
      item.projectId !== selectedProjectFilter &&
      normId(item.projectId) !== normId(selectedProjectFilter) &&
      normId(item.projectName) !== normId(selectedProjectFilter)
    ) {
      return false;
    }
    return true;
  });

  const failedCount = projectScopedActivities.filter(
    (item) => item.status === "failed" || item.status === "bounced",
  ).length;

  const filteredActivities = projectScopedActivities.filter((item) => {
    if (statusFilter !== "all" && item.status !== statusFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        item.recipient.toLowerCase().includes(q) ||
        item.subject.toLowerCase().includes(q) ||
        item.projectName.toLowerCase().includes(q) ||
        item.provider.toLowerCase().includes(q) ||
        (item.messageId && item.messageId.toLowerCase().includes(q)) ||
        (item.errorMessage && item.errorMessage.toLowerCase().includes(q)) ||
        (item.errorCode && item.errorCode.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div className="space-y-3.5">
      {/* Feed Controls Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 tracking-tight">
              Live Routing &amp; Ingestion Stream
            </h2>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-tight transition-colors ${
                isStreaming
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-500/20 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "bg-neutral-100 text-neutral-600 border border-neutral-300/40 dark:bg-neutral-800 dark:text-neutral-400"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isStreaming ? "animate-pulse bg-emerald-500" : "bg-neutral-400"
                }`}
              />
              {isStreaming ? "Live (5s poll)" : "Stream Paused"}
            </span>

            {failedCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  setStatusFilter((prev) => (prev === "failed" ? "all" : "failed"))
                }
                title="Click to filter failed deliveries and inspect errors"
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors ${
                  statusFilter === "failed"
                    ? "border-rose-600 bg-rose-600 text-white"
                    : "border-rose-500/30 bg-rose-50 text-rose-800 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/70"
                }`}
              >
                <ShieldAlert className="h-3 w-3" />
                {failedCount} Failed
              </button>
            )}
          </div>
          <p className="text-xs text-neutral-600 dark:text-neutral-300">
            Real-time delivery waterfall, failover latency, and root-cause error diagnostics
          </p>
        </div>

        {/* Filters and stream toggles with accessible >=44px touch targets */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              placeholder="Search recipient, subject, error..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="min-h-11 w-52 sm:w-60 rounded-xl border border-neutral-200 bg-white pl-9 pr-3.5 text-xs text-neutral-900 placeholder-neutral-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500 shadow-2xs"
            />
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            aria-label="Filter activity stream by status"
            onChange={(e) =>
              setStatusFilter(e.target.value as "all" | ActivityStatus)
            }
            className="min-h-11 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 shadow-2xs"
          >
            <option value="all">All Statuses</option>
            <option value="failed">Failed Only</option>
            <option value="bounced">Bounced Only</option>
            <option value="sent">Sent</option>
            <option value="delivered">Delivered</option>
          </select>

          {/* Project Filter */}
          <select
            value={selectedProjectFilter ?? ""}
            aria-label="Filter activity stream by project"
            onChange={(e) =>
              onSelectProjectFilter?.(e.target.value === "" ? null : e.target.value)
            }
            className="min-h-11 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 shadow-2xs"
          >
            <option value="">All Projects</option>
            {projects && projects.length > 0
              ? projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))
              : null}
          </select>

          {/* Live stream toggle */}
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleStreaming}
            className="min-h-11 px-3.5 rounded-xl border-neutral-200 text-xs font-semibold text-neutral-800 dark:border-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800 shadow-2xs"
          >
            {isStreaming ? "Pause Stream" : "Resume Stream"}
          </Button>

          {/* Refresh button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleManualRefresh}
            title="Refresh activities"
            className="flex h-11 w-11 items-center justify-center rounded-xl p-0 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200 transition-colors"
          >
            <RefreshCw
              className={`h-4 w-4 ${isRefreshing ? "animate-spin text-blue-600 dark:text-blue-400" : ""}`}
            />
          </Button>
        </div>
      </div>

      {/* Activities Table Container with Apple HIG styling */}
      <div className="overflow-hidden rounded-3xl border border-neutral-200/80 bg-white/90 shadow-xs dark:border-neutral-800/80 dark:bg-neutral-900/90 backdrop-blur-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-195 text-left text-sm">
            <thead className="border-b border-neutral-100 bg-neutral-50/80 text-[11px] font-semibold uppercase tracking-wider text-neutral-600 dark:border-neutral-800 dark:bg-neutral-800/50 dark:text-neutral-300">
              <tr>
                <th scope="col" className="w-12 px-3 py-4 text-center"></th>
                <th scope="col" className="px-4 py-4">
                  Time
                </th>
                <th scope="col" className="px-4 py-4">
                  Project
                </th>
                <th scope="col" className="px-4 py-4">
                  Recipient &amp; Subject
                </th>
                <th scope="col" className="px-4 py-4">
                  Routing &amp; Provider
                </th>
                <th scope="col" className="px-4 py-4 text-center">
                  Status
                </th>
                <th scope="col" className="px-5 py-4 text-right">
                  Latency
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {filteredActivities.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-14 text-center text-xs text-neutral-500 dark:text-neutral-400 font-medium"
                  >
                    No matching email activities found. Send a test email to observe live routing!
                  </td>
                </tr>
              ) : (
                filteredActivities.map((item) => {
                  const isExpanded = expandedId === item.id;
                  const latencyClass = getLatencyBadgeClass(item.latencyMs);
                  const isErrorRow = item.status === "failed" || item.status === "bounced";

                  return (
                    <tr
                      key={item.id}
                      onClick={() => handleToggleRow(item)}
                      className={`cursor-pointer transition-colors ${
                        isExpanded
                          ? "bg-blue-50/40 dark:bg-blue-950/20"
                          : isErrorRow
                          ? "hover:bg-rose-50/40 dark:hover:bg-rose-950/15"
                          : "hover:bg-neutral-50/70 dark:hover:bg-neutral-800/40"
                      }`}
                    >
                      {/* Expand chevron */}
                      <td className="px-3 py-4 text-center text-neutral-400">
                        <div className="flex items-center justify-center min-h-11">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-blue-600 dark:text-blue-400 transition-transform" />
                          ) : (
                            <ChevronRight className="h-4 w-4 transition-transform" />
                          )}
                        </div>
                      </td>

                      {/* Timestamp */}
                      <td className="whitespace-nowrap px-4 py-4 text-xs text-neutral-600 dark:text-neutral-300 font-medium">
                        <span title={new Date(item.timestamp).toLocaleString()}>
                          {formatTimeAgo(item.timestamp)}
                        </span>
                      </td>

                      {/* Project Badge */}
                      <td className="whitespace-nowrap px-4 py-4">
                        <span className="inline-flex items-center rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200 border border-neutral-200/50 dark:border-neutral-700/50">
                          {item.projectName}
                        </span>
                      </td>

                      {/* Recipient, Subject & Inline Error Preview */}
                      <td className="px-4 py-4 max-w-80">
                        <div className="truncate font-semibold text-neutral-900 dark:text-neutral-100 text-xs">
                          {item.recipient}
                        </div>
                        <div className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                          {item.subject}
                        </div>
                        {isErrorRow && item.errorMessage && (
                          <div
                            className="mt-1 flex items-center gap-1 truncate text-[11px] font-medium text-rose-700 dark:text-rose-400"
                            title={item.errorMessage}
                          >
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            <span className="truncate">{item.errorMessage}</span>
                          </div>
                        )}
                      </td>

                      {/* Routing Provider & Failover pill */}
                      <td className="whitespace-nowrap px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-neutral-800 dark:text-neutral-200 text-xs">
                            {getProviderDisplayName(item.provider)}
                          </span>

                          {item.wasFailover && (
                            <span
                              title={`Failover: ${item.failoverReason ?? "Primary exhausted"}`}
                              className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                            >
                              <RefreshCw className="h-2.5 w-2.5" />
                              Failover
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="whitespace-nowrap px-4 py-4 text-center">
                        {item.status === "delivered" && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                            <Check className="h-3 w-3" />
                            Delivered
                          </span>
                        )}
                        {item.status === "sent" && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                            Sent
                          </span>
                        )}
                        {item.status === "bounced" && (
                          <span
                            title={item.errorMessage || "Message bounced"}
                            className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                          >
                            Bounced
                          </span>
                        )}
                        {item.status === "failed" && (
                          <span
                            title={item.errorMessage || "Click row to inspect error"}
                            className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                          >
                            Failed{item.httpStatus ? ` · ${item.httpStatus}` : ""}
                          </span>
                        )}
                      </td>

                      {/* Latency Pill */}
                      <td className="whitespace-nowrap px-5 py-4 text-right">
                        <span
                          className={`inline-block rounded-lg px-2.5 py-1 font-mono text-xs font-semibold tabular-nums ${latencyClass}`}
                        >
                          {formatLatency(item.latencyMs)}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Expanded Drawer Diagnostic & Mail Content Inspector */}
        {expandedId && (
          <div className="border-t border-neutral-200/80 bg-neutral-50/95 p-5 dark:border-neutral-800 dark:bg-neutral-900/95 animate-in fade-in duration-200">
            {(() => {
              const activeItem = activities.find((a) => a.id === expandedId);
              if (!activeItem) return null;

              const isFailure = activeItem.status === "failed" || activeItem.status === "bounced";
              const displayError =
                activeItem.errorMessage ||
                activeItem.routeAttempts?.find((a) => a.error)?.error;

              return (
                <div className="space-y-4">
                  {/* Real Error Root-Cause & Remediation Card */}
                  {(isFailure || displayError) && (
                    <div className="rounded-3xl border border-rose-200/90 bg-rose-50/90 p-5 shadow-xs dark:border-rose-900/60 dark:bg-rose-950/30">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-300">
                            <ShieldAlert className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-bold uppercase tracking-wider text-rose-900 dark:text-rose-200">
                                Root Cause Diagnostics
                              </span>
                              {activeItem.errorCode && (
                                <span className="rounded-md border border-rose-300/80 bg-white/80 px-2 py-0.5 font-mono text-[10px] font-bold text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">
                                  {activeItem.errorCode}
                                </span>
                              )}
                              {activeItem.httpStatus && (
                                <span className="rounded-md bg-rose-200/70 px-2 py-0.5 font-mono text-[10px] font-bold text-rose-900 dark:bg-rose-900/70 dark:text-rose-200">
                                  HTTP {activeItem.httpStatus}
                                </span>
                              )}
                              {activeItem.diagnosticsStage && (
                                <span className="rounded-md bg-neutral-200/70 px-2 py-0.5 font-mono text-[10px] font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                                  stage: {activeItem.diagnosticsStage}
                                </span>
                              )}
                            </div>

                            <pre className="whitespace-pre-wrap wrap-break-word rounded-2xl border border-rose-200/70 bg-white/90 px-3.5 py-2.5 font-mono text-xs leading-relaxed text-rose-900 select-text dark:border-rose-900/50 dark:bg-neutral-950/70 dark:text-rose-200">
                              {displayError || "No detailed error message was recorded for this failure."}
                            </pre>

                            {activeItem.diagnosticHint && (
                              <div className="rounded-2xl border border-amber-200/80 bg-amber-50/90 px-3.5 py-2.5 text-xs leading-relaxed text-amber-950 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-200">
                                <span className="font-bold">How to fix: </span>
                                <span>{activeItem.diagnosticHint}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {displayError && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(displayError, `err-${activeItem.id}`);
                            }}
                            className="min-h-10 shrink-0 gap-1.5 rounded-xl border-rose-200 bg-white/90 px-3 text-xs font-semibold text-rose-800 hover:bg-rose-100 dark:border-rose-800 dark:bg-neutral-900 dark:text-rose-200"
                          >
                            {copiedKey === `err-${activeItem.id}` ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-emerald-600" />
                                <span>Copied Error</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5" />
                                <span>Copy Error</span>
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Apple HIG Mail Content & Recipient Inspector */}
                  <div className="rounded-3xl border border-neutral-200/80 bg-white p-5 shadow-xs dark:border-neutral-800 dark:bg-neutral-850">
                    {/* Top Row: Project Badge, Subject line and Timestamp */}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                            {activeItem.projectName}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                            <Mail className="h-3 w-3" />
                            Mail Content &amp; Inspector
                          </span>
                          <span className="text-xs text-neutral-500 font-medium">
                            &middot; {formatTimeAgo(activeItem.timestamp)}
                          </span>
                        </div>
                        <h3 className="text-sm sm:text-base font-bold text-neutral-900 dark:text-neutral-100">
                          {activeItem.subject}
                        </h3>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-neutral-500 dark:text-neutral-400" title={activeItem.timestamp}>
                          {new Date(activeItem.timestamp).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    {/* Metadata Badges: Sender (From), Recipient (To), Message ID */}
                    <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 border-t border-neutral-100 pt-3.5 dark:border-neutral-800">
                      {/* Sender (From) with Badge & 1-Click Copy */}
                      {(() => {
                        const fromVal = activeItem.fromAddress || "contact@orbitsaas.cloud";
                        return (
                          <div className="flex items-center justify-between rounded-2xl border border-neutral-200/80 bg-neutral-50/90 px-3.5 py-2.5 dark:border-neutral-750 dark:bg-neutral-800/70">
                            <div className="min-w-0 pr-2">
                              <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                                <span>From:</span>
                                <span className="rounded bg-neutral-200/80 px-1 py-0.2 text-[9px] font-semibold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
                                  Sender
                                </span>
                              </div>
                              <div className="truncate font-mono text-xs text-neutral-800 dark:text-neutral-200" title={fromVal}>
                                {fromVal}
                              </div>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopy(fromVal, `from-${activeItem.id}`);
                              }}
                              title="Copy sender email"
                              className="flex h-11 w-11 shrink-0 items-center justify-center p-0 text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 rounded-xl"
                            >
                              {copiedKey === `from-${activeItem.id}` ? (
                                <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        );
                      })()}

                      {/* Recipient (To) with Badge & 1-Click Copy */}
                      <div className="flex items-center justify-between rounded-2xl border border-neutral-200/80 bg-neutral-50/90 px-3.5 py-2.5 dark:border-neutral-750 dark:bg-neutral-800/70">
                        <div className="min-w-0 pr-2">
                          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                            <span>To:</span>
                            <span className="rounded bg-blue-100 px-1 py-0.2 text-[9px] font-semibold text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                              Recipient
                            </span>
                          </div>
                          <div className="truncate font-mono text-xs font-semibold text-neutral-900 dark:text-neutral-100" title={activeItem.recipient}>
                            {activeItem.recipient}
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopy(activeItem.recipient, `to-${activeItem.id}`);
                          }}
                          title="Copy recipient email"
                          className="flex h-11 w-11 shrink-0 items-center justify-center p-0 text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 rounded-xl"
                        >
                          {copiedKey === `to-${activeItem.id}` ? (
                            <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>

                      {/* Message ID with Badge & 1-Click Copy */}
                      {(() => {
                        const msgIdVal = activeItem.messageId || `<${activeItem.id}@mailhub.orbitmails.com>`;
                        return (
                          <div className="flex items-center justify-between rounded-2xl border border-neutral-200/80 bg-neutral-50/90 px-3.5 py-2.5 dark:border-neutral-750 dark:bg-neutral-800/70 sm:col-span-2 lg:col-span-1">
                            <div className="min-w-0 pr-2">
                              <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                                <span>Message-ID:</span>
                                <span className="rounded bg-neutral-200/80 px-1 py-0.2 text-[9px] font-semibold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
                                  RFC 5322
                                </span>
                              </div>
                              <div className="truncate font-mono text-[11px] text-neutral-700 dark:text-neutral-300" title={msgIdVal}>
                                {msgIdVal}
                              </div>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopy(msgIdVal, `msg-${activeItem.id}`);
                              }}
                              title="Copy Message-ID"
                              className="flex h-11 w-11 shrink-0 items-center justify-center p-0 text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 rounded-xl"
                            >
                              {copiedKey === `msg-${activeItem.id}` ? (
                                <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Apple HIG Segmented Control / Interactive Tab Switcher */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200/80 pb-2.5 dark:border-neutral-800">
                    <div className="inline-flex items-center rounded-2xl border border-neutral-200/80 bg-neutral-200/70 p-1 text-xs dark:border-neutral-750 dark:bg-neutral-800/80 backdrop-blur-sm">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDrawerTab("html");
                        }}
                        className={`flex min-h-11 items-center gap-2 rounded-xl px-4 py-2 font-semibold transition-all ${
                          drawerTab === "html"
                            ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-white"
                            : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                        }`}
                      >
                        <Eye className="h-4 w-4" />
                        <span>HTML Preview</span>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDrawerTab("text");
                        }}
                        className={`flex min-h-11 items-center gap-2 rounded-xl px-4 py-2 font-semibold transition-all ${
                          drawerTab === "text"
                            ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-white"
                            : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                        }`}
                      >
                        <FileText className="h-4 w-4" />
                        <span>Text Content</span>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDrawerTab("waterfall");
                        }}
                        className={`flex min-h-11 items-center gap-2 rounded-xl px-4 py-2 font-semibold transition-all ${
                          drawerTab === "waterfall"
                            ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-white"
                            : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                        }`}
                      >
                        <Route className="h-4 w-4" />
                        <span>Diagnostics &amp; Waterfall</span>
                      </button>
                    </div>

                    {/* Quick copy actions depending on active tab */}
                    {drawerTab === "html" && activeItem.htmlSnippet && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy(activeItem.htmlSnippet || "", `html-${activeItem.id}`);
                        }}
                        className="min-h-11 gap-2 px-3.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800 rounded-xl"
                      >
                        {copiedKey === `html-${activeItem.id}` ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                            <span>HTML Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span>Copy Raw HTML</span>
                          </>
                        )}
                      </Button>
                    )}

                    {drawerTab === "text" && (activeItem.textContent || activeItem.subject) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy(activeItem.textContent || activeItem.subject, `txt-${activeItem.id}`);
                        }}
                        className="min-h-11 gap-2 px-3.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800 rounded-xl"
                      >
                        {copiedKey === `txt-${activeItem.id}` ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                            <span>Text Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span>Copy Plain Text</span>
                          </>
                        )}
                      </Button>
                    )}
                  </div>

                  {/* Tab 1: Clean Sandboxed HTML Preview */}
                  {drawerTab === "html" && (
                    <div className="space-y-2">
                      <div className="overflow-hidden rounded-3xl border border-neutral-200/80 bg-neutral-100 p-2 sm:p-3 shadow-inner dark:border-neutral-800 dark:bg-neutral-950">
                        {activeItem.htmlSnippet ? (
                          <iframe
                            title={`Email Preview for ${activeItem.id}`}
                            srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:transparent;color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,sans-serif;}</style></head><body>${activeItem.htmlSnippet}</body></html>`}
                            className="h-80 w-full rounded-2xl border border-neutral-200/60 bg-white shadow-xs dark:border-neutral-800"
                            sandbox="allow-same-origin"
                          />
                        ) : (
                          <div className="flex h-48 flex-col items-center justify-center text-center text-xs text-neutral-500 dark:text-neutral-400">
                            <Mail className="mb-2 h-8 w-8 opacity-40" />
                            <p>No HTML body snippet captured for this message.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Tab 2: Formatted Plain Text Content */}
                  {drawerTab === "text" && (
                    <div className="rounded-3xl border border-neutral-200/80 bg-neutral-950 p-5 font-mono text-xs leading-relaxed text-neutral-100 shadow-inner dark:border-neutral-800 whitespace-pre-wrap select-text">
                      {activeItem.textContent || activeItem.htmlSnippet?.replace(/<[^>]+>/g, "") || (
                        <span className="text-neutral-500">No plain text body payload captured.</span>
                      )}
                    </div>
                  )}

                  {/* Tab 3: Routing Waterfall & Detailed Error Diagnostics */}
                  {drawerTab === "waterfall" && (
                    <div className="rounded-3xl border border-neutral-200/80 bg-white p-5 text-xs dark:border-neutral-800 dark:bg-neutral-850 shadow-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 pb-3 dark:border-neutral-800">
                        <div className="font-semibold text-neutral-900 dark:text-neutral-100">
                          Execution Waterfall &amp; Provider Error Trace
                        </div>
                        <div className="flex items-center gap-3 text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">
                          {activeItem.deliveryId && (
                            <span className="font-mono">ID: {activeItem.deliveryId}</span>
                          )}
                          <span>Total Latency: {formatLatency(activeItem.latencyMs)}</span>
                        </div>
                      </div>

                      <div className="mt-3.5 space-y-2.5">
                        {activeItem.routeAttempts && activeItem.routeAttempts.length > 0 ? (
                          activeItem.routeAttempts.map((attempt, index) => (
                            <div
                              key={index}
                              className="rounded-2xl bg-neutral-50 px-4 py-3 dark:bg-neutral-800/60 border border-neutral-100 dark:border-neutral-800 space-y-2"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-200 text-[11px] font-bold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300">
                                    {index + 1}
                                  </span>
                                  <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                                    {getProviderDisplayName(attempt.provider)}
                                  </span>
                                  {attempt.providerCredId && (
                                    <span className="font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
                                      ({attempt.providerCredId})
                                    </span>
                                  )}
                                  {attempt.code && attempt.code !== "SUCCESS" && (
                                    <span className="rounded bg-rose-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
                                      {attempt.code}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-3">
                                  <span
                                    className={`font-mono font-bold text-[11px] px-2 py-0.5 rounded-md ${
                                      attempt.status === 200
                                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                        : "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                                    }`}
                                  >
                                    HTTP {attempt.status}
                                  </span>
                                  <span className="font-mono text-neutral-500 dark:text-neutral-400">
                                    {attempt.latencyMs}ms
                                  </span>
                                </div>
                              </div>

                              {attempt.error && (
                                <div className="rounded-xl border border-rose-200/70 bg-rose-50/70 px-3 py-2 font-mono text-[11px] text-rose-800 wrap-break-word whitespace-pre-wrap select-text dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
                                  {attempt.error}
                                </div>
                              )}

                              {attempt.rawError && attempt.rawError !== attempt.error && (
                                <div className="rounded-xl bg-neutral-900/95 px-3 py-2 font-mono text-[10px] text-neutral-200 wrap-break-word whitespace-pre-wrap select-text">
                                  Raw: {attempt.rawError}
                                </div>
                              )}

                              {attempt.hint && (
                                <div className="text-[11px] text-amber-800 dark:text-amber-300">
                                  <span className="font-semibold">Hint: </span>
                                  {attempt.hint}
                                </div>
                              )}
                            </div>
                          ))
                        ) : (
                          <div className="flex items-center justify-between rounded-2xl bg-neutral-50 px-3.5 py-2.5 dark:bg-neutral-800/60">
                            <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                              {getProviderDisplayName(activeItem.provider)} (
                              {activeItem.status === "failed" || activeItem.status === "bounced"
                                ? "Delivery Failed"
                                : "Direct Delivery"}
                              )
                            </span>
                            <span
                              className={`font-mono font-bold ${
                                activeItem.status === "failed" || activeItem.status === "bounced"
                                  ? "text-rose-600 dark:text-rose-400"
                                  : "text-emerald-600 dark:text-emerald-400"
                              }`}
                            >
                              {activeItem.status === "failed" || activeItem.status === "bounced"
                                ? `HTTP ${activeItem.httpStatus || 502} (${activeItem.latencyMs}ms)`
                                : `HTTP 200 (${activeItem.latencyMs}ms)`}
                            </span>
                          </div>
                        )}
                      </div>

                      {activeItem.failoverReason && (
                        <div className="mt-3.5 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                          <span className="font-bold">Failover Reason: </span>
                          <span>{activeItem.failoverReason}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
