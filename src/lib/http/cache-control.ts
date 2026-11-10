/**
 * OrbitMails - HTTP Cache-Control Header Utilities
 * @module lib/http/cache-control
 */

export function getNoStoreHeaders(): Record<string, string> {
	return {
		"Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
		Pragma: "no-cache",
		Expires: "0",
	};
}

export function getPublicCacheHeaders(maxAgeSeconds = 3600, staleWhileRevalidate = 600): Record<string, string> {
	return {
		"Cache-Control": `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${staleWhileRevalidate}`,
	};
}

export function getImmutableCacheHeaders(): Record<string, string> {
	return {
		"Cache-Control": "public, max-age=31536000, immutable",
	};
}

export function applyNoStoreHeaders(response: Response): Response {
	response.headers.set("Cache-Control", "private, no-cache, no-store, max-age=0, must-revalidate");
	response.headers.set("Pragma", "no-cache");
	response.headers.set("Expires", "0");
	return response;
}

