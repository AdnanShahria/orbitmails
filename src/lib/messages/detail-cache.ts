import { AUTH_SESSION_CHANGED_EVENT, authFetch } from "@/lib/auth/client";
import { CONTACT_AVATAR_CHANGED_EVENT } from "@/lib/contacts/avatar-client";
import type { ContactAvatarChangedDetail } from "@/lib/contacts/avatar-client-types";
import { normalizeEmailAddress } from "@/lib/email/address";
import type { Message } from "@/hooks/types";
import type { CachedMessageDetail } from "./detail-cache-types";

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_LIMIT = 50;
const detailCache = new Map<string, { data: CachedMessageDetail; expiresAt: number }>();
const detailRequests = new Map<string, Promise<CachedMessageDetail>>();
let generation = 0;

function cacheDetail(messageId: string, data: CachedMessageDetail) {
	detailCache.delete(messageId);
	detailCache.set(messageId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
	if (detailCache.size > CACHE_LIMIT) {
		const oldest = detailCache.keys().next().value;
		if (oldest) detailCache.delete(oldest);
	}
}

export function clearMessageDetailCache() {
	generation += 1;
	detailCache.clear();
	detailRequests.clear();
}

export function getCachedMessageDetail(messageId: string): CachedMessageDetail | undefined {
	const cached = detailCache.get(messageId);
	if (!cached) return undefined;
	if (cached.expiresAt <= Date.now()) {
		detailCache.delete(messageId);
		return undefined;
	}
	detailCache.delete(messageId);
	detailCache.set(messageId, cached);
	return cached.data;
}

export function setCachedMessageRead(messageId: string, read: boolean): void {
	const cached = getCachedMessageDetail(messageId);
	if (cached?.message) cacheDetail(messageId, { ...cached, message: { ...cached.message, read } });
}

export function primeMessageDetail(message: Message): void {
	if (message.textBody === undefined && message.htmlBody === undefined) return;
	cacheDetail(message.id, {
		message,
		body: { textBody: message.textBody ?? null, htmlBody: message.htmlBody ?? null },
	});
}

export async function fetchCachedMessageDetail(messageId: string, force = false): Promise<CachedMessageDetail> {
	const cached = getCachedMessageDetail(messageId);
	if (!force && cached) return cached;
	if (detailRequests.has(messageId)) return detailRequests.get(messageId) ?? {};
	const requestGeneration = generation;
	const request = authFetch(`/api/messages/${messageId}`, { cache: "no-store" })
		.then(async (response) => {
			const data = await response.json() as CachedMessageDetail;
			if (requestGeneration !== generation) throw new Error("Message request invalidated");
			if (response.ok && !data.error) cacheDetail(messageId, data);
			return data;
		})
		.finally(() => { if (detailRequests.get(messageId) === request) detailRequests.delete(messageId); });
	detailRequests.set(messageId, request);
	return request;
}

function updateCachedContactAvatar(detail: ContactAvatarChangedDetail | undefined) {
	if (!detail?.email) return;
	for (const [id, entry] of detailCache.entries()) {
		if (!entry.data.message) continue;
		if (normalizeEmailAddress(entry.data.message.fromAddr) !== detail.email) continue;
		detailCache.set(id, {
			...entry,
			data: {
				...entry.data,
				message: { ...entry.data.message, fromContactHasAvatar: !!detail.hasAvatar },
			},
		});
	}
}

if (typeof window !== "undefined") {
	window.addEventListener(AUTH_SESSION_CHANGED_EVENT, clearMessageDetailCache);
	window.addEventListener(CONTACT_AVATAR_CHANGED_EVENT, (event) => {
		updateCachedContactAvatar((event as CustomEvent<ContactAvatarChangedDetail>).detail);
	});
}
