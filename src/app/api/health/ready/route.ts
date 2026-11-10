import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";

export const dynamic = "force-dynamic";

/**
 * Readiness probe: checks whether the application is ready to accept and handle traffic.
 * Validates connectivity to the primary database and storage.
 * Fails with 503 Service Unavailable if a critical dependency is down.
 */
export async function GET() {
	const checks: Record<string, "ok" | "degraded" | "error"> = {
		database: "error",
		storage: "error",
	};

	let isReady = true;

	try {
		const env = getEnv();

		// Database check
		try {
			const db = getDb(env);
			await db.run(sql`SELECT 1`);
			checks.database = "ok";
		} catch (dbErr) {
			console.error("[Health Ready] Database probe failed:", dbErr);
			checks.database = "error";
			isReady = false;
		}

		// Storage check (R2 / FileBucket)
		try {
			if (env.BUCKET) {
				// Lightweight check without mutating bucket
				if (typeof env.BUCKET.list === "function") {
					await env.BUCKET.list({ limit: 1 });
				}
				checks.storage = "ok";
			} else {
				checks.storage = "degraded";
			}
		} catch (storageErr) {
			console.warn("[Health Ready] Storage probe degraded:", storageErr);
			checks.storage = "degraded";
		}

		const status = isReady ? 200 : 503;
		return NextResponse.json(
			{
				status: isReady ? "ready" : "unhealthy",
				timestamp: new Date().toISOString(),
				checks,
			},
			{
				status,
				headers: {
					"Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
					"Content-Type": "application/json",
				},
			},
		);
	} catch (err) {
		console.error("[Health Ready] Unexpected failure:", err);
		return NextResponse.json(
			{
				status: "unhealthy",
				timestamp: new Date().toISOString(),
				error: "Readiness probe failed",
				checks,
			},
			{
				status: 503,
				headers: {
					"Cache-Control": "no-store, no-cache, must-revalidate",
				},
			},
		);
	}
}

