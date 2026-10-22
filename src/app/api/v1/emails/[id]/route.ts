import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { getEnv } from "@/lib/cloudflare";
import { authenticateIngestionRequest } from "@/lib/ingestion/auth";

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
		.where(eq(messages.id, id))
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
			reply_to: null,
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
