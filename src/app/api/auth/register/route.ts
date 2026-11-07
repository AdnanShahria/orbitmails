import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { domains, mailboxes, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { hasAdminAccount } from "@/lib/auth/setup";
import { ACCOUNTS_COOKIE, rememberLogin } from "@/lib/auth/accounts";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";
import { recordAuthActivity } from "@/lib/auth/activity";
import { newId } from "@/lib/ids";
import { firstRunRegisterSchema, registerSchema } from "@/lib/validators";
import { addDomainForUser } from "@/lib/domains/service";
import { rollbackDomainProvisioning } from "@/lib/domains/rollback";
import type { DomainProvisioningChanges } from "@/lib/domains/types";
import { ensureEmailRoutingRuleToWorker } from "@/lib/cloudflare-api";
import { ensureMailboxDomainRouting } from "@/lib/mailboxes/domain-addresses";
import { readJsonBody } from "@/lib/http/request";
import { RequestBodyTooLargeError } from "@/lib/http/errors";
import { verifyTurnstileToken } from "@/lib/auth/turnstile";
import { getDomainProvisioningError } from "@/lib/domains/errors";
import { ensureBookingUsername } from "@/lib/booking/username";

export async function GET() {
	const env = getEnv();
	const db = getDb(env);
	const hasAdmin = await hasAdminAccount(env);

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

	return NextResponse.json({
		hasAdmin,
		domains: hostnames,
	});
}

export async function POST(request: Request) {
	const env = getEnv();
	const db = getDb(env);

	let body: unknown;
	try {
		body = await readJsonBody(request, 16 * 1024);
	} catch (error) {
		const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
		return NextResponse.json({ error: "Invalid registration request" }, { status });
	}

	const bodyRecord = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
	if (!(await verifyTurnstileToken(env, request, bodyRecord.turnstileToken))) {
		return NextResponse.json({ error: "Verification failed. Please try again." }, { status: 400 });
	}

	const hasAdmin = await hasAdminAccount(env);

	// 1. If the platform is already initialized, allow public SaaS user registration
	if (hasAdmin) {
		let email = "";
		let localPart = "";
		let hostname = "";
		const rawUsername = typeof bodyRecord.username === "string" ? bodyRecord.username.trim() : "";
		const rawDomain = typeof bodyRecord.domain === "string" ? bodyRecord.domain.trim() : "";

		if (rawUsername && rawDomain) {
			localPart = rawUsername.toLowerCase().replace(/[^a-z0-9._-]/g, "");
			hostname = rawDomain.toLowerCase();
			email = `${localPart}@${hostname}`;
		} else {
			const parsed = registerSchema.safeParse(body);
			if (!parsed.success) {
				return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
			}
			email = parsed.data.email.toLowerCase().trim();
			const parts = email.split("@");
			localPart = parts[0] ?? "";
			hostname = parts[1] ?? "";
		}

		if (!email || !email.includes("@") || localPart.length === 0 || hostname.length < 3) {
			return NextResponse.json({ error: "Please enter a valid email address or username" }, { status: 400 });
		}

		const password = typeof bodyRecord.password === "string" ? bodyRecord.password : "";
		if (password.length < 8) {
			return NextResponse.json({ error: "Password must be at least 8 characters long" }, { status: 400 });
		}

		const name = (typeof bodyRecord.name === "string" && bodyRecord.name.trim()) || localPart;

		const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
		if (existing) {
			return NextResponse.json({ error: "This email address is already registered. Please choose another username or sign in." }, { status: 409 });
		}

		// Check if domain exists on platform and if localPart is already taken
		const [domainRecord] = await db.select().from(domains).where(eq(domains.hostname, hostname)).limit(1);
		if (domainRecord) {
			const [existingMailbox] = await db
				.select({ id: mailboxes.id })
				.from(mailboxes)
				.where(and(eq(mailboxes.domainId, domainRecord.id), eq(mailboxes.localPart, localPart)))
				.limit(1);
			if (existingMailbox) {
				return NextResponse.json({ error: "This mailbox handle is already taken. Please choose another username." }, { status: 409 });
			}
		}

		const userId = newId("usr");
		await db.insert(users).values({
			id: userId,
			remoteContentMode: "ask",
			email,
			passwordHash: hashPassword(password),
			name,
			role: "admin",
			isPrimaryAdmin: false,
			canManageDomains: true,
			canManageMailboxes: true,
		});

		// Auto-provision personal mailbox if domain is registered on the platform
		if (domainRecord && localPart) {
			const mailboxId = newId("mbx");
			try {
				await db.insert(mailboxes).values({
					id: mailboxId,
					userId,
					domainId: domainRecord.id,
					localPart,
					displayName: name,
					type: "personal",
				});
				await ensureMailboxDomainRouting(env, db, {
					id: mailboxId,
					domainId: domainRecord.id,
					localPart,
					useAllDomains: false,
				});
			} catch {
				// Best-effort mailbox creation
			}
		}

		const token = await createSession(env, userId);
		await recordAuthActivity(env, { action: "auth.login", userId, request });

		const response = NextResponse.json({ ok: true, token, redirect: "/inbox" });
		response.headers.set("Cache-Control", "no-store");
		response.cookies.set(SESSION_COOKIE, token, {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "lax",
			path: "/",
			maxAge: 60 * 60 * 24 * 30,
		});

		const accountsJar = await cookies();
		await rememberLogin(
			env,
			response,
			accountsJar.get(ACCOUNTS_COOKIE)?.value,
			token,
			accountsJar.get(SESSION_COOKIE)?.value,
		);
		return response;
	}

	// 2. Initial Setup Run (creating the first instance administrator)
	const firstRunParsed = firstRunRegisterSchema.safeParse(body);
	if (!firstRunParsed.success) {
		return NextResponse.json({ error: firstRunParsed.error.flatten() }, { status: 400 });
	}

	const domainName = firstRunParsed.data.domain.toLowerCase().trim();
	const username = firstRunParsed.data.username.toLowerCase().trim();
	const email = `${username}@${domainName}`;
	const password = firstRunParsed.data.password;
	const name = username;

	const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
	if (existing) {
		return NextResponse.json({ error: "Email already registered" }, { status: 409 });
	}

	const userId = newId("usr");
	await db.insert(users).values({
		id: userId,
		// Opening a message must not tell the sender; the column default predates this and stays "allow".
		remoteContentMode: "ask",
		email,
		resetEmail: firstRunParsed.data.resetEmail,
		passwordHash: hashPassword(password),
		name,
		role: "admin",
		isPrimaryAdmin: true,
	});

	// Tracks what the attempt changed on the Cloudflare zone so a failure can undo
	// precisely that. The DB is not a reliable source for this: the same errors that
	// abort registration (an unmigrated schema, a dead D1 binding) also stop the
	// domain row from ever being written, which is exactly when the orphaned zone
	// config would go unnoticed.
	let changes: DomainProvisioningChanges | null = null;
	try {
		await ensureBookingUsername(env, userId, email);
		const added = await addDomainForUser(env, userId, domainName, {
			enableRouting: true,
			enableSending: firstRunParsed.data.enableSending ?? true,
			replaceMxRecords: firstRunParsed.data.replaceMxRecords,
			skipDns: firstRunParsed.data.skipDns,
		});
		const domain = added.domain;
		changes = added.changes;
		await ensureEmailRoutingRuleToWorker(env, domain.zoneId, email);
		changes.createdAddressRules.push(email);
		const mailboxId = newId("mbx");
		await db.insert(mailboxes).values({
			id: mailboxId,
			userId,
			domainId: domain.id,
			localPart: username,
			displayName: username,
		});
		await ensureMailboxDomainRouting(env, db, { id: mailboxId, domainId: domain.id, localPart: username, useAllDomains: true });
	} catch (err) {
		if (changes) await rollbackDomainProvisioning(env, changes);
		try {
			// The domain row cascades with the user.
			await db.delete(users).where(eq(users.id, userId));
		} catch (cleanupError) {
			console.warn("Failed to remove the partial user after registration failure", cleanupError);
		}
		const failure = getDomainProvisioningError(err, "Domain setup failed", 502);
		return NextResponse.json(
			{ error: failure.message, code: failure.code },
			{ status: failure.status },
		);
	}

	const response = NextResponse.json({ ok: true, redirect: "/login" });
	response.headers.set("Cache-Control", "no-store");
	response.cookies.set(SESSION_COOKIE, "", {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		path: "/",
		maxAge: 0,
	});
	return response;
}
