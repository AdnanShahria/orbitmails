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
 * MailHub Drop-in Outbound Send Route (`/v1/send` & `/api/v1/send`)
 * Accepts:
 * - Resend format (`from`, `to`, `subject`, `html`, `text`, `attachments`, `headers`, `tags`, `reply_to`)
 * - Brevo format (`sender`, `to`, `subject`, `htmlContent`, `textContent`, `attachment`)
 * - RFC 5322 payloads (`From`, `To`, `Subject`, `raw`)
 * - Legacy Orbitflare payloads (`mailboxId`, `contentBase64`)
 *
 * Returns:
 * Standard Resend format `{ id: string }` and `{ messageId: string }`
 */
export async function POST(request: Request) {
	const env = getEnv();
	const response = await processIngestionRequest(request, env);

	// Add CORS headers to response
	response.headers.set("Access-Control-Allow-Origin", "*");
	return response;
}
