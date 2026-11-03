# OrbitMails — Complete System & Architecture Context (`orbitcontext.md`)

This document provides a definitive breakdown of the capabilities, architecture, and feature sets of **OrbitMails**, separating the original baseline platform capabilities (**Pre-Features**) from the centralized multi-provider routing and intelligence infrastructure (**Orbit Features**).

---

## Part 1: Pre-Features (Baseline Platform Capabilities)

These features constitute the original self-hosted, Cloudflare Workers / D1 / R2 email platform (Orbitflare foundation):

### 1. Core Mail Server & Protocol Engine
* **JMAP & Cloudflare Email Native Runtime**: Full support for RFC 8620 / 8621 JMAP protocol on Cloudflare Workers and Node.js runtimes.
* **Inbound MIME Processing (`src/lib/email/inbound.ts`)**: Streaming RFC 5322 MIME parser processing incoming emails from Cloudflare Email Routing directly into structured JSON and binary attachments.
* **Outbound Delivery Engine (`src/lib/email/send.ts`)**: Direct DKIM signing and SMTP/HTTP delivery via Cloudflare, AWS SES, or direct relays.
* **Full-Featured Webmail Client**: Next.js-based desktop and mobile webmail interface with rich text editor, threading, conversation views, and draft autosaving.
* **Drive & Cloud Attachments**: File storage integration powered by Cloudflare R2 Bucket and Backblaze B2 S3-compatible APIs.

### 2. Multi-Domain & Mailbox Management
* **Custom Domain Onboarding**: Domain DNS verification engine with automated checks for MX, SPF, DKIM, and DMARC.
* **Mailbox & Alias System**: Creation of unlimited personal and shared mailboxes under verified domains (`src/db/schema`).
* **Cross-Domain Catch-All (`useAllDomains`)**: Route any incoming address (`*@domain.com`) to a designated master mailbox without pre-configuring individual addresses in DNS.
* **Shared Inboxes & Granular RBAC (`mailbox_access`)**: Team sharing with permission levels: `read_only`, `send_as`, `send_on_behalf`, and `full_access`.

### 3. Security, Spam Protection & Deliverability
* **Multi-Layer Spam Analysis**:
  * Spamhaus DQS (Data Query Service) ZEN IP reputation checks.
  * Spamhaus DBL domain reputation analysis.
  * abuse.ch URLhaus malware link detection in email bodies.
  * RDAP domain age verification to block newly registered spam domains.
* **Two-Factor Authentication (2FA / TOTP)**: RFC 6238 TOTP two-factor authentication with hashed backup recovery codes.
* **Apple APNs Native Push Notifications**: Cryptographic `.p8` token-based push relay for mobile apps and web push via VAPID.

### 4. Database & Reliability Layer
* **Triple-Dialect SQL Architecture**: Schema defined once in Drizzle ORM supporting SQLite/Cloudflare D1, PostgreSQL, and MySQL simultaneously (`AGENTS.md`).
* **Database Backup & Restoration Engine**: Full point-in-time JSON database export and restore covering all user data, messages, and routing tables.
* **Scheduled Retention & Purge**: Automated background cleanup of Trash and Spam folders with configurable retention policies.

---

## Part 2: Orbit Features (MailHub Centralized Routing Infrastructure)

These features represent the new centralized routing, cost optimization, quota slicing, high-throughput delivery, and developer telemetry platform built specifically for internal projects (Aurelia, LifeSolver, Luvio, Ovijatric, etc.):

### 1. Multi-ESP Provider Integration Suite
* **Unified Provider Adapter Architecture (`src/lib/mailhub/providers/`)**:
  * **Brevo (Sendinblue)**: Transactional REST API v3 with quota tracking.
  * **Resend**: Wire-compatible HTTP API adapter.
  * **Amazon SES**: AWS Signature v4 authenticated transactional client.
  * **ZeptoMail (Zoho)**: High-deliverability transactional client.
  * **Mailgun**: Domain-scoped API adapter with EU/US region routing.
  * **Cloudflare Email**: Zero-cost worker-to-worker native sending.
