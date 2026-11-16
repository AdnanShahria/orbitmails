import { NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import { emailRouterSendLogs, messages, users } from "@/db/schema";
import { getEnv } from "@/lib/cloudflare";
import { authenticateIngestionRequest } from "@/lib/ingestion/auth";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";

export async function OPTIONS() {
	return new NextResponse(null, {
		status: 204,
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, OPTIONS",
			"Access-Control-Allow-Headers": "Authorization, Content-Type, api-key, x-api-key, x-resend-api-key",
			"Access-Control-Max-Age": "86400",
		},
	});
}

/**
 * Resend SDK Drop-in Endpoint: Retrieve Email by ID (`GET /emails/:id`)
 *
 * Developers using:
 * ```ts
 * const { data } = await resend.emails.get('msg_...');
 * ```
 */
export async function GET(
	request: Request,
	context: { params: Promise<{ id: string }> },
) {
	const env = getEnv();
	const authResult = await authenticateIngestionRequest(request, env);
	if (!authResult.success) {
		return authResult.response;
	}

	const { id } = await context.params;
	const db = getDb(env);

	const [message] = await db
		.select()
		.from(messages)
		.where(
			or(
				eq(messages.id, id),
				eq(messages.id, `<${id}>`),
				eq(messages.providerMessageId, id),
				eq(messages.providerMessageId, `<${id}>`),
			),
		)
		.limit(1);

	if (!message) {
		return NextResponse.json(
			{
				name: "not_found",
				message: `Email with ID '${id}' not found.`,
				statusCode: 404,
				error: "Not found",
			},
			{ status: 404 },
		);
	}

	const auth = authResult.auth;
	let hasAccess = false;

	if (auth.keyKind === "project") {
		if (message.userId === auth.userId) {
			hasAccess = true;
		} else if (auth.projectId) {
			const [sendLog] = await db
				.select({ id: emailRouterSendLogs.id })
				.from(emailRouterSendLogs)
				.where(
					and(
						eq(emailRouterSendLogs.projectId, auth.projectId),
						or(
							eq(emailRouterSendLogs.id, message.id),
							message.providerMessageId ? eq(emailRouterSendLogs.providerMessageId, message.providerMessageId) : undefined,
							eq(emailRouterSendLogs.providerMessageId, id),
							eq(emailRouterSendLogs.id, id),
						),
					),
				)
				.limit(1);
			if (sendLog) {
				hasAccess = true;
			}
		}
	} else {
		const [user] = await db.select().from(users).where(eq(users.id, auth.userId)).limit(1);
		if (user && !user.disabled) {
			if (message.mailboxId) {
				if (!auth.mailboxIds || auth.mailboxIds.includes(message.mailboxId)) {
					const access = await getMailboxAccessLevel(db, user, message.mailboxId);
					if (access?.canRead) {
						hasAccess = true;
					}
				}
			} else if (message.userId === user.id) {
				hasAccess = true;
			}
		}
	}

	if (!hasAccess) {
		return NextResponse.json(
			{
				name: "not_found",
				message: `Email with ID '${id}' not found.`,
				statusCode: 404,
				error: "Not found",
			},
			{ status: 404 },
		);
	}

	const lastEvent = message.status === "sent" ? "delivered" : message.status === "failed" ? "bounced" : message.status;

	return NextResponse.json(
		{
			object: "email",
			id: message.id,
			to: message.toAddr ? [message.toAddr] : [],
			from: message.fromAddr,
			created_at: message.createdAt ? new Date(message.createdAt).toISOString() : new Date().toISOString(),
			subject: message.subject,
			html: message.htmlBody,
			text: message.textBody,
			bcc: message.bccAddr ? [message.bccAddr] : null,
			cc: message.ccAddr ? [message.ccAddr] : null,
			reply_to: message.replyTo ? [message.replyTo] : null,
			last_event: lastEvent,
		},
		{
			status: 200,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Content-Type": "application/json",
			},
		},
	);
}
