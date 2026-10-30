import type {
  MailHubActivityItem,
  MailHubProject,
  MailHubProvider,
  MailHubSummaryStats,
} from "./types";

export const INITIAL_PROJECTS: MailHubProject[] = [
  {
    id: "proj_aurelia",
    slug: "aurelia",
    name: "Aurelia",
    description: "Design system & enterprise customer portal",
    apiKey: "om_aur_live_9b83f47e2c90",
    apiKeyPrefix: "om_aur_live_",
    primaryProvider: "brevo",
    fallbackChain: ["resend", "ses", "cloudflare"],
    dailyQuotaSlice: 120,
    sentToday: 114,
    failoverCount: 2,
    status: "warning",
    brandColor: "bg-purple-500",
    avatarInitials: "AU",
    lastSentAt: new Date(Date.now() - 1000 * 42).toISOString(),
  },
  {
    id: "proj_lifesolver",
    slug: "lifesolver",
    name: "LifeSolver",
    description: "Daily goal tracking & life OS automation",
    apiKey: "om_lfs_live_4a18e03b7c21",
    apiKeyPrefix: "om_lfs_live_",
    primaryProvider: "brevo",
    fallbackChain: ["resend", "ses", "cloudflare"],
    dailyQuotaSlice: 80,
    sentToday: 62,
    failoverCount: 0,
    status: "active",
    brandColor: "bg-blue-500",
    avatarInitials: "LS",
    lastSentAt: new Date(Date.now() - 1000 * 180).toISOString(),
  },
  {
    id: "proj_luvio",
    slug: "luvio",
    name: "Luvio",
    description: "AI communication assistant & intimacy journals",
    apiKey: "om_luv_live_7c34d81f9a05",
    apiKeyPrefix: "om_luv_live_",
    primaryProvider: "resend",
    fallbackChain: ["ses", "brevo", "cloudflare"],
    dailyQuotaSlice: 60,
    sentToday: 38,
    failoverCount: 1,
    status: "active",
    brandColor: "bg-pink-500",
    avatarInitials: "LV",
    lastSentAt: new Date(Date.now() - 1000 * 320).toISOString(),
  },
  {
    id: "proj_ovijatric",
    slug: "ovijatric",
    name: "Ovijatric",
    description: "Senior healthcare diagnostics & caregiver alerts",
    apiKey: "om_ovj_live_2e59a60c1d88",
    apiKeyPrefix: "om_ovj_live_",
    primaryProvider: "ses",
    fallbackChain: ["resend", "brevo", "cloudflare"],
    dailyQuotaSlice: 40,
    sentToday: 18,
    failoverCount: 0,
    status: "active",
    brandColor: "bg-teal-500",
    avatarInitials: "OV",
    lastSentAt: new Date(Date.now() - 1000 * 640).toISOString(),
  },
];

export const INITIAL_PROVIDERS: MailHubProvider[] = [
  {
    id: "brevo",
    name: "Brevo",
    tier: "Free Tier (300/day pool)",
    dailyLimit: 300,
    usedToday: 278,
    health: "quota_reached",
    consecutiveFailures: 0,
    maxStrikes: 3,
    lastIncident: "Soft limit 92% reached (Aurelia + LifeSolver shared pool)",
    avgLatencyMs: 245,
    deliveryRatePercent: 99.4,
    brandBg: "bg-blue-600",
    brandFg: "text-white",
  },
  {
    id: "resend",
    name: "Resend",
    tier: "Developer Plan (100/day pool)",
    dailyLimit: 100,
    usedToday: 42,
    health: "active",
    consecutiveFailures: 0,
    maxStrikes: 3,
    lastIncident: null,
    avgLatencyMs: 182,
    deliveryRatePercent: 99.9,
    brandBg: "bg-neutral-900 dark:bg-neutral-100",
    brandFg: "text-white dark:text-neutral-900",
  },
  {
    id: "ses",
    name: "Amazon SES",
    tier: "High-Volume Production (50k/day)",
    dailyLimit: 50000,
    usedToday: 160,
    health: "active",
    consecutiveFailures: 0,
    maxStrikes: 3,
    lastIncident: null,
    avgLatencyMs: 310,
    deliveryRatePercent: 99.95,
    brandBg: "bg-amber-600",
    brandFg: "text-white",
  },
  {
    id: "zepto",
    name: "ZeptoMail",
    tier: "Transactional Credits (10k pool)",
    dailyLimit: 10000,
    usedToday: 6,
    health: "active",
    consecutiveFailures: 0,
    maxStrikes: 3,
    lastIncident: null,
    avgLatencyMs: 198,
    deliveryRatePercent: 99.8,
    brandBg: "bg-indigo-600",
    brandFg: "text-white",
  },
  {
    id: "cloudflare",
    name: "Cloudflare Direct",
    tier: "Worker Email Routing (Unlimited)",
    dailyLimit: 0,
    usedToday: 0,
    health: "active",
    consecutiveFailures: 0,
    maxStrikes: 3,
    lastIncident: null,
    avgLatencyMs: 110,
    deliveryRatePercent: 100.0,
    brandBg: "bg-orange-500",
    brandFg: "text-white",
  },
];

