<div align="center">

<a href="https://orbitsaas.cloud" target="_blank" rel="noopener noreferrer">
  <img src="public/banners/product-of-orbitsaas-badge.png" alt="A Product of OrbitSaaS • Sponsored by OrbitSaaS" width="420" />
</a>

<br /><br />

<img src="public/orbitmails-logo.png" alt="OrbitMails Logo" width="120" height="120" />

# <img src="public/icons/mail.svg" width="32" height="32" valign="middle" /> OrbitMails

**The All-In-One Sovereign Email Platform: High-Throughput Transactional Router + Multi-Brand Webmail Suite**

*Sponsored & Maintained with Sovereign Pride by [OrbitSaaS](https://orbitsaas.cloud)*

*Send up to **1,000 emails/second**, create unlimited custom mailboxes (`abc@yourdomain.com`, `def@yourdomain.com`), stack free tiers across providers automatically, connect unlimited projects with one Cloudflare secret, monitor live telemetry in a single dashboard — and eliminate per-seat fees forever.*

<br />

[![GitHub Stars](https://img.shields.io/badge/GitHub-Star%20Repo-yellow?style=for-the-badge&logo=github)](https://github.com/orbitsaas/orbitmails)
[![GitHub Forks](https://img.shields.io/badge/GitHub-Fork%20Repo-blue?style=for-the-badge&logo=github)](https://github.com/orbitsaas/orbitmails/fork)
[![Community Issues](https://img.shields.io/badge/Community-Open%20Issues-brightgreen?style=for-the-badge&logo=github)](https://github.com/orbitsaas/orbitmails/issues)
[![Throughput](https://img.shields.io/badge/Throughput-1%2C000%20mails%2Fsec-brightgreen?style=for-the-badge)](https://github.com/orbitsaas/orbitmails)
[![Edge Serverless](https://img.shields.io/badge/Runtime-Cloudflare%20Edge%20%2B%20Node-blue?style=for-the-badge&logo=cloudflare)](https://github.com/orbitsaas/orbitmails)
[![Database](https://img.shields.io/badge/Database-D1%20%7C%20Postgres%20%7C%20MySQL-orange?style=for-the-badge)](https://github.com/orbitsaas/orbitmails)
[![API Compatibility](https://img.shields.io/badge/API-Resend%20Drop--in-purple?style=for-the-badge)](https://github.com/orbitsaas/orbitmails)
[![License](https://img.shields.io/badge/License-GNU%20AGPLv3-gray?style=for-the-badge)](LICENSE)

<br />

---

### <img src="public/icons/zap.svg" width="20" height="20" valign="middle" /> Click Below to Automatically Provision Your Sovereign Email Server:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/orbitsaas/orbitmails)

*Clicking the button above provisions your entire serverless stack on Cloudflare in 60 seconds (Worker, D1 Database, R2 Storage, Queues, and Durable Objects). No Linux VPS setup, no Postfix configuration, no headaches.*  
*Prefer Docker, VPS, or self-hosted Node.js? **[See All Deployment Options ➔](#-quickstart-deploy-in-60-seconds)***

---

<br />

> ⭐️ **Love OrbitMails?** If OrbitMails saves your business money or simplifies your developer workflow, please **[star this repository](https://github.com/orbitsaas/orbitmails)**! Every star helps our open-source community grow.

</div>

---

## <img src="public/icons/briefcase.svg" width="22" height="22" valign="middle" /> Part 1: The Business Owner's Problem (Meet Marcus)

Marcus runs three businesses: a marketing agency (`agency.com`), a B2B SaaS (`saasapp.io`), and an e-commerce brand (`shopstore.com`). He doesn't write code — he manages clients, deals, and support. But business email is an expensive, fragmented administrative headache:

1. **Account Switching Chaos**: Managing 3 businesses on Google Workspace or Office 365 requires 3 browser profiles, endless incognito windows, and constant relogging. While Marcus is logged into his agency profile, a **$10,000 enterprise inquiry** sits unseen in `hello@saasapp.io`, and a payment dispute alert languishes in `billing@shopstore.com`. Deals die in unread inboxes simply due to login fatigue.
2. **The Per-Seat Tax ($6 to $18/user/mo)**: Creating standard addresses (`abc@yourdomain.com`, `support@`, `billing@`, or intern accounts) incurs a monthly fee per address. A modest 10-person team across 3 domains costs **$300 to $540+ every month** ($3,600 to $6,480/yr) just for basic email text storage, forcing awkward password-sharing workarounds.
3. **The "Who Replied?" Forwarding Loop**: Forwarding `support@agency.com` to personal inboxes creates confusion — either nobody replies assuming someone else handled it, or two team members send contradictory replies at the same time, harming client trust.
4. **Cross-Brand Reply Mistakes**: Juggling multiple domains in standard email apps leads to sending replies from the wrong "From" address (e.g. replying to an agency lead from `support@shopstore.com`), compromising confidentiality.
5. **Account Suspension & Lockout Risk**: A false-positive spam flag or billing dispute can lock a company out of its workspace overnight with zero human support, holding years of client contracts and communications hostage.

---

## <img src="public/icons/code.svg" width="22" height="22" valign="middle" /> Part 2: The Developer's Problem (Meet Alex)

Alex is the full-stack developer maintaining the email infrastructure across these ventures:

- **Project-1 (E-commerce Store — "ShopWave")**: High-volume store sending **Order Confirmations** and shipping updates via AWS SES. To stay within budget, usage is capped — but the moment the quota caps, checkout orders complete without customers receiving receipts!
- **Website-2 (Portfolio & Agency — "DevStudio")**: Portfolio site with contact forms sending **Lead Inquiries & Gmail Alerts** via Resend (3,000 free/mo). A mid-month traffic spike exhausts the free tier, and incoming inquiries fail silently with no fallback.
- **App-3 (Hobby Project / Blog — "ReadPulse")**: Side project sending **New Feature Alerts** and weekly newsletters via Brevo (300 free/day). Daily limits throttle newsletters with no secondary failover.

Every day, Alex switches between 3 dashboards, deals with uncoordinated limits, and scatters raw AWS, Resend, and Brevo keys across `.env` files and repositories — risking credential leaks.

---

## <img src="public/icons/layers.svg" width="22" height="22" valign="middle" /> OrbitMails: The Complete Solution for Both

OrbitMails bridges the gap between **Human Webmail** and **High-Throughput Developer Transactional Dispatching** into a single, self-hosted sovereign hub.

### <img src="public/icons/briefcase.svg" width="18" height="18" valign="middle" /> For Business Owners & Founders (Solving Marcus's Pain)
- **1 Unified Sovereign Command Center**: Log in once to your own domain. All your businesses, custom domains, and mailboxes appear in a single Apple HIG sidebar. Switch between `ceo@agency.com`, `hello@saasapp.io`, and `billing@shopstore.com` instantly with 1 click — zero login/logout hassle.
- **Unlimited Mailbox Creation ($0 / seat forever)**: Spin up `abc@yourdomain.com`, `def@yourdomain.com`, `ceo@`, `support@`, `billing@`, or 100 contractor accounts without paying a single cent more. No per-seat fees ever.
- **Native Collaborative Shared Inboxes**: Multiple team members access `support@` or `billing@` in real time with shared thread status, avoiding awkward forwarding loops and duplicate replies.
- **Brand Identity Sandboxing**: Replying to an email received at `agency.com` automatically and strictly locks the sender identity to `agency.com`. Zero accidental cross-brand email leaks.
- **100% Data Sovereignty**: All emails, attachments, and customer communication records live in your own private Cloudflare D1 / PostgreSQL database and private R2/S3 storage. Nobody can suspend or cancel your company’s email except you.
- **Complete Productivity Suite**: Integrated event calendar, sovereign cloud drive storage, and public booking scheduling links included for every team member.

### <img src="public/icons/code.svg" width="18" height="18" valign="middle" /> For Developers & Platform Teams (Solving Alex's Pain)
- **Centralized Credential Vault**: Save AWS SES, Resend, and Brevo keys **once** in OrbitMails Hub via Cloudflare Secrets. No client repository ever sees raw provider credentials.
- **1 Scoped Routing Key per Project**: Each client app gets one key (`orb_live_...`). Store it in Cloudflare Secrets or `.env` and start sending.
- **Automatic Free-Tier Stacking**: OrbitMails automatically routes outgoing emails through whichever provider currently has free quota remaining.
- **Zero-Downtime Silent Failover**: If AWS SES rate-limits or fails, OrbitMails instantly diverts traffic to Resend or Brevo in milliseconds with zero dropped messages.
- **Per-Project Blast-Radius Quota Slicing**: A runaway send loop in App-3 cannot drain the email quota of Project-1 or Website-2.
- **Live Observability & Sandboxed HTML Preview**: Inspect every email across all websites in real time — see recipient, subject, provider waterfall route, latency, and rendered HTML body.
- **1,000 Emails/Second Parallel Engine**: Distributed Cloudflare Durable Objects rate coordination with async queue workers.
- **Resend SDK Drop-in Compatibility**: Just point `baseUrl` to OrbitMails and keep using your existing application code.

```
Step 1: Save provider credentials ONCE to OrbitMails Hub (Cloudflare Secrets)
────────────────────────────────────────────────────────────────────────────
  AWS SES key  ─┐
  Resend token ─┼──► 🛰️ OrbitMails Hub  ←── All provider keys live HERE only
  Brevo key    ─┘         │
  (+ more soon)           │  Free-tier stacking: SES + Resend 3k + Brevo 9k/mo FREE
                          │
Step 2: Create one Routing Key per project in OrbitMails Admin
────────────────────────────────────────────────────────────────────────────
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    [Project-1]      [Website-2]      [App-3]
   (E-commerce)      (Portfolio)      (Hobby/Blog)
  orb_live_p1_...  orb_live_w2_...  orb_live_a3_...

Step 3: Save that ONE routing key wherever your project runs
────────────────────────────────────────────────────────────────────────────
  Cloudflare Workers/Pages  →  npx wrangler secret put ORBITMAIL_ROUTING_KEY
  GitHub Actions            →  Settings → Secrets → ORBITMAIL_ROUTING_KEY
  .env file                 →  ORBITMAIL_ROUTING_KEY=orb_live_p1_...
  Railway / Render / Vercel →  Environment variable panel

Step 4: Done. No further setup. Every project sends with zero-downtime fallback.
```

> 💡 **Where does the "62,000 free emails" on AWS SES come from?**  
> Historically, AWS SES offered a famous free tier of 62,000 emails/month when sent from an EC2 instance. In mid-2023, AWS updated its free tier for newer accounts to 3,000 free emails/month for the first 12 months, followed by standard pay-as-you-go pricing ($0.10 per 1,000 emails). Whether you have legacy 62k EC2 credits, 3k first-year credits, or pay $0.10/1k, if you are on a tight budget and cap your usage, sends fail when the limit is reached — unless you have OrbitMails automatically falling back to Resend, Brevo, or Cloudflare native sending!

---

## <img src="public/icons/bar-chart.svg" width="22" height="22" valign="middle" /> Full Track Record & Telemetry for Paid Sending

OrbitMails isn't just for stacking free tiers. If you run **paid email services** (AWS SES, Resend Pro, Brevo, SendGrid, or custom SMTP relays), OrbitMails acts as an enterprise **centralized observability and reliability engine**:

- <img src="public/icons/bar-chart.svg" width="16" height="16" valign="middle" /> **Single-Pane Audit Trail**: Inspect every single email sent across all your apps and client projects in one unified feed.
- <img src="public/icons/mail.svg" width="16" height="16" valign="middle" /> **Recipient & Subject Inspector**: See exactly who received each email, the subject line, and the timestamp down to the millisecond.
- <img src="public/icons/file-text.svg" width="16" height="16" valign="middle" /> **Sandboxed HTML Render Drawer**: Click any email in the log to inspect its rendered HTML in a safe, isolated preview drawer — or copy the monospace plaintext with 1 click.
- <img src="public/icons/repeat.svg" width="16" height="16" valign="middle" /> **Provider Waterfall Diagnostics**: Review the exact routing path taken for each dispatch (e.g. `SES (Attempted: Rate Limited) ➔ Resend (Delivered: 142ms)`).
- <img src="public/icons/dollar-sign.svg" width="16" height="16" valign="middle" /> **Real-Time Cost Tracking**: Live calculation of dollar expenditures and exact savings across providers.
- <img src="public/icons/shield-check.svg" width="16" height="16" valign="middle" /> **Zero-Downtime Circuit Breakers**: If a paid provider experiences an outage, 500 errors, or DNS issues, OrbitMails instantly diverts traffic to your backup provider before your customers notice.

---

## <img src="public/icons/mail.svg" width="22" height="22" valign="middle" /> Unlimited Mailbox Creation: `$0` Per-Seat Forever

Google Workspace and Microsoft 365 charge **$6 to $18 per user, every month**. If you have 10 team members across 3 startups, you're paying **$180–$540 every month** just for basic mailboxes.

**OrbitMails eliminates per-seat fees entirely:**

- <img src="public/icons/mail.svg" width="16" height="16" valign="middle" /> **Unlimited Email Addresses**: Create `abc@yourdomain.com`, `def@yourdomain.com`, `ceo@yourdomain.com`, `support@yourdomain.com`, `billing@yourdomain.com` without paying a single cent more.
- <img src="public/icons/globe.svg" width="16" height="16" valign="middle" /> **Multi-Domain Hosting on 1 Hub**: Run email for `domain-one.com`, `clientapp.io`, and `mysaas.co` all inside a single deployment.
- <img src="public/icons/users.svg" width="16" height="16" valign="middle" /> **Shared Mailboxes & Aliases**: Create unlimited catch-all aliases and team inboxes (`support@`) that multiple team members can view and reply from.
- <img src="public/icons/cpu.svg" width="16" height="16" valign="middle" /> **Modern Apple HIG Webmail**: Fast, keyboard-first inbox with thread views, search, folder management, and 34 language translations.
- <img src="public/icons/calendar.svg" width="16" height="16" valign="middle" /> **Integrated Suite**: Built-in event calendar, R2/S3 cloud drive file storage, and public booking scheduling links.

---

## <img src="public/icons/cloud.svg" width="22" height="22" valign="middle" /> The Easiest Hosting System on Earth: Cloudflare Serverless Edge

Hosting a traditional mail server (Postfix, Dovecot, Roundcube) requires managing Linux VPS servers, configuring complex config files, updating SSL certificates, preventing spam blocklists, and keeping daemons running 24/7.

**OrbitMails runs 100% serverless on Cloudflare:**

- <img src="public/icons/rocket.svg" width="16" height="16" valign="middle" /> **1-Click Auto-Provisioning**: Click the "Deploy to Cloudflare" button. Cloudflare automatically provisions the Worker, D1 database, R2 storage bucket, queues, and Durable Objects in your account within 60 seconds.
- <img src="public/icons/globe.svg" width="16" height="16" valign="middle" /> **Global Edge Speed**: Code executes within 50 milliseconds of your users, distributed across 300+ Cloudflare edge data centers worldwide.
- <img src="public/icons/server.svg" width="16" height="16" valign="middle" /> **Zero Server Maintenance**: No Linux OS updates, no VPS security patching, no disk space exhaustion, and no crashing SMTP processes.

---

## <img src="public/icons/dollar-sign.svg" width="22" height="22" valign="middle" /> Cloudflare Pricing: Free Tier vs. $5/mo Workers Paid (Validity Check)

How does Cloudflare pricing work with OrbitMails? Here is the exact, verified technical breakdown:

| Plan | Monthly Cost | Inbound Mail | Outbound Email Sending via Cloudflare | External Providers (Resend/SES/Brevo) |
| :--- | :---: | :---: | :--- | :--- |
| **Cloudflare Free Plan** | **$0 / mo** | Unlimited (Free) | Verified destination addresses only | **100% Supported** (Route via free tiers of SES, Resend, Brevo) |
| **Cloudflare Workers Paid** | **$5 / mo** | Unlimited (Free) | **Native Arbitrary Sending Unlocked** (3,000 free/mo included, then $0.35 per 1,000 emails) | **100% Supported** (Stack native Cloudflare sending + all external free tiers) |

### 🔍 Validity Check: Can you send without Resend/AWS on Cloudflare?
**Yes!** On Cloudflare's **Workers Paid ($5/month)** plan, Cloudflare's native `send_email` binding (`EMAIL` in `wrangler.jsonc`) is fully unlocked for **arbitrary external recipients**.
- **No external provider required**: You can send transactional emails directly through Cloudflare's own network without creating AWS SES or Resend accounts.
- **Quota included**: Includes 3,000 outbound emails per month in the base $5 fee.
- **Ultra-low overage**: Additional emails cost only **$0.35 per 1,000 emails** — with no vendor lock-in.
- **OrbitMails Native Binding**: OrbitMails has built-in support for Cloudflare's `EMAIL` binding. You can use Cloudflare as your primary sender and let OrbitMails fall back to external providers if desired.

---

## <img src="public/icons/repeat.svg" width="22" height="22" valign="middle" /> Traditional Approach vs. OrbitMails

| Capability | Multiple Dashboards<br/>(SES + Resend + Brevo) | Standard Self-Hosted<br/>(Roundcube, Postfix) | Single ESP API<br/>(Resend / SES only) | 🛰️ OrbitMails |
| :--- | :---: | :---: | :---: | :---: |
| **Monthly cost** | $0 – $500+ (fragmented) | Free (needs a VPS) | $20 – $500+/mo tier | **$0 free · $5/mo (CF plan)** |
| **Human mailboxes (`abc@yourdomain.com`)** | ❌ | ✅ | ❌ | **✅ Unlimited ($0 per seat forever)** |
| **Transactional send API** | ✅ (per-vendor, fragmented) | ❌ | ✅ | **✅ Unified drop-in API** |
| **E-Commerce Integration** (Order confirmations, shipping, receipts) | ⚠️ (Fragmented setup) | ❌ (Chokes under load) | ⚠️ (Single point of failure) | **✅ High-Throughput (1,000/s) with 0 drops** |
| **Portfolio & Agency Integration** (Contact forms, lead alerts to Gmail) | ⚠️ (Manual per client) | ⚠️ (Spam filter issues) | ⚠️ (Separate API keys) | **✅ 1 Scoped Key per portfolio, 100% inbox** |
| **Blog & Newsletter Integration** (New post alerts, weekly digests) | ⚠️ (Rate-limited easily) | ❌ (Server blacklisted) | ⚠️ (High volume gets costly) | **✅ Free-tier stacking maximizes free reach** |
| **Personal / Hobby Projects** (Zero-cost notifications, side apps) | ❌ (Risk of billing overages) | ❌ (Costly VPS) | ❌ (Strict monthly free caps) | **✅ $0 Free tiers stacked + quota caps** |
| **Free tier stacking across providers** | ❌ (one provider per project) | ❌ | ❌ | **✅ Auto-stacks CF + SES + Resend + Brevo** |
| **Automatic failover when quota exhausted** | ❌ (manual switching) | ❌ | ❌ | **✅ Instant silent failover** |
| **Multi-project unified dashboard** | ❌ (3+ separate logins) | ❌ | ⚠️ (1 vendor only) | **✅ All projects, 1 screen** |
| **See recipient + email content** | ❌ (scattered logs) | ✅ | ⚠️ (basic logs) | **✅ Sandboxed HTML preview + full metadata** |
| **Per-project quota capping (blast-radius)** | ❌ | ❌ | ❌ | **✅ Atomic Durable Object isolation** |
| **Provider credentials in client repos** | ✅ (security risk) | N/A | ✅ (security risk) | **❌ Zero — only routing key in client** |
| **Centralized secret management** | ❌ (keys everywhere) | ❌ | ❌ | **✅ All keys in one Cloudflare Secret** |
| **CI/CD integration** | ❌ (per-vendor manual) | ❌ | ⚠️ (manual per repo) | **✅ 1 secret → all projects connected** |
| **Drop-in Resend SDK compatibility** | ❌ | ❌ | ✅ | **✅ 100% drop-in (`/api/v1/mail/send`)** |
| **1,000 emails/sec throughput** | ❌ (rate limited) | ❌ (server chokes) | ✅ (paid tier) | **✅ Cloudflare Durable Objects** |
| **Calendar, Drive & booking** | ❌ | ❌ | ❌ | **✅ Built-in** |
| **Multi-brand hosting (1 hub)** | ❌ (separate accounts) | ⚠️ (complex config) | ❌ (separate workspaces) | **✅ Unlimited brands** |
| **Server maintenance** | None | ⚠️ High (Linux, Postfix, SSL) | None | **✅ Zero (Serverless Edge)** |
| **Data sovereignty** | ❌ (vendor-scanned) | ✅ | ❌ (third-party cloud) | **✅ Your own Cloudflare / DB** |

---

## <img src="public/icons/sparkles.svg" width="22" height="22" valign="middle" /> Complete Feature Matrix

### <img src="public/icons/briefcase.svg" width="18" height="18" valign="middle" /> For Businesses & Founders

#### Email Hosting & Custom Mailboxes
- **Multi-Brand Hosting on One Hub**: Host email for `company.com`, `startup.io`, and `client.org` from a single deployment.
- **Unlimited Mailboxes (`abc@`, `def@`)**: Create as many user inboxes as needed with zero per-seat licensing fees.
- **Shared Team Mailboxes**: Assign shared inboxes (`support@`, `billing@`) to multiple team members without forwarding loops.
- **Unlimited Aliases & Catch-Alls**: Forward inbound emails dynamically or map aliases to any mailbox.
- **Automated DNS Setup**: OrbitMails automatically provisions and verifies MX, SPF, DKIM, and DMARC records via Cloudflare API.
- **Out-of-Office Responders**: Set custom vacation auto-responders with schedule date ranges per mailbox.
- **Full JMAP / IMAP Webmail**: Keyboard-driven webmail with threads, labels, full-text search, and desktop notification support.

#### Deliverability, Routing & Reliability
- **Automatic Multi-Provider Failover**: If AWS SES rate-limits or fails, OrbitMails silently switches to Resend, Brevo, or SendGrid in real time.
- **Free-Tier Stacking**: Automatically routes outgoing emails through whichever provider has remaining free quota.
- **Built-in DKIM Signing**: Outbound emails are cryptographically signed automatically per domain.
- **Normalized Webhooks**: Centralized handling of delivery receipts, bounces, and spam complaints across all providers.
- **Retry Queue**: Failed deliveries are retried asynchronously with exponential backoff before logging failure.

#### Cost & Quota Slicing
- **Per-Project Quota Slicing**: Prevent runaway loops in one app from exhausting your other applications' quotas.
- **Visual Consumption Gauges**: Real-time progress bars showing daily quota consumption per project.
- **Cost Telemetry per Email**: Track exact dollar savings from free-tier stacking and monitor expenses.

#### Productivity Suite
- **Interactive Calendar**: Per-mailbox calendar with invite dispatch and ICS file support.
- **Sovereign Cloud Drive**: Store attachments and personal files in private R2/S3 storage.
- **Public Booking Links**: Share availability links; confirmed bookings create calendar invites automatically.
- **Address Book**: Synchronized contacts with auto-completion from recent senders.

---

### <img src="public/icons/code.svg" width="18" height="18" valign="middle" /> For Developers & Platform Teams

#### The 3-Step Routing Key Workflow
1. **Save Provider Keys Once**: Add your AWS SES, Resend, and Brevo keys into OrbitMails Hub via Cloudflare Secrets.
2. **Generate a Routing Key**: In the OrbitMails Admin, create a project (e.g. `Project-1`) and copy its scoped routing key (`orb_live_p1_...`).
3. **Use in Any Project**: Save that single key in your project via Cloudflare Secrets (`npx wrangler secret put ORBITMAIL_ROUTING_KEY`), GitHub Secrets, or `.env`.

#### API & Developer Tooling
- **Drop-in Resend SDK Compatibility**: Point `baseUrl` to your OrbitMails hub and keep using `resend.emails.send()`.
- **Zero-Dependency Native Fetch & cURL**: Send emails using standard HTTP POST requests with a Bearer token.
- **Sandboxed HTML Drawer**: Inspect the rendered HTML of any sent message directly inside the dashboard.
- **1-Click AI Agent Prompt**: Ready-to-paste prompts for Cursor, Claude, Antigravity, and Codex.
- **Model Context Protocol (MCP)**: Native MCP server for AI coding agents to read, draft, and send emails securely.
- **1,000 Emails/Second Engine**: Powered by Cloudflare Durable Objects for distributed token leases and rate limiting.
- **Multi-Dialect Database**: Drizzle ORM supports Cloudflare D1 (SQLite), PostgreSQL (Neon, Supabase), and MySQL.

---

## <img src="public/icons/server.svg" width="22" height="22" valign="middle" /> Supported Email Providers

| Provider | Outbound Send | Inbound Receive | Free Tier / Base Pricing | Status |
| :--- | :---: | :---: | :--- | :---: |
| **Cloudflare Workers (`send_email`)** | ✅ | ✅ | 3,000 included in $5/mo Workers Paid plan ($0.35/1k after) | ✅ **Live** |
| **AWS SES** | ✅ | ✅ | 3,000/mo free (1st yr) · $0.10/1k emails pay-as-you-go | ✅ **Live** |
| **Resend** | ✅ | ✅ | 3,000 emails/month free | ✅ **Live** |
| **Brevo (Sendinblue)** | ✅ | ❌ | 300 emails/day (~9,000/month free) | ✅ **Live** |
| **SendGrid** | ✅ | ❌ | 100 emails/day free | ✅ **Live** |
| **Custom SMTP Relay** | ✅ | ❌ | Configurable per relay | ✅ **Live** |
| **Postmark** | 🔜 | ❌ | 100 emails/month free | 🔜 *Coming Soon* |
| **Mailgun** | 🔜 | 🔜 | 5,000 emails/month free trial | 🔜 *Coming Soon* |
| **ZeptoMail** | 🔜 | ❌ | Generous free credit tier | 🔜 *Coming Soon* |
| **Mailjet** | 🔜 | ❌ | 6,000 emails/month free (200/day) | 🔜 *Coming Soon* |
| **SparkPost / Bird** | 🔜 | ❌ | Pay-as-you-go tier | 🔜 *Coming Soon* |
| **Plunk** | 🔜 | ❌ | 3,000 emails/month free | 🔜 *Coming Soon* |

---

## <img src="public/icons/rocket.svg" width="22" height="22" valign="middle" /> Quickstart: Deploy in 60 Seconds

### <img src="public/icons/cloud.svg" width="18" height="18" valign="middle" /> Option A: One-Click Deploy to Cloudflare (Easiest & Recommended)

Click the button below to automatically provision your sovereign email server:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/orbitsaas/orbitmails)

**What Cloudflare provisions automatically in your account:**
- <img src="public/icons/cpu.svg" width="16" height="16" valign="middle" /> Cloudflare Worker: `orbitmails`
- <img src="public/icons/database.svg" width="16" height="16" valign="middle" /> Serverless D1 Database: `orbitmails`
- <img src="public/icons/hard-drive.svg" width="16" height="16" valign="middle" /> R2 Storage Bucket: `orbitmails-raw`
- <img src="public/icons/mail.svg" width="16" height="16" valign="middle" /> Queues: `orbitmails-inbound`, `orbitmails-outbound`, `orbitmails-agent`
- <img src="public/icons/lock.svg" width="16" height="16" valign="middle" /> Durable Objects: `QuotaCoordinator`, `RealtimeHub`

**After clicking:**
1. Sign in to your Cloudflare account.
2. Enter your scoped `CF_TOKEN` (see [docs/deployment.md](docs/deployment.md) for required permissions).
3. Wait for provisioning to finish, open your Worker URL, and visit `/setup` to create your primary admin account!

---

### <img src="public/icons/code.svg" width="18" height="18" valign="middle" /> Option B: Deploy via Wrangler CLI

```bash
git clone https://github.com/orbitsaas/orbitmails.git
cd orbitmails
npm install
npm run deploy
```

---

### <img src="public/icons/server.svg" width="18" height="18" valign="middle" /> Option C: Self-Host via Docker / Node.js

```bash
# Build & start standalone Node.js server
npm run build:node
npm run start:node

# Or using Docker Compose
cp .env.docker.example .env.docker
docker compose up -d --build
```

Runs anywhere Node.js runs: Ubuntu, Debian, Docker, Railway, Coolify, or Fly.io.

---

## <img src="public/icons/key.svg" width="22" height="22" valign="middle" /> 4-Step Developer Quickstart

### Step 1: Save Provider Keys to OrbitMails Hub (Once)
```bash
npx wrangler secret put AWS_SES_ACCESS_KEY_ID
npx wrangler secret put AWS_SES_SECRET_ACCESS_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put BREVO_API_KEY
```
*(Or enter them directly via the OrbitMails Admin UI under MailHub → Providers).*

### Step 2: Create a Routing Key in OrbitMails Admin
Open your OrbitMails admin dashboard → **MailHub → Projects → New Routing Key**.  
Copy the generated key (e.g. `orb_live_project1_xxxxxxxxxxxx`).

### Step 3: Add Routing Key to Your Client Project
In your client project directory, set the secret:
```bash
npx wrangler secret put ORBITMAIL_ROUTING_KEY
# Paste your orb_live_... key

npx wrangler secret put ORBITMAIL_BASE_URL
# Paste: https://your-domain.com/api/v1/mail
```
*(Or store as an environment variable in `.env`, GitHub Secrets, Railway, or Vercel).*

### Step 4: Send Emails from Your App
```typescript
import { Resend } from "resend";

// Drop-in replacement: simply point baseUrl to OrbitMails
const resend = new Resend(process.env.ORBITMAIL_ROUTING_KEY, {
  baseUrl: process.env.ORBITMAIL_BASE_URL,
});

await resend.emails.send({
  from: "notifications@project-1.com",
  to: "customer@example.com",
  subject: "Your Order is Confirmed!",
  html: "<h1>Thank you for your order!</h1><p>We are preparing your shipment.</p>",
});
```

---

## <img src="public/icons/file-text.svg" width="22" height="22" valign="middle" /> Licensing & Entitlements: How Does It Work?

### 1. Codebase License: GNU AGPLv3
OrbitMails is free, open-source software distributed under the **[GNU Affero General Public License v3 (AGPLv3)](LICENSE)**:
- **Freedom to self-host**: You can run OrbitMails on your own Cloudflare account, VPS, or private servers completely free forever.
- **Data sovereignty**: You retain 100% ownership of all emails, attachments, and user data.
- **Transparent source**: All code is public and community-audited.

### 2. In-App Team Entitlements: 100% Unlocked ($0 / Free)
In older upstream forks, certain branding features required a paid key. In **OrbitMails**, all features are permanently unlocked for everyone:
- **Team Plan Active Out-of-the-Box**: Unrestricted multi-domain hosting, unlimited mailboxes and aliases, shared inboxes, and custom branding are **100% enabled for free** (`plan: "team"`).
- **No License Key Needed**: You do not need to buy, activate, or enter any license key to access all features. Everything runs out of the box with zero paywalls.

---

## <img src="public/icons/shield-check.svg" width="22" height="22" valign="middle" /> Verification & Benchmark Test Suite

OrbitMails includes an enterprise test suite verifying multi-provider failover, quota coordination, and database dialect compatibility:

```bash
# Run all 89 unit tests, failovers, and parallel benchmarks
node --test tests/mailhub-*.test.mjs tests/router-auth.test.mjs tests/ingestion-api.test.mjs tests/quota-durable-object.test.mjs tests/benchmark-1000-per-sec.test.mjs

# Verify database dialect parity across SQLite/D1, PostgreSQL, and MySQL
node --test tests/database-dialects.test.mjs

# Run full TypeScript compiler verification
npx tsc --noEmit
```

---

## <img src="public/icons/users.svg" width="22" height="22" valign="middle" /> Contributing & Community

OrbitMails is **100% free and open-source**. We welcome community contributions!

- ⭐️ **[Star this Repository](https://github.com/orbitsaas/orbitmails)**: Help more developers discover sovereign email infrastructure.
- 🐛 **[Report Issues & Request Features](https://github.com/orbitsaas/orbitmails/issues)**: Share feedback or report bugs.
- 🔌 **Build Provider Adapters**: Contribute adapters for Postmark, Mailgun, or custom SMTP relays in `src/lib/router/providers/`.
- 🌍 **Translations**: Help translate OrbitMails into additional languages (34 supported currently).

---

## <img src="public/icons/file-text.svg" width="22" height="22" valign="middle" /> Documentation Reference

| Document | Description |
| :--- | :--- |
| **[orbitcontext.md](orbitcontext.md)** | Deep architectural breakdown of Orbitflare base vs. OrbitMails MailHub router |
| **[docs/deployment.md](docs/deployment.md)** | Cloudflare API token configuration, 1-click deploy guide, and DNS setup |
| **[docs/databases.md](docs/databases.md)** | Multi-dialect database guide for Cloudflare D1, PostgreSQL, MySQL, and SQLite |
| **[docs/providers.md](docs/providers.md)** | Configuration guides for Cloudflare Sending, AWS SES, Resend, Brevo, and SMTP |
| **[docs/api.md](docs/api.md)** | Complete REST API reference, request payloads, and webhook specifications |

---

## <img src="public/icons/shield-check.svg" width="22" height="22" valign="middle" /> License

OrbitMails is open-source software licensed under the **[GNU AGPLv3 License](LICENSE)**.  
Built and maintained with sovereign pride by **[OrbitSaaS](https://orbitsaas.cloud)**.
