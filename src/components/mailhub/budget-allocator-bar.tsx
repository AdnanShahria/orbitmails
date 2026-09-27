"use client";

import React from "react";
import { AlertTriangle, CheckCircle2, ShieldAlert } from "@/components/icons";

export interface ProjectSliceBarItem {
	projectId: string;
	projectName: string;
	slice: number;
	percentage: number;
	colorClass: string;
	textColorClass: string;
}

interface BudgetAllocatorBarProps {
	providerName: string;
	providerLimit: number;
	slices: ProjectSliceBarItem[];
	totalAllocated: number;
	isOverAllocated: boolean;
	overAllocatedBy: number;
}

export function BudgetAllocatorBar({
	providerName,
	providerLimit,
	slices,
	totalAllocated,
	isOverAllocated,
	overAllocatedBy,
}: BudgetAllocatorBarProps) {
	const allocationPercentage = Math.min(100, Math.round((totalAllocated / providerLimit) * 100));
	const remainingBuffer = Math.max(0, providerLimit - totalAllocated);

	return (
		<div className="space-y-3 rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-xs dark:border-neutral-800 dark:bg-neutral-900">
			{/* Top Bar Header */}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<div className="flex items-center gap-2">
						<span className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
							Live Allocation Balancer
						</span>
						<span className="inline-flex items-center rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
							{providerName}
						</span>
					</div>
					<div className="mt-1 flex items-baseline gap-2">
						<span className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
							{totalAllocated.toLocaleString()}
						</span>
						<span className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
							/ {providerLimit.toLocaleString()} emails/day
						</span>
					</div>
				</div>

				<div className="flex items-center gap-2">
					{isOverAllocated ? (
						<div className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-300 ring-inset dark:bg-rose-950/60 dark:text-rose-400 dark:ring-rose-800">
							<AlertTriangle className="h-3.5 w-3.5" />
							<span>Exceeded by {overAllocatedBy.toLocaleString()} emails!</span>
						</div>
					) : totalAllocated === providerLimit ? (
						<div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-300 ring-inset dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-800">
							<CheckCircle2 className="h-3.5 w-3.5" />
							<span>100% Fully Allocated</span>
						</div>
					) : (
						<div className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-200 ring-inset dark:bg-blue-950/60 dark:text-blue-400 dark:ring-blue-800">
							<span>{remainingBuffer.toLocaleString()} buffer available</span>
						</div>
					)}
				</div>
			</div>

			{/* Multi-segment Progress Bar */}
			<div className="relative h-4 w-full overflow-hidden rounded-full bg-neutral-100 p-0.5 dark:bg-neutral-800">
				<div className="flex h-full w-full overflow-hidden rounded-full">
					{slices.map((slice) => {
						if (slice.slice <= 0) return null;
						// Width proportional to providerLimit
						const widthPct = Math.min(100, (slice.slice / providerLimit) * 100);
						return (
							<div
								key={slice.projectId}
								style={{ width: `${widthPct}%` }}
								className={`h-full transition-all duration-300 ${slice.colorClass}`}
								title={`${slice.projectName}: ${slice.slice} emails (${Math.round((slice.slice / providerLimit) * 100)}%)`}
							/>
						);
					})}
					{isOverAllocated && (
						<div
							style={{ width: `${Math.min(100, (overAllocatedBy / providerLimit) * 100)}%` }}
							className="h-full animate-pulse bg-rose-600"
							title={`Over-allocated: ${overAllocatedBy} emails`}
						/>
					)}
				</div>
			</div>

			{/* Legend */}
			<div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-xs">
				{slices.map((slice) => (
					<div key={slice.projectId} className="flex items-center gap-1.5">
						<span className={`h-2.5 w-2.5 rounded-full ${slice.colorClass}`} />
						<span className="font-medium text-neutral-800 dark:text-neutral-200">
							{slice.projectName}
						</span>
						<span className="text-neutral-500 dark:text-neutral-400">
							({slice.slice} - {Math.round((slice.slice / providerLimit) * 100)}%)
						</span>
					</div>
				))}

				{remainingBuffer > 0 && (
					<div className="flex items-center gap-1.5 text-neutral-500 dark:text-neutral-400">
						<span className="h-2.5 w-2.5 rounded-full bg-neutral-300 dark:bg-neutral-600" />
						<span>Unallocated Buffer ({remainingBuffer})</span>
					</div>
				)}

				{isOverAllocated && (
					<div className="flex items-center gap-1.5 font-semibold text-rose-600 dark:text-rose-400">
						<span className="h-2.5 w-2.5 rounded-full bg-rose-600 animate-pulse" />
						<span>Over-allocated (+{overAllocatedBy})</span>
					</div>
				)}
			</div>

			{/* Real-time Validation Banner */}
			{isOverAllocated && (
				<div className="mt-2 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50/90 p-3 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
					<ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
					<div className="space-y-0.5">
						<p className="font-semibold">Quota Over-Allocation Detected</p>
						<p>
							The sum of project allocations ({totalAllocated}) exceeds {providerName}&apos;s hard daily limit of {providerLimit} emails.
							Please reduce one or more project slices by at least {overAllocatedBy} emails to save changes and prevent routing rejections.
						</p>
					</div>
				</div>
			)}
		</div>
	);
}
