import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-ingestion-"));
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
		nodePaths: [join(root, "node_modules")],
	});
	return import(pathToFileURL(join(outDir, outfile)).href);
}

const normalizerModule = await bundle("src/lib/ingestion/normalizer.ts", "normalizer.mjs");
const validatorsModule = await bundle("src/lib/ingestion/validators.ts", "validators.mjs");
const authModule = await bundle("src/lib/ingestion/auth.ts", "auth.mjs");
const serviceModule = await bundle("src/lib/ingestion/service.ts", "service.mjs");

const {
	normalizePayload,
	normalizeRecipientList,
	normalizeSender,
	normalizeAttachment,
	normalizeAttachmentContent,
} = normalizerModule;

const {
	singleEmailSchema,
	batchEmailSchema,
	formatZodError,
} = validatorsModule;

const {
	extractIngestionApiKey,
} = authModule;

const {
	handleRecipientSplitting,
} = serviceModule;

test("WP-07: Ingestion API Key Extraction from Multiple SDK Header Styles", () => {
	// 1. Resend SDK: Authorization: Bearer om_live_...
	const resendReq = new Request("https://mailhub.local/v1/emails", {
		headers: { Authorization: "Bearer om_live_aurelia_1234567890abcdef" },
	});
	assert.strictEqual(
		extractIngestionApiKey(resendReq),
		"om_live_aurelia_1234567890abcdef",
		"Should extract Bearer token from Authorization header",
	);

	// 2. Brevo SDK: api-key: om_live_...
	const brevoReq = new Request("https://mailhub.local/v3/smtp/email", {
		headers: { "api-key": "om_live_lifesolver_abcdef1234567890" },
	});
	assert.strictEqual(
		extractIngestionApiKey(brevoReq),
		"om_live_lifesolver_abcdef1234567890",
		"Should extract key from 'api-key' header",
	);

	// 3. AWS / Standard REST: x-api-key: ...
	const xReq = new Request("https://mailhub.local/v1/send", {
		headers: { "x-api-key": "om_live_luvio_9988776655443322" },
	});
	assert.strictEqual(
		extractIngestionApiKey(xReq),
		"om_live_luvio_9988776655443322",
		"Should extract key from 'x-api-key' header",
	);

	// 4. Basic Auth
	const basicToken = Buffer.from("api:om_live_basic_key_123").toString("base64");
	const basicReq = new Request("https://mailhub.local/v1/send", {
		headers: { Authorization: `Basic ${basicToken}` },
	});
	assert.strictEqual(
		extractIngestionApiKey(basicReq),
		"om_live_basic_key_123",
		"Should extract password from Basic auth",
	);

	// 5. Query parameter fallback
	const queryReq = new Request("https://mailhub.local/v1/send?api_key=om_live_query_token_456");
	assert.strictEqual(
		extractIngestionApiKey(queryReq),
		"om_live_query_token_456",
		"Should extract key from query parameter",
	);
});

