import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-security-audit-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	stdin: {
		contents: `
export { isForbiddenHostname, isPublicAddress } from "./src/lib/remote-images/fetch.ts";
export { assertSafeImapHost, assertSafeImapPort } from "./src/lib/import/imap-utils.ts";
export { isSafeRedirectPath, safeRedirectUrl } from "./src/lib/security/redirect.ts";
export { signPayload, verifyWebhookSignature } from "./src/lib/email/webhooks.ts";
export { isPublicHttpsUrl } from "./src/lib/security/public-url.ts";
export { resolveAgentBaseUrl } from "./src/lib/agent/provider.ts";
export { getValidatedOrigin } from "./src/lib/security/cors.ts";
`,
		resolveDir: root,
		sourcefile: "security-entry.ts",
	},
	outfile: join(outDir, "security.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	packages: "external",
	logLevel: "silent",
	alias: {
		"@": join(root, "src"),
		"next/server": "next/server.js",
		"cloudflare:workers": join(root, "server/runtime/cloudflare-workers.ts"),
	},
});

const {
	isForbiddenHostname,
	isPublicAddress,
	assertSafeImapHost,
	assertSafeImapPort,
	isSafeRedirectPath,
	safeRedirectUrl,
	signPayload,
	verifyWebhookSignature,
	isPublicHttpsUrl,
	resolveAgentBaseUrl,
	getValidatedOrigin,
} = await import(pathToFileURL(join(outDir, "security.mjs")).href);

test("isPublicAddress blocks all IPv4 and IPv6 private, reserved, loopback, and metadata ranges", () => {
	// IPv4 non-public
	assert.equal(isPublicAddress("127.0.0.1"), false);
	assert.equal(isPublicAddress("10.0.0.1"), false);
	assert.equal(isPublicAddress("169.254.169.254"), false);
	assert.equal(isPublicAddress("192.168.1.1"), false);
	assert.equal(isPublicAddress("172.16.0.1"), false);
	assert.equal(isPublicAddress("172.31.255.255"), false);
	assert.equal(isPublicAddress("100.64.0.1"), false);
	assert.equal(isPublicAddress("0.0.0.0"), false);

	// IPv4 public
	assert.equal(isPublicAddress("8.8.8.8"), true);
	assert.equal(isPublicAddress("93.184.216.34"), true);

	// IPv6 loopback variants
	assert.equal(isPublicAddress("::1"), false);
	assert.equal(isPublicAddress("0:0:0:0:0:0:0:1"), false);
	assert.equal(isPublicAddress("[::1]"), false);
	assert.equal(isPublicAddress("::"), false);

	// IPv6 private & local
	assert.equal(isPublicAddress("fe80::1"), false);
	assert.equal(isPublicAddress("fec0::1"), false);
	assert.equal(isPublicAddress("fc00::1"), false);
	assert.equal(isPublicAddress("fd00::1"), false);
	assert.equal(isPublicAddress("ff02::1"), false);
	assert.equal(isPublicAddress("2001:db8::1"), false);

	// IPv6 mapped / translated
	assert.equal(isPublicAddress("::ffff:127.0.0.1"), false);
	assert.equal(isPublicAddress("::ffff:7f00:1"), false);
	assert.equal(isPublicAddress("::ffff:169.254.169.254"), false);
	assert.equal(isPublicAddress("::ffff:8.8.8.8"), true);
	assert.equal(isPublicAddress("::127.0.0.1"), false);
	assert.equal(isPublicAddress("64:ff9b::127.0.0.1"), false);
	assert.equal(isPublicAddress("64:ff9b::8.8.8.8"), true);
	assert.equal(isPublicAddress("2002:7f00:0001::"), false);

	// IPv6 public
	assert.equal(isPublicAddress("2607:f8b0:4005:805::200e"), true);
});

test("isForbiddenHostname rejects internal TLDs and embedded private IP addresses", () => {
	assert.equal(isForbiddenHostname("localhost"), true);
	assert.equal(isForbiddenHostname("internal"), true);
	assert.equal(isForbiddenHostname("service.internal"), true);
	assert.equal(isForbiddenHostname("host.local"), true);
	assert.equal(isForbiddenHostname("nas.lan"), true);
	assert.equal(isForbiddenHostname("ad.corp"), true);
	assert.equal(isForbiddenHostname("dc.localdomain"), true);
	assert.equal(isForbiddenHostname("127.0.0.1.nip.io"), true);
	assert.equal(isForbiddenHostname("169-254-169-254.sslip.io"), true);
	assert.equal(isForbiddenHostname("0x7f000001.nip.io"), true);
	assert.equal(isForbiddenHostname("2130706433.nip.io"), true);

	assert.equal(isForbiddenHostname("images.unsplash.com"), false);
	assert.equal(isForbiddenHostname("cdn.example.com"), false);
});

test("isPublicHttpsUrl requires HTTPS and public host with standard port", () => {
	assert.equal(isPublicHttpsUrl("https://webhook.site/path"), true);
	assert.equal(isPublicHttpsUrl("https://webhook.site:443/path"), true);
	assert.equal(isPublicHttpsUrl("http://webhook.site/path"), false);
	assert.equal(isPublicHttpsUrl("https://webhook.site:22/path"), false);
	assert.equal(isPublicHttpsUrl("https://webhook.site:6379/path"), false);
	assert.equal(isPublicHttpsUrl("https://127.0.0.1/path"), false);
	assert.equal(isPublicHttpsUrl("https://localhost/path"), false);
	assert.equal(isPublicHttpsUrl("https://127.0.0.1.nip.io/path"), false);
});

