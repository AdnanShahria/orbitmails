/**
 * OrbitMails - Database Backup Validation & Disaster Recovery Testing
 * @module lib/backups/validator
 */

import Database from "better-sqlite3";
import { logger } from "@/lib/logging/logger";

export interface BackupValidationResult {
	valid: boolean;
	totalTables: number;
	totalRows: number;
	tablesSummary: Record<string, number>;
	errors: string[];
	simulatedRestoreSuccess: boolean;
}

const ESSENTIAL_TABLES = ["users", "domains", "mailboxes"];

/**
 * Validates a backup JSON payload structure and verifies disaster recovery restoration.
 */
export function validateBackupContent(backupJson: string): BackupValidationResult {
	const errors: string[] = [];
	const tablesSummary: Record<string, number> = {};
	let totalTables = 0;
	let totalRows = 0;
	let simulatedRestoreSuccess = false;

	let data: unknown;
	try {
		data = JSON.parse(backupJson);
	} catch (err) {
		return {
			valid: false,
			totalTables: 0,
			totalRows: 0,
			tablesSummary: {},
			errors: [`JSON parse failure: ${(err as Error).message}`],
			simulatedRestoreSuccess: false,
		};
	}

	if (typeof data !== "object" || data === null) {
		return {
			valid: false,
			totalTables: 0,
			totalRows: 0,
			tablesSummary: {},
			errors: ["Backup data root is not a valid object"],
			simulatedRestoreSuccess: false,
		};
	}

	// Process tables
	const tablesData = data as Record<string, unknown[]>;
	const tableNames = Object.keys(tablesData);
	totalTables = tableNames.length;

	for (const [table, rows] of Object.entries(tablesData)) {
		if (Array.isArray(rows)) {
			tablesSummary[table] = rows.length;
			totalRows += rows.length;
		}
	}

	// Verify essential tables exist
	for (const essential of ESSENTIAL_TABLES) {
		if (!tableNames.includes(essential)) {
			errors.push(`Critical table '${essential}' is missing from the backup.`);
		}
	}

	// Simulate restoration into an in-memory SQLite database
	try {
		const memDb = new Database(":memory:");
		// Test creating a temporary table and inserting rows
		for (const [table, rows] of Object.entries(tablesData)) {
			if (!Array.isArray(rows) || rows.length === 0) continue;

			const sampleRow = rows[0];
			if (typeof sampleRow !== "object" || sampleRow === null) continue;

			const cols = Object.keys(sampleRow);
			const colDefs = cols.map((col) => `"${col}" TEXT`).join(", ");
			memDb.exec(`CREATE TABLE IF NOT EXISTS "${table}" (${colDefs})`);

			const placeholders = cols.map(() => "?").join(", ");
			const insertStmt = memDb.prepare(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`);

			// Insert sample batch
			const testBatch = rows.slice(0, 10);
			const insertMany = memDb.transaction((batch: any[]) => {
				for (const r of batch) {
					insertStmt.run(cols.map((c) => (r[c] !== undefined && r[c] !== null ? String(r[c]) : null)));
				}
			});
			insertMany(testBatch);
		}

		memDb.close();
		simulatedRestoreSuccess = true;
	} catch (restoreErr) {
		errors.push(`Simulated DB restore failed: ${(restoreErr as Error).message}`);
		simulatedRestoreSuccess = false;
	}

	const valid = errors.length === 0 && simulatedRestoreSuccess;

	logger.info("Backup DR validation completed", {
		valid,
		totalTables,
		totalRows,
		simulatedRestoreSuccess,
	});

	return {
		valid,
		totalTables,
		totalRows,
		tablesSummary,
		errors,
		simulatedRestoreSuccess,
	};
}

/**
 * Validates a stored backup object in R2/storage for disaster recovery.
 */
export async function verifyBackupDisasterRecovery(
	env: CloudflareEnv,
	r2Key: string,
): Promise<BackupValidationResult> {
	const object = await env.BUCKET.get(r2Key);
	if (!object) {
		return {
			valid: false,
			totalTables: 0,
			totalRows: 0,
			tablesSummary: {},
			errors: [`Backup object not found at key: ${r2Key}`],
			simulatedRestoreSuccess: false,
		};
	}

	const content = await object.text();
	return validateBackupContent(content);
}

