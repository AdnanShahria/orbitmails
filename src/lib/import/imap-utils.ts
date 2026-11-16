export function quoteImapString(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function parseSearchUids(line: string): string[] {
	const match = line.match(/^\* SEARCH(?:\s+(.+))?$/i);
	if (!match?.[1]) return [];
	return match[1].trim().split(/\s+/).filter((value) => /^\d+$/.test(value));
}

export type ImapUidBatch = {
	uids: string[];
	total: number;
	/** Offset to pass on the next request, or null when the folder is fully covered. */
	nextOffset: number | null;
};

/**
 * Picks one batch of UIDs, newest first. `offset` is how many of the newest
 * messages earlier batches already covered, so repeated requests with the
 * returned `nextOffset` walk back through the whole folder.
 */
export function selectImapUidBatch(allUids: string[], limit: number, offset: number): ImapUidBatch {
	const total = allUids.length;
	const safeOffset = Math.min(Math.max(Math.floor(offset) || 0, 0), total);
	const end = total - safeOffset;
	const start = Math.max(0, end - Math.max(Math.floor(limit) || 1, 1));
	const nextOffset = start > 0 ? safeOffset + (end - start) : null;
	return { uids: allUids.slice(start, end), total, nextOffset };
}

/**
 * Messages to fetch in one chunk. `size` is the size the job settled on after
 * earlier trouble; every redelivery of the same queue message (`attempt` > 1,
 * e.g. the Worker died with a resource-limit 503) halves it again.
 */
export function getImapChunkSize(base: number, size: number | undefined, attempt = 1): number {
	const current = Math.min(Math.max(Math.floor(size ?? base) || base, 1), base);
	return Math.max(1, Math.floor(current / 2 ** Math.max(attempt - 1, 0)));
}

/** After a clean chunk, climb back towards `base` gradually rather than all at once. */
export function growImapChunkSize(base: number, size: number): number {
	return size >= base ? base : Math.min(base, size + Math.max(1, Math.floor(size / 2)));
}

/** Errors a smaller batch cannot fix: bad credentials, lost settings. */
export function isPermanentImapError(message: string): boolean {
	return /login|auth|credential|not allowed|unreadable|no longer exists/i.test(message);
}

/** A folder the server says does not exist or cannot be selected, such as Gmail's `[Gmail]` parent. */
export function isMissingImapFolderError(message: string): boolean {
	return /NONEXISTENT|unknown mailbox|mailbox (?:does not|doesn't) exist|nonexistent namespace|NOSELECT/i.test(message);
}

/** FETCH commands sent back to back, and the raw mail one group may hold before the next is requested. */
const IMAP_PIPELINE_COUNT = 10;
const IMAP_PIPELINE_BYTES = 4 * 1024 * 1024;
// Every fetched message is held in memory and then parsed and stored within one
// Worker request, so a batch stops early once it holds this much raw mail.
export const MAX_IMAP_BATCH_BYTES = 20 * 1024 * 1024;

/**
 * Splits UIDs (newest first) into groups to pipeline, dropping the tail that would
 * push the batch past the memory budget. A UID with an unknown size travels alone.
 */
export function planImapFetchGroups(uids: string[], sizes: Map<string, number>): string[][] {
	const groups: string[][] = [];
	let current: string[] = [];
	let currentBytes = 0;
	let planned = 0;
	for (const uid of uids) {
		if (planned >= MAX_IMAP_BATCH_BYTES) break;
		const size = sizes.get(uid);
		if (size === undefined) {
			if (current.length) groups.push(current);
			groups.push([uid]);
			current = [];
			currentBytes = 0;
			planned = MAX_IMAP_BATCH_BYTES;
			continue;
		}
		current.push(uid);
		currentBytes += size;
		planned += size;
		if (current.length >= IMAP_PIPELINE_COUNT || currentBytes >= IMAP_PIPELINE_BYTES) {
			groups.push(current);
			current = [];
			currentBytes = 0;
		}
	}
	if (current.length) groups.push(current);
	return groups;
}

export function getLiteralLength(line: string): number | null {
	const match = line.match(/\{(\d+)\}$/);
	return match ? Number(match[1]) : null;
}

/** Uppercased flags from a FETCH response line, or null when the line has none. */
export function parseFetchFlags(line: string): string[] | null {
	const match = line.match(/\bFLAGS \(([^)]*)\)/i);
	if (!match) return null;
	return match[1].trim().split(/\s+/).filter(Boolean).map((flag) => flag.toUpperCase());
}

export function isTaggedCompletion(line: string, tag: string): boolean {
	return line.toUpperCase().startsWith(`${tag.toUpperCase()} `);
}

export function parseListMailboxName(line: string): string | null {
	const match = line.match(/^\* LIST\s+\([^\)]*\)\s+(?:"[^"]*"|NIL)\s+(.+)$/i);
	if (!match?.[1]) return null;
	const value = match[1].trim();
	if (value.startsWith('"') && value.endsWith('"')) {
		return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
	}
	return value || null;
}

const FORBIDDEN_PORTS = new Set([
	20, 21, // FTP
	22, // SSH
	23, // Telnet
	25, // SMTP
	53, // DNS
	67, 68, // DHCP
	69, // TFTP
	80, // HTTP
	110, // POP3
	119, // NNTP
	123, // NTP
	135, 137, 138, 139, 445, // NetBIOS / SMB
	1433, // MSSQL
	1521, // Oracle
	2049, // NFS
	2375, 2376, // Docker
	3306, // MySQL
	3389, // RDP
	5432, // PostgreSQL
	5984, // CouchDB
	6379, // Redis
	8080, 8443, // HTTP Alt
	9200, 9300, // Elasticsearch
	11211, // Memcached
	27017, 27018, // MongoDB
]);

export function assertSafeImapPort(port: number): void {
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error("IMAP port is invalid");
	}
	if (port === 993 || port === 143) {
		return;
	}
	if (port < 1024 || FORBIDDEN_PORTS.has(port)) {
		throw new Error("IMAP port is not allowed");
	}
}

