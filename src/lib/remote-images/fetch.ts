import { queryDns } from "@/lib/dns-query";
import { isPublicIpv4 } from "@/lib/spam/domain-utils";

export const REMOTE_IMAGE_MAX_URL_LENGTH = 4096;
export const REMOTE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const REMOTE_IMAGE_MAX_REDIRECTS = 3;
export const REMOTE_IMAGE_TIMEOUT_MS = 10_000;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_CONTENT_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/avif",
]);

export type RemoteImageFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class RemoteImageError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(
		message: string,
		status: number,
		code: string,
	) {
		super(message);
		this.name = "RemoteImageError";
		this.status = status;
		this.code = code;
	}
}

export type RemoteImageResult = {
	body: Uint8Array;
	contentType: string;
};

export type RemoteImageFetchOptions = {
	fetch?: RemoteImageFetch;
	/** Resolves a hostname to its A and AAAA addresses; every one must be public. Defaults to DNS-over-HTTPS. */
	resolveHost?: (hostname: string) => Promise<string[]>;
	blockedOrigins?: Iterable<string>;
	timeoutMs?: number;
	maxBytes?: number;
	maxRedirects?: number;
};

function invalidUrl(message = "Invalid remote image URL"): never {
	throw new RemoteImageError(message, 400, "invalid_url");
}

export function isIpLiteral(hostname: string): boolean {
	return hostname.startsWith("[") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

// Wildcard DNS services that resolve an embedded address, e.g. 127.0.0.1.nip.io.
const WILDCARD_DNS_SUFFIXES = ["nip.io", "sslip.io", "xip.io", "traefik.me", "localtest.me", "lvh.me", "localhost.run"];

function embedsNonPublicIpv4(host: string): boolean {
	for (const match of host.matchAll(/(?<![\d])(\d{1,3})[.-](\d{1,3})[.-](\d{1,3})[.-](\d{1,3})(?![\d])/g)) {
		if (!isPublicIpv4(`${match[1]}.${match[2]}.${match[3]}.${match[4]}`)) return true;
	}
	for (const label of host.split(".")) {
		if (/^0x[0-9a-f]{1,8}$/i.test(label) || /^[0-9a-f]{8}$/i.test(label) || /^\d{8,10}$/.test(label)) {
			const num = Number(label.startsWith("0x") || /^[0-9a-f]{8}$/i.test(label) ? parseInt(label, 16) : parseInt(label, 10));
			if (Number.isInteger(num) && num >= 0 && num <= 0xffffffff) {
				const a = (num >>> 24) & 0xff;
				const b = (num >>> 16) & 0xff;
				const c = (num >>> 8) & 0xff;
				const d = num & 0xff;
				if (!isPublicIpv4(`${a}.${b}.${c}.${d}`)) return true;
			}
		}
	}
	return false;
}

export function isForbiddenHostname(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/\.$/, "");
	if (embedsNonPublicIpv4(host)) return true;
	if (WILDCARD_DNS_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return true;
	return host === "localhost"
		|| host === "local"
		|| host === "internal"
		|| host === "intranet"
		|| host === "lan"
		|| host === "corp"
		|| host === "localdomain"
		|| host === "test"
		|| host.endsWith(".localhost")
		|| host.endsWith(".local")
		|| host.endsWith(".internal")
		|| host.endsWith(".intranet")
		|| host.endsWith(".lan")
		|| host.endsWith(".corp")
		|| host.endsWith(".localdomain")
		|| host === "home.arpa"
		|| host.endsWith(".home.arpa")
		|| host.endsWith(".test");
}

export function parseRemoteImageUrl(value: string, blockedOrigins: Iterable<string> = []): URL {
	if (!value || value.length > REMOTE_IMAGE_MAX_URL_LENGTH) invalidUrl();

	let url: URL;
	try {
		url = new URL(value);
	} catch {
		invalidUrl();
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") invalidUrl();
	if (url.username || url.password || url.port) invalidUrl();
	if (!url.hostname || isIpLiteral(url.hostname) || isForbiddenHostname(url.hostname)) invalidUrl();

	for (const origin of blockedOrigins) {
		if (url.origin === origin) invalidUrl("Remote image URL cannot target this application");
	}

	return url;
}

function contentTypeEssence(value: string | null): string | null {
	if (!value) return null;
	const essence = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
	return ALLOWED_CONTENT_TYPES.has(essence) ? essence : null;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(start, start + length));
}

function hasAvifSignature(bytes: Uint8Array): boolean {
	if (bytes.length < 16 || ascii(bytes, 4, 4) !== "ftyp") return false;
	const boxSize = Math.min(bytes.length, new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0));
	if (boxSize < 16) return false;
	for (let offset = 8; offset + 4 <= boxSize; offset += 4) {
		const brand = ascii(bytes, offset, 4);
		if (brand === "avif" || brand === "avis") return true;
	}
	return false;
}

