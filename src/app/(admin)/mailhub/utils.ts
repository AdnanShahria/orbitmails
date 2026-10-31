import type { ProviderHealth, ProviderId } from "./types";

export function getQuotaProgressColor(used: number, limit: number) {
  if (limit <= 0) {
    return {
      ratio: 0,
      percentage: 0,
      level: "safe" as const,
      barColor: "bg-emerald-500",
      textColor: "text-emerald-700 dark:text-emerald-400",
      bgSubtle: "bg-emerald-50 dark:bg-emerald-950/30",
      borderSubtle: "border-emerald-200/60 dark:border-emerald-800/40",
      glow: "shadow-[0_0_12px_rgba(16,185,129,0.2)]",
      pillClass: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20",
    };
  }

  const ratio = Math.min(1, Math.max(0, used / limit));
  const percentage = Math.round(ratio * 100);

  if (ratio > 0.9) {
    return {
      ratio,
      percentage,
      level: "danger" as const,
      barColor: "bg-rose-500",
      textColor: "text-rose-700 dark:text-rose-400",
      bgSubtle: "bg-rose-50 dark:bg-rose-950/30",
      borderSubtle: "border-rose-200/60 dark:border-rose-800/40",
      glow: "shadow-[0_0_12px_rgba(244,63,94,0.25)]",
      pillClass: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20",
    };
  }

  if (ratio >= 0.7) {
    return {
      ratio,
      percentage,
      level: "warning" as const,
      barColor: "bg-amber-500",
      textColor: "text-amber-700 dark:text-amber-400",
      bgSubtle: "bg-amber-50 dark:bg-amber-950/30",
      borderSubtle: "border-amber-200/60 dark:border-amber-800/40",
      glow: "shadow-[0_0_12px_rgba(245,158,11,0.2)]",
      pillClass: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20",
    };
  }

  return {
    ratio,
    percentage,
    level: "safe" as const,
    barColor: "bg-emerald-500",
    textColor: "text-emerald-700 dark:text-emerald-400",
    bgSubtle: "bg-emerald-50 dark:bg-emerald-950/30",
    borderSubtle: "border-emerald-200/60 dark:border-emerald-800/40",
    glow: "shadow-[0_0_12px_rgba(16,185,129,0.2)]",
    pillClass: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20",
  };
}

export function getProviderHealthMeta(health: ProviderHealth) {
  switch (health) {
    case "active":
      return {
        label: "Operational",
        dotColor: "bg-emerald-500",
        pulse: true,
        badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200/70 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800/50",
      };
    case "circuit_broken":
      return {
        label: "Circuit Tripped",
        dotColor: "bg-rose-500",
        pulse: true,
        badgeClass: "bg-rose-50 text-rose-700 border-rose-200/70 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800/50",
      };
    case "quota_reached":
      return {
        label: "Quota Saturated",
        dotColor: "bg-amber-500",
        pulse: false,
        badgeClass: "bg-amber-50 text-amber-700 border-amber-200/70 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800/50",
      };
    case "warning":
      return {
        label: "Degraded",
        dotColor: "bg-amber-500",
        pulse: false,
        badgeClass: "bg-amber-50 text-amber-700 border-amber-200/70 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800/50",
      };
  }
}

export function getProviderDisplayName(id: ProviderId): string {
  switch (id) {
    case "brevo":
      return "Brevo";
    case "resend":
      return "Resend";
    case "ses":
      return "Amazon SES";
    case "zepto":
      return "ZeptoMail";
    case "cloudflare":
      return "Cloudflare Email";
  }
}

export function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));

  if (diffInSeconds < 5) return "just now";
  if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays}d ago`;
}

export function formatLatency(ms: number) {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

export function getLatencyBadgeClass(ms: number): string {
  if (ms < 350) {
    return "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
  }
  if (ms < 900) {
    return "bg-amber-50 text-amber-700 border-amber-200/60 dark:bg-amber-950/30 dark:text-amber-400";
  }
  return "bg-rose-50 text-rose-700 border-rose-200/60 dark:bg-rose-950/30 dark:text-rose-400";
}

export function maskApiKey(key: string): string {
  if (!key || key.length < 12) return "••••••••••••";
  const start = key.slice(0, 7);
  const end = key.slice(-4);
  return `${start}••••${end}`;
}
