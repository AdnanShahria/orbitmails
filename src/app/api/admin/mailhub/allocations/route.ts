import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { isPrimaryAdmin } from "@/lib/auth/admin";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";
import {
	getMailHubState,
	updateProviderSlices,
	type AllocationSlice,
} from "@/lib/mailhub/storage";

async function authorize(request: Request, isMutation = false) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
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

const updateAllocationsSchema = z.object({
	providerId: z.string().min(1),
	slices: z.array(
		z.object({
			projectId: z.string().min(1),
			dailySlice: z.number().int().min(0),
		})
	),
});

export async function GET(request: Request) {
	const access = await authorize(request, false);
	if (access.error) return access.error;

	try {
		const state = await getMailHubState(access.env as any);

		// Calculate aggregated sums for each provider
		const providersWithStats = state.providers.map((prov) => {
			const provAllocations = state.allocations.filter((a) => a.providerId === prov.id);
			const totalAllocated = provAllocations.reduce((sum, a) => sum + a.dailySlice, 0);
			const totalUsedToday = provAllocations.reduce((sum, a) => sum + (a.usedToday || 0), 0);
			const remainingBuffer = Math.max(0, prov.dailyLimit - totalAllocated);
			const isOverAllocated = totalAllocated > prov.dailyLimit;

			return {
				...prov,
				totalAllocated,
				totalUsedToday,
				remainingBuffer,
				isOverAllocated,
				overAllocatedBy: isOverAllocated ? totalAllocated - prov.dailyLimit : 0,
			};
		});

		// Aggregate system-wide summary
		const totalDailyCapacity = providersWithStats.reduce((sum, p) => sum + p.dailyLimit, 0);
		const totalAllocated = providersWithStats.reduce((sum, p) => sum + p.totalAllocated, 0);
		const totalUsedToday = providersWithStats.reduce((sum, p) => sum + p.totalUsedToday, 0);

		return NextResponse.json(
			{
				providers: providersWithStats,
				projects: state.projects,
				allocations: state.allocations,
				keys: state.keys.map((k) => ({
					id: k.id,
					projectId: k.projectId,
					name: k.name,
					prefix: k.prefix,
					displayPrefix: k.displayPrefix,
					environment: k.environment,
					status: k.status,
					createdAt: k.createdAt,
					lastUsedAt: k.lastUsedAt,
				})),
				summary: {
					totalDailyCapacity,
					totalAllocated,
					totalUsedToday,
					providerCount: state.providers.length,
					projectCount: state.projects.length,
				},
			},
			{ headers: { "Cache-Control": "no-store" } }
		);
	} catch (err: any) {
		console.error("[GET /api/admin/mailhub/allocations] Error:", err);
		return NextResponse.json({ error: err.message || "Failed to load allocations" }, { status: 500 });
	}
}

export async function POST(request: Request) {
	const access = await authorize(request, true);
	if (access.error) return access.error;

	try {
		const body = await request.json().catch(() => null);
		const parsed = updateAllocationsSchema.safeParse(body);
		if (!parsed.success) {
			return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
		}

		const result = await updateProviderSlices(
			access.env as any,
			parsed.data.providerId,
			parsed.data.slices
		);

		if (!result.success) {
			return NextResponse.json(
				{
					error: result.error,
					totalAllocated: result.totalAllocated,
					limit: result.limit,
				},
				{ status: 422 }
			);
		}

		return NextResponse.json({
			success: true,
			totalAllocated: result.totalAllocated,
			limit: result.limit,
		});
	} catch (err: any) {
		console.error("[POST /api/admin/mailhub/allocations] Error:", err);
		return NextResponse.json({ error: err.message || "Failed to update allocations" }, { status: 500 });
	}
}
