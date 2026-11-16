import type { ImapImportInput } from "@/lib/import/imap-types";
import { assertSafeImapPort } from "@/lib/import/imap-utils";
import type { ImapFolderListRequest } from "./types";

export function parseImapFolderListRequest(input: ImapFolderListRequest): Omit<ImapImportInput, "folder" | "limit" | "offset"> {
	const host = input.host?.trim() ?? "";
	const port = Number(input.port ?? 993);
	const username = input.username?.trim() ?? "";
	const password = input.password ?? "";

	if (!host) throw new Error("IMAP host is required");
	assertSafeImapPort(port);
	if (!username || !password) throw new Error("IMAP username and password are required");

	return {
		host,
		port,
		secure: input.secure ?? port === 993,
		username,
		password,
	};
}
