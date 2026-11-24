import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readSrc = (rel) => readFileSync(join(root, rel), "utf8");

test("public registration never grants admin role or domain management permissions", () => {
	const src = readSrc("src/app/api/auth/register/route.ts");
	const publicBranchStart = src.indexOf("if (hasAdmin)");
	const setupBranchStart = src.indexOf("// 2. Initial Setup Run");
	assert.ok(publicBranchStart !== -1 && setupBranchStart !== -1);
	const publicBranch = src.slice(publicBranchStart, setupBranchStart);

	assert.match(publicBranch, /role:\s*"user"/);
	assert.match(publicBranch, /isPrimaryAdmin:\s*false/);
	assert.match(publicBranch, /canManageDomains:\s*false/);
	assert.match(publicBranch, /canManageMailboxes:\s*false/);
	assert.doesNotMatch(publicBranch, /role:\s*"admin"/);
	assert.doesNotMatch(publicBranch, /canManageDomains:\s*true/);
});

test("Cloudflare OAuth callback escapes HTML output and verifies admin permissions before saving tokens", () => {
	const callback = readSrc("src/app/api/auth/cloudflare/callback/route.ts");
	assert.match(callback, /escapeHtml/);
	assert.ok(
		callback.includes("!user.canManageDomains && !user.isPrimaryAdmin"),
		"callback must require domain management permissions",
	);

	const login = readSrc("src/app/api/auth/cloudflare/login/route.ts");
	assert.ok(
		login.includes("!user.canManageDomains && !user.isPrimaryAdmin"),
		"login route must require domain management permissions",
	);
	assert.doesNotMatch(login, /postMessage\([^)]*,\s*['"]\*['"]\)/, "must not postMessage with wildcard targetOrigin");
});

test("privileged Cloudflare and admin update mutations enforce session origin validation", () => {
	const protectedRoutes = [
		"src/app/api/auth/cloudflare/token-connect/route.ts",
		"src/app/api/auth/cloudflare/save-oauth/route.ts",
		"src/app/api/auth/cloudflare/sync/route.ts",
		"src/app/api/admin/update/POST.ts",
	];
	for (const rel of protectedRoutes) {
		const src = readSrc(rel);
		assert.match(src, /hasValidSessionMutationOrigin\(/, `${rel} must enforce hasValidSessionMutationOrigin`);
	}

	const updateUtils = readSrc("src/app/api/admin/update/utils.ts");
	assert.match(updateUtils, /\^\[A-Za-z0-9_.-\]\+\\\/\[A-Za-z0-9_.-\]\+\$/, "GITHUB_UPDATE_REPO must be validated as owner/repo");
	assert.doesNotMatch(updateUtils, /console\.log\(\s*["']\[gg\]/, "debug logging must be removed");
});
