"use client";

import { useState } from "react";
import { Check, CheckCircle2, Settings2, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { MailHubProject } from "./types";

interface QuotaSliceModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: MailHubProject[];
  onSaveSlices?: (updatedSlices: Record<string, number>) => void;
}

export function QuotaSliceModal({
  isOpen,
  onClose,
  projects,
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

  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!isOpen) return null;

  const totalCapacity = 300; // Brevo free tier pool limit
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

  function handleSave() {
    onSaveSlices?.(slices);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 1200);
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
        className="fixed inset-0 bg-neutral-900/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Dialog Body */}
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
              <Settings2 className="h-4 w-4" />
            </div>
            <div>
              <h3
                id="quota-slice-title"
                className="text-base font-semibold text-neutral-900 dark:text-neutral-100"
              >
                Rebalance Quota Slices
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Allocate shared provider capacity (Brevo 300/day pool) to avoid cross-project lockouts
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-full p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Stacked Visual Bar */}
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-neutral-700 dark:text-neutral-300">
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
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
            {projects.map((p) => {
              const slice = slices[p.id] || 0;
              const widthPct = (slice / totalCapacity) * 100;
              return (
                <div
                  key={p.id}
                  title={`${p.name}: ${slice} (${Math.round(widthPct)}%)`}
                  className={`h-full transition-all duration-300 ${p.brandColor}`}
                  style={{ width: `${widthPct}%` }}
                />
              );
            })}
          </div>
        </div>

        {/* Project Slice Inputs */}
        <div className="mt-5 space-y-3.5">
          {projects.map((p) => {
            const currentSlice = slices[p.id] ?? p.dailyQuotaSlice;
            const pct = Math.round((currentSlice / totalCapacity) * 100);

            return (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-2xl border border-neutral-100 bg-neutral-50/60 p-3 dark:border-neutral-800 dark:bg-neutral-800/40"
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold text-white ${p.brandColor}`}
                  >
                    {p.avatarInitials}
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                      {p.name}
                    </span>
                    <span className="ml-1.5 text-[11px] text-neutral-400">
                      ({pct}% of pool)
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="10"
                    max="200"
                    step="5"
                    value={currentSlice}
                    onChange={(e) =>
                      handleSliceChange(p.id, parseInt(e.target.value, 10))
                    }
                    className="h-1.5 w-28 cursor-pointer accent-blue-600"
                  />
                  <input
                    type="number"
                    min="0"
                    max="500"
                    value={currentSlice}
                    onChange={(e) =>
                      handleSliceChange(p.id, parseInt(e.target.value, 10) || 0)
                    }
                    className="h-8 w-16 rounded-xl border border-neutral-200 bg-white px-2 text-center text-xs font-semibold text-neutral-900 focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  />
                  <span className="text-xs text-neutral-400">/day</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="mt-6 flex items-center justify-end gap-2 border-t border-neutral-100 pt-4 dark:border-neutral-800">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="rounded-xl border-neutral-200 text-xs font-medium dark:border-neutral-700"
          >
            Cancel
          </Button>

          <Button
            variant="default"
            size="sm"
            disabled={isOverAllocated || savedSuccess}
            onClick={handleSave}
            className="gap-1.5 rounded-xl bg-blue-600 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {savedSuccess ? (
              <Check className="h-3.5 w-3.5 text-white" />
            ) : null}
            {savedSuccess ? "Saved Successfully!" : "Save Slice Allocations"}
          </Button>
        </div>
      </div>
    </div>
  );
}
