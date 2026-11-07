import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { AuthGuard } from "@/components/auth/auth-guard";
import { SESSION_COOKIE, getUserFromSession } from "@/lib/auth/session";
import { hasAdminAccount } from "@/lib/auth/setup";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { domains } from "@/db/schema";
import { SaasRegisterClient } from "./saas-register-client";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
	const env = getEnv();
	const hasAdmin = await hasAdminAccount(env);

	// If no admin account exists yet, instance must be initialized via setup
	if (!hasAdmin) {
		redirect("/setup");
	}

	const cookieStore = await cookies();
	const user = await getUserFromSession(env, cookieStore.get(SESSION_COOKIE)?.value).catch(() => null);
	if (user && !user.disabled) {
		redirect("/inbox");
	}

	const db = getDb(env);
	let activeDomains = await db
		.select({ hostname: domains.hostname })
		.from(domains)
		.where(eq(domains.status, "active"))
		.limit(10);

	if (activeDomains.length === 0) {
		const [firstDomain] = await db.select({ hostname: domains.hostname }).from(domains).limit(1);
		if (firstDomain) activeDomains = [firstDomain];
	}

	const hostnames = activeDomains.map((d) => d.hostname);
	if (hostnames.length === 0) {
		hostnames.push(env.APP_URL ? new URL(env.APP_URL).hostname : "orbitmails.com");
	}

	return (
		<AuthGuard mode="public">
			<SaasRegisterClient availableDomains={hostnames} />
		</AuthGuard>
	);
}
