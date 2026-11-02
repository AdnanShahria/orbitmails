import type { OutboundProviderMessage } from "@/lib/email/outbound-provider-types";
import { BrevoAdapter } from "./brevo";
import { CloudflareEmailAdapter } from "./cloudflare";
import {
	decryptCredentialsRecord,
	resolveMasterEncryptionSecret,
} from "./crypto";
import { ProviderError, wrapAsProviderError } from "./error";
import { MailgunAdapter } from "./mailgun";
import { ResendAdapter } from "./resend";
import { SesAdapter } from "./ses";
import type {
	AnyProviderCredentials,
	MailHubProviderType,
	ProviderAdapter,
	ProviderSendOptions,
	ProviderSendResult,
} from "./types";
import { ZeptoMailAdapter } from "./zeptomail";

const adapters: Record<MailHubProviderType, ProviderAdapter> = {
	brevo: new BrevoAdapter(),
	resend: new ResendAdapter(),
	ses: new SesAdapter(),
	zeptomail: new ZeptoMailAdapter(),
	mailgun: new MailgunAdapter(),
	cloudflare: new CloudflareEmailAdapter(),
};

/**
 * Returns the ProviderAdapter instance for the given provider type.
 */
export function getProviderAdapter(provider: MailHubProviderType): ProviderAdapter {
	const adapter = adapters[provider];
	if (!adapter) {
		throw new ProviderError({
			message: `Unsupported or unknown outbound email provider: "${provider}"`,
			code: "INVALID_PAYLOAD",
			provider: (provider as MailHubProviderType) || "cloudflare",
		});
	}
	return adapter;
}

/**
 * Validates whether a string is a recognized MailHub provider type.
 */
export function isSupportedProvider(provider: string): provider is MailHubProviderType {
	return provider in adapters;
}

/**
 * Unified dispatch helper:
 * 1. Resolves adapter
 * 2. Decrypts credentials if encrypted at rest
 * 3. Executes send with timeout and uniform error wrapping
 */
export async function sendWithAdapter(
	provider: MailHubProviderType,
	credentials: AnyProviderCredentials | Record<string, any>,
	message: OutboundProviderMessage,
	options?: ProviderSendOptions,
	env?: any,
): Promise<ProviderSendResult> {
	const adapter = getProviderAdapter(provider);

	// Decrypt any encrypted fields in credentials using master secret
	const masterSecret = resolveMasterEncryptionSecret(env);
	const decryptedCredentials = await decryptCredentialsRecord(credentials, masterSecret);

	try {
		return await adapter.send(decryptedCredentials, message, options, env);
	} catch (err) {
		throw wrapAsProviderError(err, provider);
	}
}
