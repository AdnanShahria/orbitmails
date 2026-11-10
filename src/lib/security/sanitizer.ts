/**
 * OrbitMails - Strict Input Sanitization & Payload Validation
 * @module lib/security/sanitizer
 */

import { NextResponse } from "next/server";
import { type ZodSchema, ZodError } from "zod";
import { readJsonBody } from "@/lib/http/request";
import { RequestBodyTooLargeError } from "@/lib/http/errors";

/**
 * Strips dangerous control characters and CRLF injection sequences.
 * Critical for preventing SMTP/email header injection (e.g. \r\nBcc: victim@example.com).
 */
export function sanitizeHeaderValue(value: string): string {
	return value.replace(/[\r\n\0]/g, "").trim();
}

/**
 * Strips null bytes from text payloads.
 */
export function stripNullBytes(value: string): string {
	return value.replace(/\0/g, "");
}

/**
 * Basic HTML escaping for untrusted plain text rendered in HTML contexts.
 */
export function escapeHtml(unsafe: string): string {
	return unsafe
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

export interface ValidationSuccess<T> {
	success: true;
	data: T;
	errorResponse: null;
}

export interface ValidationFailure {
	success: false;
	data: null;
	errorResponse: NextResponse;
}

export type ValidationOutcome<T> = ValidationSuccess<T> | ValidationFailure;

/**
 * Validates and sanitizes incoming JSON request body against a strict Zod schema.
 */
export async function validateJsonPayload<T>(
	request: Request,
	schema: ZodSchema<T>,
	maxBytes = 1024 * 1024, // 1MB default
): Promise<ValidationOutcome<T>> {
	try {
		const raw = await readJsonBody<unknown>(request, maxBytes);
		const parsed = schema.parse(raw);
		return { success: true, data: parsed, errorResponse: null };
	} catch (error) {
		if (error instanceof RequestBodyTooLargeError) {
			return {
				success: false,
				data: null,
				errorResponse: NextResponse.json(
					{ error: "Payload Too Large", message: "Request body exceeds maximum allowed size" },
					{ status: 413 },
				),
			};
		}

		if (error instanceof ZodError) {
			const formattedIssues = error.issues.map((issue) => ({
				field: issue.path.join("."),
				message: issue.message,
			}));

			return {
				success: false,
				data: null,
				errorResponse: NextResponse.json(
					{
						error: "Invalid request payload",
						issues: formattedIssues,
					},
					{ status: 400 },
				),
			};
		}

		return {
			success: false,
			data: null,
			errorResponse: NextResponse.json(
				{ error: "Bad Request", message: "Malformed JSON payload" },
				{ status: 400 },
			),
		};
	}
}

