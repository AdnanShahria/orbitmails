"use client";

import { useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  RefreshCw,
  Send,
  ShieldAlert,
  X,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/auth/client";
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
  const [senderAddress, setSenderAddress] = useState("");
  const [routingMode, setRoutingMode] = useState<"auto" | ProviderId>("auto");
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resultTrace, setResultTrace] = useState<{
    success: boolean;
    providerUsed: ProviderId;
    latencyMs: number;
    messageId?: string;
    deliveryId?: string;
    waterfall: Array<{ provider: string; status: number; message?: string; error?: string; latencyMs?: number }>;
  } | null>(null);

  if (!isOpen || !project) return null;

  async function handleExecuteTest() {
    if (!project) return;
    setIsSending(true);
    setErrorMessage(null);
    setResultTrace(null);

    try {
      const res = await authFetch("/api/admin/mailhub/test-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          recipient,
          subject,
          senderAddress: senderAddress.trim() || undefined,
          routingMode: routingMode === "auto" ? undefined : routingMode,
        }),
      });

      const data = (await res.json().catch(() => null)) as any;

      if (!res.ok || !data?.success) {
        const errorText =
          data?.error ||
          data?.result?.waterfall?.find((w: any) => w.status !== 200)?.message ||
          data?.result?.attempts?.find((a: any) => a.code !== "SUCCESS")?.message ||
          `Failed to send test email (HTTP ${res.status})`;
        setErrorMessage(typeof errorText === "string" ? errorText : JSON.stringify(errorText));

        if (data?.result?.waterfall || data?.result?.attempts) {
          const resResult = data.result || {};
          const providerUsed: ProviderId = resResult.providerUsed || project.primaryProvider;
          const waterfall: Array<{ provider: string; status: number; message?: string; error?: string; latencyMs?: number }> =
            resResult.waterfall ||
            resResult.attempts?.map((a: any) => ({
              provider: getProviderDisplayName(a.provider),
              status: a.status || (a.code === "SUCCESS" ? 200 : a.code === "QUOTA_EXCEEDED" ? 429 : 500),
              message: a.message || a.error || "Attempt failed",
              latencyMs: a.latencyMs,
            })) || [];

          setResultTrace({
            success: false,
            providerUsed,
            latencyMs: resResult.latencyMs || 0,
            deliveryId: resResult.deliveryId,
            waterfall,
          });
        }

        setIsSending(false);
        return;
      }

      const resResult = data.result || {};
      const providerUsed: ProviderId = resResult.providerUsed || project.primaryProvider;
      const latencyMs: number = resResult.latencyMs || 150;
      const waterfall: Array<{ provider: string; status: number; message?: string; error?: string; latencyMs?: number }> =
        resResult.waterfall ||
        resResult.attempts?.map((a: any) => ({
          provider: getProviderDisplayName(a.provider),
          status: a.status || 200,
          message: a.status === 200 ? "Dispatched successfully" : a.error || "Attempt failed",
          latencyMs: a.latencyMs,
        })) || [
          {
            provider: getProviderDisplayName(providerUsed),
            status: 200,
            message: "Dispatched via live routing engine.",
            latencyMs,
          },
        ];

      const trace = {
        success: true,
        providerUsed,
        latencyMs,
        messageId: resResult.messageId,
        deliveryId: resResult.deliveryId,
        waterfall,
      };

      setResultTrace(trace);
      setIsSending(false);

      onSuccessSend?.({
        projectId: project.id,
        recipient,
        subject,
        provider: providerUsed,
        latencyMs,
      });
    } catch (err: any) {
      setErrorMessage(err.message || "Network error while triggering test email");
      setIsSending(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="test-send-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop with Apple blur */}
      <div
        className="fixed inset-0 bg-neutral-900/50 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* Dialog Box */}
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between pb-3.5 border-b border-neutral-100 dark:border-neutral-800">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-2xl text-xs font-bold text-white shadow-xs ${project.brandColor}`}
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
                Execute live dispatch and inspect multi-provider waterfall routing
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

        {/* Form Body */}
        <div className="mt-5 space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-300">
                Sender Address (From)
              </label>
              <span className="text-[10px] text-neutral-400">Optional: verified domain or onboarding@resend.dev</span>
            </div>
            <input
              type="email"
              value={senderAddress}
              placeholder="e.g. onboarding@resend.dev or name@yourdomain.com"
              onChange={(e) => setSenderAddress(e.target.value)}
              className="mt-1.5 min-h-[44px] w-full rounded-xl border border-neutral-200 bg-white px-3.5 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-300">
              Recipient Address
            </label>
            <input
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="mt-1.5 min-h-[44px] w-full rounded-xl border border-neutral-200 bg-white px-3.5 text-xs text-neutral-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-300">
              Subject Line
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1.5 min-h-[44px] w-full rounded-xl border border-neutral-200 bg-white px-3.5 text-xs text-neutral-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-300">
              Routing Policy
            </label>
            <select
              value={routingMode}
              onChange={(e) =>
                setRoutingMode(e.target.value as "auto" | ProviderId)
              }
              className="mt-1.5 min-h-[44px] w-full rounded-xl border border-neutral-200 bg-white px-3.5 text-xs font-medium text-neutral-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            >
              <option value="auto">
                Automatic Smart Waterfall (Primary + Quota Slice + Fallback)
              </option>
              <option value="brevo">Force Brevo</option>
              <option value="resend">Force Resend</option>
              <option value="ses">Force Amazon SES</option>
              <option value="zepto">Force ZeptoMail</option>
              <option value="cloudflare">Force Cloudflare Direct</option>
            </select>
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div className="rounded-2xl border border-rose-200/80 bg-rose-50/80 p-3.5 text-xs dark:border-rose-900/60 dark:bg-rose-950/30">
              <div className="flex items-start gap-2 text-rose-800 dark:text-rose-300">
                <ShieldAlert className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
                <div className="min-w-0">
                  <span className="font-semibold">Dispatch Failed: </span>
                  <span>{errorMessage}</span>
                </div>
              </div>
            </div>
          )}

          {/* Live Result Waterfall Trace */}
          {resultTrace && (
            <div className={`rounded-2xl border p-4 text-xs ${
              resultTrace.success
                ? "border-emerald-200/80 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/30"
                : "border-amber-200/80 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/30"
            }`}>
              <div className="flex items-center justify-between font-semibold">
                <span className={`flex items-center gap-2 ${
                  resultTrace.success ? "text-emerald-800 dark:text-emerald-300" : "text-amber-800 dark:text-amber-300"
                }`}>
                  {resultTrace.success ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      Live Dispatch Completed
                    </>
                  ) : (
                    <>
                      <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      Routing Waterfall Traversed
                    </>
                  )}
                </span>
                <span className={`font-mono text-xs px-2 py-0.5 rounded-md ${
                  resultTrace.success
                    ? "bg-emerald-100/70 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200"
                    : "bg-amber-100/70 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200"
                }`}>
                  {resultTrace.latencyMs}ms
                </span>
              </div>

              {resultTrace.messageId && (
                <div className="mt-2 text-[11px] font-mono text-emerald-900/80 dark:text-emerald-300/80 truncate">
                  Message-ID: {resultTrace.messageId}
                </div>
              )}

              <div className={`mt-3 space-y-2 border-t pt-2.5 text-neutral-800 dark:text-neutral-200 ${
                resultTrace.success
                  ? "border-emerald-200/60 dark:border-emerald-900/50"
                  : "border-amber-200/60 dark:border-amber-900/50"
              }`}>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  Live Waterfall Steps:
                </div>
                {resultTrace.waterfall.map((step, idx) => (
                  <div
                    key={idx}
                    className="flex items-start justify-between gap-2 rounded-xl bg-white/70 dark:bg-neutral-800/60 p-2.5 border border-neutral-200/50 dark:border-neutral-700/50"
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                        {step.provider}:
                      </span>{" "}
                      <span className="text-neutral-600 dark:text-neutral-300">
                        {step.message || step.error || "Processed"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`font-mono text-[11px] font-bold px-1.5 py-0.5 rounded ${
                          step.status === 200
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                            : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                        }`}
                      >
                        HTTP {step.status}
                      </span>
                      {step.latencyMs !== undefined && (
                        <span className="font-mono text-[10px] text-neutral-400">
                          {step.latencyMs}ms
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div className="mt-6 flex items-center justify-end gap-3 border-t border-neutral-100 pt-4 dark:border-neutral-800">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="min-h-[44px] px-4 rounded-xl border-neutral-200 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            Close
          </Button>

          <Button
            variant="default"
            size="sm"
            disabled={isSending}
            onClick={handleExecuteTest}
            className="min-h-[44px] px-5 gap-2 rounded-xl bg-blue-600 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {isSending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {isSending ? "Routing & Sending..." : "Send Test Now"}
          </Button>
        </div>
      </div>
    </div>
  );
}
