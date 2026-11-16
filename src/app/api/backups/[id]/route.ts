import { NextResponse } from "next/server";
import { assertPrimaryAdmin } from "@/lib/auth/admin";
import { requireUser } from "@/lib/auth/cookies";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";
import { deleteBackup } from "@/lib/backups/service";
import { getEnv } from "@/lib/cloudflare";

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const env = getEnv();
	try {
		const user = await requireUser(env, request);
		assertPrimaryAdmin(user);
		if (!hasValidSessionMutationOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
		const { id } = await params;
		const deleted = await deleteBackup(env, id);
		if (!deleted) return NextResponse.json({ error: "Backup not found" }, { status: 404 });
		return NextResponse.json({ ok: true });
	} catch {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}
}
