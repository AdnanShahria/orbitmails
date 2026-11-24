import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDir = join(root, ".github", "workflows");

function listWorkflowFiles() {
	return readdirSync(workflowsDir)
		.filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
		.map((name) => ({ name, path: join(workflowsDir, name), content: readFileSync(join(workflowsDir, name), "utf8") }));
}

test("GitHub Actions workflows declare least-privilege permissions", () => {
	for (const wf of listWorkflowFiles()) {
		assert.match(wf.content, /^permissions:\s*$/m, `${wf.name} must declare explicit permissions`);
		assert.doesNotMatch(wf.content, /permissions:\s*write-all/i, `${wf.name} must not grant write-all`);
	}
});

test("GitHub Actions workflows pin third-party actions to full 40-char commit SHAs", () => {
	const usesPattern = /^\s*-?\s*uses:\s*([^\s#]+)/gm;
	for (const wf of listWorkflowFiles()) {
		for (const match of wf.content.matchAll(usesPattern)) {
			const target = match[1];
			if (target.startsWith("./")) continue;
			assert.match(
				target,
				/@[0-9a-f]{40}$/i,
				`${wf.name} uses unpinned action "${target}"; pin to a 40-char commit SHA`,
			);
		}
	}
});

test("GitHub Actions workflows do not interpolate untrusted event context into shell run scripts", () => {
	const dangerousExpr = /\$\{\{\s*(github\.event\.|github\.head_ref|inputs\.)/;
	for (const wf of listWorkflowFiles()) {
		assert.doesNotMatch(
			wf.content,
			dangerousExpr,
			`${wf.name} must not interpolate event/head_ref/inputs directly in workflow expressions`,
		);
	}
});

test("CI workflow generates migration bundle before TypeScript typecheck and runs security job", () => {
	const ci = readFileSync(join(workflowsDir, "ci.yml"), "utf8");
	const bundleIndex = ci.indexOf("npm run db:bundle");
	const tscIndex = ci.indexOf("npx tsc --noEmit");
	assert.ok(bundleIndex !== -1, "ci.yml must run npm run db:bundle");
	assert.ok(tscIndex !== -1, "ci.yml must run npx tsc --noEmit");
	assert.ok(bundleIndex < tscIndex, "npm run db:bundle must run before npx tsc --noEmit so bundle.json exists");
	assert.match(ci, /tests\/security-\*\.test\.mjs/, "ci.yml must run the security test suite");
});
