import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/api/auth";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";
import { getEnv } from "@/lib/cloudflare";
import { syncCloudflareDomains } from "@/lib/domains/cloudflare-sync";

export async function POST(request: Request) {
	const env = getEnv();
	const authSession = await requireSessionUser(env, request);
	if (authSession.error) return authSession.error;
	const user = authSession.user;
	if (!user.canManageDomains && !user.isPrimaryAdmin) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}
	if (!hasValidSessionMutationOrigin(request)) {
		return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
	}

	try {
		const result = await syncCloudflareDomains(env, user.id);
		return NextResponse.json({ ok: true, result });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to sync domains from Cloudflare";
		return NextResponse.json({ error: message }, { status: 502 });
	}
}

