import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthGuard } from "@/components/auth/auth-guard";
import { SESSION_COOKIE, getUserFromSession } from "@/lib/auth/session";
import { hasAdminAccount } from "@/lib/auth/setup";
import { getEnv } from "@/lib/cloudflare";
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

	return (
		<AuthGuard mode="public">
			<SaasRegisterClient />
		</AuthGuard>
	);
}
