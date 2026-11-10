/**
 * OrbitMails - Standard API Pagination Utilities
 * @module lib/api/pagination
 *
 * Implements standard cursor-based and offset-based pagination to optimize payload transfer sizes.
 */

export interface PaginationParams {
	limit: number;
	offset: number;
	cursor?: string | null;
}

export interface PaginatedResult<T> {
	items: T[];
	pagination: {
		limit: number;
		offset: number;
		total?: number;
		hasMore: boolean;
		nextCursor?: string | null;
	};
}

/**
 * Parses and bounds pagination parameters from a URL query string.
 */
export function parsePaginationParams(
	urlOrParams: URL | URLSearchParams,
	defaultLimit = 50,
	maxLimit = 100,
): PaginationParams {
	const params = urlOrParams instanceof URL ? urlOrParams.searchParams : urlOrParams;

	const rawLimit = Number(params.get("limit") ?? defaultLimit);
	const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, maxLimit) : defaultLimit;

	const rawOffset = Number(params.get("offset") ?? 0);
	const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

	const cursor = params.get("cursor")?.trim() || null;

	return { limit, offset, cursor };
}

/**
 * Creates an opaque base64 cursor from an ID and timestamp.
 */
export function encodeCursor(id: string, timestamp: number | Date): string {
	const time = timestamp instanceof Date ? timestamp.getTime() : timestamp;
	const payload = JSON.stringify({ id, time });
	return btoa(payload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decodes an opaque base64 cursor.
 */
export function decodeCursor(cursor: string): { id: string; time: number } | null {
	try {
		let base64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
		while (base64.length % 4 !== 0) {
			base64 += "=";
		}
		const json = atob(base64);
		const parsed = JSON.parse(json) as { id: string; time: number };
		if (typeof parsed.id === "string" && typeof parsed.time === "number") {
			return parsed;
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Formats data and pagination metadata into a standard response payload.
 */
export function formatPaginatedResponse<T>(
	items: T[],
	params: PaginationParams,
	options: {
		total?: number;
		getId?: (item: T) => string;
		getTimestamp?: (item: T) => number | Date;
	} = {},
): PaginatedResult<T> {
	const hasMore = items.length > params.limit;
	const sliced = hasMore ? items.slice(0, params.limit) : items;

	let nextCursor: string | null = null;
	if (hasMore && options.getId && options.getTimestamp) {
		const lastItem = sliced[sliced.length - 1];
		if (lastItem) {
			nextCursor = encodeCursor(options.getId(lastItem), options.getTimestamp(lastItem));
		}
	}

	return {
		items: sliced,
		pagination: {
			limit: params.limit,
			offset: params.offset,
			total: options.total,
			hasMore,
			nextCursor,
		},
	};
}

