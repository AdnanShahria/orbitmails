"use client";

import {
  Activity,
  ArrowUp,
  CheckCircle2,
  RefreshCw,
  Send,
  Server,
  ShieldCheck,
} from "@/components/icons";
import type { MailHubSummaryStats } from "./types";

interface StatsCardsProps {
  stats: MailHubSummaryStats;
}

export function StatsCards({ stats }: StatsCardsProps) {
  return (
    <section
      aria-label="MailHub summary metrics"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {/* 1. Total Sent Today */}
      <div className="group relative overflow-hidden rounded-3xl border border-neutral-200/80 bg-white/90 p-5 shadow-xs transition-all duration-200 hover:border-neutral-300 hover:shadow-md dark:border-neutral-800/80 dark:bg-neutral-900/90 dark:hover:border-neutral-700 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-300">
            Total Sent Today
          </span>
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 transition-transform group-hover:scale-105 dark:bg-blue-950/40 dark:text-blue-400 shadow-2xs">
            <Send className="h-5 w-5" />
          </div>
        </div>

        <div className="mt-3.5 flex items-baseline gap-2.5">
          <span className="text-3xl font-bold tracking-tight text-neutral-900 tabular-nums dark:text-neutral-50">
            {stats.totalSentToday.toLocaleString()}
          </span>
          <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-500/30 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            <ArrowUp className="h-3 w-3" />
            +{stats.sentDeltaPercent}%
          </span>
        </div>

        <div className="mt-3.5 flex items-center justify-between border-t border-neutral-100 pt-3 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-300 font-medium">
          <span>Avg latency: {stats.avgLatencyMs}ms</span>
          <span className="font-semibold text-neutral-800 dark:text-neutral-200">
            {stats.overallDeliveryRate}% delivered
          </span>
        </div>
      </div>

      {/* 2. Active Projects */}
      <div className="group relative overflow-hidden rounded-3xl border border-neutral-200/80 bg-white/90 p-5 shadow-xs transition-all duration-200 hover:border-neutral-300 hover:shadow-md dark:border-neutral-800/80 dark:bg-neutral-900/90 dark:hover:border-neutral-700 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-300">
            Active Projects
          </span>
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-purple-50 text-purple-600 transition-transform group-hover:scale-105 dark:bg-purple-950/40 dark:text-purple-400 shadow-2xs">
            <Server className="h-5 w-5" />
          </div>
        </div>

        <div className="mt-3.5 flex items-baseline gap-2">
          <span className="text-3xl font-bold tracking-tight text-neutral-900 tabular-nums dark:text-neutral-50">
            {stats.activeProjectsCount}
          </span>
          <span className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">
            / {stats.totalProjectsCount} routed
          </span>
        </div>

        <div className="mt-3.5 flex items-center gap-1.5 border-t border-neutral-100 pt-3 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-300 font-medium">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
          <span className="truncate">Multi-tenant quota isolated</span>
        </div>
      </div>

      {/* 3. Provider Health */}
      <div className="group relative overflow-hidden rounded-3xl border border-neutral-200/80 bg-white/90 p-5 shadow-xs transition-all duration-200 hover:border-neutral-300 hover:shadow-md dark:border-neutral-800/80 dark:bg-neutral-900/90 dark:hover:border-neutral-700 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-300">
            Provider Fleet Health
          </span>
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 transition-transform group-hover:scale-105 dark:bg-emerald-950/40 dark:text-emerald-400 shadow-2xs">
            <ShieldCheck className="h-5 w-5" />
          </div>
        </div>

        <div className="mt-3.5 flex items-baseline gap-2">
          <span className="text-3xl font-bold tracking-tight text-neutral-900 tabular-nums dark:text-neutral-50">
            {stats.healthyProvidersCount}
          </span>
          <span className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">
            / {stats.totalProvidersCount} operational
          </span>
        </div>

        <div className="mt-3.5 flex items-center justify-between border-t border-neutral-100 pt-3 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-300 font-medium">
          <span>Active circuit checks</span>
          <span className="text-emerald-700 dark:text-emerald-300 font-semibold">
            All pools active
          </span>
        </div>
      </div>

      {/* 4. Failovers Triggered */}
      <div className="group relative overflow-hidden rounded-3xl border border-neutral-200/80 bg-white/90 p-5 shadow-xs transition-all duration-200 hover:border-neutral-300 hover:shadow-md dark:border-neutral-800/80 dark:bg-neutral-900/90 dark:hover:border-neutral-700 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-300">
            Automated Failovers
          </span>
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 transition-transform group-hover:scale-105 dark:bg-amber-950/40 dark:text-amber-400 shadow-2xs">
            <RefreshCw className="h-5 w-5" />
          </div>
        </div>

        <div className="mt-3.5 flex items-baseline gap-2.5">
          <span className="text-3xl font-bold tracking-tight text-neutral-900 tabular-nums dark:text-neutral-50">
            {stats.failoversTriggeredToday}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckCircle2 className="h-3 w-3" />
            100% Protected
          </span>
        </div>

        <div className="mt-3.5 flex items-center justify-between border-t border-neutral-100 pt-3 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-300 font-medium">
          <span>Waterfall reroutes</span>
          <span className="text-neutral-800 dark:text-neutral-200 font-semibold">
            0 emails dropped
          </span>
        </div>
      </div>
    </section>
  );
}
