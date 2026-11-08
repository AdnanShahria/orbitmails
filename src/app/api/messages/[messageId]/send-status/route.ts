import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { messages, outboundJobs } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";

/**
 * Lightweight delivery status for the compose toast. It deliberately returns only
 * the message status so polling does not load the body, attachments or thread.
 */
export async function GET(
	request: Request,
	{ params }: { params: Promise<{ messageId: string }> },
) {
	const { messageId } = await params;
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const db = getDb(env);
	const [message] = await db
		.select({ mailboxId: messages.mailboxId, status: messages.status })
		.from(messages)
		.where(eq(messages.id, messageId))
		.limit(1);
	if (!message?.mailboxId) return NextResponse.json({ error: "Message not found" }, { status: 404 });

	const access = await getMailboxAccessLevel(db, user, message.mailboxId);
	if (!access?.canRead) return NextResponse.json({ error: "Message not found" }, { status: 404 });

	let error: string | undefined;
	if (message.status === "failed") {
		const [job] = await db
			.select({ error: outboundJobs.error })
			.from(outboundJobs)
			.where(eq(outboundJobs.messageId, messageId))
			.limit(1);
		if (job?.error) error = job.error;
	}

	return NextResponse.json({ status: message.status, ...(error ? { error } : {}) }, { headers: { "Cache-Control": "no-store" } });
}
