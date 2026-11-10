/**
 * OrbitMails - Structured JSON Logging with PII Redaction
 * @module lib/logging/logger
 *
 * Implements high-performance, structured JSON logging for Cloudflare Workers,
 * Docker containers, Kubernetes, and Node.js runtimes. Automatically scrubs PII,
 * secrets, credentials, tokens, and raw MIME from logs.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEYS = new Set([
	"password",
	"passwordhash",
	"secret",
	"token",
	"sessiontoken",
	"authorization",
	"cookie",
	"set-cookie",
	"apikey",
	"key",
	"totpsecret",
	"rawmime",
	"creditcard",
	"cardnumber",
	"cvv",
	"clientsecret",
	"cftoken",
	"cfapikey",
	"webhooksecret",
	"privatekey",
]);

const EMAIL_REGEX = /([a-zA-Z0-9_.+-])[a-zA-Z0-9_.+-]*@([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/g;

/**
 * Mask email address for privacy: test.user@example.com -> t***@example.com
 */
export function maskEmail(email: string): string {
	return email.replace(EMAIL_REGEX, "$1***@$2");
}

/**
 * Recursively sanitize an object to redact sensitive keys, tokens, and PII.
 */
export function sanitizeLogValue(val: unknown, depth = 0): unknown {
	if (depth > 6) return "[MaxDepthReached]";
	if (val === null || val === undefined) return val;

	if (typeof val === "string") {
		// Mask potential Bearer tokens
		if (val.toLowerCase().startsWith("bearer ")) {
			return "Bearer [REDACTED]";
		}
		return val;
	}

	if (typeof val === "number" || typeof val === "boolean") {
		return val;
	}

	if (val instanceof Error) {
		return {
			name: val.name,
			message: val.message,
			stack: process.env.NODE_ENV === "production" ? undefined : val.stack,
		};
	}

	if (Array.isArray(val)) {
		return val.map((item) => sanitizeLogValue(item, depth + 1));
	}

	if (typeof val === "object") {
		const clean: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(val)) {
			const lowerKey = k.toLowerCase().replace(/[^a-z0-9]/g, "");
			if (SENSITIVE_KEYS.has(lowerKey)) {
				clean[k] = "[REDACTED]";
			} else if (typeof v === "string" && (lowerKey.includes("email") || lowerKey === "to" || lowerKey === "from")) {
				clean[k] = maskEmail(v);
			} else {
				clean[k] = sanitizeLogValue(v, depth + 1);
			}
		}
		return clean;
	}

	return String(val);
}

export interface StructuredLogEntry {
	timestamp: string;
	level: LogLevel;
	message: string;
	service: string;
	context?: Record<string, unknown>;
	error?: unknown;
}

class Logger {
	private readonly isProduction = process.env.NODE_ENV === "production";
	private readonly serviceName = "orbitmails";

	private formatLog(level: LogLevel, message: string, context?: Record<string, unknown>, error?: unknown): string {
		const entry: StructuredLogEntry = {
			timestamp: new Date().toISOString(),
			level,
			message,
			service: this.serviceName,
		};

		if (context) {
			entry.context = sanitizeLogValue(context) as Record<string, unknown>;
		}

		if (error) {
			entry.error = sanitizeLogValue(error);
		}

		return JSON.stringify(entry);
	}

	debug(message: string, context?: Record<string, unknown>): void {
		if (this.isProduction && !process.env.DEBUG_LOGS) return;
		console.debug(this.formatLog("debug", message, context));
	}

	info(message: string, context?: Record<string, unknown>): void {
		console.info(this.formatLog("info", message, context));
	}

	warn(message: string, context?: Record<string, unknown>, error?: unknown): void {
		console.warn(this.formatLog("warn", message, context, error));
	}

	error(message: string, context?: Record<string, unknown>, error?: unknown): void {
		console.error(this.formatLog("error", message, context, error));
	}
}

export const logger = new Logger();

