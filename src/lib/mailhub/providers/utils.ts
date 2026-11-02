import { getEmailAddress } from "@/lib/email/address";

export function toBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	}
	return btoa(binary);
}

export function extractDomain(emailOrHostname: string): string {
	const address = getEmailAddress(emailOrHostname);
	const parts = address.split("@");
	return parts.length > 1 ? parts[1].toLowerCase() : address.toLowerCase();
}

export function mintMessageId(from: string): string {
	const domain = extractDomain(from) || "orbitsaas.cloud";
	const id = typeof crypto !== "undefined" && crypto.randomUUID
		? crypto.randomUUID()
		: `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
	return `<${id}@${domain}>`;
}

export async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	timeoutMs = 15000,
): Promise<Response> {
	let signal: AbortSignal;
	let timeoutId: any;

	if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
		signal = AbortSignal.timeout(timeoutMs);
	} else {
		const controller = new AbortController();
		timeoutId = setTimeout(() => controller.abort(), timeoutMs);
		signal = controller.signal;
	}

	try {
		const response = await fetch(url, {
			...init,
			signal: init.signal || signal,
		});
		return response;
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
	}
}