test("WP-07: Resend Format Payload Normalization", () => {
	const rawResendPayload = {
		from: "Aurelia App <onboarding@aurelia.com>",
		to: ["alice@example.com", "bob@example.com"],
		subject: "Welcome to Aurelia",
		html: "<strong>Welcome Alice & Bob!</strong>",
		text: "Welcome Alice & Bob!",
		cc: ["manager@example.com"],
		bcc: "audit@aurelia.com",
		reply_to: "support@aurelia.com",
		tags: [
			{ name: "category", value: "onboarding" },
			{ name: "cohort", value: "2026-Q4" },
		],
		headers: {
			"X-Entity-Ref-ID": "aur_9921",
		},
		attachments: [
			{
				filename: "guide.pdf",
				content: Buffer.from("PDF_MOCK_DATA").toString("base64"),
				content_type: "application/pdf",
			},
		],
	};

	const parsed = singleEmailSchema.safeParse(rawResendPayload);
	assert.ok(parsed.success, "Resend payload should pass Zod validation");

	const normalized = normalizePayload(rawResendPayload);
	assert.strictEqual(normalized.from, "Aurelia App <onboarding@aurelia.com>");
	assert.deepStrictEqual(normalized.to, ["alice@example.com", "bob@example.com"]);
	assert.deepStrictEqual(normalized.cc, ["manager@example.com"]);
	assert.deepStrictEqual(normalized.bcc, ["audit@aurelia.com"]);
	assert.strictEqual(normalized.subject, "Welcome to Aurelia");
	assert.strictEqual(normalized.html, "<strong>Welcome Alice & Bob!</strong>");
	assert.strictEqual(normalized.replyTo, "support@aurelia.com");
	assert.strictEqual(normalized.headers["Reply-To"], "support@aurelia.com");
	assert.strictEqual(normalized.headers["X-Entity-Ref-ID"], "aur_9921");
	assert.strictEqual(normalized.headers["X-MailHub-Tag-category"], "onboarding");
	assert.strictEqual(normalized.headers["X-MailHub-Tag-cohort"], "2026-Q4");
	assert.strictEqual(normalized.attachments.length, 1);
	assert.strictEqual(normalized.attachments[0].filename, "guide.pdf");
	assert.strictEqual(normalized.attachments[0].type, "application/pdf");
	assert.ok(normalized.attachments[0].content instanceof ArrayBuffer);
});

test("WP-07: Brevo Format Payload Normalization", () => {
	const rawBrevoPayload = {
		sender: { name: "LifeSolver", email: "help@lifesolver.com" },
		to: [
			{ name: "Jane Doe", email: "jane@example.com" },
			{ email: "john@example.com" },
		],
		subject: "Your Daily LifeSolver Digest",
		htmlContent: "<p>Here is your digest for today.</p>",
		textContent: "Here is your digest for today.",
		replyTo: { name: "Support", email: "replies@lifesolver.com" },
		attachment: [
			{
				name: "report.csv",
				content: Buffer.from("id,score\n1,100").toString("base64"),
			},
		],
		headers: {
			"X-LifeSolver-ID": "ls_771",
		},
	};

	const parsed = singleEmailSchema.safeParse(rawBrevoPayload);
	assert.ok(parsed.success, "Brevo payload should pass Zod validation");

	const normalized = normalizePayload(rawBrevoPayload);
	assert.strictEqual(normalized.from, '"LifeSolver" <help@lifesolver.com>');
	assert.deepStrictEqual(normalized.to, ['"Jane Doe" <jane@example.com>', "john@example.com"]);
	assert.strictEqual(normalized.subject, "Your Daily LifeSolver Digest");
	assert.strictEqual(normalized.html, "<p>Here is your digest for today.</p>");
	assert.strictEqual(normalized.text, "Here is your digest for today.");
	assert.strictEqual(normalized.replyTo, '"Support" <replies@lifesolver.com>');
	assert.strictEqual(normalized.attachments.length, 1);
	assert.strictEqual(normalized.attachments[0].filename, "report.csv");
});

test("WP-07: Standard RFC 5322 Header Format Normalization", () => {
	const rawRfcPayload = {
		From: "Luvio Team <noreply@luvio.io>",
		To: "customer@example.com",
		Subject: "Order Confirmation #5541",
		Cc: "archive@luvio.io",
		"Reply-To": "orders@luvio.io",
		"In-Reply-To": "<msg_previous_123@luvio.io>",
		References: ["<msg_previous_123@luvio.io>", "<msg_initial_001@luvio.io>"],
		html: "<p>Thank you for your order!</p>",
	};

	const parsed = singleEmailSchema.safeParse(rawRfcPayload);
	assert.ok(parsed.success, "RFC 5322 payload should pass Zod validation");

	const normalized = normalizePayload(rawRfcPayload);
	assert.strictEqual(normalized.from, "Luvio Team <noreply@luvio.io>");
	assert.deepStrictEqual(normalized.to, ["customer@example.com"]);
	assert.deepStrictEqual(normalized.cc, ["archive@luvio.io"]);
	assert.strictEqual(normalized.subject, "Order Confirmation #5541");
	assert.strictEqual(normalized.headers["Reply-To"], "orders@luvio.io");
	assert.strictEqual(normalized.inReplyTo, "<msg_previous_123@luvio.io>");
});

