import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { isPrimaryAdmin } from "@/lib/auth/admin";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";
import {
	createProject,
	updateProjectFallbackOrder,
	getMailHubState,
	saveMailHubState,
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

const actionSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("create"),
		name: z.string().trim().min(2).max(64),
		slug: z.string().trim().min(2).max(32).optional(),
		description: z.string().trim().max(255).optional(),
	}),
	z.object({
		action: z.literal("update_order"),
		projectId: z.string().min(1),
		providerOrder: z.array(z.string().min(1)).min(1),
	}),
	z.object({
		action: z.literal("update_status"),
		projectId: z.string().min(1),
		status: z.enum(["active", "paused", "archived"]),
	}),
	z.object({
		action: z.literal("delete"),
		projectId: z.string().min(1),
	}),
]);

export async function POST(request: Request) {
	const access = await authorize(request, true);
	if (access.error) return access.error;

	try {
		const body = await request.json().catch(() => null);
		const parsed = actionSchema.safeParse(body);
		if (!parsed.success) {
			return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
		}

		const data = parsed.data;

		if (data.action === "create") {
			const { project, key } = await createProject(access.env as any, {
				name: data.name,
				slug: data.slug,
				description: data.description,
			});
			return NextResponse.json({ success: true, project, key });
		}

		if (data.action === "update_order") {
			const result = await updateProjectFallbackOrder(
				access.env as any,
				data.projectId,
				data.providerOrder
			);
			if (!result.success) {
				return NextResponse.json({ error: result.error }, { status: 404 });
			}
			return NextResponse.json({ success: true });
		}

		if (data.action === "update_status") {
			const state = await getMailHubState(access.env as any);
			const proj = state.projects.find((p) => p.id === data.projectId);
			if (!proj) return NextResponse.json({ error: "Project not found" }, { status: 404 });

			proj.status = data.status;
			proj.updatedAt = new Date().toISOString();
			await saveMailHubState(access.env as any, state);
			return NextResponse.json({ success: true, project: proj });
		}

		if (data.action === "delete") {
			const state = await getMailHubState(access.env as any);
			state.projects = state.projects.filter((p) => p.id !== data.projectId);
			state.allocations = state.allocations.filter((a) => a.projectId !== data.projectId);
			state.keys = state.keys.filter((k) => k.projectId !== data.projectId);
			await saveMailHubState(access.env as any, state);
			return NextResponse.json({ success: true });
		}

		return NextResponse.json({ error: "Invalid action" }, { status: 400 });
	} catch (err: any) {
		console.error("[POST /api/admin/mailhub/projects] Error:", err);
		return NextResponse.json({ error: err.message || "Operation failed" }, { status: 500 });
	}
}
