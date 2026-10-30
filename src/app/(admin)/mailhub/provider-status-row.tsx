"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  MoreVertical,
  RefreshCw,
  Server,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { MailHubProvider, ProviderId } from "./types";
import {
  getProviderHealthMeta,
  getQuotaProgressColor,
} from "./utils";

interface ProviderStatusRowProps {
  providers: MailHubProvider[];
  onResetBreaker?: (providerId: ProviderId) => void;
  onPingProvider?: (providerId: ProviderId) => Promise<void>;
}

export function ProviderStatusRow({
  providers,
  onResetBreaker,
  onPingProvider,
}: ProviderStatusRowProps) {
  const [pingingId, setPingingId] = useState<ProviderId | null>(null);
  const [pingFeedback, setPingFeedback] = useState<Record<string, string>>({});

  async function handlePing(id: ProviderId) {
    setPingingId(id);
    try {
      if (onPingProvider) {
        await onPingProvider(id);
      } else {
        // Simulated responsive ping
        await new Promise((r) => setTimeout(r, 450));
      }
      setPingFeedback((prev) => ({
        ...prev,
        [id]: "200 OK (142ms)",
      }));
      setTimeout(() => {
        setPingFeedback((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }, 3000);
    } finally {
      setPingingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            Provider Fleets & Quota Pools
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Multi-vendor capacity ceilings, active circuit breakers, and account-wide consumption
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            &lt; 70% Safe
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
            70–90% Warning
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-rose-500" />
            &gt; 90% Danger
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
        {providers.map((p) => {
          const quota = getQuotaProgressColor(p.usedToday, p.dailyLimit);
          const healthMeta = getProviderHealthMeta(p.health);
          const isPinging = pingingId === p.id;
          const pingResult = pingFeedback[p.id];

          return (
            <div
              key={p.id}
              className="relative flex flex-col justify-between rounded-2xl border border-neutral-200/70 bg-white p-4 shadow-xs transition-all duration-200 hover:border-neutral-300 hover:shadow-sm dark:border-neutral-800/80 dark:bg-neutral-900 dark:hover:border-neutral-700"
            >
              {/* Header: Provider badge & Health pill */}
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold ${p.brandBg} ${p.brandFg} shadow-xs`}
                    >
                      {p.name.charAt(0)}
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                        {p.name}
                      </h3>
                      <p className="truncate text-[11px] text-neutral-400 dark:text-neutral-500">
                        {p.tier}
                      </p>
                    </div>
                  </div>

                  {/* Health status pill */}
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${healthMeta.badgeClass}`}
                  >
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full ${healthMeta.dotColor} ${
                        healthMeta.pulse ? "animate-pulse" : ""
                      }`}
                    />
                    {healthMeta.label}
                  </span>
                </div>

                {/* Quota Progress Bar */}
                <div className="mt-4 space-y-1.5">
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="font-semibold text-neutral-900 tabular-nums dark:text-neutral-100">
                      {p.dailyLimit > 0 ? (
                        <>
                          {p.usedToday.toLocaleString()}{" "}
                          <span className="font-normal text-neutral-400 dark:text-neutral-500">
                            / {p.dailyLimit.toLocaleString()}
                          </span>
                        </>
                      ) : (
                        <span className="font-normal text-neutral-500 dark:text-neutral-400">
                          Direct worker routing
                        </span>
                      )}
                    </span>
                    {p.dailyLimit > 0 && (
                      <span
                        className={`font-semibold tabular-nums ${quota.textColor}`}
                      >
                        {quota.percentage}%
                      </span>
                    )}
                  </div>

                  {p.dailyLimit > 0 ? (
                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ease-out ${quota.barColor} ${quota.glow}`}
                        style={{ width: `${Math.max(2, quota.percentage)}%` }}
                      />
                    </div>
                  ) : (
                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-emerald-100 dark:bg-emerald-950/40">
                      <div className="h-full w-full rounded-full bg-emerald-500" />
                    </div>
                  )}
                </div>

                {/* Circuit Breaker Strike indicator */}
                <div className="mt-3.5 flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400">
                  <span className="flex items-center gap-1">
                    <span>Circuit Breaker:</span>
                  </span>

                  <div className="flex items-center gap-1">
                    {[1, 2, 3].map((strikeIndex) => {
                      const isStruck = strikeIndex <= p.consecutiveFailures;
                      return (
                        <span
                          key={strikeIndex}
                          title={
                            isStruck
                              ? `Strike ${strikeIndex} of 3 (consecutive failure)`
                              : `Strike slot ${strikeIndex} clear`
                          }
                          className={`inline-block h-2 w-2 rounded-full transition-colors ${
                            isStruck
                              ? "bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.6)]"
                              : "bg-neutral-200 dark:bg-neutral-700"
                          }`}
                        />
                      );
                    })}
                    <span className="ml-1 text-[10px] font-mono font-medium text-neutral-400">
                      {p.consecutiveFailures}/3
                    </span>
                  </div>
                </div>

                {/* Notice / incident if warning */}
                {p.lastIncident && (
                  <div className="mt-2 rounded-lg bg-amber-50/80 p-2 text-[11px] leading-tight text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                    <p className="line-clamp-2">{p.lastIncident}</p>
                  </div>
                )}
              </div>

              {/* Actions Footer */}
              <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-2.5 dark:border-neutral-800">
                <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
                  {pingResult ? (
                    <span className="font-mono text-emerald-600 dark:text-emerald-400">
                      {pingResult}
                    </span>
                  ) : (
                    `Avg: ${p.avgLatencyMs}ms`
                  )}
                </span>

                <div className="flex items-center gap-1">
                  {p.consecutiveFailures > 0 && onResetBreaker && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onResetBreaker(p.id)}
                      className="h-6 px-1.5 text-[11px] text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                    >
                      Reset
                    </Button>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isPinging}
                    onClick={() => handlePing(p.id)}
                    title={`Ping ${p.name} API endpoint`}
                    className="h-6 px-2 text-[11px] font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  >
                    {isPinging ? (
                      <RefreshCw className="h-3 w-3 animate-spin text-neutral-500" />
                    ) : (
                      "Ping"
                    )}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
