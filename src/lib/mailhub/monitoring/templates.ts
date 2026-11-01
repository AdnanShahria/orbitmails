/**
 * OrbitMails / MailHub - Apple-Grade Modern Email Alert & Digest Templates
 * @module lib/mailhub/monitoring/templates
 */

import type {
	CircuitBreakerAlert,
	DailyDigest,
	DeadLetterAlert,
	QuotaThresholdAlert,
} from "./types";

function escapeHtml(str: string | number | null | undefined): string {
	if (str === null || str === undefined) return "";
	return String(str)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function formatCurrency(usd: number): string {
	return `$${usd.toFixed(usd < 0.01 && usd > 0 ? 4 : 2)}`;
}

/** Base email HTML wrapper with responsive Apple-style typography and layout */
function wrapHtmlLayout({
	title,
	badgeText,
	badgeColor,
	badgeBg,
	contentHtml,
	actionUrl,
	actionText = "Open MailHub Dashboard",
	appUrl = "https://orbitmails.cloud",
}: {
	title: string;
	badgeText: string;
	badgeColor: string;
	badgeBg: string;
	contentHtml: string;
	actionUrl?: string;
	actionText?: string;
	appUrl?: string;
}): string {
	const ctaUrl = actionUrl || `${appUrl}/admin/mailhub`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f5f5f7;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1d1d1f;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      max-width: 600px;
      margin: 32px auto;
      padding: 0 16px;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
      padding: 0 4px;
    }
    .brand {
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -0.2px;
      color: #1d1d1f;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .brand-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: #0071e3;
      display: inline-block;
    }
    .card {
      background: #ffffff;
      border-radius: 16px;
      border: 1px solid #e5e5ea;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
      padding: 32px;
      margin-bottom: 24px;
    }
    .badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 4px 10px;
      border-radius: 20px;
      color: ${badgeColor};
      background-color: ${badgeBg};
      margin-bottom: 16px;
    }
    h1 {
      margin: 0 0 12px 0;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.4px;
      line-height: 1.25;
      color: #1d1d1f;
    }
    .subtitle {
      font-size: 14px;
      color: #86868b;
      margin-bottom: 24px;
      line-height: 1.4;
    }
    .metric-row {
      display: flex;
      gap: 12px;
      margin: 20px 0;
    }
    .metric-box {
      flex: 1;
      background: #f5f5f7;
      border-radius: 12px;
      padding: 14px 16px;
      border: 1px solid #e5e5ea;
    }
    .metric-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: #86868b;
      margin-bottom: 4px;
      letter-spacing: 0.3px;
    }
    .metric-value {
      font-size: 20px;
      font-weight: 700;
      color: #1d1d1f;
      letter-spacing: -0.3px;
    }
    .progress-bar-container {
      width: 100%;
      background-color: #e5e5ea;
      height: 10px;
      border-radius: 5px;
      overflow: hidden;
      margin: 16px 0;
    }
    .progress-bar-fill {
      height: 100%;
      border-radius: 5px;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 13px;
    }
    .data-table th {
      text-align: left;
      padding: 8px 10px;
      color: #86868b;
      font-weight: 600;
      border-bottom: 1px solid #e5e5ea;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .data-table td {
      padding: 10px;
      border-bottom: 1px solid #f2f2f7;
      color: #1d1d1f;
    }
    .data-table tr:last-child td {
      border-bottom: none;
    }
    .code-pill {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      background: #f0f0f2;
      padding: 2px 6px;
      border-radius: 4px;
      color: #1d1d1f;
    }
    .alert-callout {
      border-radius: 12px;
      padding: 14px 16px;
      margin: 18px 0;
      font-size: 13px;
      line-height: 1.45;
    }
    .cta-button {
      display: inline-block;
      background-color: #0071e3;
      color: #ffffff !important;
      text-decoration: none;
      font-size: 14px;
      font-weight: 600;
      padding: 12px 24px;
      border-radius: 980px;
      text-align: center;
      margin-top: 16px;
      transition: background-color 0.15s ease;
    }
    .footer {
      text-align: center;
      font-size: 12px;
      color: #86868b;
      line-height: 1.5;
      padding: 0 16px;
    }
    .footer a {
      color: #0071e3;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="brand">
        <span class="brand-dot"></span>
        OrbitMails MailHub Monitor
      </div>
      <div style="font-size: 12px; color: #86868b;">
        ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC
      </div>
    </div>

    <div class="card">
      <div class="badge">${escapeHtml(badgeText)}</div>
      <h1>${escapeHtml(title)}</h1>
      ${contentHtml}
      <div style="text-align: left; margin-top: 24px;">
        <a href="${escapeHtml(ctaUrl)}" class="cta-button" target="_blank">${escapeHtml(actionText)}</a>
      </div>
    </div>

    <div class="footer">
      <p>This automated health notification was dispatched by OrbitMails MailHub Cron Trigger.</p>
      <p>Target: <strong>Production Email Routing Core</strong> &bull; <a href="${escapeHtml(ctaUrl)}">Alert Settings</a></p>
    </div>
  </div>
</body>
</html>`;
}

/** 1. Render Quota Warning Alert (>85% consumed before midday) */
export function renderQuotaAlert(
	alert: QuotaThresholdAlert,
	appUrl = "https://orbitmails.cloud",
): { subject: string; html: string; text: string } {
	const subject = `⚠️ [MailHub Alert] ${alert.projectName} consumed ${alert.percentage.toFixed(1)}% of ${alert.providerName} quota before noon`;

	const progressColor = alert.percentage >= 95 ? "#ff3b30" : "#ff9500";
	const burnRateHoursText = alert.estimatedDepletionHours
		? `At current burn rate, slice will be completely exhausted in ~<strong>${alert.estimatedDepletionHours.toFixed(1)} hours</strong>.`
		: "At current burn rate, slice is at risk of midday exhaustion.";

	const contentHtml = `
    <div class="subtitle">
      Project <strong>${escapeHtml(alert.projectName)}</strong> has consumed 
      <strong>${alert.percentage.toFixed(1)}%</strong> of its daily quota slice on 
      <strong>${escapeHtml(alert.providerName)}</strong> before midday (${alert.hourUtc}:00 UTC).
    </div>

    <div class="metric-row">
      <div class="metric-box">
        <div class="metric-label">Consumed Today</div>
        <div class="metric-value">${alert.usedToday} <span style="font-size: 13px; font-weight: normal; color: #86868b;">/ ${alert.dailySlice}</span></div>
      </div>
      <div class="metric-box">
        <div class="metric-label">Remaining Slice</div>
        <div class="metric-value" style="color: ${progressColor};">${alert.remaining}</div>
      </div>
      <div class="metric-box">
        <div class="metric-label">Quota Used</div>
        <div class="metric-value" style="color: ${progressColor};">${alert.percentage.toFixed(1)}%</div>
      </div>
    </div>

    <div style="margin: 16px 0;">
      <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px; color: #86868b;">
        <span>Usage Progress</span>
        <span>${alert.usedToday} / ${alert.dailySlice} (${alert.percentage.toFixed(1)}%)</span>
      </div>
      <div class="progress-bar-container">
        <div class="progress-bar-fill" style="width: ${Math.min(100, alert.percentage)}%; background-color: ${progressColor};"></div>
      </div>
    </div>

    <div class="alert-callout" style="background-color: #fff9eb; border: 1px solid #ffe8b3; color: #7a4100;">
      <strong>Early Warning:</strong> ${burnRateHoursText} 
      Once exhausted, MailHub will automatically fail over traffic to secondary providers (e.g. Resend or SES), which may incur extra metered costs or hit subordinate limits.
    </div>

    <table class="data-table">
      <tr>
        <th>Property</th>
        <th>Value</th>
      </tr>
      <tr>
        <td>Project</td>
        <td><span class="code-pill">${escapeHtml(alert.projectId)}</span> (${escapeHtml(alert.projectName)})</td>
      </tr>
      <tr>
        <td>Provider Account</td>
        <td><span class="code-pill">${escapeHtml(alert.providerCredId)}</span> (${escapeHtml(alert.providerName)})</td>
      </tr>
      <tr>
        <td>Date Bucket</td>
        <td>${escapeHtml(alert.dateBucket)}</td>
      </tr>
      <tr>
        <td>Detection Time</td>
        <td>${new Date(alert.detectedAt).toISOString().slice(11, 19)} UTC</td>
      </tr>
    </table>
  `;

	const html = wrapHtmlLayout({
		title: `Quota Threshold Alert: ${alert.projectName}`,
		badgeText: "High Quota Consumption",
		badgeColor: "#ff9500",
		badgeBg: "#fff9eb",
		contentHtml,
		actionUrl: `${appUrl}/admin/mailhub/allocations?project=${encodeURIComponent(alert.projectId)}`,
		actionText: "Adjust Project Quota Slices",
		appUrl,
	});

	const text = `
[MAILHUB ALERT] QUOTA SLICE WARNING
=====================================================
Project:           ${alert.projectName} (${alert.projectId})
Provider:          ${alert.providerName} (${alert.providerCredId})
Usage:             ${alert.usedToday} of ${alert.dailySlice} emails (${alert.percentage.toFixed(1)}%)
Remaining:         ${alert.remaining} emails
Detection Time:    ${new Date(alert.detectedAt).toISOString()}

${alert.projectName} has consumed over 85% of its daily quota slice before midday (hour ${alert.hourUtc} UTC).
To prevent automated failover or service disruption, review or increase quota allocations in the dashboard:
${appUrl}/admin/mailhub/allocations?project=${alert.projectId}
`.trim();

	return { subject, html, text };
}

/** 2. Render Provider Circuit Breaker Alert (3 consecutive failures) */
export function renderCircuitBreakerAlert(
	alert: CircuitBreakerAlert,
	appUrl = "https://orbitmails.cloud",
): { subject: string; html: string; text: string } {
	const subject = `🚨 [MailHub CRITICAL] Circuit breaker OPEN for ${alert.providerName} (3 consecutive failures)`;

	const contentHtml = `
    <div class="subtitle">
      Provider <strong>${escapeHtml(alert.providerName)}</strong> has tripped its circuit breaker 
      after encountering <strong>${alert.consecutiveFailures} consecutive delivery failures</strong>.
      Traffic has been automatically quarantined for <strong>${alert.cooldownMinutes} minutes</strong>.
    </div>

    <div class="metric-row">
      <div class="metric-box">
        <div class="metric-label">Circuit State</div>
        <div class="metric-value" style="color: #ff3b30;">OPEN</div>
      </div>
      <div class="metric-box">
        <div class="metric-label">Consecutive Fails</div>
        <div class="metric-value" style="color: #ff3b30;">${alert.consecutiveFailures} / 3</div>
      </div>
      <div class="metric-box">
        <div class="metric-label">Isolation Window</div>
        <div class="metric-value">${alert.cooldownMinutes}m</div>
      </div>
    </div>

    <div class="alert-callout" style="background-color: #fff2f2; border: 1px solid #ffd6d6; color: #a8071a;">
      <strong>Root Cause / Last Error:</strong><br/>
      <pre style="margin: 8px 0 0; font-size: 12px; white-space: pre-wrap; font-family: ui-monospace, monospace;">${escapeHtml(alert.lastError)}</pre>
    </div>

    <table class="data-table">
      <tr>
        <th>Affected Element</th>
        <th>Status & Rerouting Detail</th>
      </tr>
      <tr>
        <td>Quarantined Provider</td>
        <td><span class="code-pill">${escapeHtml(alert.providerCredId)}</span> (${escapeHtml(alert.providerName)})</td>
      </tr>
      <tr>
        <td>Active Failover Provider</td>
        <td>${alert.fallbackProvider ? `<span class="code-pill" style="color: #34c759; font-weight: 600;">${escapeHtml(alert.fallbackProvider)}</span>` : "Next available priority candidate"}</td>
      </tr>
      <tr>
        <td>Affected Projects</td>
        <td>${alert.affectedProjects.length ? alert.affectedProjects.map((p) => `<span class="code-pill" style="margin-right: 4px;">${escapeHtml(p)}</span>`).join(" ") : "All projects sharing this provider"}</td>
      </tr>
      <tr>
        <td>Tripped Timestamp</td>
        <td>${new Date(alert.trippedAt).toISOString().slice(0, 19).replace("T", " ")} UTC</td>
      </tr>
    </table>

    <div style="font-size: 13px; color: #86868b; line-height: 1.45; margin-top: 16px;">
      💡 <strong>Self-Healing Mechanism:</strong> After ${alert.cooldownMinutes} minutes, the circuit will transition to <code>half-open</code> and allow a single canary probe email through. If successful, the circuit closes automatically.
    </div>
  `;

	const html = wrapHtmlLayout({
		title: `Circuit Breaker Tripped: ${alert.providerName}`,
		badgeText: "Critical Outage Quarantined",
		badgeColor: "#ff3b30",
		badgeBg: "#fff2f2",
		contentHtml,
		actionUrl: `${appUrl}/admin/mailhub/providers?credId=${encodeURIComponent(alert.providerCredId)}`,
		actionText: "Inspect Provider Health & Logs",
		appUrl,
	});

	const text = `
[MAILHUB CRITICAL] CIRCUIT BREAKER TRIPPED
=====================================================
Provider:          ${alert.providerName} (${alert.providerCredId})
State:             OPEN (Quarantined for ${alert.cooldownMinutes} minutes)
Failures:          ${alert.consecutiveFailures} consecutive failed sends
Last Error:        ${alert.lastError}
Fallback Target:   ${alert.fallbackProvider || "Next available in waterfall"}
Tripped At:        ${new Date(alert.trippedAt).toISOString()}

Affected projects are being automatically rerouted around this provider.
Inspect credentials or API health:
${appUrl}/admin/mailhub/providers?credId=${alert.providerCredId}
`.trim();

	return { subject, html, text };
}

/** 3. Render Dead Letter Queue Alert (All providers failed) */
export function renderDeadLetterAlert(
	alert: DeadLetterAlert,
	appUrl = "https://orbitmails.cloud",
): { subject: string; html: string; text: string } {
	const subject = `🔥 [MailHub CRITICAL] Email delivery failed across all providers: pushed to DLQ`;

	const providerChainHtml = alert.attemptedProviders
		.map(
			(p) => `
      <tr>
        <td><span class="code-pill">${escapeHtml(p.provider)}</span></td>
        <td style="color: #ff3b30; font-family: ui-monospace, monospace; font-size: 11px;">${escapeHtml(p.error)}</td>
      </tr>
    `,
		)
		.join("");

	const contentHtml = `
    <div class="subtitle">
      An outbound message from <strong>${escapeHtml(alert.projectName)}</strong> failed across 
      <strong>all configured providers in the waterfall</strong> and could not be delivered. 
      It has been saved to the Dead Letter Queue (DLQ) for replay.
    </div>

    <div class="alert-callout" style="background-color: #fff2f2; border: 1px solid #ffd6d6; color: #a8071a;">
      <strong>Delivery Failure:</strong> All primary and secondary email relays were exhausted without successful delivery.
    </div>

    <table class="data-table">
      <tr>
        <th>Message Detail</th>
        <th>Value</th>
      </tr>
      <tr>
        <td>Project</td>
        <td><span class="code-pill">${escapeHtml(alert.projectId)}</span> (${escapeHtml(alert.projectName)})</td>
      </tr>
      <tr>
        <td>Recipient</td>
        <td><strong>${escapeHtml(alert.recipient)}</strong></td>
      </tr>
      <tr>
        <td>Subject</td>
        <td>${escapeHtml(alert.subject || "(No Subject)")}</td>
      </tr>
      <tr>
        <td>DLQ Message ID</td>
        <td><span class="code-pill">${escapeHtml(alert.dlqId)}</span></td>
      </tr>
      <tr>
        <td>Enqueue Timestamp</td>
        <td>${new Date(alert.enqueuedAt).toISOString().slice(0, 19).replace("T", " ")} UTC</td>
      </tr>
    </table>

    <div style="font-size: 13px; font-weight: 600; margin: 16px 0 8px;">Waterfall Provider Failure Chain:</div>
    <table class="data-table">
      <thead>
        <tr>
          <th>Attempted Provider</th>
          <th>Returned Error</th>
        </tr>
      </thead>
      <tbody>
        ${providerChainHtml || `<tr><td colspan="2">${escapeHtml(alert.lastError)}</td></tr>`}
      </tbody>
    </table>
  `;

	const html = wrapHtmlLayout({
		title: `Dead Letter Queue Enqueued: ${alert.projectName}`,
		badgeText: "Delivery Exhausted (DLQ)",
		badgeColor: "#ff3b30",
		badgeBg: "#fff2f2",
		contentHtml,
		actionUrl: `${appUrl}/admin/mailhub/dlq?id=${encodeURIComponent(alert.dlqId)}`,
		actionText: "Inspect & Replay Dead Letter",
		appUrl,
	});

	const text = `
[MAILHUB CRITICAL] DEAD LETTER QUEUE ENQUEUED
=====================================================
Project:           ${alert.projectName} (${alert.projectId})
Recipient:         ${alert.recipient}
Subject:           ${alert.subject}
DLQ ID:            ${alert.dlqId}
Enqueued At:       ${new Date(alert.enqueuedAt).toISOString()}

Attempted Provider Failures:
${alert.attemptedProviders.map((p) => `- ${p.provider}: ${p.error}`).join("\n")}

Replay message or fix provider accounts:
${appUrl}/admin/mailhub/dlq?id=${alert.dlqId}
`.trim();

	return { subject, html, text };
}

/** 4. Render Daily Developer Digest (8:00 AM summary) */
export function renderDailyDigest(
	digest: DailyDigest,
	appUrl = "https://orbitmails.cloud",
): { subject: string; html: string; text: string } {
	const subject = `📊 [MailHub Digest] Daily Developer Briefing: ${digest.totalSent.toLocaleString()} emails sent (${digest.deliverySuccessRatePct.toFixed(1)}% success, ${formatCurrency(digest.totalCostUsd)})`;

	const projectsRowsHtml = digest.projects
		.map((p) => {
			const utilColor = p.quotaUtilizationPct >= 90 ? "#ff3b30" : p.quotaUtilizationPct >= 75 ? "#ff9500" : "#34c759";
			return `
      <tr>
        <td>
          <strong>${escapeHtml(p.name)}</strong><br/>
          <span style="font-size: 11px; color: #86868b;">${escapeHtml(p.slug)}</span>
        </td>
        <td><strong>${p.sent.toLocaleString()}</strong></td>
        <td>
          <span style="color: ${p.failed > 0 ? "#ff3b30" : "#34c759"}; font-weight: 600;">
            ${p.failed > 0 ? `${p.failed} fails` : "0 fails"}
          </span>
        </td>
        <td>
          <span style="color: ${utilColor}; font-weight: 600;">${p.quotaUtilizationPct.toFixed(0)}%</span>
          <span style="font-size: 11px; color: #86868b;">(${p.quotaUsed}/${p.quotaSlice})</span>
        </td>
        <td><span class="code-pill">${escapeHtml(p.primaryProvider)}</span></td>
        <td>${p.failoversTriggered > 0 ? `<span style="color: #ff9500; font-weight: 600;">${p.failoversTriggered}</span>` : "0"}</td>
        <td>${formatCurrency(p.costUsd)}</td>
      </tr>
    `;
		})
		.join("");

	const providerRowsHtml = digest.providers
		.map((pv) => {
			const statusColor = pv.status === "healthy" ? "#34c759" : pv.status === "degraded" ? "#ff9500" : "#ff3b30";
			const statusLabel = pv.status.toUpperCase().replace("_", " ");
			return `
      <tr>
        <td>
          <strong>${escapeHtml(pv.name)}</strong><br/>
          <span class="code-pill" style="font-size: 10px;">${escapeHtml(pv.provider)}</span>
        </td>
        <td>${pv.totalRequests.toLocaleString()}</td>
        <td><strong>${pv.successRatePct.toFixed(1)}%</strong></td>
        <td>${pv.avgLatencyMs.toFixed(0)} ms</td>
        <td>${pv.circuitBreakerTrips > 0 ? `<span style="color: #ff3b30; font-weight: 600;">${pv.circuitBreakerTrips}</span>` : "0"}</td>
        <td><span style="color: ${statusColor}; font-weight: 700; font-size: 11px;">● ${statusLabel}</span></td>
      </tr>
    `;
		})
		.join("");

	const recommendationsHtml = digest.recommendations.length
		? digest.recommendations.map((r) => `<li style="margin-bottom: 6px;">${escapeHtml(r)}</li>`).join("")
		: "<li>All quota allocations and provider health are optimal. No rebalancing needed.</li>";

	const warningsHtml = digest.warnings.length
		? digest.warnings.map((w) => `<div style="margin-bottom: 4px;">⚠️ ${escapeHtml(w)}</div>`).join("")
		: "";

	const contentHtml = `
    <div class="subtitle">
      Yesterday's email performance and infrastructure health across all 
      <strong>${digest.activeProjectsCount} active projects</strong>.
    </div>

    <div class="metric-row">
      <div class="metric-box">
        <div class="metric-label">Total Delivered</div>
        <div class="metric-value">${digest.totalSent.toLocaleString()}</div>
      </div>
      <div class="metric-box">
        <div class="metric-label">Success Rate</div>
        <div class="metric-value" style="color: #34c759;">${digest.deliverySuccessRatePct.toFixed(1)}%</div>
      </div>
      <div class="metric-box">
        <div class="metric-label">Failed / DLQ</div>
        <div class="metric-value" style="color: ${digest.totalFailed > 0 ? "#ff3b30" : "#1d1d1f"};">${digest.totalFailed}</div>
      </div>
      <div class="metric-box">
        <div class="metric-label">Total Cost</div>
        <div class="metric-value">${formatCurrency(digest.totalCostUsd)}</div>
      </div>
    </div>

    ${
			warningsHtml
				? `<div class="alert-callout" style="background-color: #fff9eb; border: 1px solid #ffe8b3; color: #7a4100;">
           <strong>Attention Required:</strong>
           ${warningsHtml}
         </div>`
				: ""
		}

    <div style="font-size: 14px; font-weight: 700; margin: 24px 0 8px; color: #1d1d1f;">Project Utilization Breakdown</div>
    <div style="overflow-x: auto;">
      <table class="data-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Sent</th>
            <th>Fails</th>
            <th>Quota Slice</th>
            <th>Primary</th>
            <th>Failovers</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          ${projectsRowsHtml}
        </tbody>
      </table>
    </div>

    <div style="font-size: 14px; font-weight: 700; margin: 24px 0 8px; color: #1d1d1f;">Provider Reliability & Latency Matrix</div>
    <div style="overflow-x: auto;">
      <table class="data-table">
        <thead>
          <tr>
            <th>Provider</th>
            <th>Volume</th>
            <th>Success %</th>
            <th>p95 Latency</th>
            <th>CB Trips</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${providerRowsHtml}
        </tbody>
      </table>
    </div>

    <div style="margin-top: 24px; padding: 16px; background-color: #f5f5f7; border-radius: 12px; border: 1px solid #e5e5ea;">
      <div style="font-size: 13px; font-weight: 700; margin-bottom: 8px; color: #1d1d1f;">💡 Proactive Optimization Insights</div>
      <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #424245; line-height: 1.5;">
        ${recommendationsHtml}
      </ul>
    </div>
  `;

	const html = wrapHtmlLayout({
		title: `Daily Developer Digest &bull; ${digest.date}`,
		badgeText: "24-Hour Developer Digest",
		badgeColor: "#0071e3",
		badgeBg: "#e8f2fd",
		contentHtml,
		actionUrl: `${appUrl}/admin/mailhub`,
		actionText: "Open MailHub Admin Console",
		appUrl,
	});

	const text = `
[MAILHUB DAILY DEVELOPER DIGEST] - ${digest.date}
=====================================================
Total Delivered:       ${digest.totalSent.toLocaleString()}
Delivery Success:      ${digest.deliverySuccessRatePct.toFixed(1)}%
Failed / DLQ:          ${digest.totalFailed}
Total Incurred Cost:   ${formatCurrency(digest.totalCostUsd)}
Active Projects:       ${digest.activeProjectsCount}

PROJECT USAGE SUMMARY:
${digest.projects
	.map(
		(p) =>
			`- ${p.name.padEnd(14)}: ${p.sent.toString().padStart(5)} sent | ${p.failed} fails | Quota: ${p.quotaUtilizationPct.toFixed(0)}% (${p.quotaUsed}/${p.quotaSlice}) | Cost: ${formatCurrency(p.costUsd)}`,
	)
	.join("\n")}

PROVIDER HEALTH MATRIX:
${digest.providers
	.map(
		(pv) =>
			`- ${pv.name.padEnd(16)}: ${pv.totalRequests.toString().padStart(5)} reqs | ${pv.successRatePct.toFixed(1)}% succ | ${pv.avgLatencyMs.toFixed(0)}ms | CB trips: ${pv.circuitBreakerTrips} | Status: ${pv.status.toUpperCase()}`,
	)
	.join("\n")}

RECOMMENDATIONS:
${digest.recommendations.map((r) => `* ${r}`).join("\n")}

View live dashboard:
${appUrl}/admin/mailhub
`.trim();

	return { subject, html, text };
}
