#!/usr/bin/env node

/**
 * OrbitMails - Routine Disaster Recovery Backup Validation Script
 * Usage: node scripts/validate-backup-dr.mjs <path-to-backup.json>
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";

const fileArg = process.argv[2];

if (!fileArg) {
	console.log("Usage: node scripts/validate-backup-dr.mjs <backup-file.json>");
	console.log("Simulating validation test with synthetic backup payload...");

	const syntheticBackup = JSON.stringify({
		users: [{ id: "usr_1", email: "admin@orbitmails.dev", role: "admin", name: "Admin" }],
		domains: [{ id: "dom_1", hostname: "orbitmails.dev", status: "active" }],
		mailboxes: [{ id: "mbx_1", local_part: "contact", domain_id: "dom_1" }],
	});

	validateAndRestore(syntheticBackup);
	process.exit(0);
}

try {
	const content = readFileSync(resolve(fileArg), "utf-8");
	validateAndRestore(content);
} catch (err) {
	console.error("Disaster recovery validation failed:", err.message);
	process.exit(1);
}

function validateAndRestore(backupJson) {
	console.log("1. Parsing backup JSON...");
	const data = JSON.parse(backupJson);

	const tables = Object.keys(data);
	console.log(`2. Found ${tables.length} tables: ${tables.join(", ")}`);

	const required = ["users", "domains", "mailboxes"];
	for (const req of required) {
		if (!tables.includes(req)) {
			throw new Error(`Critical missing table in backup: ${req}`);
		}
	}

	console.log("3. Simulating restoration into ephemeral in-memory SQLite...");
	const memDb = new Database(":memory:");

	let totalRestored = 0;
	for (const [table, rows] of Object.entries(data)) {
		if (!Array.isArray(rows) || rows.length === 0) continue;
		const cols = Object.keys(rows[0]);
		memDb.exec(`CREATE TABLE "${table}" (${cols.map((c) => `"${c}" TEXT`).join(", ")})`);

		const placeholders = cols.map(() => "?").join(", ");
		const stmt = memDb.prepare(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`);

		for (const r of rows) {
			stmt.run(cols.map((c) => (r[c] !== undefined && r[c] !== null ? String(r[c]) : null)));
			totalRestored += 1;
		}
	}

	memDb.close();
	console.log(`✔ SUCCESS: Disaster Recovery validation test passed! Restored ${totalRestored} rows without error.`);
}

