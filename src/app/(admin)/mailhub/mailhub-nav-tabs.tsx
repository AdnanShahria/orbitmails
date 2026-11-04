"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Route } from "@/components/icons";

interface MailHubNavTabsProps {
  className?: string;
}

export function MailHubNavTabs({ className = "" }: MailHubNavTabsProps) {
  const pathname = usePathname();
  // Check if we are currently on the allocations tab
  const isAllocations = pathname === "/mailhub/allocations" || pathname === "/admin/mailhub/allocations";
  const isObservability = !isAllocations;

  return (
    <nav
      aria-label="MailHub Section Navigation"
      className={`inline-flex w-full sm:w-auto items-center p-1 rounded-2xl bg-neutral-200/70 dark:bg-neutral-800/80 backdrop-blur-md border border-neutral-300/40 dark:border-neutral-700/50 shadow-inner ${className}`}
    >
      {/* Tab 1: Observability & Activity */}
      <Link
        href="/mailhub"
        aria-current={isObservability ? "page" : undefined}
        className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[44px] rounded-xl text-xs font-semibold tracking-tight transition-all duration-200 select-none ${
          isObservability
            ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-50 dark:shadow-black/40"
            : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 hover:bg-neutral-300/30 dark:hover:bg-neutral-700/40"
        }`}
      >
        <Activity
          className={`h-4 w-4 shrink-0 transition-colors ${
            isObservability ? "text-blue-600 dark:text-blue-400" : "text-neutral-500 dark:text-neutral-400"
          }`}
        />
        <span>Observability &amp; Activity</span>
      </Link>

      {/* Tab 2: Capacity & Quota Slices */}
      <Link
        href="/mailhub/allocations"
        aria-current={isAllocations ? "page" : undefined}
        className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[44px] rounded-xl text-xs font-semibold tracking-tight transition-all duration-200 select-none ${
          isAllocations
            ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-50 dark:shadow-black/40"
            : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 hover:bg-neutral-300/30 dark:hover:bg-neutral-700/40"
        }`}
      >
        <Route
          className={`h-4 w-4 shrink-0 transition-colors ${
            isAllocations ? "text-blue-600 dark:text-blue-400" : "text-neutral-500 dark:text-neutral-400"
          }`}
        />
        <span>Capacity &amp; Quota Slices</span>
      </Link>
    </nav>
  );
}
