import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: "./src/db/schema/index.ts",
	out: "./drizzle/migrations",
	dialect: "sqlite",
	driver: "d1-http",
	dbCredentials: {
		accountId: process.env.CLOUDFLARE_ACCOUNT_ID || "14666fcfc8a4015d8ff3565860e33002",
		databaseId: process.env.CLOUDFLARE_DATABASE_ID || "b4c4e894-377a-4b7d-87e1-22bcdab33bb2",
		token: process.env.CLOUDFLARE_D1_TOKEN || "",
	},
});

