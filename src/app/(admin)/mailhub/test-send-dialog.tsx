"use client";

import { useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  RefreshCw,
  Send,
  X,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { MailHubProject, ProviderId } from "./types";
import { getProviderDisplayName } from "./utils";

interface TestSendDialogProps {
  isOpen: boolean;
  onClose: () => void;
  project: MailHubProject | null;
  onSuccessSend?: (sentData: {
    projectId: string;
    recipient: string;
    subject: string;
    provider: ProviderId;
    latencyMs: number;
  }) => void;
}

export function TestSendDialog({
  isOpen,
  onClose,
  project,
  onSuccessSend,
}: TestSendDialogProps) {
  const [recipient, setRecipient] = useState("developer@orbitmails.internal");
  const [subject, setSubject] = useState("MailHub Test Dispatch: Intelligent Failover Verification");
  const [routingMode, setRoutingMode] = useState<"auto" | ProviderId>("auto");
  const [isSending, setIsSending] = useState(false);
  const [resultTrace, setResultTrace] = useState<{
    success: boolean;
    providerUsed: ProviderId;
    latencyMs: number;
    waterfall: Array<{ provider: string; status: number; message: string }>;
  } | null>(null);

  if (!isOpen || !project) return null;

  async function handleExecuteTest() {
    if (!project) return;
    setIsSending(true);
    setResultTrace(null);

    // Simulate real routing waterfall through the engine
    await new Promise((r) => setTimeout(r, 650));

    let providerUsed: ProviderId = project.primaryProvider;
    let waterfall: Array<{ provider: string; status: number; message: string }> = [];

    if (routingMode === "auto") {
      // If Aurelia slice is saturated (95%), simulate failover to Resend
      if (project.sentToday >= project.dailyQuotaSlice - 5) {
        waterfall.push({
          provider: getProviderDisplayName(project.primaryProvider),
          status: 429,
          message: `Daily project quota reached (${project.sentToday}/${project.dailyQuotaSlice}). Rerouting to fallback.`,
        });
        providerUsed = project.fallbackChain[0] || "resend";
        waterfall.push({
          provider: getProviderDisplayName(providerUsed),
          status: 200,
          message: "Dispatched successfully via fallback provider.",
        });
      } else {
        waterfall.push({
          provider: getProviderDisplayName(project.primaryProvider),
          status: 200,
          message: "Dispatched via primary provider within allocated quota slice.",
        });
      }
    } else {
      providerUsed = routingMode;
      waterfall.push({
        provider: getProviderDisplayName(routingMode),
        status: 200,
        message: "Dispatched via forced provider override.",
      });
    }

    const latency = 168 + Math.floor(Math.random() * 95);
    const trace = {
      success: true,
      providerUsed,
      latencyMs: latency,
      waterfall,
    };

    setResultTrace(trace);
    setIsSending(false);

    onSuccessSend?.({
      projectId: project.id,
      recipient,
      subject,
      provider: providerUsed,
      latencyMs: latency,
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="test-send-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-neutral-900/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Dialog Box */}
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800">
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-xl text-xs font-bold text-white ${project.brandColor}`}
            >
              {project.avatarInitials}
            </div>
            <div>
              <h3
                id="test-send-title"
                className="text-base font-semibold text-neutral-900 dark:text-neutral-100"
              >
                Trigger Test Email ({project.name})
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Test routing rules and multi-provider failover without modifying code
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

        {/* Form Body */}
        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Recipient Address
            </label>
            <input
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="mt-1 h-9 w-full rounded-xl border border-neutral-200 bg-white px-3 text-xs text-neutral-900 focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Subject Line
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 h-9 w-full rounded-xl border border-neutral-200 bg-white px-3 text-xs text-neutral-900 focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Routing Policy
            </label>
            <select
              value={routingMode}
              onChange={(e) =>
                setRoutingMode(e.target.value as "auto" | ProviderId)
              }
              className="mt-1 h-9 w-full rounded-xl border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-800 focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            >
              <option value="auto">
                Automatic Smart Waterfall (Primary + Quota Slice Check + Fallback)
              </option>
              <option value="brevo">Force Brevo</option>
              <option value="resend">Force Resend</option>
              <option value="ses">Force Amazon SES</option>
              <option value="zepto">Force ZeptoMail</option>
              <option value="cloudflare">Force Cloudflare Direct</option>
            </select>
          </div>

          {/* Result Waterfall Trace */}
          {resultTrace && (
            <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/50 p-3.5 text-xs dark:border-emerald-900/50 dark:bg-emerald-950/20">
              <div className="flex items-center justify-between font-semibold text-emerald-800 dark:text-emerald-300">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  Email Dispatched Successfully
                </span>
                <span className="font-mono">{resultTrace.latencyMs}ms</span>
              </div>

              <div className="mt-2 space-y-1.5 border-t border-emerald-200/50 pt-2 text-neutral-700 dark:border-emerald-900/40 dark:text-neutral-300">
                {resultTrace.waterfall.map((step, idx) => (
                  <div key={idx} className="flex items-start gap-1.5">
                    <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                      [{step.provider}]:
                    </span>
                    <span>{step.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div className="mt-6 flex items-center justify-end gap-2 border-t border-neutral-100 pt-4 dark:border-neutral-800">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="rounded-xl border-neutral-200 text-xs font-medium dark:border-neutral-700"
          >
            Close
          </Button>

          <Button
            variant="default"
            size="sm"
            disabled={isSending}
            onClick={handleExecuteTest}
            className="gap-1.5 rounded-xl bg-blue-600 text-xs font-medium text-white hover:bg-blue-700"
          >
            {isSending ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {isSending ? "Routing & Sending..." : "Send Test Now"}
          </Button>
        </div>
      </div>
    </div>
  );
}