* **Hardware-Grade AES-256-GCM Encryption (`crypto.ts`)**: Provider API keys and SMTP credentials are encrypted at rest with authenticated tamper detection.

### 2. Intelligent Scoring & Cost Optimization Engine (`src/lib/mailhub/scoring.ts`)
* **Cost-Tier Ranking Algorithm**:
  * Prioritizes **Free-Tier providers** (Brevo 300/day free, Resend 100/day free) to maximize zero-cost email sending.
  * Automatically balances and rolls over to low-cost paid tiers (e.g. Amazon SES at $0.10 per 10,000 emails) when free quotas saturate.
* **Mathematical Score Heuristic**:
  $$\text{Score} = (\text{CostTierWeight} \times 1000) + ((10 - \text{Priority}) \times 100) + ((1 - \text{UsageRatio}) \times 100) + (\text{HealthScore} \times 50) - (\text{ConsecutiveFailures} \times 20)$$
* **Real-time Quota Exhaustion Cascade**: Seamless transition across providers without dropping a single outgoing message.

### 3. Atomic Quota Slicing & Isolation
* **Durable Object Quota Coordinator (`src/lib/router/quota-durable-object.ts`)**:
  * Single-threaded, zero-race atomic counter coordinating per-project daily allocations.
  * Sub-millisecond check-and-increment operations with automatic UTC midnight rollovers.
* **Blast Radius Isolation**:
  * If Project A (e.g. Aurelia) encounters an infinite loop or spam bug, it exhausts **only** its own quota slice.
  * Project B (LifeSolver) and Project C (Luvio) retain 100% of their allocated sending capacity.

### 4. 1,000 Emails/Second High-Throughput Engine (`src/lib/mailhub/high-throughput/`)
* **Token Lease Pool (`token-lease-pool.ts`)**:
  * Worker isolates lease quota in blocks of 50 tokens at once, reducing Durable Object RPC calls by 98% (preventing single-threaded bottlenecks).
* **Parallel Queue Producer & Dispatcher (`parallel-dispatcher.ts`)**:
  * Asynchronous queue ingestion sustaining **30,000–50,000 emails/sec ingestion** and **3,200–6,200 emails/sec parallel dispatch**.
  * Executes up to 50 concurrent network sockets per worker isolate.
* **Atomic D1 Batch Commits (`flushBatchToD1`)**:
  * Multi-row SQL statement batching (up to 100 log rows per query), eliminating `SQLITE_BUSY` database lock contention.

### 5. Automatic Failover & Circuit Breaker Engine (`src/lib/mailhub/failover.ts`)
* **3-Strike Automatic Quarantine (`circuit-breaker.ts`)**:
  * Detects provider 5xx outages and immediately trips the circuit breaker to `OPEN`.
  * Instantly diverts traffic to the next provider in the project's waterfall chain without waiting for timeouts.
* **Self-Healing Half-Open Probing**:
  * Automatically tests quarantined providers with canary requests after cooldown periods.
* **Dead Letter Queue (DLQ) & Exponential Backoff (`dlq.ts`)**:
  * If all configured providers fail simultaneously, messages are gracefully preserved in Cloudflare Queues with a 5-step exponential backoff retry schedule (30s, 2m, 10m, 30m, 1h).

### 6. Drop-in Resend & REST Ingestion API (`src/app/api/v1/`)
* **100% Resend SDK Wire-Compatibility**:
  * Downstream projects simply pass `baseUrl: "https://mail.orbitsaas.cloud/v1"` to the official `Resend` npm package.
* **Multi-Format Ingestion**:
  * Accepts Resend, Brevo, and RFC 5322 payloads simultaneously.
  * Automatic multi-recipient splitting (up to 50 recipients per provider batch).

### 7. Apple HIG Admin Dashboard & Mail Content Inspector
* **Command Center (`/admin/mailhub`)**:
  * Real-time metrics: Sends today, active failovers, provider health status, latency benchmarks.
