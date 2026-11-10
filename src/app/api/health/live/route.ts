import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness probe: checks whether the application process / Worker is alive and responsive.
 * Used by Kubernetes, ECS, Nomad, Docker Swarm, and edge orchestrators.
 */
export async function GET() {
	const uptimeSeconds = typeof process !== "undefined" && typeof process.uptime === "function"
		? Math.floor(process.uptime())
		: 0;

	return NextResponse.json(
		{
			status: "ok",
			service: "orbitmails",
			timestamp: new Date().toISOString(),
			uptime: uptimeSeconds,
		},
		{
			status: 200,
			headers: {
				"Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
				"Content-Type": "application/json",
			},
		},
	);
}

