import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { processIngestionRequest } from "@/lib/ingestion";

/**
 * Standard CORS preflight response
 */
export async function OPTIONS() {
	return new NextResponse(null, {
		status: 204,
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "POST, OPTIONS",
			"Access-Control-Allow-Headers": "Authorization, Content-Type, api-key, x-api-key, x-resend-api-key, Idempotency-Key",
			"Access-Control-Max-Age": "86400",
		},
	});
}

/**
 * Resend SDK Drop-in Batch Endpoint (`/emails/batch`, `/v1/emails/batch`, & `/api/v1/emails/batch`)
 *
 * Developers using the official Resend SDK batch send:
 * ```ts
 * const { data } = await resend.batch.send([
 *   { from: '...', to: ['...'], subject: '...' },
 *   { from: '...', to: ['...'], subject: '...' },
 * ]);
 * ```
 *
 * Returns:
 * `{ "data": [{ "id": "..." }, { "id": "..." }] }` (Status 200)
 */
export async function POST(request: Request) {
	const env = getEnv();
	const response = await processIngestionRequest(request, env, undefined, { forceBatch: true });

	response.headers.set("Access-Control-Allow-Origin", "*");
	return response;
}
