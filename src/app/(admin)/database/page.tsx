"use client";

import { useState, useEffect } from "react";
import {
	Database,
	Search,
	RefreshCw,
	ChevronLeft,
	ChevronRight,
	Play,
	Columns2,
	Copy,
	Check,
	ExternalLink,
	Activity,
} from "@/components/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@/components/ui/dialog";

interface TableMeta {
	name: string;
	count: number;
}

interface ColumnMeta {
	cid: number;
	name: string;
	type: string;
	notnull: number;
	dflt_value: any;
	pk: number;
}

interface TableDataResponse {
	table: string;
	columns: ColumnMeta[];
	rows: Record<string, any>[];
	pagination: {
		page: number;
		limit: number;
		totalRows: number;
		totalPages: number;
	};
}

export default function DatabaseExplorerPage() {
	const [tables, setTables] = useState<TableMeta[]>([]);
	const [tableSearch, setTableSearch] = useState("");
	const [selectedTable, setSelectedTable] = useState<string>("");
	const [tableData, setTableData] = useState<TableDataResponse | null>(null);
	const [activeTab, setActiveTab] = useState<"data" | "console" | "schema">("data");

	// Pagination & row search
	const [page, setPage] = useState(1);
	const [limit] = useState(25);
	const [rowSearch, setRowSearch] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Cell Inspector Modal
	const [inspectCell, setInspectCell] = useState<{ col: string; val: any } | null>(null);
	const [copied, setCopied] = useState(false);

	// SQL Console state
	const [sqlQuery, setSqlQuery] = useState("SELECT * FROM email_router_send_logs ORDER BY sent_at DESC LIMIT 20;");
	const [sqlResults, setSqlResults] = useState<{
		columns: string[];
		rows: Record<string, any>[];
		executionTimeMs: number;
		rowCount: number;
	} | null>(null);
	const [sqlError, setSqlError] = useState<string | null>(null);
	const [isSqlRunning, setIsSqlRunning] = useState(false);

	// Fetch table list on load
	useEffect(() => {
		async function loadTables() {
			try {
				const res = await fetch("/api/admin/database?action=tables");
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = (await res.json()) as any;
				if (data.tables && data.tables.length > 0) {
					setTables(data.tables as TableMeta[]);
					const defaultTbl =
						data.tables.find((t: TableMeta) => t.name === "email_router_send_logs")?.name ||
						data.tables[0].name;
					setSelectedTable(defaultTbl);
				}
			} catch {
				setError("Failed to load tables. Ensure admin authorization is active.");
			}
		}
		loadTables();
	}, []);

	// Fetch table data when selectedTable, page, or rowSearch changes
	useEffect(() => {
		if (!selectedTable) return;
		let isMounted = true;
		setIsLoading(true);
		setError(null);

		const searchParam = rowSearch ? `&search=${encodeURIComponent(rowSearch)}` : "";
		fetch(`/api/admin/database?table=${encodeURIComponent(selectedTable)}&page=${page}&limit=${limit}${searchParam}`)
			.then((res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return res.json();
			})
			.then((data: any) => {
				if (isMounted) {
					setTableData(data as TableDataResponse);
					setIsLoading(false);
				}
			})
			.catch((err) => {
				if (isMounted) {
					setError(err.message || "Failed to load table data");
					setIsLoading(false);
				}
			});

		return () => {
			isMounted = false;
		};
	}, [selectedTable, page, rowSearch, limit]);

	// Execute custom SQL
	async function runQuery() {
		if (!sqlQuery.trim()) return;
		setIsSqlRunning(true);
		setSqlError(null);
		try {
			const res = await fetch("/api/admin/database", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: sqlQuery }),
			});
			const data = (await res.json()) as any;
			if (!res.ok || !data.success) {
				throw new Error(data.error || "Query failed");
			}
			setSqlResults(data);
		} catch (err: any) {
			setSqlError(err.message || "Execution error");
		} finally {
			setIsSqlRunning(false);
		}
	}

	const filteredTables = tables.filter((t) =>
		t.name.toLowerCase().includes(tableSearch.toLowerCase())
	);

	function copyText(val: string) {
		navigator.clipboard.writeText(val);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}

	return (
		<div className="space-y-6">
			{/* Top Header */}
			<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
				<div>
					<div className="flex items-center gap-2">
						<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-neutral-900 text-white shadow-sm">
							<Database className="h-5 w-5" />
						</div>
						<h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
							Database Explorer
						</h1>
					</div>
					<p className="mt-1 text-sm text-neutral-500">
						Cloudflare D1 edge database (<code>orbitflare</code>) • Accessible anywhere from phone, tablet, or desktop
					</p>
				</div>

				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						className="h-9 gap-1.5 rounded-xl border-neutral-200 text-xs shadow-none"
						onClick={() => {
							if (selectedTable) {
								setPage(1);
								setRowSearch("");
							}
						}}
					>
						<RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
						Refresh
					</Button>
					<a
						href="https://dash.cloudflare.com/14666fcfc8a4015d8ff3565860e33002/workers/d1/databases/b4c4e894-377a-4b7d-87e1-22bcdab33bb2"
						target="_blank"
						rel="noreferrer"
						className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-neutral-100 px-3 text-xs font-medium text-neutral-700 transition hover:bg-neutral-200"
					>
						Cloudflare D1 <ExternalLink className="h-3 w-3" />
					</a>
				</div>
			</div>

			{/* Main Layout: Sidebar (Tables) + Content */}
			<div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
				{/* Tables List Sidebar */}
				<div className="lg:col-span-3 space-y-3">
					<Card className="rounded-2xl border-neutral-200/80 shadow-sm">
						<CardHeader className="p-4 pb-2">
							<div className="flex items-center justify-between">
								<CardTitle className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
									Tables ({tables.length})
								</CardTitle>
								<Badge variant="secondary" className="text-[10px] h-5 rounded-md">D1 Edge</Badge>
							</div>
							<div className="relative mt-2">
								<Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-neutral-400" />
								<Input
									placeholder="Filter tables..."
									value={tableSearch}
									onChange={(e) => setTableSearch(e.target.value)}
									className="h-8 pl-8 text-xs rounded-xl border-neutral-200"
								/>
							</div>
						</CardHeader>
						<CardContent className="p-2 max-h-[600px] overflow-y-auto space-y-0.5">
							{filteredTables.map((tbl) => {
								const isSelected = selectedTable === tbl.name;
								return (
									<button
										key={tbl.name}
										onClick={() => {
											setSelectedTable(tbl.name);
											setPage(1);
											setRowSearch("");
										}}
										className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-xl font-medium transition text-left ${
											isSelected
												? "bg-neutral-900 text-white shadow-sm"
												: "text-neutral-700 hover:bg-neutral-100"
										}`}
									>
										<span className="truncate pr-2">{tbl.name}</span>
										<span
											className={`text-[10px] px-1.5 py-0.5 rounded-full ${
												isSelected
													? "bg-neutral-800 text-neutral-300"
													: "bg-neutral-100 text-neutral-500"
											}`}
										>
											{tbl.count.toLocaleString()}
										</span>
									</button>
								);
							})}
							{filteredTables.length === 0 && (
								<p className="py-4 text-center text-xs text-neutral-400">No tables match &quot;{tableSearch}&quot;</p>
							)}
						</CardContent>
					</Card>
				</div>

				{/* Main Data & Console Area */}
				<div className="lg:col-span-9 space-y-4">
					<Card className="rounded-2xl border-neutral-200/80 shadow-sm">
						{/* Apple HIG Segmented Controls Header */}
						<div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-100 p-4 gap-3">
							<div className="flex items-center gap-2">
								<span className="font-mono text-sm font-semibold text-neutral-900">
									{selectedTable || "Select Table"}
								</span>
								{tableData && (
									<Badge variant="outline" className="text-xs h-5 rounded-md font-mono">
										{tableData.pagination.totalRows.toLocaleString()} rows
									</Badge>
								)}
							</div>

							<div className="inline-flex rounded-xl bg-neutral-100 p-1">
								<button
									onClick={() => setActiveTab("data")}
									className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
										activeTab === "data" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"
									}`}
								>
									Data Grid
								</button>
								<button
									onClick={() => setActiveTab("console")}
									className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
										activeTab === "console" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"
									}`}
								>
									SQL Console
								</button>
								<button
									onClick={() => setActiveTab("schema")}
									className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
										activeTab === "schema" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"
									}`}
								>
									Schema
								</button>
							</div>
						</div>

						{/* TAB 1: DATA GRID */}
						{activeTab === "data" && (
							<div className="p-4 space-y-4">
								{/* Search & Pagination Bar */}
								<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
									<div className="relative flex-1 max-w-sm">
										<Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-neutral-400" />
										<Input
											placeholder={`Search in ${selectedTable}...`}
											value={rowSearch}
											onChange={(e) => {
												setRowSearch(e.target.value);
												setPage(1);
											}}
											className="h-8 pl-8 text-xs rounded-xl"
										/>
									</div>

									{tableData && (
										<div className="flex items-center gap-2 text-xs text-neutral-500">
											<span>
												Page {tableData.pagination.page} of {tableData.pagination.totalPages}
											</span>
											<Button
												variant="outline"
												size="icon"
												className="h-8 w-8 rounded-lg"
												disabled={page <= 1 || isLoading}
												onClick={() => setPage((p) => Math.max(1, p - 1))}
											>
												<ChevronLeft className="h-3.5 w-3.5" />
											</Button>
											<Button
												variant="outline"
												size="icon"
												className="h-8 w-8 rounded-lg"
												disabled={page >= tableData.pagination.totalPages || isLoading}
												onClick={() => setPage((p) => p + 1)}
											>
												<ChevronRight className="h-3.5 w-3.5" />
											</Button>
										</div>
									)}
								</div>

								{error && (
									<div className="rounded-xl bg-red-50 p-3 text-xs text-red-600">
										{error}
									</div>
								)}

								<div className="overflow-x-auto rounded-xl border border-neutral-200/80">
									<table className="w-full border-collapse text-left text-xs font-mono">
										<thead>
											<tr className="bg-neutral-50 border-b border-neutral-200/80">
												{tableData?.columns.map((col) => (
													<th key={col.cid} className="p-2.5 font-semibold text-neutral-700 whitespace-nowrap">
														<div className="flex items-center gap-1">
															<span>{col.name}</span>
															<span className="text-[10px] text-neutral-400 font-normal">({col.type || "text"})</span>
															{col.pk === 1 && (
																<Badge variant="outline" className="h-4 px-1 text-[9px] border-amber-400 text-amber-600">PK</Badge>
															)}
														</div>
													</th>
												))}
											</tr>
										</thead>
										<tbody className="divide-y divide-neutral-100">
											{tableData?.rows.map((row, rIdx) => (
												<tr key={rIdx} className="hover:bg-neutral-50/80 transition">
													{tableData.columns.map((col) => {
														const cellVal = row[col.name];
														const displayVal =
															cellVal === null || cellVal === undefined
																? "NULL"
																: typeof cellVal === "object"
																? JSON.stringify(cellVal)
																: String(cellVal);

														const isNull = cellVal === null || cellVal === undefined;

														return (
															<td
																key={col.cid}
																onClick={() => setInspectCell({ col: col.name, val: cellVal })}
																className={`p-2.5 max-w-[200px] truncate cursor-pointer transition select-text ${
																	isNull ? "text-neutral-400 italic" : "text-neutral-800"
																}`}
																title={displayVal}
															>
																{displayVal}
															</td>
														);
													})}
												</tr>
											))}
											{tableData?.rows.length === 0 && !isLoading && (
												<tr>
													<td colSpan={tableData?.columns.length || 1} className="p-8 text-center text-neutral-400">
														No records found in {selectedTable}
													</td>
												</tr>
											)}
										</tbody>
									</table>
								</div>
							</div>
						)}

						{/* TAB 2: SQL CONSOLE */}
						{activeTab === "console" && (
							<div className="p-4 space-y-4">
								<div className="space-y-2">
									<div className="flex items-center justify-between">
										<label className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
											Execute SQL Query on D1
										</label>
										<div className="flex gap-1.5">
											<Button
												variant="ghost"
												size="sm"
												className="h-6 text-[10px] px-2 text-neutral-500"
												onClick={() => setSqlQuery(`SELECT * FROM ${selectedTable} LIMIT 10;`)}
											>
												Select from {selectedTable}
											</Button>
											<Button
												variant="ghost"
												size="sm"
												className="h-6 text-[10px] px-2 text-neutral-500"
												onClick={() => setSqlQuery("SELECT * FROM email_router_send_logs ORDER BY sent_at DESC LIMIT 20;")}
											>
												Recent Send Logs
											</Button>
										</div>
									</div>
									<textarea
										value={sqlQuery}
										onChange={(e) => setSqlQuery(e.target.value)}
										rows={4}
										className="w-full rounded-xl border border-neutral-200 p-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-neutral-900"
										placeholder="SELECT * FROM table LIMIT 10;"
									/>
									<div className="flex justify-end">
										<Button
											onClick={runQuery}
											disabled={isSqlRunning || !sqlQuery.trim()}
											size="sm"
											className="rounded-xl h-8 text-xs font-medium bg-neutral-900 text-white hover:bg-neutral-800 gap-1.5"
										>
											<Play className="h-3 w-3" />
											{isSqlRunning ? "Executing..." : "Run Query (D1)"}
										</Button>
									</div>
								</div>

								{sqlError && (
									<div className="rounded-xl bg-red-50 p-3 text-xs text-red-600">
										❌ {sqlError}
									</div>
								)}

								{sqlResults && (
									<div className="space-y-2">
										<div className="flex items-center justify-between text-xs text-neutral-500">
											<span>
												Returned {sqlResults.rowCount} row(s) in {sqlResults.executionTimeMs}ms
											</span>
										</div>
										<div className="overflow-x-auto rounded-xl border border-neutral-200/80">
											<table className="w-full border-collapse text-left text-xs font-mono">
												<thead>
													<tr className="bg-neutral-50 border-b border-neutral-200/80">
														{sqlResults.columns.map((col) => (
															<th key={col} className="p-2.5 font-semibold text-neutral-700 whitespace-nowrap">
																{col}
															</th>
														))}
													</tr>
												</thead>
												<tbody className="divide-y divide-neutral-100">
													{sqlResults.rows.map((row, idx) => (
														<tr key={idx} className="hover:bg-neutral-50/80">
															{sqlResults.columns.map((col) => (
																<td key={col} className="p-2.5 max-w-[200px] truncate select-text">
																	{row[col] === null ? (
																		<span className="text-neutral-400 italic">NULL</span>
																	) : typeof row[col] === "object" ? (
																		JSON.stringify(row[col])
																	) : (
																		String(row[col])
																	)}
																</td>
															))}
														</tr>
													))}
												</tbody>
											</table>
										</div>
									</div>
								)}
							</div>
						)}

						{/* TAB 3: SCHEMA INSPECTOR */}
						{activeTab === "schema" && (
							<div className="p-4 space-y-4">
								<div className="rounded-xl border border-neutral-200/80 overflow-hidden">
									<table className="w-full border-collapse text-left text-xs font-mono">
										<thead className="bg-neutral-50 border-b border-neutral-200/80">
											<tr>
												<th className="p-2.5">Column</th>
												<th className="p-2.5">Type</th>
												<th className="p-2.5">Primary Key</th>
												<th className="p-2.5">Nullable</th>
												<th className="p-2.5">Default</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-neutral-100">
											{tableData?.columns.map((col) => (
												<tr key={col.cid}>
													<td className="p-2.5 font-semibold">{col.name}</td>
													<td className="p-2.5 text-neutral-600">{col.type || "ANY"}</td>
													<td className="p-2.5">{col.pk ? <Badge variant="outline" className="text-[10px]">PK</Badge> : "No"}</td>
													<td className="p-2.5">{col.notnull === 0 ? "Yes" : "No"}</td>
													<td className="p-2.5 text-neutral-400">{col.dflt_value !== null ? String(col.dflt_value) : "-"}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</div>
						)}
					</Card>
				</div>
			</div>

			{/* Cell Value Inspection Dialog */}
			<Dialog open={!!inspectCell} onOpenChange={(open) => !open && setInspectCell(null)}>
				<DialogContent className="max-w-lg rounded-2xl p-6">
					<DialogHeader>
						<DialogTitle className="text-sm font-semibold font-mono">
							Column: {inspectCell?.col}
						</DialogTitle>
						<DialogDescription className="text-xs text-neutral-500">
							Full formatted cell value inspection
						</DialogDescription>
					</DialogHeader>

					<div className="mt-2">
						<pre className="max-h-72 overflow-y-auto rounded-xl bg-neutral-950 p-3 font-mono text-xs text-neutral-100 whitespace-pre-wrap break-all">
							{inspectCell?.val === null
								? "NULL"
								: typeof inspectCell?.val === "object"
								? JSON.stringify(inspectCell.val, null, 2)
								: String(inspectCell?.val)}
						</pre>
					</div>

					<div className="mt-4 flex justify-end gap-2">
						<Button
							variant="outline"
							size="sm"
							className="rounded-xl text-xs gap-1.5"
							onClick={() => copyText(typeof inspectCell?.val === "object" ? JSON.stringify(inspectCell.val, null, 2) : String(inspectCell?.val))}
						>
							{copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
							{copied ? "Copied" : "Copy Value"}
						</Button>
						<Button
							size="sm"
							className="rounded-xl text-xs bg-neutral-900 text-white"
							onClick={() => setInspectCell(null)}
						>
							Done
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
