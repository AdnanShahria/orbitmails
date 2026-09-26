"use client";

import React, { useState } from "react";
import { Plus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

interface AddProjectModalProps {
	isOpen: boolean;
	onClose: () => void;
	onAddProject: (data: { name: string; slug?: string; description?: string }) => Promise<{ project: any; key: string }>;
	onProjectCreated: (created: { project: any; key: string }) => void;
}

export function AddProjectModal({
	isOpen,
	onClose,
	onAddProject,
	onProjectCreated,
}: AddProjectModalProps) {
	const [name, setName] = useState("");
	const [slug, setSlug] = useState("");
	const [description, setDescription] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const val = e.target.value;
		setName(val);
		if (!slug || slug === name.toLowerCase().replace(/[^a-z0-9]/g, "-")) {
			setSlug(val.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-"));
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		if (!name.trim()) {
			setError("Project name is required.");
			return;
		}

		try {
			setIsSubmitting(true);
			const result = await onAddProject({
				name: name.trim(),
				slug: slug.trim() || undefined,
				description: description.trim() || undefined,
			});
			setName("");
			setSlug("");
			setDescription("");
			onClose();
			onProjectCreated(result);
		} catch (err: any) {
			setError(err.message || "Failed to create project");
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Register New Web Project</DialogTitle>
					<DialogDescription>
						Add a new project (e.g. Aurelia, LifeSolver, Luvio, Ovijatric) to MailHub to receive dedicated quota slices and routing keys.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4 pt-2">
					{error && (
						<div className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
							{error}
						</div>
					)}

					<div className="space-y-1.5">
						<Label htmlFor="proj-name" className="text-xs font-semibold">
							Project Name
						</Label>
						<Input
							id="proj-name"
							placeholder="e.g. Aurelia"
							value={name}
							onChange={handleNameChange}
							className="h-9 text-sm"
							required
						/>
					</div>

					<div className="space-y-1.5">
						<Label htmlFor="proj-slug" className="text-xs font-semibold">
							Slug (Identifier)
						</Label>
						<Input
							id="proj-slug"
							placeholder="e.g. aurelia"
							value={slug}
							onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
							className="h-9 font-mono text-xs"
						/>
						<p className="text-[11px] text-neutral-400">
							Used in routing key format: <code className="font-mono">om_live_{slug || "project"}_...</code>
						</p>
					</div>

					<div className="space-y-1.5">
						<Label htmlFor="proj-desc" className="text-xs font-semibold">
							Description (Optional)
						</Label>
						<Input
							id="proj-desc"
							placeholder="e.g. Transactional notifications & newsletter"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							className="h-9 text-xs"
						/>
					</div>

					<div className="flex items-center justify-end gap-2 pt-3">
						<Button type="button" variant="outline" size="sm" onClick={onClose} className="h-8 text-xs">
							Cancel
						</Button>
						<Button type="submit" size="sm" disabled={isSubmitting} className="h-8 gap-1.5 text-xs font-semibold">
							<Plus className="h-3.5 w-3.5" />
							{isSubmitting ? "Creating..." : "Create Project"}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
