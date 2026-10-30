"use client";

import { Activity, ArrowUp, CheckCircle2, RefreshCw, Send, Server, ShieldAlert, ShieldCheck } from "@/components/icons";
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
      <div className="group relative overflow-hidden rounded-2xl border border-neutral-200/70 bg-white p-5 shadow-xs transition-all duration-200 hover:border-neutral-300 hover:shadow-sm dark:border-neutral-800/80 dark:bg-neutral-900 dark:hover:border-neutral-700">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            Total Sent Today
          </span>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition-transform group-hover:scale-105 dark:bg-blue-950/40 dark:text-blue-400">
            <Send className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-3 flex items-baseline gap-2.5">
          <span className="text-3xl font-bold tracking-tight text-neutral-900 tabular-nums dark:text-neutral-50">
            {stats.totalSentToday.toLocaleString()}
          </span>
          <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-500/20 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
            <ArrowUp className="h-3 w-3" />
            +{stats.sentDeltaPercent}%
          </span>
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
          <span>Avg speed: {stats.avgLatencyMs}ms</span>
          <span className="font-medium text-neutral-700 dark:text-neutral-300">
            {stats.overallDeliveryRate}% delivered
          </span>
        </div>
      </div>

      {/* 2. Active Projects */}
      <div className="group relative overflow-hidden rounded-2xl border border-neutral-200/70 bg-white p-5 shadow-xs transition-all duration-200 hover:border-neutral-300 hover:shadow-sm dark:border-neutral-800/80 dark:bg-neutral-900 dark:hover:border-neutral-700">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            Active Projects
          </span>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-50 text-purple-600 transition-transform group-hover:scale-105 dark:bg-purple-950/40 dark:text-purple-400">
            <Server className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-3xl font-bold tracking-tight text-neutral-900 tabular-nums dark:text-neutral-50">
            {stats.activeProjectsCount}
          </span>
          <span className="text-sm font-medium text-neutral-400 dark:text-neutral-500">
            / {stats.totalProjectsCount} routed
          </span>
        </div>

        <div className="mt-3 flex items-center gap-1.5 border-t border-neutral-100 pt-3 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          <span className="truncate">Aurelia, LifeSolver, Luvio, Ovijatric</span>
        </div>
      </div>

      {/* 3. Provider Health */}
      <div className="group relative overflow-hidden rounded-2xl border border-neutral-200/70 bg-white p-5 shadow-xs transition-all duration-200 hover:border-neutral-300 hover:shadow-sm dark:border-neutral-800/80 dark:bg-neutral-900 dark:hover:border-neutral-700">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            Provider Health
          </span>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 transition-transform group-hover:scale-105 dark:bg-emerald-950/40 dark:text-emerald-400">
            <ShieldCheck className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-3xl font-bold tracking-tight text-neutral-900 tabular-nums dark:text-neutral-50">
            {stats.healthyProvidersCount}
          </span>
          <span className="text-sm font-medium text-neutral-400 dark:text-neutral-500">
            / {stats.totalProvidersCount} healthy
          </span>
          <span className="ml-auto inline-flex items-center rounded-full border border-amber-500/20 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
            1 Quota Alert
          </span>
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
          <span>0 Circuit Breaks</span>
          <span className="text-amber-600 dark:text-amber-400 font-medium">Brevo 92% pool</span>
        </div>
      </div>

      {/* 4. Failovers Triggered */}
      <div className="group relative overflow-hidden rounded-2xl border border-neutral-200/70 bg-white p-5 shadow-xs transition-all duration-200 hover:border-neutral-300 hover:shadow-sm dark:border-neutral-800/80 dark:bg-neutral-900 dark:hover:border-neutral-700">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            Failovers Today
          </span>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600 transition-transform group-hover:scale-105 dark:bg-amber-950/40 dark:text-amber-400">
            <RefreshCw className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-3 flex items-baseline gap-2.5">
          <span className="text-3xl font-bold tracking-tight text-neutral-900 tabular-nums dark:text-neutral-50">
            {stats.failoversTriggeredToday}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
            <CheckCircle2 className="h-3 w-3" />
            100% Resolved
          </span>
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
          <span>Seamless reroute</span>
          <span className="text-neutral-700 dark:text-neutral-300 font-medium">0 emails dropped</span>
        </div>
      </div>
    </section>
  );
}
