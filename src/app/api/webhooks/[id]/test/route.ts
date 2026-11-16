import { NextResponse } from "next/server";
import { sendTestDelivery } from "@/lib/email/webhooks";
import { loadOwnedWebhook } from "../utils";
import type { WebhookRouteParams } from "../types";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";

export async function POST(request: Request, { params }: WebhookRouteParams) {
	if (!hasValidSessionMutationOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
	const { id } = await params;
	const loaded = await loadOwnedWebhook(request, id);
	if (loaded.error) return loaded.error;

	const result = await sendTestDelivery(loaded.env, loaded.hook);
	return NextResponse.json(result);
}
