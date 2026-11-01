/**
 * Web Crypto AES-256-GCM with HKDF-SHA256 key derivation for MailHub provider credentials.
 * Compatible with Cloudflare Workers, Node.js 18+, Edge Runtime, and V8 environments.
 */

const HKDF_INFO = "mailhub-credentials-v1";
const PREFIX = "enc:v1:";

function toBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function buffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

/**
 * Derives a 256-bit AES-GCM CryptoKey from master secret string and random salt via HKDF-SHA256.
 */
async function deriveEncryptionKey(
	masterSecret: string,
	salt: Uint8Array,
	usages: KeyUsage[],
): Promise<CryptoKey> {
	const encoder = new TextEncoder();
	const secretBytes = encoder.encode(masterSecret);
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		secretBytes,
		"HKDF",
		false,
		["deriveKey"],
	);

	return crypto.subtle.deriveKey(
		{
			name: "HKDF",
			hash: "SHA-256",
			salt: buffer(salt),
			info: encoder.encode(HKDF_INFO),
		},
		keyMaterial,
		{ name: "AES-GCM", length: 256 },
		false,
		usages,
	);
}

/**
 * Resolves the master encryption key from environment or falls back to an installation secret.
 */
export function resolveMasterEncryptionSecret(env?: any): string {
	if (!env && typeof process !== "undefined") {
		env = process.env;
	}
	const secret =
		env?.MAILHUB_ENCRYPTION_KEY ||
		env?.CF_TOKEN ||
		env?.INBOUND_WEBHOOK_SECRET ||
		env?.NEXTAUTH_SECRET ||
		(typeof process !== "undefined"
			? process.env?.MAILHUB_ENCRYPTION_KEY || process.env?.CF_TOKEN
			: undefined);

	if (secret && typeof secret === "string" && secret.trim().length > 0) {
		return secret.trim();
	}

	// Deterministic local fallback for tests or zero-config development
	return "mailhub-orbitmails-master-secret-key-32chars!";
}

/**
 * Encrypts a plaintext string (e.g. API key) at rest.
 * Output format: `enc:v1:<base64(salt)>:<base64(iv)>:<base64(ciphertext+tag)>`
 */
export async function encryptCredential(
	plaintext: string,
	masterSecret: string,
): Promise<string> {
	if (!plaintext) return plaintext;

	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await deriveEncryptionKey(masterSecret, salt, ["encrypt"]);

	const plaintextBytes = new TextEncoder().encode(plaintext);
	const ciphertextBuffer = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv: buffer(iv) },
		key,
		plaintextBytes,
	);

	const ciphertextBytes = new Uint8Array(ciphertextBuffer);

	return `${PREFIX}${toBase64(salt)}:${toBase64(iv)}:${toBase64(ciphertextBytes)}`;
}

/**
 * Decrypts a credential ciphertext.
 * If the value is not prefixed with `enc:v1:`, it is treated as raw plaintext
 * to preserve backwards compatibility with unencrypted keys.
 */
export async function decryptCredential(
	value: string,
	masterSecret: string,
): Promise<string> {
	if (!value || typeof value !== "string") return value;

	if (!value.startsWith(PREFIX)) {
		// Passthrough unencrypted plaintext
		return value;
	}

	const parts = value.slice(PREFIX.length).split(":");
	if (parts.length !== 3) {
		throw new Error(
			"Invalid encrypted credential format: expected enc:v1:<salt>:<iv>:<ciphertext>",
		);
	}

	const [saltB64, ivB64, ctB64] = parts;
	const salt = fromBase64(saltB64);
	const iv = fromBase64(ivB64);
	const ciphertextBytes = fromBase64(ctB64);

	const key = await deriveEncryptionKey(masterSecret, salt, ["decrypt"]);

	try {
		const decryptedBuffer = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: buffer(iv) },
			key,
			buffer(ciphertextBytes),
		);

		return new TextDecoder().decode(decryptedBuffer);
	} catch (err) {
		throw new Error(
			`Failed to decrypt credential: MAC authentication failed or incorrect secret key (${err instanceof Error ? err.message : String(err)})`,
		);
	}
}

/**
 * Decrypts all string fields of a credential object in-place or returns a decrypted copy.
 */
export async function decryptCredentialsRecord<T extends Record<string, any>>(
	record: T,
	masterSecret: string,
): Promise<T> {
	if (!record || typeof record !== "object") return record;

	const result: Record<string, any> = { ...record };
	for (const [key, val] of Object.entries(record)) {
		if (typeof val === "string" && val.startsWith(PREFIX)) {
			result[key] = await decryptCredential(val, masterSecret);
		} else if (val && typeof val === "object" && !Array.isArray(val) && !(val instanceof ArrayBuffer)) {
			result[key] = await decryptCredentialsRecord(val, masterSecret);
		}
	}
	return result as T;
}

/**
 * Checks whether a string is currently encrypted with the `enc:v1:` scheme.
 */
export function isEncryptedCredential(value: unknown): boolean {
	return typeof value === "string" && value.startsWith(PREFIX);
}