const WILDCARD_DNS_SUFFIXES = ["nip.io", "sslip.io", "xip.io", "traefik.me", "localtest.me", "lvh.me", "localhost.run"];

function isForbiddenImapHost(host: string): boolean {
	if (WILDCARD_DNS_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return true;
	for (const match of host.matchAll(/(?<![\d])(\d{1,3})[.-](\d{1,3})[.-](\d{1,3})[.-](\d{1,3})(?![\d])/g)) {
		if (isPrivateImapIp(`${match[1]}.${match[2]}.${match[3]}.${match[4]}`)) return true;
	}
	return host === "localhost"
		|| host === "local"
		|| host === "internal"
		|| host === "intranet"
		|| host === "lan"
		|| host === "corp"
		|| host === "localdomain"
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

function isPrivateImapIp(value: string): boolean {
	const parts = value.split(".").map(Number);
	if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
	const [a, b] = parts;
	return a === 10 || a === 127 || a === 0 || a >= 224 ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 169 && b === 254) ||
		(a === 100 && b >= 64 && b <= 127);
}

export function assertSafeImapHost(host: string, port?: number): void {
	const value = host.trim().toLowerCase();
	if (!value) {
		throw new Error("IMAP host is not allowed");
	}
	if (value.includes(":") || value.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(value)) {
		const cleanIp = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
		if (cleanIp === "::1" || cleanIp === "::" || cleanIp.startsWith("fe80:") || cleanIp.startsWith("fc") || cleanIp.startsWith("fd") || isPrivateImapIp(cleanIp)) {
			throw new Error("Private IMAP hosts are not allowed");
		}
	}
	if (isForbiddenImapHost(value)) {
		throw new Error("IMAP host is not allowed");
	}
	if (port !== undefined) {
		assertSafeImapPort(port);
	}
}
