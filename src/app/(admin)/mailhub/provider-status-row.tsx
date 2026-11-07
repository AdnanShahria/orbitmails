"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Server,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/auth/client";
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
  const [resettingId, setResettingId] = useState<ProviderId | null>(null);
  const [pingFeedback, setPingFeedback] = useState<Record<string, { text: string; isError?: boolean }>>({});

  async function handleResetCircuitBreaker(id: ProviderId) {
    setResettingId(id);
    try {
      const res = await authFetch("/api/admin/mailhub/circuit-breaker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset",
          providerCredId: id,
          providerId: id,
        }),
      });
      if (res.ok) {
        onResetBreaker?.(id);
      }
    } catch (err) {
      console.error("Failed to reset circuit breaker:", err);
    } finally {
      setResettingId(null);
    }
  }

  async function handlePing(id: ProviderId) {
    setPingingId(id);
    try {
      if (onPingProvider) {
        await onPingProvider(id);
        setPingFeedback((prev) => ({
          ...prev,
          [id]: { text: "200 OK" },
        }));
      } else {
        const start = performance.now();
        const res = await authFetch("/api/admin/mailhub/ping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerId: id }),
        });
        const elapsed = Math.round(performance.now() - start);
        const data = (await res.json().catch(() => null)) as any;

        if (res.ok && data?.success) {
          const latency = data.latencyMs ?? elapsed;
          const statusText = data.status || "200 OK";
          setPingFeedback((prev) => ({
            ...prev,
            [id]: { text: `${statusText} (${latency}ms)` },
          }));
        } else {
          setPingFeedback((prev) => ({
            ...prev,
            [id]: { text: data?.error || `Err ${res.status}`, isError: true },
          }));
        }
      }

      setTimeout(() => {
        setPingFeedback((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }, 4000);
    } catch (err: any) {
      setPingFeedback((prev) => ({
        ...prev,
        [id]: { text: err.message || "Timeout", isError: true },
      }));
    } finally {
      setPingingId(null);
    }
  }

  return (
    <div className="space-y-3.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50 tracking-tight">
            Provider Fleets &amp; Quota Pools
          </h2>
          <p className="text-xs text-neutral-600 dark:text-neutral-300">
            Multi-vendor capacity ceilings, active circuit breakers, and account-wide consumption
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs font-medium text-neutral-600 dark:text-neutral-300">
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {providers.map((p) => {
          const quota = getQuotaProgressColor(p.usedToday, p.dailyLimit);
          const healthMeta = getProviderHealthMeta(p.health);
          const isPinging = pingingId === p.id;
          const isResetting = resettingId === p.id;
          const pingResult = pingFeedback[p.id];

          return (
            <div
              key={p.id}
              className="relative flex flex-col justify-between rounded-3xl border border-neutral-200/80 bg-white/90 p-4 shadow-xs transition-all duration-200 hover:border-neutral-300 hover:shadow-md dark:border-neutral-800/80 dark:bg-neutral-900/90 dark:hover:border-neutral-700 backdrop-blur-sm"
            >
              {/* Header: Provider badge & Health pill */}
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${p.brandBg} ${p.brandFg} shadow-xs`}
                    >
                      {p.name.charAt(0)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                        {p.name}
                      </h3>
                      <p className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
                        {p.tier}
                      </p>
                    </div>
                  </div>

                  {/* Health status pill */}
                  <span
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-tight ${healthMeta.badgeClass}`}
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
                          <span className="font-normal text-neutral-500 dark:text-neutral-400">
                            / {p.dailyLimit.toLocaleString()}
                          </span>
                        </>
                      ) : (
                        <span className="font-medium text-neutral-600 dark:text-neutral-300">
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
                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800 border border-neutral-200/60 dark:border-neutral-700/60">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ease-out ${quota.barColor} ${quota.glow}`}
                        style={{
                          width: `${quota.percentage > 0 ? Math.max(2, quota.percentage) : 0}%`,
                        }}
                      />
                    </div>
                  ) : (
                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-emerald-100 dark:bg-emerald-950/40">
                      <div className="h-full w-full rounded-full bg-emerald-500" />
                    </div>
                  )}
                </div>

                {/* Circuit Breaker Strike indicator */}
                <div className="mt-3.5 flex items-center justify-between text-[11px] text-neutral-600 dark:text-neutral-300 font-medium">
                  <span className="flex items-center gap-1">
                    <span>Circuit Breaker:</span>
                  </span>

                  <div className="flex items-center gap-1.5">
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
                              ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.7)]"
                              : "bg-neutral-200 dark:bg-neutral-700"
                          }`}
                        />
                      );
                    })}
                    <span className="ml-1 text-[10px] font-mono font-semibold text-neutral-500 dark:text-neutral-400">
                      {p.consecutiveFailures}/3
                    </span>
                  </div>
                </div>

                {/* Notice / incident if warning */}
                {p.lastIncident && (
                  <div className="mt-2.5 rounded-xl bg-amber-50/90 p-2.5 text-[11px] leading-tight text-amber-900 border border-amber-200/60 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800/40">
                    <p className="line-clamp-2">{p.lastIncident}</p>
                  </div>
                )}
              </div>

              {/* Actions Footer with accessible >=44px touch targets */}
              <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3 dark:border-neutral-800">
                <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                  {pingResult ? (
                    <span
                      className={`font-mono font-semibold ${
                        pingResult.isError
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      {pingResult.text}
                    </span>
                  ) : p.avgLatencyMs > 0 ? (
                    `Avg: ${p.avgLatencyMs}ms`
                  ) : (
                    "Latency: --"
                  )}
                </span>

                <div className="flex items-center gap-1">
                  {p.consecutiveFailures > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isResetting}
                      onClick={() => handleResetCircuitBreaker(p.id)}
                      className="min-h-[44px] px-2.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40 rounded-xl"
                    >
                      {isResetting ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        "Reset"
                      )}
                    </Button>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isPinging}
                    onClick={() => handlePing(p.id)}
                    title={`Ping ${p.name} API endpoint`}
                    className="min-h-[44px] px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800 rounded-xl transition-colors"
                  >
                    {isPinging ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-neutral-500" />
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
