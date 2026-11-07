import type { TranslationKey } from "@/lib/i18n/types";

export type SettingsNavItem = {
	href: string;
	labelKey: TranslationKey;
	requiresMailboxAccess?: boolean;
	requiresDomainAccess?: boolean;
};

export type SettingsNavSection = {
	labelKey: TranslationKey;
	items: SettingsNavItem[];
};
