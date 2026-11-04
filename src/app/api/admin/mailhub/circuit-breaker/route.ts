import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { isPrimaryAdmin } from "@/lib/auth/admin";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";
import { defaultCircuitBreaker } from "@/lib/mailhub/circuit-breaker";
import { getMailHubState } from "@/lib/mailhub/storage";

async function authorize(request: Request, isMutation = false) {
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
	if (isMutation && !hasValidSessionMutationOrigin(request)) {
		if (process.env.NODE_ENV !== "development") {
			return { env, user: null, error: NextResponse.json({ error: "Invalid origin" }, { status: 403 }) };
		}
	}
	return { env, user: auth.user, error: null };
}

const circuitBreakerActionSchema = z.object({
	action: z.enum(["reset", "trip"]),
	providerCredId: z.string().min(1),
	reason: z.string().optional(),
});

export async function GET(request: Request) {
	const access = await authorize(request, false);
	if (access.error) return access.error;

	try {
		const { searchParams } = new URL(request.url);
		const providerCredId = searchParams.get("providerCredId");

		if (providerCredId) {
			const record = await defaultCircuitBreaker.getState(providerCredId, access.env as any);
			return NextResponse.json({ success: true, record });
		}

		const state = await getMailHubState(access.env as any);
		const records = await Promise.all(
			state.providers.map(async (p) => {
				const rec = await defaultCircuitBreaker.getState(p.id, access.env as any);
				return {
					providerId: p.id,
					provider: p.provider,
					label: p.label,
					...rec,
				};
			})
		);

		return NextResponse.json({ success: true, records });
	} catch (err: any) {
		console.error("[GET /api/admin/mailhub/circuit-breaker] Error:", err);
		return NextResponse.json(
			{ error: err.message || "Failed to inspect circuit breaker state" },
			{ status: 500 }
		);
	}
}

export async function POST(request: Request) {
	const access = await authorize(request, true);
	if (access.error) return access.error;

	try {
		const body = await request.json().catch(() => null);
		const parsed = circuitBreakerActionSchema.safeParse(body);
		if (!parsed.success) {
			return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
		}

		const data = parsed.data;
		const state = await getMailHubState(access.env as any);

		// Resolve provider ID from either cred ID (e.g. cred_brevo_main) or slug (e.g. brevo)
		const matchedProvider = state.providers.find(
			(p) => p.id === data.providerCredId || p.provider === data.providerCredId
		);

		const targetId = matchedProvider ? matchedProvider.id : data.providerCredId;

		if (data.action === "reset") {
			const record = await defaultCircuitBreaker.reset(targetId, access.env as any);

			// Also reset the slug key if different (e.g. "brevo" vs "cred_brevo_main")
			if (matchedProvider && matchedProvider.provider !== targetId) {
				await defaultCircuitBreaker.reset(matchedProvider.provider, access.env as any);
			}

			return NextResponse.json({ success: true, record });
		}

		if (data.action === "trip") {
			const recordResult = await defaultCircuitBreaker.recordFailure(
				targetId,
				{
					message: data.reason || "Administrative manual circuit breaker trip",
					code: "TRANSIENT_SERVER_ERROR",
				},
				access.env as any
			);
			return NextResponse.json({ success: true, record: recordResult.record });
		}

		return NextResponse.json({ error: "Unknown action" }, { status: 400 });
	} catch (err: any) {
		console.error("[POST /api/admin/mailhub/circuit-breaker] Error:", err);
		return NextResponse.json(
			{ error: err.message || "Failed to update circuit breaker state" },
			{ status: 500 }
		);
	}
}
