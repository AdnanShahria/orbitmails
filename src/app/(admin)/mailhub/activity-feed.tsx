"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  Mail,
  RefreshCw,
  Route,
  Search,
  Send,
  ShieldAlert,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { MailHubActivityItem, ProviderId } from "./types";
import {
  formatLatency,
  formatTimeAgo,
  getLatencyBadgeClass,
  getProviderDisplayName,
} from "./utils";

interface ActivityFeedProps {
  activities: MailHubActivityItem[];
  selectedProjectFilter?: string | null;
  onSelectProjectFilter?: (projectId: string | null) => void;
  onRefresh?: () => void;
}

export function ActivityFeed({
  activities,
  selectedProjectFilter = null,
  onSelectProjectFilter,
  onRefresh,
}: ActivityFeedProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isLiveStreaming, setIsLiveStreaming] = useState(true);
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

  // Auto-refresh timer when streaming is active
  useEffect(() => {
    if (!isLiveStreaming) return;
    const interval = setInterval(() => {
      onRefresh?.();
    }, 5000);
    return () => clearInterval(interval);
  }, [isLiveStreaming, onRefresh]);

  function handleManualRefresh() {
    setIsRefreshing(true);
    onRefresh?.();
    setTimeout(() => setIsRefreshing(false), 500);
  }

  // Filter activities by project and search query
  const filteredActivities = activities.filter((item) => {
    if (selectedProjectFilter && item.projectId !== selectedProjectFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        item.recipient.toLowerCase().includes(q) ||
        item.subject.toLowerCase().includes(q) ||
        item.projectName.toLowerCase().includes(q) ||
        item.provider.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-3">
      {/* Feed Controls Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
              Live Routing & Ingestion Stream
            </h2>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                isLiveStreaming
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                  : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isLiveStreaming ? "animate-pulse bg-emerald-500" : "bg-neutral-400"
                }`}
              />
              {isLiveStreaming ? "Live (5s poll)" : "Stream Paused"}
            </span>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Real-time delivery waterfall, failover latency, and bounce tracking
          </p>
        </div>

        {/* Filters and stream toggles */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              placeholder="Search recipient, subject..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-48 rounded-xl border border-neutral-200 bg-white pl-8 pr-3 text-xs text-neutral-800 placeholder-neutral-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:placeholder-neutral-500"
            />
          </div>

          {/* Project Filter */}
          <select
            value={selectedProjectFilter ?? ""}
            aria-label="Filter activity stream by project"
            onChange={(e) =>
              onSelectProjectFilter?.(e.target.value === "" ? null : e.target.value)
            }
            className="h-8 rounded-xl border border-neutral-200 bg-white px-2.5 text-xs font-medium text-neutral-700 focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
          >
            <option value="">All Projects</option>
            <option value="proj_aurelia">Aurelia</option>
            <option value="proj_lifesolver">LifeSolver</option>
            <option value="proj_luvio">Luvio</option>
            <option value="proj_ovijatric">Ovijatric</option>
          </select>

          {/* Live stream toggle */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsLiveStreaming(!isLiveStreaming)}
            className="h-8 rounded-xl border-neutral-200 text-xs font-medium dark:border-neutral-700"
          >
            {isLiveStreaming ? "Pause" : "Resume"}
          </Button>

          {/* Refresh button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleManualRefresh}
            title="Refresh logs"
            className="h-8 w-8 rounded-xl p-0 text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </div>

      {/* Activities Table Container */}
      <div className="overflow-hidden rounded-3xl border border-neutral-200/70 bg-white shadow-xs dark:border-neutral-800/80 dark:bg-neutral-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-neutral-100 bg-neutral-50/70 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800 dark:bg-neutral-800/40 dark:text-neutral-400">
              <tr>
                <th scope="col" className="w-10 px-3 py-3 text-center"></th>
                <th scope="col" className="px-4 py-3">
                  Time
                </th>
                <th scope="col" className="px-4 py-3">
                  Project
                </th>
                <th scope="col" className="px-4 py-3">
                  Recipient & Subject
                </th>
                <th scope="col" className="px-4 py-3">
                  Routing & Provider
                </th>
                <th scope="col" className="px-4 py-3 text-center">
                  Status
                </th>
                <th scope="col" className="px-5 py-3 text-right">
                  Latency
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {filteredActivities.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-10 text-center text-xs text-neutral-400 dark:text-neutral-500"
                  >
                    No matching email activities found.
                  </td>
                </tr>
              ) : (
                filteredActivities.map((item) => {
                  const isExpanded = expandedId === item.id;
                  const latencyClass = getLatencyBadgeClass(item.latencyMs);

                  return (
                    <tr
                      key={item.id}
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      className={`cursor-pointer transition-colors ${
                        isExpanded
                          ? "bg-neutral-50/80 dark:bg-neutral-800/50"
                          : "hover:bg-neutral-50/40 dark:hover:bg-neutral-800/20"
                      }`}
                    >
                      {/* Expand chevron */}
                      <td className="px-3 py-3.5 text-center text-neutral-400">
                        {isExpanded ? (
                          <ChevronDown className="inline h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="inline h-3.5 w-3.5" />
                        )}
                      </td>

                      {/* Timestamp */}
                      <td className="whitespace-nowrap px-4 py-3.5 text-xs text-neutral-500 dark:text-neutral-400">
                        <span title={new Date(item.timestamp).toLocaleString()}>
                          {formatTimeAgo(item.timestamp)}
                        </span>
                      </td>

                      {/* Project Badge */}
                      <td className="whitespace-nowrap px-4 py-3.5">
                        <span className="inline-flex items-center rounded-lg bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                          {item.projectName}
                        </span>
                      </td>

                      {/* Recipient & Subject */}
                      <td className="px-4 py-3.5 max-w-72">
                        <div className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                          {item.recipient}
                        </div>
                        <div className="truncate text-xs text-neutral-400 dark:text-neutral-500">
                          {item.subject}
                        </div>
                      </td>

                      {/* Routing Provider & Failover pill */}
                      <td className="whitespace-nowrap px-4 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-neutral-800 dark:text-neutral-200">
                            {getProviderDisplayName(item.provider)}
                          </span>

                          {item.wasFailover && (
                            <span
                              title={`Failover: ${item.failoverReason ?? "Primary exhausted"}`}
                              className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-50 px-2 py-0.2 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                            >
                              <RefreshCw className="h-2.5 w-2.5" />
                              Failover
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="whitespace-nowrap px-4 py-3.5 text-center">
                        {item.status === "delivered" && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                            <Check className="h-3 w-3" />
                            Delivered
                          </span>
                        )}
                        {item.status === "sent" && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/20 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-400">
                            Sent
                          </span>
                        )}
                        {item.status === "bounced" && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/20 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-400">
                            Bounced
                          </span>
                        )}
                      </td>

                      {/* Latency Pill */}
                      <td className="whitespace-nowrap px-5 py-3.5 text-right">
                        <span
                          className={`inline-block rounded-md px-2 py-0.5 font-mono text-xs font-medium tabular-nums ${latencyClass}`}
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
          <div className="border-t border-neutral-200 bg-neutral-50/90 p-5 dark:border-neutral-800 dark:bg-neutral-900/80">
            {(() => {
              const activeItem = activities.find((a) => a.id === expandedId);
              if (!activeItem) return null;

              return (
                <div className="space-y-4">
                  {/* Apple HIG Mail Content & Recipient Inspector */}
                  <div className="rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-2xs dark:border-neutral-800 dark:bg-neutral-850">
                    {/* Top Row: Project Badge, Subject line and Timestamp */}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                            {activeItem.projectName}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                            <Mail className="h-3 w-3" />
                            Mail Content &amp; Recipient Inspector
                          </span>
                          <span className="text-xs text-neutral-400">
                            &middot; {formatTimeAgo(activeItem.timestamp)}
                          </span>
                        </div>
                        <h3 className="text-sm sm:text-base font-bold text-neutral-900 dark:text-neutral-100">
                          {activeItem.subject}
                        </h3>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-neutral-400" title={activeItem.timestamp}>
                          {new Date(activeItem.timestamp).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    {/* Metadata Badges: Sender (From), Recipient (To), Message ID */}
                    <div className="mt-3.5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                      {/* Sender (From) with Badge & 1-Click Copy */}
                      {(() => {
                        const fromVal = activeItem.fromAddress || `notifications@${activeItem.projectId.replace("proj_", "")}.com`;
                        return (
                          <div className="flex items-center justify-between rounded-xl border border-neutral-200/70 bg-neutral-50/80 px-3 py-2 dark:border-neutral-750 dark:bg-neutral-800/60">
                            <div className="min-w-0 pr-2">
                              <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                                <span>From:</span>
                                <span className="rounded bg-neutral-200/70 px-1 py-0.2 text-[9px] font-medium text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                                  Sender
                                </span>
                              </div>
                              <div className="truncate font-mono text-xs text-neutral-700 dark:text-neutral-200" title={fromVal}>
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
                              className="h-7 w-7 shrink-0 p-0 text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
                            >
                              {copiedKey === `from-${activeItem.id}` ? (
                                <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </div>
                        );
                      })()}

                      {/* Recipient (To) with Badge & 1-Click Copy */}
                      <div className="flex items-center justify-between rounded-xl border border-neutral-200/70 bg-neutral-50/80 px-3 py-2 dark:border-neutral-750 dark:bg-neutral-800/60">
                        <div className="min-w-0 pr-2">
                          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                            <span>To:</span>
                            <span className="rounded bg-blue-100/70 px-1 py-0.2 text-[9px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
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
                          className="h-7 w-7 shrink-0 p-0 text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
                        >
                          {copiedKey === `to-${activeItem.id}` ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>

                      {/* Message ID with Badge & 1-Click Copy */}
                      {(() => {
                        const msgIdVal = activeItem.messageId || `<${activeItem.id}@mailhub.orbitmails.com>`;
                        return (
                          <div className="flex items-center justify-between rounded-xl border border-neutral-200/70 bg-neutral-50/80 px-3 py-2 dark:border-neutral-750 dark:bg-neutral-800/60 sm:col-span-2 lg:col-span-1">
                            <div className="min-w-0 pr-2">
                              <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                                <span>Message-ID:</span>
                                <span className="rounded bg-neutral-200/70 px-1 py-0.2 text-[9px] font-medium text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                                  RFC 5322
                                </span>
                              </div>
                              <div className="truncate font-mono text-[11px] text-neutral-600 dark:text-neutral-400" title={msgIdVal}>
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
                              className="h-7 w-7 shrink-0 p-0 text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
                            >
                              {copiedKey === `msg-${activeItem.id}` ? (
                                <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Apple HIG Segmented Control / Interactive Tab Switcher */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200/80 pb-2 dark:border-neutral-800">
                    <div className="inline-flex items-center rounded-xl border border-neutral-200/80 bg-neutral-200/60 p-1 text-xs dark:border-neutral-750 dark:bg-neutral-800/80 backdrop-blur-sm">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDrawerTab("html");
                        }}
                        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-all ${
                          drawerTab === "html"
                            ? "bg-white text-neutral-900 shadow-2xs font-semibold dark:bg-neutral-700 dark:text-white"
                            : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                        }`}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>HTML Preview</span>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDrawerTab("text");
                        }}
                        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-all ${
                          drawerTab === "text"
                            ? "bg-white text-neutral-900 shadow-2xs font-semibold dark:bg-neutral-700 dark:text-white"
                            : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                        }`}
                      >
                        <FileText className="h-3.5 w-3.5" />
                        <span>Text Content</span>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDrawerTab("waterfall");
                        }}
                        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-all ${
                          drawerTab === "waterfall"
                            ? "bg-white text-neutral-900 shadow-2xs font-semibold dark:bg-neutral-700 dark:text-white"
                            : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                        }`}
                      >
                        <Route className="h-3.5 w-3.5" />
                        <span>Routing Waterfall</span>
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
                        className="h-7 gap-1.5 text-xs text-neutral-600 hover:bg-neutral-200/50 dark:text-neutral-300 dark:hover:bg-neutral-800"
                      >
                        {copiedKey === `html-${activeItem.id}` ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-500" />
                            <span>HTML Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
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
                        className="h-7 gap-1.5 text-xs text-neutral-600 hover:bg-neutral-200/50 dark:text-neutral-300 dark:hover:bg-neutral-800"
                      >
                        {copiedKey === `txt-${activeItem.id}` ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-500" />
                            <span>Text Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            <span>Copy Plain Text</span>
                          </>
                        )}
                      </Button>
                    )}
                  </div>

                  {/* Tab 1: Clean Sandboxed HTML Preview */}
                  {drawerTab === "html" && (
                    <div className="space-y-2">
                      <div className="overflow-hidden rounded-2xl border border-neutral-200/80 bg-neutral-100 p-2 sm:p-3 shadow-inner dark:border-neutral-800 dark:bg-neutral-950">
                        {activeItem.htmlSnippet ? (
                          <iframe
                            title={`Email Preview for ${activeItem.id}`}
                            srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:12px;background:transparent;color-scheme:light;}</style></head><body>${activeItem.htmlSnippet}</body></html>`}
                            className="h-80 w-full rounded-xl border border-neutral-200/60 bg-white shadow-2xs dark:border-neutral-800"
                            sandbox="allow-same-origin"
                          />
                        ) : (
                          <div className="flex h-48 flex-col items-center justify-center text-center text-xs text-neutral-400 dark:text-neutral-500">
                            <Mail className="mb-2 h-8 w-8 opacity-40" />
                            <p>No HTML body snippet captured for this message.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Tab 2: Formatted Plain Text Content */}
                  {drawerTab === "text" && (
                    <div className="rounded-2xl border border-neutral-200/80 bg-neutral-950 p-4 font-mono text-xs leading-relaxed text-neutral-200 shadow-inner dark:border-neutral-800 whitespace-pre-wrap select-text">
                      {activeItem.textContent || activeItem.htmlSnippet?.replace(/<[^>]+>/g, "") || (
                        <span className="text-neutral-500">No plain text body payload captured.</span>
                      )}
                    </div>
                  )}

                  {/* Tab 3: Routing Waterfall & Failover Trace */}
                  {drawerTab === "waterfall" && (
                    <div className="rounded-2xl border border-neutral-200/80 bg-white p-4 text-xs dark:border-neutral-800 dark:bg-neutral-850">
                      <div className="flex items-center justify-between border-b border-neutral-100 pb-2 dark:border-neutral-800">
                        <div className="font-semibold text-neutral-900 dark:text-neutral-100">
                          Watermarked Routing Chain
                        </div>
                        <span className="text-[11px] text-neutral-400">
                          Total Latency: {formatLatency(activeItem.latencyMs)}
                        </span>
                      </div>

                      <div className="mt-3 space-y-2">
                        {activeItem.routeAttempts.map((attempt, index) => (
                          <div
                            key={index}
                            className="flex items-center justify-between rounded-xl bg-neutral-50 px-3 py-2 dark:bg-neutral-800/60"
                          >
                            <div className="flex items-center gap-2">
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-200 text-[10px] font-bold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300">
                                {index + 1}
                              </span>
                              <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                                {getProviderDisplayName(attempt.provider)}
                              </span>
                              {attempt.error && (
                                <span className="text-rose-600 dark:text-rose-400">
                                  — {attempt.error}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-3">
                              <span
                                className={`font-mono font-semibold ${
                                  attempt.status === 200
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-rose-600 dark:text-rose-400"
                                }`}
                              >
                                HTTP {attempt.status}
                              </span>
                              <span className="font-mono text-neutral-400">
                                {attempt.latencyMs}ms
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>

                      {activeItem.failoverReason && (
                        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                          <span className="font-semibold">Failover Trigger: </span>
                          {activeItem.failoverReason}
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
