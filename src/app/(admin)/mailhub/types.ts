export type ProviderId = "brevo" | "resend" | "ses" | "zepto" | "cloudflare";

export type ProviderHealth = "active" | "circuit_broken" | "quota_reached" | "warning";

export type MailHubProject = {
  id: string;
  slug: string;
  name: string;
  description: string;
  apiKey: string;
  apiKeyPrefix: string;
  primaryProvider: ProviderId;
  fallbackChain: ProviderId[];
  dailyQuotaSlice: number;
  sentToday: number;
  failoverCount: number;
  status: "active" | "warning" | "quota_exceeded" | "paused";
  brandColor: string;
  avatarInitials: string;
  lastSentAt: string | null;
};

export type MailHubProvider = {
  id: ProviderId;
  name: string;
  tier: string;
  dailyLimit: number;
  usedToday: number;
  health: ProviderHealth;
  consecutiveFailures: number;
  maxStrikes: number;
  lastIncident: string | null;
  avgLatencyMs: number;
  deliveryRatePercent: number;
  brandBg: string;
  brandFg: string;
};

export type ActivityStatus = "delivered" | "sent" | "bounced" | "failed";

export type RoutingAttempt = {
  provider: ProviderId;
  status: number;
  latencyMs: number;
  error?: string;
  timestamp: string;
};

export type MailHubActivityItem = {
  id: string;
  timestamp: string;
  projectId: string;
  projectName: string;
  recipient: string;
  fromAddress?: string;
  subject: string;
  messageId?: string;
  htmlSnippet?: string;
  textContent?: string;
  headers?: Record<string, string>;
  provider: ProviderId;
  wasFailover: boolean;
  failoverFrom?: ProviderId;
  failoverReason?: string;
  status: ActivityStatus;
  latencyMs: number;
  routeAttempts: RoutingAttempt[];
};

export type MailHubSummaryStats = {
  totalSentToday: number;
  sentDeltaPercent: number;
  activeProjectsCount: number;
  totalProjectsCount: number;
  healthyProvidersCount: number;
  totalProvidersCount: number;
  failoversTriggeredToday: number;
  overallDeliveryRate: number;
  avgLatencyMs: number;
};
