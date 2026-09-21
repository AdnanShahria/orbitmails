export interface QuotaCheckResult {
	/** Whether this request is within quota and permitted to proceed */
	allowed: boolean;
	/** Number of emails remaining in this project's slice for the day */
	remaining: number;
	/** Number of emails used so far today by this project for this provider */
	currentUsed: number;
	/** Configured daily slice limit */
	sliceLimit: number;
	/** Date bucket (YYYY-MM-DD UTC) */
	dateBucket: string;
	/** Unix timestamp in ms when the daily quota resets (next UTC midnight) */
	resetAt: number;
}

export interface QuotaRefundResult {
	refunded: boolean;
	remaining: number;
	currentUsed: number;
	dateBucket: string;
}

export interface QuotaSnapshot {
	projectId: string;
	providerId: string;
	currentUsed: number;
	dateBucket: string;
	updatedAt: number;
}

export interface QuotaParams {
	projectId: string;
	providerId: string;
	sliceLimit: number;
	dateBucket?: string;
}

export interface RefundParams {
	projectId: string;
	providerId: string;
	dateBucket?: string;
	count?: number;
}

/**
 * Returns current UTC date string in 'YYYY-MM-DD' format.
 */
export function getTodayUtcDateBucket(d = new Date()): string {
	const year = d.getUTCFullYear();
	const month = String(d.getUTCMonth() + 1).padStart(2, "0");
	const day = String(d.getUTCDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/**
 * Returns timestamp in ms for the next UTC midnight (00:00:00.000 UTC).
 */
export function getNextUtcMidnightMs(d = new Date()): number {
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
}

/**
 * Returns a UTC date bucket offset by N days (positive or negative).
 */
export function getUtcDateBucketOffsetDays(daysOffset: number, d = new Date()): string {
	const target = new Date(d.getTime() + daysOffset * 86400000);
	return getTodayUtcDateBucket(target);
}