test("assertSafeImapHost and assertSafeImapPort restrict connections to valid external IMAP servers", () => {
	assert.doesNotThrow(() => assertSafeImapHost("imap.gmail.com", 993));
	assert.doesNotThrow(() => assertSafeImapHost("mail.example.com", 143));

	assert.throws(() => assertSafeImapHost("localhost"), /IMAP host is not allowed/);
	assert.throws(() => assertSafeImapHost("127.0.0.1"), /Private IMAP hosts are not allowed/);
	assert.throws(() => assertSafeImapHost("10.0.0.5"), /Private IMAP hosts are not allowed/);
	assert.throws(() => assertSafeImapHost("169.254.169.254"), /Private IMAP hosts are not allowed/);
	assert.throws(() => assertSafeImapHost("::1"), /Private IMAP hosts are not allowed/);
	assert.throws(() => assertSafeImapHost("[::1]"), /Private IMAP hosts are not allowed/);
	assert.throws(() => assertSafeImapHost("127.0.0.1.nip.io"), /IMAP host is not allowed/);

	assert.throws(() => assertSafeImapPort(22), /IMAP port is not allowed/);
	assert.throws(() => assertSafeImapPort(25), /IMAP port is not allowed/);
	assert.throws(() => assertSafeImapPort(80), /IMAP port is not allowed/);
	assert.throws(() => assertSafeImapPort(443), /IMAP port is not allowed/);
	assert.throws(() => assertSafeImapPort(6379), /IMAP port is not allowed/);
	assert.throws(() => assertSafeImapPort(0), /IMAP port is invalid/);
	assert.throws(() => assertSafeImapPort(70000), /IMAP port is invalid/);
});

test("safeRedirectUrl constrains redirects to relative paths and rejects open redirect vectors", () => {
	assert.equal(isSafeRedirectPath("/inbox"), true);
	assert.equal(isSafeRedirectPath("/settings/account"), true);
	assert.equal(isSafeRedirectPath("/admin?page=1"), true);

	assert.equal(isSafeRedirectPath("https://evil.com"), false);
	assert.equal(isSafeRedirectPath("//evil.com"), false);
	assert.equal(isSafeRedirectPath("/\\evil.com"), false);
	assert.equal(isSafeRedirectPath("\\evil.com"), false);
	assert.equal(isSafeRedirectPath("javascript:alert(1)"), false);
	assert.equal(isSafeRedirectPath("data:text/html,<script>"), false);
	assert.equal(isSafeRedirectPath("/inbox\r\nLocation: https://evil.com"), false);

	assert.equal(safeRedirectUrl("/settings", "/inbox"), "/settings");
	assert.equal(safeRedirectUrl("https://evil.com", "/inbox"), "/inbox");
	assert.equal(safeRedirectUrl("//evil.com", "/inbox"), "/inbox");
});

test("verifyWebhookSignature correctly verifies and rejects tampered signatures", async () => {
	const secret = "whsec_test_secret_12345";
	const body = JSON.stringify({ type: "message.inbound", data: { id: "msg_123" } });
	const signature = await signPayload(secret, body);

	assert.equal(await verifyWebhookSignature(secret, body, signature), true);
	assert.equal(await verifyWebhookSignature(secret, body, "invalid_signature"), false);
	assert.equal(await verifyWebhookSignature("wrong_secret", body, signature), false);
	assert.equal(await verifyWebhookSignature(secret, body + "tampered", signature), false);
});

test("resolveAgentBaseUrl blocks private, loopback, metadata, and non-443 SSRF URLs", () => {
	assert.equal(resolveAgentBaseUrl("custom", "https://api.example.com/v1/"), "https://api.example.com/v1");
	assert.throws(() => resolveAgentBaseUrl("custom", "https://127.0.0.1/v1"), /public HTTPS/);
	assert.throws(() => resolveAgentBaseUrl("custom", "https://169.254.169.254/latest"), /public HTTPS/);
	assert.throws(() => resolveAgentBaseUrl("custom", "https://localhost/v1"), /public HTTPS/);
	assert.throws(() => resolveAgentBaseUrl("custom", "https://service.internal/v1"), /public HTTPS/);
	assert.throws(() => resolveAgentBaseUrl("custom", "https://api.example.com:8443/v1"), /public HTTPS/);
	assert.throws(() => resolveAgentBaseUrl("custom", "http://api.example.com/v1"), /public HTTPS/);
});

test("getValidatedOrigin rejects non-HTTPS remote origins and subdomain suffix spoofing", () => {
	const req = (origin) => new Request("https://app.example.com", { headers: { origin } });
	assert.equal(getValidatedOrigin(req("http://evil.com")), null);
	assert.equal(getValidatedOrigin(req("javascript:alert(1)")), null);
	assert.equal(getValidatedOrigin(req("https://evil.com")), "https://evil.com");
	assert.equal(getValidatedOrigin(req("http://localhost:3000")), "http://localhost:3000");

	assert.equal(getValidatedOrigin(req("https://app.example.com"), ["*.example.com"]), "https://app.example.com");
	assert.equal(getValidatedOrigin(req("https://evil-example.com"), ["*.example.com"]), null);
	assert.equal(getValidatedOrigin(req("http://app.example.com"), ["*.example.com"]), null);
});
