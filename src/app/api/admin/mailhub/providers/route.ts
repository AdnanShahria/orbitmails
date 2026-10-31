import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { isPrimaryAdmin } from "@/lib/auth/admin";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";
import { updateProviderConfig, getMailHubState } from "@/lib/mailhub/storage";

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

const updateProviderSchema = z.object({
	providerId: z.string().min(1),
	label: z.string().trim().max(100).optional(),
	dailyLimit: z.number().int().min(1).optional(),
	enabled: z.boolean().optional(),
	apiKey: z.string().trim().optional(),
	secretKey: z.string().trim().optional(),
	region: z.string().trim().optional(),
	bounceAddress: z.string().trim().optional(),
});

export async function POST(request: Request) {
	const access = await authorize(request, true);
	if (access.error) return access.error;

	try {
		const body = await request.json().catch(() => null);
		const parsed = updateProviderSchema.safeParse(body);
		if (!parsed.success) {
			return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
		}

		const updated = await updateProviderConfig(
			access.env as any,
			parsed.data.providerId,
			parsed.data
		);

		return NextResponse.json({ success: true, provider: updated });
	} catch (err: any) {
		console.error("[POST /api/admin/mailhub/providers] Error:", err);
		return NextResponse.json({ error: err.message || "Failed to update provider" }, { status: 500 });
	}
}
