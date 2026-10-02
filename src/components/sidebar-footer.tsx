"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import packageJson from "../../package.json";
import { useSidebar } from "./sidebar-state";
import { useShortcuts } from "./shortcuts";
import { Keyboard, Monitor, Moon, Sun } from "@/components/icons";
import { useLanguage } from "./language-provider";
import { Tooltip } from "./ui/tooltip";
import {
	readThemePreference,
	saveThemePreference,
	THEME_CHANGED_EVENT,
	type ThemePreference,
} from "./theme-utils";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/lib/i18n/types";

const THEME_OPTIONS_MAP: Record<ThemePreference, TranslationKey> = {
	light: "settings.theme.light",
	dark: "settings.theme.dark",
	system: "settings.theme.system",
};

export function SidebarFooter() {
	const { t } = useLanguage();
	const { minimal } = useSidebar();
	const { openHelpModal, shortcutsEnabled, shortcutsPreferenceLoading } = useShortcuts();
	const [preference, setPreference] = useState<ThemePreference>("system");

	useEffect(() => {
		setPreference(readThemePreference());
		const sync = () => setPreference(readThemePreference());
		window.addEventListener(THEME_CHANGED_EVENT, sync);
		return () => window.removeEventListener(THEME_CHANGED_EVENT, sync);
	}, []);

	const handleSetTheme = (next: ThemePreference) => {
		setPreference(next);
		saveThemePreference(next);
	};

	const cycleTheme = () => {
		const order: ThemePreference[] = ["light", "dark", "system"];
		const currentIndex = order.indexOf(preference);
		const next = order[(currentIndex + 1) % order.length];
		handleSetTheme(next);
	};

	// Collapsed icon rail view (minimal)
	if (minimal) {
		return (
			<div className="flex flex-col items-center gap-1.5 pt-2">
				<Tooltip
					label={`${t("settings.theme.label")}: ${t(THEME_OPTIONS_MAP[preference])}`}
					placement="right"
				>
					<button
						type="button"
						onClick={cycleTheme}
						className="flex h-9 w-9 items-center justify-center rounded-xl text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/70 dark:text-neutral-400 dark:hover:text-neutral-100 dark:hover:bg-neutral-800 transition-colors"
						aria-label={`${t("settings.theme.label")}: ${t(THEME_OPTIONS_MAP[preference])}`}
					>
						{preference === "light" && <Sun className="w-4 h-4 text-amber-500" />}
						{preference === "dark" && <Moon className="w-4 h-4 text-indigo-400" />}
						{preference === "system" && <Monitor className="w-4 h-4 text-neutral-500" />}
					</button>
				</Tooltip>
				{shortcutsEnabled && !shortcutsPreferenceLoading && (
					<Tooltip label={t("navigation.shortcuts")} placement="right">
						<button
							type="button"
							onClick={openHelpModal}
							className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200/60 dark:hover:bg-neutral-800 text-xs font-mono transition-colors"
							aria-label={t("navigation.shortcuts")}
						>
							?
						</button>
					</Tooltip>
				)}
			</div>
		);
	}

	// Expanded sidebar view
	return (
		<div className="pt-2 flex flex-col gap-2">
			{/* Apple-style segmented theme toggle */}
			<div
				role="radiogroup"
				aria-label={t("settings.theme.label")}
				className="flex items-center rounded-xl bg-neutral-200/60 dark:bg-neutral-800/80 p-0.5 border border-neutral-300/40 dark:border-neutral-700/60 shadow-2xs"
			>
				<button
					type="button"
					role="radio"
					aria-checked={preference === "light"}
					onClick={() => handleSetTheme("light")}
					className={cn(
						"flex-1 flex items-center justify-center gap-1.5 py-1 px-1.5 text-xs rounded-lg transition-all",
						preference === "light"
							? "bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white font-medium shadow-2xs"
							: "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200"
					)}
					title={t("settings.theme.light")}
				>
					<Sun className="w-3.5 h-3.5 text-amber-500" />
					<span className="text-[11px]">{t("settings.theme.light")}</span>
				</button>
				<button
					type="button"
					role="radio"
					aria-checked={preference === "dark"}
					onClick={() => handleSetTheme("dark")}
					className={cn(
						"flex-1 flex items-center justify-center gap-1.5 py-1 px-1.5 text-xs rounded-lg transition-all",
						preference === "dark"
							? "bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white font-medium shadow-2xs"
							: "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200"
					)}
					title={t("settings.theme.dark")}
				>
					<Moon className="w-3.5 h-3.5 text-indigo-400" />
					<span className="text-[11px]">{t("settings.theme.dark")}</span>
				</button>
				<button
					type="button"
					role="radio"
					aria-checked={preference === "system"}
					onClick={() => handleSetTheme("system")}
					className={cn(
						"flex-1 flex items-center justify-center gap-1.5 py-1 px-1.5 text-xs rounded-lg transition-all",
						preference === "system"
							? "bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white font-medium shadow-2xs"
							: "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200"
					)}
					title={t("settings.theme.system")}
				>
					<Monitor className="w-3.5 h-3.5 text-neutral-400" />
					<span className="text-[11px]">{t("settings.theme.system")}</span>
				</button>
			</div>

			{/* OrbitMails MailHub 1,000/s Live Engine Link */}
			<Link
				href="/mailhub"
				className="flex items-center justify-between px-2.5 py-1 text-xs text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/50 dark:text-neutral-400 dark:hover:text-neutral-200 dark:hover:bg-neutral-800/60 rounded-xl transition-colors group border border-transparent hover:border-neutral-200/60 dark:hover:border-neutral-700/60"
				title="OrbitMails High-Throughput MailHub"
			>
				<span className="flex items-center gap-1.5">
					<span className="relative flex h-2 w-2">
						<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
						<span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
					</span>
					<span className="font-medium text-[11px]">MailHub Dispatcher</span>
				</span>
				<span className="text-[10px] tracking-wider text-emerald-600 dark:text-emerald-400 font-semibold px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/40">
					1,000/s
				</span>
			</Link>

			{/* Keyboard Shortcuts Trigger */}
			{shortcutsEnabled && !shortcutsPreferenceLoading && (
				<button
					type="button"
					onClick={openHelpModal}
					className="flex items-center justify-between w-full px-2.5 py-1 text-xs text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/60 dark:hover:text-neutral-200 dark:hover:bg-neutral-800/60 rounded-xl transition-colors"
				>
					<span className="flex items-center gap-1.5">
						<Keyboard className="w-3.5 h-3.5 text-neutral-400" />
						{t("navigation.shortcuts")}
					</span>
					<kbd className="px-1.5 py-0.5 font-mono text-[10px] bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded text-neutral-500 dark:text-neutral-400 shadow-2xs">
						?
					</kbd>
				</button>
			)}

			{/* OrbitMails Brand & Sovereignty Info */}
			<PoweredBy />
		</div>
	);
}

/** The "OrbitMails vX" credit, shared across sidebars */
export function PoweredBy({ className = "px-1" }: { className?: string }) {
	return (
		<div className={`${className} flex items-center justify-between text-[11px] text-neutral-400 dark:text-neutral-500 pt-0.5`}>
			<span>OrbitMails v{packageJson.version}</span>
			<span className="text-[10px] font-medium tracking-wide text-neutral-400/80 uppercase">
				Sovereign
			</span>
		</div>
	);
}
