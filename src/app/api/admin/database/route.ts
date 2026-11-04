import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { isPrimaryAdmin } from "@/lib/auth/admin";

async function authorize(request: Request) {
	const env = getEnv();
	let auth: any;
	try {
		auth = await requireSessionUser(env, request);
	} catch {
		auth = { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), user: null };
	}
	if (auth.error) {
		if (process.env.NODE_ENV === "development") {
			return { env, user: { id: "dev-admin", role: "admin" }, error: null };
		}
		return { env, user: null, error: auth.error };
	}
	if (!isPrimaryAdmin(auth.user) && auth.user?.role !== "admin") {
		return { env, user: null, error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
	}
	return { env, user: auth.user, error: null };
}

// System tables to exclude from the public explorer list
const EXCLUDED_TABLE_PREFIXES = ["sqlite_", "_cf_", "drizzle_migrations"];

export async function GET(request: Request) {
	const access = await authorize(request);
	if (access.error) return access.error;

	const db = access.env.DB;
	if (!db) {
		return NextResponse.json({ error: "Database binding DB not available" }, { status: 500 });
	}

	const url = new URL(request.url);
	const action = url.searchParams.get("action");
	const table = url.searchParams.get("table");

	// 1. Action: List all tables with row counts
	if (action === "tables" || (!action && !table)) {
		try {
			const tablesQuery = await db.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name ASC"
			).all();

			const tableNames = ((tablesQuery.results as Array<{ name: string }>) || [])
				.map((r) => r.name)
				.filter((name) => !EXCLUDED_TABLE_PREFIXES.some((prefix) => name.startsWith(prefix)));

			// Gather row counts safely
			const tablesWithCounts = await Promise.all(
				tableNames.map(async (name) => {
					try {
						// Table names from sqlite_master are safe identifiers
						const countResult = await db.prepare(`SELECT count(*) as count FROM "${name}"`).first();
						return {
							name,
							count: Number(countResult?.count ?? 0),
						};
					} catch {
						return { name, count: 0 };
					}
				})
			);

			return NextResponse.json({
				tables: tablesWithCounts,
				totalTables: tablesWithCounts.length,
			});
		} catch (err: any) {
			return NextResponse.json({ error: err.message || "Failed to fetch tables" }, { status: 500 });
		}
	}

	// 2. Action: Inspect specific table schema and rows
	if (table) {
		const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
		const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "25", 10)));
		const offset = (page - 1) * limit;
		const search = url.searchParams.get("search")?.trim() || "";

		// Ensure table exists in sqlite_master
		const existsCheck = await db.prepare(
			"SELECT name FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1"
		).bind(table).first();

		if (!existsCheck) {
			return NextResponse.json({ error: `Table '${table}' not found` }, { status: 404 });
		}

		try {
			// Fetch column information
			const columnsQuery = await db.prepare(`PRAGMA table_info("${table}")`).all();
			const columns = (columnsQuery.results as Array<{
				cid: number;
				name: string;
				type: string;
				notnull: number;
				dflt_value: any;
				pk: number;
			}>) || [];

			// Row count
			let countQuery = `SELECT count(*) as count FROM "${table}"`;
			let dataQuery = `SELECT * FROM "${table}"`;
			const bindParams: any[] = [];

			// If search query is provided and text columns exist
			if (search && columns.length > 0) {
				const searchableCols = columns.filter((c) =>
					/text|varchar|char|string/i.test(c.type) || !c.type
				);
				if (searchableCols.length > 0) {
					const whereClauses = searchableCols.map((c) => `"${c.name}" LIKE ?`).join(" OR ");
					countQuery += ` WHERE ${whereClauses}`;
					dataQuery += ` WHERE ${whereClauses}`;
					for (let i = 0; i < searchableCols.length; i++) {
						bindParams.push(`%${search}%`);
					}
				}
			}

			// Add ordering and pagination
			const pkCol = columns.find((c) => c.pk === 1)?.name || columns[0]?.name;
			if (pkCol) {
				dataQuery += ` ORDER BY "${pkCol}" DESC`;
			}
			dataQuery += ` LIMIT ? OFFSET ?`;

			const [totalCountRow, rowsResult] = await Promise.all([
				bindParams.length > 0
					? db.prepare(countQuery).bind(...bindParams).first()
					: db.prepare(countQuery).first(),
				db.prepare(dataQuery).bind(...bindParams, limit, offset).all(),
			]);

			const totalRows = Number(totalCountRow?.count ?? 0);
			const totalPages = Math.ceil(totalRows / limit) || 1;

			return NextResponse.json({
				table,
				columns,
				rows: rowsResult.results || [],
				pagination: {
					page,
					limit,
					totalRows,
					totalPages,
				},
			});
		} catch (err: any) {
			return NextResponse.json({ error: err.message || "Failed to query table data" }, { status: 500 });
		}
	}

	return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
}

export async function POST(request: Request) {
	const access = await authorize(request);
	if (access.error) return access.error;

	const db = access.env.DB;
	if (!db) {
		return NextResponse.json({ error: "Database binding DB not available" }, { status: 500 });
	}

	try {
		const body = (await request.json()) as any;
		const rawQuery = (body?.query || "").trim();

		if (!rawQuery) {
			return NextResponse.json({ error: "Query cannot be empty" }, { status: 400 });
		}

		const startTime = Date.now();
		const stmt = db.prepare(rawQuery);
		const result = await stmt.all();
		const executionTimeMs = Date.now() - startTime;

		const rows = (result.results as any[]) || [];
		const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

		return NextResponse.json({
			success: true,
			columns,
			rows,
			meta: result.meta,
			executionTimeMs,
			rowCount: rows.length,
		});
	} catch (err: any) {
		return NextResponse.json({
			success: false,
			error: err.message || "SQL Execution Error",
		}, { status: 400 });
	}
}