* **Interactive Live Activity Stream (`activity-feed.tsx`)**:
  * Live-streaming feed with 5s polling toggle.
  * **Mail Content & Recipient Inspector Drawer**:
    * Full `From:`, `To:`, and `Subject:` visibility with 1-click copy.
    * **Rendered HTML Preview**: Sandboxed visual preview of the actual email sent.
    * **Plain Text View**: Monospace raw text payload with 1-click clipboard copy.
    * **Routing Waterfall Trace**: Complete diagnostic trail showing every provider attempt, HTTP status code, and latency in milliseconds.
* **Visual Allocation Slider (`/admin/mailhub/allocations`)**:
  * Interactive drag-and-drop budget allocator bar.
  * Visual over-allocation prevention warnings.
  * Project failover priority waterfall reordering.

### 8. AI Agent Integration Prompt & Guidance Modal
* **Interactive Routing Key Modal (`routing-key-modal.tsx`)**:
  * One-click **"🤖 AI Agent Prompt"** generator tailored for Cursor, Claude, Antigravity, and ChatGPT.
  * Includes `.env` snippets, Resend drop-in code, and cURL terminal verification scripts.

### 9. Webhooks, Bounces & Suppression Pipeline (`/api/v1/webhooks/`)
* **Multi-Provider Webhook Ingestion**:
  * Cryptographic signature verification for Resend, Brevo, Amazon SES, and Mailgun webhooks.
* **Automated Suppression List**:
  * Automatically isolates hard bounces and spam complaints into a multi-tier suppression list to protect sender reputation across all domains.

### 10. Automated Health Monitoring & Developer Alerts
* **Cron Health Sentry (`src/lib/mailhub/monitoring/`)**:
  * Monitors quota saturation (>85% consumed before midday).
  * Alerts on tripped circuit breakers and DLQ retries.
* **Daily 8:00 AM Developer Digest**:
  * Automated email digest summarizing 24-hour volume, total delivery rate, provider breakdown, and dollar savings achieved.

### 11. GitHub Secrets & CI/CD Centralized Integration ("One Platform, All Solutions")
* **Centralized Master Secrets**:
  * Upstream ESP credentials (AWS SES, Resend, Brevo, SendGrid) are configured once in OrbitMails and encrypted via AES-GCM.
* **Zero Secret Sprawl in Downstream Repos**:
  * Client projects (Aurelia, LifeSolver, Luvio, Ovijatric) do not hold raw provider credentials.
  * Only a single scoped `ORBITMAIL_ROUTING_KEY` is added to GitHub Repository Secrets (`Settings -> Secrets and variables -> Actions`).
* **CI/CD Integration (`.github/workflows/deploy.yml`)**:
  * Automated GitHub Actions workflows inject `ORBITMAIL_ROUTING_KEY` during deployment.
* **Unified Live Monitoring**:
  * All emails dispatched from GitHub Actions or production servers stream into `/admin/mailhub` with real-time recipient logs, sandboxed HTML rendered previews, failover waterfalls, and cost tracking.

---

## Summary Matrix

| Capability | Pre-Features (Orbitflare) | Orbit Features (MailHub) |
| :--- | :---: | :---: |
| **Webmail Inbox UI** | ✅ | ✅ |
| **Custom Domains & DNS** | ✅ | ✅ |
| **Multi-ESP Load Balancing (SES, Brevo, Resend, Mailgun)** | ❌ | ✅ |
| **Free-Tier Cost Optimization** | ❌ | ✅ |
| **Durable Object Atomic Quota Slices** | ❌ | ✅ |
| **Blast-Radius Project Isolation** | ❌ | ✅ |
| **1,000+ Mails/Sec Parallel Queue Pipeline** | ❌ | ✅ |
| **3-Strike Automatic Outage Circuit Breaker** | ❌ | ✅ |
| **Drop-in Resend SDK Compatibility** | ❌ | ✅ |
| **AI Agent Guided Integration Prompt** | ❌ | ✅ |
| **Live Mail Content & HTML Body Inspector** | ❌ | ✅ |
| **Centralized Developer Activity Stream** | ❌ | ✅ |
| **Centralized GitHub Secrets & CI/CD Routing** | ❌ | ✅ |

