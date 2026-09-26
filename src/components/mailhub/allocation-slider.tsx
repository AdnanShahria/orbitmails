"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface AllocationSliderProps {
	projectId: string;
	projectName: string;
	projectSlug: string;
	slice: number;
	maxLimit: number;
	usedToday: number;
	colorClass: string;
	badgeBgClass: string;
	onChange: (newSlice: number) => void;
	disabled?: boolean;
}

export function AllocationSlider({
	projectId,
	projectName,
	projectSlug,
	slice,
	maxLimit,
	usedToday,
	colorClass,
	badgeBgClass,
	onChange,
	disabled = false,
}: AllocationSliderProps) {
	const percentageOfLimit = Math.min(100, Math.round((slice / maxLimit) * 100));
	const usedPercentage = slice > 0 ? Math.min(100, Math.round((usedToday / slice) * 100)) : 0;

	const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const val = parseInt(e.target.value, 10);
		onChange(isNaN(val) ? 0 : Math.max(0, val));
	};

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const val = parseInt(e.target.value, 10);
		onChange(isNaN(val) ? 0 : Math.max(0, val));
	};

	const adjust = (delta: number) => {
		onChange(Math.max(0, Math.min(maxLimit, slice + delta)));
	};

	return (
		<div className="rounded-xl border border-neutral-200/70 bg-white p-4 transition-all hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900/60 dark:hover:border-neutral-700">
			{/* Header info */}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2.5">
					<div className={`h-3.5 w-3.5 rounded-full ${colorClass}`} />
					<div>
						<div className="flex items-center gap-2">
							<span className="font-semibold text-neutral-900 dark:text-neutral-100">{projectName}</span>
							<span className="font-mono text-xs text-neutral-400">({projectSlug})</span>
						</div>
						<div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
							<span>Used today:</span>
							<span className="font-medium text-neutral-700 dark:text-neutral-300">
								{usedToday.toLocaleString()} / {slice.toLocaleString()} ({usedPercentage}%)
							</span>
						</div>
					</div>
				</div>

				{/* Number Input & Controls */}
				<div className="flex items-center gap-2">
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={() => adjust(-10)}
							disabled={disabled || slice <= 0}
							className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
							title="Decrease by 10"
						>
							-10
						</button>
						<button
							type="button"
							onClick={() => adjust(+10)}
							disabled={disabled || slice >= maxLimit}
							className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
							title="Increase by 10"
						>
							+10
						</button>
					</div>

					<div className="relative w-28">
						<Input
							type="number"
							min={0}
							max={maxLimit}
							value={slice}
							onChange={handleInputChange}
							disabled={disabled}
							className="h-8 pr-8 text-right font-mono text-sm font-semibold"
						/>
						<span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-neutral-400">
							/day
						</span>
					</div>
				</div>
			</div>

			{/* Interactive Range Slider */}
			<div className="mt-3.5 space-y-1.5">
				<div className="relative flex items-center">
					<input
						type="range"
						min={0}
						max={maxLimit}
						step={5}
						value={slice}
						onChange={handleSliderChange}
						disabled={disabled}
						className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-neutral-200 accent-neutral-900 disabled:opacity-50 dark:bg-neutral-700 dark:accent-neutral-100"
					/>
				</div>

				<div className="flex items-center justify-between text-[11px] text-neutral-400">
					<span>0 emails</span>
					<span>{percentageOfLimit}% of provider limit</span>
					<span>{maxLimit.toLocaleString()} max</span>
				</div>
			</div>

			{/* Mini Usage Bar */}
			{slice > 0 && (
				<div className="mt-2.5">
					<div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
						<div
							style={{ width: `${usedPercentage}%` }}
							className={`h-full transition-all duration-300 ${
								usedPercentage > 90 ? "bg-rose-500" : usedPercentage > 75 ? "bg-amber-500" : "bg-emerald-500"
							}`}
						/>
					</div>
				</div>
			)}
		</div>
	);
}