export const INITIAL_SUMMARY: MailHubSummaryStats = {
  totalSentToday: 232,
  sentDeltaPercent: 14.8,
  activeProjectsCount: 4,
  totalProjectsCount: 4,
  healthyProvidersCount: 4,
  totalProvidersCount: 5,
  failoversTriggeredToday: 3,
  overallDeliveryRate: 99.85,
  avgLatencyMs: 218,
};

export const INITIAL_ACTIVITIES: MailHubActivityItem[] = [
  {
    id: "send_89210",
    timestamp: new Date(Date.now() - 1000 * 12).toISOString(),
    projectId: "proj_aurelia",
    projectName: "Aurelia",
    fromAddress: "security@aurelia.design",
    recipient: "alex.mercer@gmail.com",
    subject: "Security Alert: New session from Chrome on macOS",
    messageId: "<aur-sec-89210@mail.aurelia.design>",
    headers: {
      "From": "Aurelia Security <security@aurelia.design>",
      "To": "alex.mercer@gmail.com",
      "Subject": "Security Alert: New session from Chrome on macOS",
      "Message-ID": "<aur-sec-89210@mail.aurelia.design>",
      "X-Mailer": "Orbitmails MailHub/1.0",
      "X-Orbit-Project": "aurelia",
      "List-Unsubscribe": "<https://aurelia.design/security/alerts/opt-out>",
    },
    htmlSnippet: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 16px; background-color: #ffffff;">
  <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
    <div style="width: 40px; height: 40px; border-radius: 10px; background: linear-gradient(135deg, #9333ea, #a855f7); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 18px;">A</div>
    <span style="font-weight: 700; font-size: 16px; color: #111827;">Aurelia Studio</span>
  </div>
  <div style="background-color: #fef2f2; border: 1px solid #fee2e2; border-radius: 12px; padding: 16px; margin-bottom: 20px;">
    <h2 style="font-size: 15px; font-weight: 600; color: #991b1b; margin: 0 0 6px 0;">New Security Sign-in Detected</h2>
    <p style="font-size: 13px; color: #7f1d1d; margin: 0; line-height: 1.5;">We noticed a new login to your Aurelia account from an unrecognized macOS workstation in San Francisco.</p>
  </div>
  <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 24px;">
    <tr><td style="padding: 8px 0; color: #6b7280; width: 130px;">Browser & OS:</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">Google Chrome 129.0 (macOS Sequoia)</td></tr>
    <tr><td style="padding: 8px 0; color: #6b7280;">IP Address:</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">198.51.100.44 (San Francisco, CA)</td></tr>
    <tr><td style="padding: 8px 0; color: #6b7280;">Date & Time:</td><td style="padding: 8px 0; color: #111827; font-weight: 500;">Tuesday, Nov 3, 2026, 06:14 UTC</td></tr>
  </table>
  <div style="margin-bottom: 20px;">
    <a href="https://aurelia.design/account/sessions" style="display: inline-block; background-color: #111827; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 10px; font-weight: 600; font-size: 13px;">Review Active Sessions</a>
  </div>
  <p style="font-size: 11px; color: #9ca3af; margin: 0;">If this was you, you can safely ignore this email. If not, please revoke your active sessions and reset your master API keys immediately.</p>
</div>`,
    textContent: `Aurelia Studio Security Alert

New Security Sign-in Detected:
We noticed a new login to your Aurelia account from an unrecognized macOS workstation in San Francisco.

Details:
- Browser & OS: Google Chrome 129.0 (macOS Sequoia)
- IP Address: 198.51.100.44 (San Francisco, CA)
- Date & Time: Tuesday, Nov 3, 2026, 06:14 UTC

Review active sessions: https://aurelia.design/account/sessions

If this was you, you can safely ignore this email. If not, revoke sessions immediately.`,
    provider: "resend",
    wasFailover: true,
    failoverFrom: "brevo",
    failoverReason: "Brevo project quota exceeded (114/120 slice)",
    status: "delivered",
    latencyMs: 184,
    routeAttempts: [
      {
        provider: "brevo",
        status: 429,
        latencyMs: 45,
        error: "QuotaSliceExceeded: Aurelia slice 120 reached",
        timestamp: new Date(Date.now() - 1000 * 13).toISOString(),
      },
      {
        provider: "resend",
        status: 200,
        latencyMs: 139,
        timestamp: new Date(Date.now() - 1000 * 12).toISOString(),
      },
    ],
  },
  {
    id: "send_89209",
    timestamp: new Date(Date.now() - 1000 * 48).toISOString(),
    projectId: "proj_lifesolver",
    projectName: "LifeSolver",
    fromAddress: "blueprint@lifesolver.io",
    recipient: "sarah.jenkins@outlook.com",
    subject: "Your Daily LifeSolver Blueprint for Tuesday",
    messageId: "<ls-bp-89209@notify.lifesolver.io>",
    headers: {
      "From": "LifeSolver Blueprint <blueprint@lifesolver.io>",
      "To": "sarah.jenkins@outlook.com",
      "Subject": "Your Daily LifeSolver Blueprint for Tuesday",
      "Message-ID": "<ls-bp-89209@notify.lifesolver.io>",
      "X-Mailer": "Orbitmails MailHub/1.0",
      "X-Orbit-Project": "lifesolver",
      "List-Unsubscribe": "<https://lifesolver.io/unsubscribe>",
    },
    htmlSnippet: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 16px; background-color: #ffffff;">
  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
    <div style="display: flex; align-items: center; gap: 10px;">
      <div style="width: 36px; height: 36px; border-radius: 10px; background: #3b82f6; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 16px;">LS</div>
      <span style="font-weight: 700; font-size: 16px; color: #0f172a;">LifeSolver Daily OS</span>
    </div>
    <span style="font-size: 12px; font-weight: 600; color: #2563eb; background-color: #eff6ff; padding: 4px 10px; border-radius: 9999px;">Tuesday Blueprint</span>
  </div>
  <h2 style="font-size: 17px; font-weight: 700; color: #0f172a; margin: 0 0 10px 0;">Good morning, Sarah! Ready to conquer today?</h2>
  <p style="font-size: 13px; color: #475569; line-height: 1.5; margin: 0 0 18px 0;">Here is your synthesized priority schedule generated by the LifeSolver autonomous morning planner.</p>
  <div style="background-color: #f8fafc; border-radius: 12px; padding: 16px; margin-bottom: 20px;">
    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 10px; letter-spacing: 0.5px;">Today's Priority Focus Blocks</div>
    <div style="font-size: 13px; font-weight: 600; color: #1e293b; margin-bottom: 8px;">09:00 AM - 11:30 AM &middot; Architecture Refactoring & Spec Review</div>
    <div style="font-size: 13px; font-weight: 600; color: #1e293b; margin-bottom: 8px;">02:00 PM - 03:30 PM &middot; Client Strategy Presentation</div>
    <div style="font-size: 13px; font-weight: 600; color: #1e293b;">05:00 PM - 05:30 PM &middot; 5km Cardio Run & Recovery</div>
  </div>
  <a href="https://lifesolver.io/app/today" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 10px 22px; border-radius: 10px; font-weight: 600; font-size: 13px;">Launch Today's Focus</a>
</div>`,
    textContent: `LifeSolver Daily OS - Tuesday Blueprint

Good morning, Sarah! Ready to conquer today?
Here is your synthesized priority schedule:

Today's Priority Focus Blocks:
- 09:00 AM - 11:30 AM: Architecture Refactoring & Spec Review
- 02:00 PM - 03:30 PM: Client Strategy Presentation
- 05:00 PM - 05:30 PM: 5km Cardio Run & Recovery

Launch Today's Focus: https://lifesolver.io/app/today`,
    provider: "brevo",
    wasFailover: false,
    status: "delivered",
    latencyMs: 228,
    routeAttempts: [
      {
        provider: "brevo",
        status: 200,
        latencyMs: 228,
        timestamp: new Date(Date.now() - 1000 * 48).toISOString(),
      },
    ],
  },
  {
    id: "send_89208",
    timestamp: new Date(Date.now() - 1000 * 115).toISOString(),
    projectId: "proj_luvio",
    projectName: "Luvio",
    fromAddress: "moments@luvio.app",
    recipient: "elena.rostova@icloud.com",
    subject: "Luvio Moment: You received a thoughtful check-in",
    messageId: "<luv-mom-89208@luvio.app>",
    headers: {
      "From": "Luvio Moments <moments@luvio.app>",
      "To": "elena.rostova@icloud.com",
      "Subject": "Luvio Moment: You received a thoughtful check-in",
      "Message-ID": "<luv-mom-89208@luvio.app>",
      "X-Mailer": "Orbitmails MailHub/1.0",
      "X-Orbit-Project": "luvio",
    },
    htmlSnippet: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; border: 1px solid #fce7f3; border-radius: 16px; background-color: #fffdfd;">
  <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 18px;">
    <div style="width: 36px; height: 36px; border-radius: 10px; background: #ec4899; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 16px;">LV</div>
    <span style="font-weight: 700; font-size: 16px; color: #831843;">Luvio Reflection</span>
  </div>
  <h2 style="font-size: 17px; font-weight: 600; color: #831843; margin: 0 0 10px 0;">Elena, you have a new prompt from Liam</h2>
  <div style="border-left: 3px solid #ec4899; padding-left: 14px; margin: 16px 0; font-style: italic; color: #4c0519; font-size: 14px; line-height: 1.6;">
    "What is one quiet moment from this past weekend that made you smile without saying a word?"
  </div>
  <p style="font-size: 13px; color: #701a75; line-height: 1.5; margin-bottom: 20px;">Take two minutes to reply with a short journal reflection or photo.</p>
  <a href="https://luvio.app/journal/entry/89208" style="display: inline-block; background-color: #db2777; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 10px; font-weight: 600; font-size: 13px;">Write Your Reply</a>
</div>`,
    textContent: `Luvio Reflection

Elena, you have a new prompt from Liam:
"What is one quiet moment from this past weekend that made you smile without saying a word?"

Take two minutes to reply with a short journal reflection or photo:
https://luvio.app/journal/entry/89208`,
    provider: "resend",
    wasFailover: false,
    status: "delivered",
    latencyMs: 172,
    routeAttempts: [
      {
        provider: "resend",
        status: 200,
        latencyMs: 172,
        timestamp: new Date(Date.now() - 1000 * 115).toISOString(),
      },
    ],
  },
  {
    id: "send_89207",
    timestamp: new Date(Date.now() - 1000 * 190).toISOString(),
    projectId: "proj_ovijatric",
    projectName: "Ovijatric",
    fromAddress: "alerts@ovijatric.org",
    recipient: "caregiver.support@ovijatric.org",
    subject: "Care Alert: Daily vitals check-in completed for Patient #402",
    messageId: "<ovj-vital-89207@ovijatric.org>",
    headers: {
      "From": "Ovijatric Diagnostics <alerts@ovijatric.org>",
      "To": "caregiver.support@ovijatric.org",
      "Subject": "Care Alert: Daily vitals check-in completed for Patient #402",
      "Message-ID": "<ovj-vital-89207@ovijatric.org>",
      "X-Mailer": "Orbitmails MailHub/1.0",
      "X-Orbit-Project": "ovijatric",
      "X-Priority": "High",
    },
    htmlSnippet: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; border: 1px solid #ccfbf1; border-radius: 16px; background-color: #ffffff;">
  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px;">
    <div style="display: flex; align-items: center; gap: 10px;">
      <div style="width: 36px; height: 36px; border-radius: 10px; background: #0d9488; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 16px;">OV</div>
      <span style="font-weight: 700; font-size: 16px; color: #115e59;">Ovijatric Eldercare</span>
    </div>
    <span style="font-size: 11px; font-weight: 600; color: #0d9488; background-color: #f0fdfa; border: 1px solid #99f6e4; padding: 3px 8px; border-radius: 9999px;">Patient #402</span>
  </div>
  <h2 style="font-size: 16px; font-weight: 600; color: #134e4a; margin: 0 0 12px 0;">Daily Vitals Telemetry Check-in Complete</h2>
  <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px;">
    <div style="background-color: #f0fdfa; border-radius: 10px; padding: 12px; text-align: center;">
      <div style="font-size: 11px; color: #0d9488; text-transform: uppercase;">Heart Rate</div>
      <div style="font-size: 18px; font-weight: 700; color: #115e59;">72 bpm</div>
    </div>
    <div style="background-color: #f0fdfa; border-radius: 10px; padding: 12px; text-align: center;">
      <div style="font-size: 11px; color: #0d9488; text-transform: uppercase;">Blood Pressure</div>
      <div style="font-size: 18px; font-weight: 700; color: #115e59;">124/82</div>
    </div>
    <div style="background-color: #f0fdfa; border-radius: 10px; padding: 12px; text-align: center;">
      <div style="font-size: 11px; color: #0d9488; text-transform: uppercase;">SpO2</div>
      <div style="font-size: 18px; font-weight: 700; color: #115e59;">98%</div>
    </div>
  </div>
  <p style="font-size: 13px; color: #334155; margin-bottom: 20px; line-height: 1.5;">All physiological parameters remain within normal baseline bounds. Caregiver morning visit logged by Nurse R. Begum.</p>
  <a href="https://ovijatric.org/portal/patients/402" style="display: inline-block; background-color: #0f766e; color: #ffffff; text-decoration: none; padding: 9px 18px; border-radius: 10px; font-weight: 600; font-size: 13px;">View Patient Chart</a>
</div>`,
    textContent: `Ovijatric Eldercare Telemetry Report
Patient #402 - Daily Vitals Check-in Complete

Telemetry:
- Heart Rate: 72 bpm (Normal)
- Blood Pressure: 124/82 mmHg
- Blood Oxygen (SpO2): 98%

Caregiver notes: All vitals within normal parameters. Morning visit logged by Nurse R. Begum.
Chart link: https://ovijatric.org/portal/patients/402`,
    provider: "ses",
    wasFailover: false,
    status: "delivered",
    latencyMs: 295,
    routeAttempts: [
      {
        provider: "ses",
        status: 200,
        latencyMs: 295,
        timestamp: new Date(Date.now() - 1000 * 190).toISOString(),
      },
    ],
  },
  {
    id: "send_89206",
    timestamp: new Date(Date.now() - 1000 * 310).toISOString(),
    projectId: "proj_aurelia",
    projectName: "Aurelia",
    fromAddress: "billing@aurelia.design",
    recipient: "devops@acme-corp.io",
    subject: "Invoice #INV-2026-1102 has been generated",
    messageId: "<aur-inv-89206@billing.aurelia.design>",
    headers: {
      "From": "Aurelia Billing <billing@aurelia.design>",
      "To": "devops@acme-corp.io",
      "Subject": "Invoice #INV-2026-1102 has been generated",
      "Message-ID": "<aur-inv-89206@billing.aurelia.design>",
      "X-Mailer": "Orbitmails MailHub/1.0",
      "X-Orbit-Project": "aurelia",
      "X-Invoice-Number": "INV-2026-1102",
    },
    htmlSnippet: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 16px; background-color: #ffffff;">
  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
    <div style="font-weight: 700; font-size: 18px; color: #111827;">Aurelia Studio</div>
    <span style="font-size: 12px; font-weight: 600; color: #059669; background-color: #ecfdf5; padding: 4px 10px; border-radius: 9999px;">Paid &middot; $297.40</span>
  </div>
  <h2 style="font-size: 16px; font-weight: 600; color: #1f2937; margin: 0 0 6px 0;">Invoice #INV-2026-1102</h2>
  <p style="font-size: 13px; color: #6b7280; margin: 0 0 20px 0;">Thank you for renewing your Aurelia Enterprise Team Seat.</p>
  <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px;">
    <tr style="border-bottom: 1px solid #f3f4f6;"><td style="padding: 10px 0; color: #4b5563;">Aurelia Pro Team (15 seats)</td><td style="padding: 10px 0; text-align: right; font-weight: 600; color: #111827;">$285.00</td></tr>
    <tr style="border-bottom: 1px solid #f3f4f6;"><td style="padding: 10px 0; color: #4b5563;">Private CDN Bandwidth Overage</td><td style="padding: 10px 0; text-align: right; font-weight: 600; color: #111827;">$12.40</td></tr>
    <tr><td style="padding: 12px 0; font-weight: 700; color: #111827;">Total Charged</td><td style="padding: 12px 0; text-align: right; font-weight: 700; color: #111827;">$297.40 USD</td></tr>
  </table>
  <a href="https://aurelia.design/billing/invoices/2026-1102.pdf" style="display: inline-block; background-color: #111827; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 10px; font-weight: 600; font-size: 13px;">Download PDF Receipt</a>
</div>`,
    textContent: `Aurelia Studio Invoice #INV-2026-1102
Billed to: Acme Corp (devops@acme-corp.io)

Items:
- Aurelia Pro Team (15 seats): $285.00
- Private CDN Bandwidth Overage: $12.40
Total Charged: $297.40 USD (Paid via Visa ****4242)

PDF receipt link: https://aurelia.design/billing/invoices/2026-1102.pdf`,
    provider: "resend",
    wasFailover: true,
    failoverFrom: "brevo",
    failoverReason: "Brevo rate limit backoff (HTTP 429)",
    status: "delivered",
    latencyMs: 210,
    routeAttempts: [
      {
        provider: "brevo",
        status: 429,
        latencyMs: 52,
        error: "429 Too Many Requests (Account concurrency peak)",
        timestamp: new Date(Date.now() - 1000 * 311).toISOString(),
      },
      {
        provider: "resend",
        status: 200,
        latencyMs: 158,
        timestamp: new Date(Date.now() - 1000 * 310).toISOString(),
      },
    ],
  },
  {
    id: "send_89205",
    timestamp: new Date(Date.now() - 1000 * 420).toISOString(),
    projectId: "proj_lifesolver",
    projectName: "LifeSolver",
    fromAddress: "celebrate@lifesolver.io",
    recipient: "marcus.k@hey.com",
    subject: "Habit Streak Milestone: 30 days active in LifeSolver!",
    messageId: "<ls-strk-89205@notify.lifesolver.io>",
    headers: {
      "From": "LifeSolver Milestones <celebrate@lifesolver.io>",
      "To": "marcus.k@hey.com",
      "Subject": "Habit Streak Milestone: 30 days active in LifeSolver!",
      "Message-ID": "<ls-strk-89205@notify.lifesolver.io>",
      "X-Mailer": "Orbitmails MailHub/1.0",
      "X-Orbit-Project": "lifesolver",
    },
    htmlSnippet: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; border: 1px solid #fde68a; border-radius: 16px; background-color: #fffbeb;">
  <div style="text-align: center; padding: 12px 0;">
    <div style="font-size: 36px; margin-bottom: 8px;">🔥 30 DAYS</div>
    <h2 style="font-size: 18px; font-weight: 700; color: #92400e; margin: 0 0 6px 0;">Habit Streak Milestone Unlocked!</h2>
    <p style="font-size: 13px; color: #b45309; margin: 0 0 18px 0; line-height: 1.5;">Marcus, you have maintained your daily mindfulness and deep work rhythm for 30 consecutive days.</p>
    <a href="https://lifesolver.io/app/trophy/streak-30" style="display: inline-block; background-color: #d97706; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 10px; font-weight: 600; font-size: 13px;">Claim Golden Flame Badge</a>
  </div>
</div>`,
    textContent: `LifeSolver Milestone: 30-Day Streak!

Marcus, you have maintained your daily mindfulness and deep work rhythm for 30 consecutive days!
Claim your Golden Flame badge: https://lifesolver.io/app/trophy/streak-30`,
    provider: "brevo",
    wasFailover: false,
    status: "delivered",
    latencyMs: 260,
    routeAttempts: [
      {
        provider: "brevo",
        status: 200,
        latencyMs: 260,
        timestamp: new Date(Date.now() - 1000 * 420).toISOString(),
      },
    ],
  },
  {
    id: "send_89204",
    timestamp: new Date(Date.now() - 1000 * 580).toISOString(),
    projectId: "proj_luvio",
    projectName: "Luvio",
    fromAddress: "auth@luvio.app",
    recipient: "chloe.dupont@proton.me",
    subject: "One-Time Login Code: 492-180",
    messageId: "<luv-otp-89204@auth.luvio.app>",
    headers: {
      "From": "Luvio Security <auth@luvio.app>",
      "To": "chloe.dupont@proton.me",
      "Subject": "One-Time Login Code: 492-180",
      "Message-ID": "<luv-otp-89204@auth.luvio.app>",
      "X-Mailer": "Orbitmails MailHub/1.0",
      "X-Orbit-Project": "luvio",
      "X-Security-Level": "High",
    },
    htmlSnippet: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 16px; background-color: #ffffff;">
  <div style="font-weight: 700; font-size: 16px; color: #db2777; margin-bottom: 16px;">Luvio Security Authentication</div>
  <h2 style="font-size: 16px; font-weight: 600; color: #111827; margin: 0 0 10px 0;">Your One-Time Passcode</h2>
  <p style="font-size: 13px; color: #4b5563; margin-bottom: 18px; line-height: 1.5;">Enter the following single-use code to sign into your private Luvio vault. This code expires in 10 minutes.</p>
  <div style="text-align: center; margin: 20px 0; padding: 16px; background-color: #fdf2f8; border-radius: 12px; border: 1px dashed #f472b6;">
    <span style="font-family: ui-monospace, monospace; font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #9d174d;">492-180</span>
  </div>
  <p style="font-size: 11px; color: #9ca3af; margin: 0;">Never share this code with anyone. Luvio support staff will never ask for your authentication token.</p>
</div>`,
    textContent: `Luvio Security Authentication

Your One-Time Passcode: 492-180
This code expires in 10 minutes.

Enter this code into your Luvio app to verify your identity.
Never share this code with anyone.`,
    provider: "ses",
    wasFailover: true,
    failoverFrom: "resend",
    failoverReason: "Resend regional DNS timeout",
    status: "delivered",
    latencyMs: 412,
    routeAttempts: [
      {
        provider: "resend",
        status: 504,
        latencyMs: 120,
        error: "Connection timeout to api.resend.com",
        timestamp: new Date(Date.now() - 1000 * 581).toISOString(),
      },
      {
        provider: "ses",
        status: 200,
        latencyMs: 292,
        timestamp: new Date(Date.now() - 1000 * 580).toISOString(),
      },
    ],
  },
  {
    id: "send_89203",
    timestamp: new Date(Date.now() - 1000 * 720).toISOString(),
    projectId: "proj_ovijatric",
    projectName: "Ovijatric",
    fromAddress: "reports@ovijatric.org",
    recipient: "dr.hassan@hospital-dhaka.bd",
    subject: "Weekly Eldercare Diagnostic Summary Export",
    messageId: "<ovj-rpt-89203@ovijatric.org>",
    headers: {
      "From": "Ovijatric Reports <reports@ovijatric.org>",
      "To": "dr.hassan@hospital-dhaka.bd",
      "Subject": "Weekly Eldercare Diagnostic Summary Export",
      "Message-ID": "<ovj-rpt-89203@ovijatric.org>",
      "X-Mailer": "Orbitmails MailHub/1.0",
      "X-Orbit-Project": "ovijatric",
    },
    htmlSnippet: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
    <span style="font-weight: 700; font-size: 16px; color: #0f766e;">Ovijatric Clinical Intelligence</span>
    <span style="font-size: 11px; font-weight: 600; color: #64748b; background-color: #f1f5f9; padding: 2px 8px; border-radius: 4px;">CONFIDENTIAL</span>
  </div>
  <h2 style="font-size: 16px; font-weight: 600; color: #0f172a; margin: 0 0 10px 0;">Weekly Eldercare Diagnostic Summary Export</h2>
  <p style="font-size: 13px; color: #475569; margin-bottom: 16px; line-height: 1.5;">Dr. Hassan, the weekly geriatric diagnostic aggregation for Ward 4 is ready for clinical review.</p>
  <ul style="font-size: 13px; color: #334155; padding-left: 20px; margin-bottom: 20px; line-height: 1.6;">
    <li>Total monitored patients: 28</li>
    <li>Medication adherence rate: 96.4%</li>
    <li>Critical threshold escalations: 0</li>
  </ul>
  <a href="https://ovijatric.org/secure-exports/ward-4-w44.enc" style="display: inline-block; background-color: #0f766e; color: #ffffff; text-decoration: none; padding: 9px 18px; border-radius: 10px; font-weight: 600; font-size: 13px;">Decrypt & Download Report</a>
</div>`,
    textContent: `Ovijatric Weekly Diagnostic Export - Ward 4
Attn: Dr. Hassan

Highlights:
- Total monitored patients: 28
- Medication adherence rate: 96.4%
- Critical escalations: 0

Secure portal download: https://ovijatric.org/secure-exports/ward-4-w44.enc`,
    provider: "ses",
    wasFailover: false,
    status: "delivered",
    latencyMs: 340,
    routeAttempts: [
      {
        provider: "ses",
        status: 200,
        latencyMs: 340,
        timestamp: new Date(Date.now() - 1000 * 720).toISOString(),
      },
    ],
  },
  {
    id: "send_89202",
    timestamp: new Date(Date.now() - 1000 * 940).toISOString(),
    projectId: "proj_aurelia",
    projectName: "Aurelia",
    fromAddress: "workspace@aurelia.design",
    recipient: "team-invites@lumina-agency.com",
    subject: "You have been invited to collaborate on Aurelia UI Studio",
    messageId: "<aur-invt-89202@aurelia.design>",
    headers: {
      "From": "Aurelia Workspace <workspace@aurelia.design>",
      "To": "team-invites@lumina-agency.com",
      "Subject": "You have been invited to collaborate on Aurelia UI Studio",
      "Message-ID": "<aur-invt-89202@aurelia.design>",
      "X-Mailer": "Orbitmails MailHub/1.0",
      "X-Orbit-Project": "aurelia",
    },
    htmlSnippet: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 16px; background-color: #ffffff;">
  <div style="font-weight: 700; font-size: 16px; color: #9333ea; margin-bottom: 16px;">Aurelia UI Studio</div>
  <h2 style="font-size: 16px; font-weight: 600; color: #111827; margin: 0 0 8px 0;">Collaborate with Lumina Agency</h2>
  <p style="font-size: 13px; color: #4b5563; margin-bottom: 18px; line-height: 1.5;">Sarah Chen has invited your team to join the <strong>Design Systems Core</strong> workspace as an Administrator.</p>
  <a href="https://aurelia.design/join/inv_89202" style="display: inline-block; background-color: #9333ea; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 10px; font-weight: 600; font-size: 13px;">Accept Studio Invitation</a>
</div>`,
    textContent: `Aurelia UI Studio Workspace Invitation

Sarah Chen has invited your team to join the "Design Systems Core" workspace as Administrator.

Accept invitation: https://aurelia.design/join/inv_89202`,
    provider: "brevo",
    wasFailover: false,
    status: "delivered",
    latencyMs: 235,
    routeAttempts: [
      {
        provider: "brevo",
        status: 200,
        latencyMs: 235,
        timestamp: new Date(Date.now() - 1000 * 940).toISOString(),
      },
    ],
  },
  {
    id: "send_89201",
    timestamp: new Date(Date.now() - 1000 * 1200).toISOString(),
    projectId: "proj_lifesolver",
    projectName: "LifeSolver",
    fromAddress: "reminders@lifesolver.io",
    recipient: "dan.r@company.org",
    subject: "Reminder: Weekly Retrospective scheduled for 5:00 PM",
    messageId: "<ls-rem-89201@notify.lifesolver.io>",
    headers: {
      "From": "LifeSolver Schedule <reminders@lifesolver.io>",
      "To": "dan.r@company.org",
      "Subject": "Reminder: Weekly Retrospective scheduled for 5:00 PM",
      "Message-ID": "<ls-rem-89201@notify.lifesolver.io>",
      "X-Mailer": "Orbitmails MailHub/1.0",
      "X-Orbit-Project": "lifesolver",
    },
    htmlSnippet: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 16px; background-color: #ffffff;">
  <div style="font-weight: 700; font-size: 16px; color: #2563eb; margin-bottom: 16px;">LifeSolver OS</div>
  <h2 style="font-size: 16px; font-weight: 600; color: #111827; margin: 0 0 8px 0;">Weekly Retrospective in 30 Minutes</h2>
  <p style="font-size: 13px; color: #4b5563; margin-bottom: 16px; line-height: 1.5;">Scheduled for 5:00 PM today. You have 3 key quarterly goals pending weekly self-evaluation.</p>
  <a href="https://lifesolver.io/app/retro" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 9px 18px; border-radius: 10px; font-weight: 600; font-size: 13px;">Begin Retrospective</a>
</div>`,
    textContent: `LifeSolver Reminder: Weekly Retrospective
Scheduled for 5:00 PM today.

You have 3 key quarterly goals pending weekly self-evaluation.
Begin your evaluation: https://lifesolver.io/app/retro`,
    provider: "brevo",
    wasFailover: false,
    status: "delivered",
    latencyMs: 215,
    routeAttempts: [
      {
        provider: "brevo",
        status: 200,
        latencyMs: 215,
        timestamp: new Date(Date.now() - 1000 * 1200).toISOString(),
      },
    ],
  },
];
