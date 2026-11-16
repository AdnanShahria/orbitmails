/**
 * Security utility to prevent open redirect vulnerabilities.
 * Ensures redirect targets are strictly constrained to safe relative application paths
 * and cannot escape to external origins or invoke pseudo-protocols (e.g. javascript:, data:).
 */

/**
 * Checks whether a target URL/path is a safe relative path within the application.
 * Returns true ONLY if:
 * 1. It is a non-empty string starting with a single '/'
 * 2. It does NOT start with '//' (protocol-relative external URL)
 * 3. It does NOT contain '\' or start with '/\' (Windows backslash path confusion)
 * 4. It does NOT contain control characters, newlines, or null bytes
 */
export function isSafeRedirectPath(target: string | null | undefined): target is string {
	if (!target || typeof target !== "string") return false;
	const trimmed = target.trim();
	if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\") || trimmed.includes("\\")) {
		return false;
	}
	// Reject ASCII control characters, newlines, null bytes
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u001f\u007f-\u009f]/.test(trimmed)) {
		return false;
	}
	return true;
}

/**
 * Returns the target path if it is safe, otherwise falls back to the specified fallback (default: "/inbox").
 */
export function safeRedirectUrl(target: string | null | undefined, fallback = "/inbox"): string {
	return isSafeRedirectPath(target) ? target.trim() : fallback;
}
