"use client";

import { useState } from "react";
import { Check, CheckCircle2, Settings2, ShieldAlert, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/auth/client";
import type { MailHubProject } from "./types";

interface QuotaSliceModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: MailHubProject[];
  providerId?: string;
  providerLimit?: number;
  onSaveSlices?: (updatedSlices: Record<string, number>) => void;
}

export function QuotaSliceModal({
  isOpen,
  onClose,
  projects,
  providerId = "cred_brevo_main",
  providerLimit = 300,
  onSaveSlices,
}: QuotaSliceModalProps) {
  // Slices state initialized from project props
  const [slices, setSlices] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    projects.forEach((p) => {
      map[p.id] = p.dailyQuotaSlice;
    });
    return map;
  });

  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const totalCapacity = providerLimit || 300;
  const currentTotal = Object.values(slices).reduce((sum, val) => sum + val, 0);
  const remaining = totalCapacity - currentTotal;
  const isOverAllocated = remaining < 0;

  function handleSliceChange(projectId: string, newValue: number) {
    const val = Math.max(0, newValue);
    setSlices((prev) => ({
      ...prev,
      [projectId]: val,
    }));
  }

  async function handleSave() {
    setIsSaving(true);
    setErrorMessage(null);

    try {
      const payload = {
        providerId,
        slices: Object.entries(slices).map(([pId, dailySlice]) => ({
          projectId: pId,
          dailySlice,
        })),
      };

      const res = await authFetch("/api/admin/mailhub/allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json().catch(() => null)) as any;

      if (!res.ok || data?.error) {
        setErrorMessage(data?.error || `Failed to save allocations (HTTP ${res.status})`);
        setIsSaving(false);
        return;
      }

      onSaveSlices?.(slices);
      setSavedSuccess(true);
      setTimeout(() => {
        setSavedSuccess(false);
        setIsSaving(false);
        onClose();
      }, 1000);
    } catch (err: any) {
      setErrorMessage(err.message || "Network error while saving quota slices");
      setIsSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quota-slice-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-neutral-900/50 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* Dialog Body */}
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between pb-3.5 border-b border-neutral-100 dark:border-neutral-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200 shadow-2xs">
              <Settings2 className="h-5 w-5" />
            </div>
            <div>
              <h3
                id="quota-slice-title"
                className="text-base font-semibold text-neutral-900 dark:text-neutral-100"
              >
                Rebalance Quota Slices
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Allocate shared provider capacity ({totalCapacity}/day pool) across projects
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Stacked Visual Bar */}
        <div className="mt-5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-neutral-800 dark:text-neutral-200">
              Allocated: {currentTotal} / {totalCapacity} emails/day
            </span>
            <span
              className={`font-semibold ${
                isOverAllocated
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {isOverAllocated
                ? `${Math.abs(remaining)} over limit`
                : `${remaining} unallocated`}
            </span>
          </div>

          {/* Stacked multi-color slice preview */}
          <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-neutral-150 dark:bg-neutral-800 p-0.5">
            {projects.map((p) => {
              const slice = slices[p.id] || 0;
              const widthPct = (slice / totalCapacity) * 100;
              return (
                <div
                  key={p.id}
                  title={`${p.name}: ${slice} (${Math.round(widthPct)}%)`}
                  className={`h-full rounded-sm transition-all duration-300 ${p.brandColor}`}
                  style={{ width: `${widthPct}%` }}
                />
              );
            })}
          </div>
        </div>

        {/* Error message */}
        {errorMessage && (
          <div className="mt-4 rounded-2xl border border-rose-200/80 bg-rose-50/80 p-3 text-xs dark:border-rose-900/60 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Project Slice Inputs */}
        <div className="mt-5 space-y-3 max-h-[280px] overflow-y-auto pr-1">
          {projects.map((p) => {
            const currentSlice = slices[p.id] ?? p.dailyQuotaSlice;
            const pct = Math.round((currentSlice / totalCapacity) * 100);

            return (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-2xl border border-neutral-200/70 bg-neutral-50/70 p-3 dark:border-neutral-800 dark:bg-neutral-800/40"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-xl text-xs font-bold text-white shadow-xs ${p.brandColor}`}
                  >
                    {p.avatarInitials}
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                      {p.name}
                    </span>
                    <span className="ml-1.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                      ({pct}% of pool)
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <input
                    type="range"
                    min="0"
                    max={totalCapacity}
                    step="5"
                    value={currentSlice}
                    onChange={(e) =>
                      handleSliceChange(p.id, parseInt(e.target.value, 10))
                    }
                    className="h-2 w-28 cursor-pointer accent-blue-600"
                  />
                  <input
                    type="number"
                    min="0"
                    max={totalCapacity}
                    value={currentSlice}
                    onChange={(e) =>
                      handleSliceChange(p.id, parseInt(e.target.value, 10) || 0)
                    }
                    className="h-9 w-18 rounded-xl border border-neutral-200 bg-white px-2 text-center text-xs font-semibold text-neutral-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  />
                  <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">/day</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer with accessible >=44px buttons */}
        <div className="mt-6 flex items-center justify-end gap-3 border-t border-neutral-100 pt-4 dark:border-neutral-800">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="min-h-[44px] px-4 rounded-xl border-neutral-200 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            Cancel
          </Button>

          <Button
            variant="default"
            size="sm"
            disabled={isOverAllocated || savedSuccess || isSaving}
            onClick={handleSave}
            className="min-h-[44px] px-5 gap-2 rounded-xl bg-blue-600 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {savedSuccess ? (
              <Check className="h-4 w-4 text-white" />
            ) : isSaving ? (
              <Settings2 className="h-4 w-4 animate-spin" />
            ) : null}
            {savedSuccess
              ? "Saved to MailHub!"
              : isSaving
              ? "Persisting..."
              : "Save Slice Allocations"}
          </Button>
        </div>
      </div>
    </div>
  );
}
