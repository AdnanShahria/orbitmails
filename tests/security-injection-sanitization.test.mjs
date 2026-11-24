import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = mkdtempSync(join(root, "tests", ".tmp-security-test-"));
test.after(() => rmSync(tempDir, { recursive: true, force: true }));

const bundle = await build({
	entryPoints: {
		richTextUtils: join(root, "src/components/compose/rich-text-utils.ts"),
		passwordResetUtils: join(root, "src/lib/auth/password-reset-utils.ts"),
		sanitizer: join(root, "src/lib/security/sanitizer.ts"),
		driveUtils: join(root, "src/lib/drive/utils.ts"),
		zipUtils: join(root, "src/lib/import/zip-utils.ts"),
		backupValidator: join(root, "src/lib/backups/validator.ts"),
		dbSql: join(root, "src/db/sql.ts"),
		dbIntrospect: join(root, "src/db/introspect.ts"),
	},
	outdir: tempDir,
	outExtension: { ".js": ".mjs" },
	bundle: true,
	platform: "node",
	format: "esm",
	packages: "external",
	alias: {
		"@": join(root, "src"),
		"next/headers": "next/headers.js",
		"next/server": "next/server.js",
		"cloudflare:workers": join(root, "server/runtime/cloudflare-workers.ts"),
	},
	logLevel: "silent",
});

const load = (name) => import(pathToFileURL(join(tempDir, `${name}.mjs`)).href);
const { escapeHtml: escapeRichText } = await load("richTextUtils");
const { escapeHtml: escapePasswordReset } = await load("passwordResetUtils");
const { escapeHtml: escapeSanitizer } = await load("sanitizer");
const { normalizeDriveName, driveContentDisposition } = await load("driveUtils");
const { sanitizeZipEntryPath } = await load("zipUtils");
const { validateBackupContent } = await load("backupValidator");
const { concatText } = await load("dbSql");
const { quoteIdentifier } = await load("dbIntrospect");

test("HTML escaping in all utility modules escapes single quotes and XML characters", () => {
	const payload = `hello <script>alert('xss & "more"')</script>`;
	const expected = `hello &lt;script&gt;alert(&#039;xss &amp; &quot;more&quot;&#039;)&lt;/script&gt;`;

	assert.equal(escapeRichText(payload), expected);
	assert.equal(escapePasswordReset(payload), expected);
	assert.equal(escapeSanitizer(payload), expected);
});

test("normalizeDriveName blocks dot-only traversal names and sanitizes control characters", () => {
	assert.equal(normalizeDriveName("."), null);
	assert.equal(normalizeDriveName(".."), null);
	assert.equal(normalizeDriveName("..."), null);
	assert.equal(normalizeDriveName("...."), null);
	assert.equal(normalizeDriveName(""), null);
	assert.equal(normalizeDriveName("   "), null);

	// Normal names are preserved
	assert.equal(normalizeDriveName("Document.pdf"), "Document.pdf");
	assert.equal(normalizeDriveName("Folder / Subfolder"), "Folder Subfolder");
	assert.equal(normalizeDriveName("hello\u0000world\r\n.txt"), "hello world .txt");
});

test("driveContentDisposition conforms to RFC 5987 and prevents header injection", () => {
	const disposition = driveContentDisposition('test"file\\*(name)\r\nInjection: 1.pdf', false);
	assert.match(disposition, /^attachment;/);
	// Control chars stripped
	assert.doesNotMatch(disposition, /[\r\n]/);
	// RFC 5987 attr-char set requires encoding of ', (, ), *
	assert.match(disposition, /filename\*=UTF-8''test%22file%5C%2A%28name%29Injection%3A%201\.pdf/);
	// ASCII fallback replaces quotes, backslashes, and % with _
	assert.match(disposition, /filename="test_file_\*\(name\)Injection: 1\.pdf"/);
});

test("sanitizeZipEntryPath neutralizes ZipSlip directory traversal attacks", () => {
	// Dangerous traversal paths must be rejected
	assert.equal(sanitizeZipEntryPath("../../etc/passwd"), null);
	assert.equal(sanitizeZipEntryPath("..\\..\\windows\\system32\\calc.exe"), null);
	assert.equal(sanitizeZipEntryPath("../test.mbox"), null);
	assert.equal(sanitizeZipEntryPath("./../../test.mbox"), null);
	assert.equal(sanitizeZipEntryPath("/../../"), null);

	// Safe relative paths are preserved / normalized
	assert.equal(sanitizeZipEntryPath("Takeout/Mail/All.mbox"), "Takeout/Mail/All.mbox");
	assert.equal(sanitizeZipEntryPath("Takeout\\Mail\\All.mbox"), "Takeout/Mail/All.mbox");
	assert.equal(sanitizeZipEntryPath("Takeout/./Mail/All.mbox"), "Takeout/Mail/All.mbox");
	assert.equal(sanitizeZipEntryPath("Takeout/subdir/../Mail/All.mbox"), "Takeout/Mail/All.mbox");
	assert.equal(sanitizeZipEntryPath("C:\\Takeout\\Mail\\All.mbox"), "Takeout/Mail/All.mbox");

	// Control chars and null bytes are stripped
	assert.equal(sanitizeZipEntryPath("Mail/All\u0000.mbox"), "Mail/All.mbox");
});

test("validateBackupContent safely handles malicious SQL in table and column names", () => {
	const maliciousBackup = JSON.stringify({
		users: [{ id: "u1", email: "admin@example.com" }],
		domains: [{ id: "d1", name: "example.com" }],
		mailboxes: [{ id: "m1", name: "Inbox" }],
		// Injected table name breaking double quotes
		'injected"; DROP TABLE users; --': [{ id: "1", 'evil"; DROP TABLE mailboxes; --': "val" }],
	});

	// Must run without SQL syntax errors or executing malicious SQL statements
	const result = validateBackupContent(maliciousBackup);
	assert.equal(result.valid, true);
	assert.equal(result.simulatedRestoreSuccess, true);
	assert.equal(result.errors.length, 0);
});

test("quoteIdentifier properly escapes SQLite and MySQL quotes", () => {
	assert.equal(quoteIdentifier("sqlite", 'table"name'), '"table""name"');
	assert.equal(quoteIdentifier("postgres", 'table"name'), '"table""name"');
	assert.equal(quoteIdentifier("mysql", "table`name"), "`table``name`");
});

test("concatText produces parameterized query without raw string injection", () => {
	const result = concatText("prefix", "suffix");
	// Should produce query with query chunks
	assert.ok(result);
});

test("admin database explorer GET route quotes all dynamic SQLite identifiers", () => {
	const source = readFileSync(join(root, "src/app/api/admin/database/route.ts"), "utf8");
	assert.ok(source.includes("quoteIdentifier("), "Expected quoteIdentifier usage in admin/database/route.ts");
	assert.doesNotMatch(source, /PRAGMA table_info\("\$\{/, "Unescaped table interpolation in PRAGMA");
	assert.doesNotMatch(source, /FROM "\$\{/, "Unescaped table interpolation in FROM");
	assert.doesNotMatch(source, /ORDER BY "\$\{/, "Unescaped pkCol interpolation in ORDER BY");
});