function signatureMatches(contentType: string, bytes: Uint8Array): boolean {
	switch (contentType) {
		case "image/png":
			return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
		case "image/jpeg":
			return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
		case "image/gif":
			return bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a");
		case "image/webp":
			return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
		case "image/avif":
			return hasAvifSignature(bytes);
		default:
			return false;
	}
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
	const declaredLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
		await response.body?.cancel().catch(() => undefined);
		throw new RemoteImageError("Remote image is too large", 413, "too_large");
	}
	if (!response.body) throw new RemoteImageError("Remote image has no body", 502, "empty_body");

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > maxBytes) {
				await reader.cancel().catch(() => undefined);
				throw new RemoteImageError("Remote image is too large", 413, "too_large");
			}
			chunks.push(value);
		}
	} catch (error) {
		await reader.cancel().catch(() => undefined);
		throw error;
	}

	const body = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

function parseIpv6Words(ip: string): number[] | null {
	let str = ip.trim().toLowerCase();
	if (!str.includes(":")) return null;
	if (str.startsWith("[") && str.endsWith("]")) str = str.slice(1, -1);
	const doubleColonCount = (str.match(/::/g) || []).length;
	if (doubleColonCount > 1) return null;
	let parts: number[];
	if (doubleColonCount === 1) {
		const [left, right] = str.split("::");
		const leftParts = left ? left.split(":") : [];
		const rightParts = right ? right.split(":") : [];
		let ipv4Parts: number[] | null = null;
		if (rightParts.length > 0 && rightParts[rightParts.length - 1].includes(".")) {
			const v4 = rightParts.pop()!.split(".").map(Number);
			if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
			ipv4Parts = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
		}
		const needed = 8 - leftParts.length - rightParts.length - (ipv4Parts ? 2 : 0);
		if (needed < 0) return null;
		const middle = new Array(needed).fill(0);
		const leftNums = leftParts.map((p) => parseInt(p, 16));
		const rightNums = rightParts.map((p) => parseInt(p, 16));
		if (leftNums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff) || rightNums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;
		parts = [...leftNums, ...middle, ...rightNums, ...(ipv4Parts || [])];
	} else {
		const rawParts = str.split(":");
		let ipv4Parts: number[] | null = null;
		if (rawParts.length > 0 && rawParts[rawParts.length - 1].includes(".")) {
			const v4 = rawParts.pop()!.split(".").map(Number);
			if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
			ipv4Parts = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
		}
		const nums = rawParts.map((p) => parseInt(p, 16));
		if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;
		parts = [...nums, ...(ipv4Parts || [])];
	}
	if (parts.length !== 8) return null;
	return parts;
}

export function isPublicAddress(address: string): boolean {
	const value = address.trim().toLowerCase();
	if (!value.includes(":")) {
		if (!isPublicIpv4(value)) return false;
		const parts = value.split(".").map(Number);
		const [a, b, c] = parts;
		// Documentation test ranges: 192.0.2.0/24 (TEST-NET-1), 198.51.100.0/24 (TEST-NET-2), 203.0.113.0/24 (TEST-NET-3)
		if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
		if (a === 198 && b === 51 && c === 100) return false;
		if (a === 203 && b === 0 && c === 113) return false;
		return true;
	}
	const parts = parseIpv6Words(value);
	if (!parts) return false;
	// Unspecified ::
	if (parts.every((p) => p === 0)) return false;
	// Loopback ::1 or 0:0:0:0:0:0:0:1
	if (parts.slice(0, 7).every((p) => p === 0) && parts[7] === 1) return false;
	// Unique local fc00::/7 (fc00 - fdff)
	if ((parts[0] & 0xfe00) === 0xfc00) return false;
	// Link-local fe80::/10
	if ((parts[0] & 0xffc0) === 0xfe80) return false;
	// Site-local (deprecated) fec0::/10
	if ((parts[0] & 0xffc0) === 0xfec0) return false;
	// Multicast ff00::/8
	if ((parts[0] & 0xff00) === 0xff00) return false;
	// Documentation 2001:db8::/32
	if (parts[0] === 0x2001 && parts[1] === 0x0db8) return false;
	// ORCHID / ORCHIDv2 (2001:10::/28, 2001:20::/28)
	if (parts[0] === 0x2001 && ((parts[1] & 0xfff0) === 0x0010 || (parts[1] & 0xfff0) === 0x0020)) return false;
	// Discard prefix 100::/64
	if (parts[0] === 0x0100 && parts[1] === 0 && parts[2] === 0 && parts[3] === 0) return false;
	// 6to4 prefix 2002::/16 embedding IPv4 in words 1 and 2
	if (parts[0] === 0x2002) {
		const v4 = `${parts[1] >> 8}.${parts[1] & 0xff}.${parts[2] >> 8}.${parts[2] & 0xff}`;
		return isPublicIpv4(v4);
	}
	// NAT64 well-known prefix 64:ff9b::/96
	if (parts[0] === 0x0064 && parts[1] === 0xff9b && parts.slice(2, 6).every((p) => p === 0)) {
		const v4 = `${parts[6] >> 8}.${parts[6] & 0xff}.${parts[7] >> 8}.${parts[7] & 0xff}`;
		return isPublicIpv4(v4);
	}
	// IPv4-mapped ::ffff:x.x.x.x
	if (parts.slice(0, 5).every((p) => p === 0) && parts[5] === 0xffff) {
		const v4 = `${parts[6] >> 8}.${parts[6] & 0xff}.${parts[7] >> 8}.${parts[7] & 0xff}`;
		return isPublicIpv4(v4);
	}
	// IPv4-compatible (deprecated) ::x.x.x.x
	if (parts.slice(0, 6).every((p) => p === 0)) {
		const v4 = `${parts[6] >> 8}.${parts[6] & 0xff}.${parts[7] >> 8}.${parts[7] & 0xff}`;
		return isPublicIpv4(v4);
	}
	return true;
}

