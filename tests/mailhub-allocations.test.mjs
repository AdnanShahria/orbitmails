import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "mailhub-allocations-test-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

async function bundle(entry, outfile) {
	await build({
		entryPoints: [join(root, entry)],
		outfile: join(outDir, outfile),
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node22",
		logLevel: "silent",
		alias: { "@": join(root, "src") },
	});
	return import(pathToFileURL(join(outDir, outfile)).href);
}

const storage = await bundle("src/lib/mailhub/storage.ts", "storage.mjs");
const {
	getMailHubState,
	updateProviderSlices,
	updateProjectFallbackOrder,
	createProject,
	createRoutingKey,
	revokeRoutingKey,
	updateProviderConfig,
	DEFAULT_MAILHUB_STATE,
} = storage;

test("MailHub Allocations - Initial Seed Verification", async () => {
	const state = await getMailHubState({});
	assert.ok(state.projects.length >= 4);
	assert.ok(state.providers.some((p) => p.id === "cred_brevo_main" && p.dailyLimit === 300));

	const brevoAllocations = state.allocations.filter((a) => a.providerId === "cred_brevo_main");
	const totalBrevoSlices = brevoAllocations.reduce((sum, a) => sum + a.dailySlice, 0);
	assert.equal(totalBrevoSlices, 300, "Initial Brevo allocations must sum to exactly 300");

	// Check individual project slices
	const aurelia = brevoAllocations.find((a) => a.projectId === "proj_aurelia");
	const lifesolver = brevoAllocations.find((a) => a.projectId === "proj_lifesolver");
	const luvio = brevoAllocations.find((a) => a.projectId === "proj_luvio");
	const ovijatric = brevoAllocations.find((a) => a.projectId === "proj_ovijatric");

	assert.equal(aurelia.dailySlice, 120);
	assert.equal(lifesolver.dailySlice, 80);
	assert.equal(luvio.dailySlice, 60);
	assert.equal(ovijatric.dailySlice, 40);
});

test("MailHub Allocations - Valid Slice Rebalancing", async () => {
	// Rebalance Brevo: Aurelia: 100, LifeSolver: 100, Luvio: 50, Ovijatric: 50 -> sum = 300
	const result = await updateProviderSlices({}, "cred_brevo_main", [
		{ projectId: "proj_aurelia", dailySlice: 100 },
		{ projectId: "proj_lifesolver", dailySlice: 100 },
		{ projectId: "proj_luvio", dailySlice: 50 },
		{ projectId: "proj_ovijatric", dailySlice: 50 },
	]);

	assert.equal(result.success, true);
	assert.equal(result.totalAllocated, 300);
	assert.equal(result.limit, 300);

	const state = await getMailHubState({});
	const aurelia = state.allocations.find((a) => a.providerId === "cred_brevo_main" && a.projectId === "proj_aurelia");
	assert.equal(aurelia.dailySlice, 100);
});

test("MailHub Allocations - Over-Allocation Prevention & Real-time Warning", async () => {
	// Attempt to allocate 350 on Brevo (limit 300)
	const result = await updateProviderSlices({}, "cred_brevo_main", [
		{ projectId: "proj_aurelia", dailySlice: 150 },
		{ projectId: "proj_lifesolver", dailySlice: 100 },
		{ projectId: "proj_luvio", dailySlice: 60 },
		{ projectId: "proj_ovijatric", dailySlice: 40 },
	]);

	assert.equal(result.success, false);
	assert.equal(result.totalAllocated, 350);
	assert.equal(result.limit, 300);
	assert.ok(result.error?.includes("exceeds provider limit"));
});

test("MailHub Project Waterfall - Priority Reordering", async () => {
	// Change Aurelia's order to: Resend -> Brevo -> SES
	const result = await updateProjectFallbackOrder({}, "proj_aurelia", [
		"cred_resend_main",
		"cred_brevo_main",
		"cred_ses_backup",
	]);

	assert.equal(result.success, true);

	const state = await getMailHubState({});
	const aurelia = state.projects.find((p) => p.id === "proj_aurelia");
	assert.deepEqual(aurelia.providerOrder, ["cred_resend_main", "cred_brevo_main", "cred_ses_backup"]);

	const resendAlloc = state.allocations.find((a) => a.projectId === "proj_aurelia" && a.providerId === "cred_resend_main");
	const brevoAlloc = state.allocations.find((a) => a.projectId === "proj_aurelia" && a.providerId === "cred_brevo_main");
	assert.equal(resendAlloc.priority, 1);
	assert.equal(brevoAlloc.priority, 2);
});

test("MailHub Routing Keys - Creation & One-Click Format", async () => {
	const { routingKey, fullKey } = await createRoutingKey({}, "proj_aurelia", "Staging Runner", "live");

	assert.ok(fullKey.startsWith("om_live_aurelia_"));
	assert.equal(routingKey.projectId, "proj_aurelia");
	assert.equal(routingKey.status, "active");
	assert.ok(routingKey.displayPrefix.includes("om_live_aurelia_"));
	assert.ok(routingKey.displayPrefix.includes("••••••••"));
	assert.ok(routingKey.keyHash.length === 64, "SHA-256 hash must be 64 hex characters");

	// Test revocation
	const revoked = await revokeRoutingKey({}, routingKey.id);
	assert.equal(revoked, true);

	const state = await getMailHubState({});
	const found = state.keys.find((k) => k.id === routingKey.id);
	assert.equal(found.status, "revoked");
});
