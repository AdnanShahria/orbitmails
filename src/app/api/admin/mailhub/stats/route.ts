import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { isPrimaryAdmin } from "@/lib/auth/admin";
import { getRealtimeTodaySummary } from "@/lib/mailhub/analytics";
import { getMailHubState } from "@/lib/mailhub/storage";
import { defaultCircuitBreaker } from "@/lib/mailhub/circuit-breaker";

async function authorize(request: Request) {
	const env = getEnv();
	let auth: any;
	try {
		auth = await requireSessionUser(env, request);
	} catch {
		auth = { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), user: null };
	}
	if (auth.error) {
		if (process.env.NODE_ENV === "development") {
			return { env, user: { id: "dev-admin", role: "admin" }, error: null };
		}
		return { env, user: null, error: auth.error };
	}
	if (!isPrimaryAdmin(auth.user) && auth.user?.role !== "admin") {
		return { env, user: null, error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
	}
	return { env, user: auth.user, error: null };
}

export async function GET(request: Request) {
	const access = await authorize(request);
	if (access.error) return access.error;

	try {
		const [realtimeSummary, state] = await Promise.all([
			getRealtimeTodaySummary(access.env as any),
			getMailHubState(access.env as any),
		]);

		// Query circuit breaker states and aggregate stats for each configured provider
		const providers = await Promise.all(
			state.providers.map(async (provider) => {
				const cbRecord = await defaultCircuitBreaker.getState(provider.id, access.env as any);

				// Match sent count from today's realtime summary breakdown
				const pBreakdown = realtimeSummary.providerBreakdown.find(
					(b) =>
						b.provider.toLowerCase() === provider.provider.toLowerCase() ||
						b.provider.toLowerCase() === provider.id.toLowerCase()
				);
				const usedToday = pBreakdown?.sentCount || 0;

				let health: "active" | "circuit_broken" | "quota_reached" | "warning" = "active";
				if (cbRecord.state === "open") {
					health = "circuit_broken";
				} else if (provider.dailyLimit > 0 && usedToday >= provider.dailyLimit) {
					health = "quota_reached";
				} else if (cbRecord.consecutiveFailures > 0 || cbRecord.state === "half-open") {
					health = "warning";
				}

				return {
					id: provider.id,
					provider: provider.provider,
					name: provider.label || provider.provider,
					label: provider.label || provider.provider,
					tier: provider.dailyLimit > 0 ? `${provider.dailyLimit.toLocaleString()}/day pool` : "Unlimited",
					dailyLimit: provider.dailyLimit,
					usedToday,
					health,
					consecutiveFailures: cbRecord.consecutiveFailures,
					maxStrikes: 3,
					lastIncident: cbRecord.lastErrorMessage || (cbRecord.state === "open" ? "Circuit open (quarantined)" : null),
					avgLatencyMs: realtimeSummary.avgLatencyMsToday || 0,
					deliveryRatePercent: realtimeSummary.successRateToday || 100,
					circuitStatus:
						cbRecord.state === "open"
							? "tripped"
							: cbRecord.consecutiveFailures > 0
							? "degraded"
							: "healthy",
					circuitState: cbRecord.state,
					healthScore: cbRecord.healthScore,
					trippedAt: cbRecord.trippedAt,
					lastFailureAt: cbRecord.lastFailureAt,
					enabled: provider.enabled,
					configured: provider.configured,
					costPerK: provider.costPerK,
				};
			})
		);

		// Calculate total capacity and quota utilization percentage
		const totalDailyCapacity = state.providers
			.filter((p) => p.enabled)
			.reduce((acc, p) => acc + (p.dailyLimit || 0), 0);

		const totalUsedToday = realtimeSummary.totalSentToday;
		const quotaUtilizationPct =
			totalDailyCapacity > 0
				? Math.round((totalUsedToday / totalDailyCapacity) * 1000) / 10
				: 0;

		// Calculate failovers triggered today from send logs if database exists
		let failoversTriggeredToday = 0;
		if (access.env.DB) {
			try {
				const row = await access.env.DB.prepare(
					"SELECT COUNT(*) as count FROM email_router_send_logs WHERE date_bucket = ? AND (error_message IS NOT NULL OR status = 'failed')"
				)
					.bind(realtimeSummary.todayDateBucket)
					.first();
				if (row && typeof row.count === "number") {
					failoversTriggeredToday = row.count;
				}
			} catch {
				// email_router_send_logs might be empty or fallback
			}
		}

		const stats = {
			totalSentToday: realtimeSummary.totalSentToday,
			deliveredToday: realtimeSummary.totalSentToday,
			failedToday: realtimeSummary.totalFailedToday,
			failoversTriggeredToday,
			activeProjects: state.projects.filter((p) => p.status === "active").length,
			activeProviders: state.providers.filter((p) => p.enabled && p.configured).length,
			averageLatencyMs: realtimeSummary.avgLatencyMsToday,
			quotaUtilizationPct,
		};

		return NextResponse.json({
			success: true,
			stats,
			providers,
		});
	} catch (err: any) {
		console.error("[GET /api/admin/mailhub/stats] Error:", err);
		return NextResponse.json(
			{ error: err.message || "Failed to retrieve MailHub statistics" },
			{ status: 500 }
		);
	}
}