async function defaultResolveHost(hostname: string): Promise<string[]> {
	const [v4, v6] = await Promise.all([queryDns(hostname, "A"), queryDns(hostname, "AAAA")]);
	return [...v4, ...v6];
}

/** A public-looking name can still resolve to a private address, so check what it resolves to. */
async function assertPublicHost(resolve: (hostname: string) => Promise<string[]>, hostname: string): Promise<void> {
	let addresses: string[];
	try {
		addresses = await resolve(hostname);
	} catch {
		throw new RemoteImageError("Could not verify remote image host", 502, "upstream_error");
	}
	if (!addresses.length || addresses.some((address) => !isPublicAddress(address))) invalidUrl("Remote image host is not public");
}

export async function fetchRemoteImage(value: string, options: RemoteImageFetchOptions = {}): Promise<RemoteImageResult> {
	const fetchImpl = options.fetch ?? fetch;
	const blockedOrigins = [...(options.blockedOrigins ?? [])];
	const maxBytes = options.maxBytes ?? REMOTE_IMAGE_MAX_BYTES;
	const maxRedirects = options.maxRedirects ?? REMOTE_IMAGE_MAX_REDIRECTS;
	const resolveHost = options.resolveHost ?? defaultResolveHost;
	let current = parseRemoteImageUrl(value, blockedOrigins);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? REMOTE_IMAGE_TIMEOUT_MS);

	try {
		for (let redirects = 0; ; redirects += 1) {
			await assertPublicHost(resolveHost, current.hostname);
			let response: Response;
			try {
				response = await fetchImpl(current.href, {
					method: "GET",
					headers: { Accept: "image/png,image/jpeg,image/gif,image/webp,image/avif", "User-Agent": "Orbitflare-Remote-Images/1.0" },
					cache: "no-store",
					redirect: "manual",
					signal: controller.signal,
				});
			} catch {
				if (controller.signal.aborted) throw new RemoteImageError("Remote image request timed out", 504, "timeout");
				throw new RemoteImageError("Could not fetch remote image", 502, "upstream_error");
			}

			if (REDIRECT_STATUSES.has(response.status)) {
				await response.body?.cancel().catch(() => undefined);
				if (redirects >= maxRedirects) throw new RemoteImageError("Too many remote image redirects", 502, "too_many_redirects");
				const location = response.headers.get("location");
				if (!location) throw new RemoteImageError("Remote image redirect has no location", 502, "invalid_redirect");
				let redirected: URL;
				try {
					redirected = new URL(location, current);
				} catch {
					throw new RemoteImageError("Remote image redirect is invalid", 502, "invalid_redirect");
				}
				current = parseRemoteImageUrl(redirected.href, blockedOrigins);
				continue;
			}

			if (!response.ok) {
				await response.body?.cancel().catch(() => undefined);
				throw new RemoteImageError("Remote image server returned an error", 502, "upstream_status");
			}
			const contentType = contentTypeEssence(response.headers.get("content-type"));
			if (!contentType) {
				await response.body?.cancel().catch(() => undefined);
				const receivedType = (response.headers.get("content-type") ?? "missing content type").split(";", 1)[0].slice(0, 100);
				throw new RemoteImageError(`Remote resource is not a supported image (${receivedType})`, 415, "unsupported_type");
			}
			let body: Uint8Array;
			try {
				body = await readLimitedBody(response, maxBytes);
			} catch (error) {
				if (controller.signal.aborted && !(error instanceof RemoteImageError)) {
					throw new RemoteImageError("Remote image request timed out", 504, "timeout");
				}
				throw error;
			}
			if (!signatureMatches(contentType, body)) throw new RemoteImageError("Remote image signature is invalid", 415, "invalid_signature");
			return { body, contentType };
		}
	} finally {
		clearTimeout(timeout);
	}
}
