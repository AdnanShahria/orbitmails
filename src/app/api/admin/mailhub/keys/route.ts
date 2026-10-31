import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { isPrimaryAdmin } from "@/lib/auth/admin";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";
import {
	createRoutingKey,
	revokeRoutingKey,
	getMailHubState,
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

const keyActionSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("generate"),
		projectId: z.string().min(1),
		name: z.string().trim().max(100).optional(),
		environment: z.enum(["live", "test"]).default("live"),
	}),
	z.object({
		action: z.literal("revoke"),
		keyId: z.string().min(1),
	}),
	z.object({
		action: z.literal("list"),
		projectId: z.string().optional(),
	}),
]);

export async function POST(request: Request) {
	const access = await authorize(request, true);
	if (access.error) return access.error;

	try {
		const body = await request.json().catch(() => null);
		const parsed = keyActionSchema.safeParse(body);
		if (!parsed.success) {
			return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
		}

		const data = parsed.data;

		if (data.action === "generate") {
			const { routingKey, fullKey } = await createRoutingKey(
				access.env as any,
				data.projectId,
				data.name,
				data.environment
			);
			return NextResponse.json({
				success: true,
				routingKey,
				fullKey, // Plaintext returned ONCE for modal copy
			});
		}

		if (data.action === "revoke") {
			const revoked = await revokeRoutingKey(access.env as any, data.keyId);
			if (!revoked) {
				return NextResponse.json({ error: "Routing key not found" }, { status: 404 });
			}
			return NextResponse.json({ success: true });
		}

		if (data.action === "list") {
			const state = await getMailHubState(access.env as any);
			const filtered = data.projectId
				? state.keys.filter((k) => k.projectId === data.projectId)
				: state.keys;
			return NextResponse.json({ success: true, keys: filtered });
		}

		return NextResponse.json({ error: "Invalid action" }, { status: 400 });
	} catch (err: any) {
		console.error("[POST /api/admin/mailhub/keys] Error:", err);
		return NextResponse.json({ error: err.message || "Key operation failed" }, { status: 500 });
	}
}