test("WP-07: Multi-Recipient Splitting and Chunking Engine", () => {
	// Generate 120 recipients
	const recipients = Array.from({ length: 120 }, (_, i) => `user_${i + 1}@example.com`);

	const largePayload = {
		from: "Aurelia <announcements@aurelia.com>",
		to: recipients,
		subject: "Product Launch Announcement",
		html: "<h1>We are live!</h1>",
		cc: ["boss@aurelia.com"],
		bcc: [],
		attachments: [],
		headers: {},
	};

	// 1. Normal chunking when > 50 recipients
	const chunks = handleRecipientSplitting(largePayload);
	assert.strictEqual(chunks.length, 3, "120 recipients should be split into 3 chunks (50, 50, 20)");
	assert.strictEqual(chunks[0].to.length, 50);
	assert.strictEqual(chunks[1].to.length, 50);
	assert.strictEqual(chunks[2].to.length, 20);

	// Primary chunk retains CC, subsequent chunks do not duplicate CC
	assert.deepStrictEqual(chunks[0].cc, ["boss@aurelia.com"]);
	assert.deepStrictEqual(chunks[1].cc, []);
	assert.deepStrictEqual(chunks[2].cc, []);

	// 2. Individual delivery isolation (split: true)
	const isolatedPayload = {
		...largePayload,
		to: ["alice@example.com", "bob@example.com", "charlie@example.com"],
		splitRecipients: true,
	};
	const isolatedChunks = handleRecipientSplitting(isolatedPayload);
	assert.strictEqual(isolatedChunks.length, 3, "Should split into 3 individual payloads");
	assert.deepStrictEqual(isolatedChunks[0].to, ["alice@example.com"]);
	assert.deepStrictEqual(isolatedChunks[1].to, ["bob@example.com"]);
	assert.deepStrictEqual(isolatedChunks[2].to, ["charlie@example.com"]);
});

test("WP-07: Batch Email Schema Validation", () => {
	const batchPayload = [
		{
			from: "billing@aurelia.com",
			to: ["alice@example.com"],
			subject: "Invoice #101",
			html: "<p>Invoice details...</p>",
		},
		{
			from: "billing@aurelia.com",
			to: ["bob@example.com"],
			subject: "Invoice #102",
			html: "<p>Invoice details...</p>",
		},
	];

	const parsed = batchEmailSchema.safeParse(batchPayload);
	assert.ok(parsed.success, "Batch payload should pass validation");
	assert.strictEqual(parsed.data.length, 2);
});

test("WP-07: Resend-Compatible Zod Error Formatting", () => {
	const invalidPayload = {
		from: "invalid-email",
		// missing 'to' and 'subject'
	};

	const parsed = singleEmailSchema.safeParse(invalidPayload);
	assert.ok(!parsed.success, "Invalid payload must fail validation");

	const resendError = formatZodError(parsed.error);
	assert.strictEqual(resendError.name, "validation_error");
	assert.strictEqual(resendError.statusCode, 422);
	assert.ok(resendError.message.length > 0);
});

test("WP-07: Data URI and Buffer Attachment Handling", () => {
	// Data URI
	const dataUri = "data:text/plain;base64,SGVsbG8gTWFpbEh1YiE=";
	const bufferFromDataUri = normalizeAttachmentContent(dataUri);
	const textFromDataUri = new TextDecoder().decode(bufferFromDataUri);
	assert.strictEqual(textFromDataUri, "Hello MailHub!");

	// Node.js Buffer JSON representation
	const bufferObj = { type: "Buffer", data: [79, 114, 98, 105, 116] };
	const bufferFromObj = normalizeAttachmentContent(bufferObj);
	const textFromObj = new TextDecoder().decode(bufferFromObj);
	assert.strictEqual(textFromObj, "Orbit");
});
