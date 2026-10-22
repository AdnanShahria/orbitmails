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
 * Resend SDK Drop-in Endpoint (`/emails`, `/v1/emails`, & `/api/v1/emails`)
 *
 * Developers using the official Resend SDK simply configure:
 * ```ts
 * const resend = new Resend('om_live_aurelia_secret', {
 *   baseUrl: 'https://mailhub.domain.com/v1',
 * });
 * const { data, error } = await resend.emails.send({ ... });
 * ```
 *
 * Returns:
 * `{ "id": "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" }` (Status 200)
 */
export async function POST(request: Request) {
	const env = getEnv();
	const response = await processIngestionRequest(request, env);

	response.headers.set("Access-Control-Allow-Origin", "*");
	return response;
}
