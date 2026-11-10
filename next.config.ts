import type { NextConfig } from "next";
import { getSecurityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
	compress: true,
	poweredByHeader: false,
	assetPrefix: process.env.CDN_URL?.trim() || undefined,
	distDir: process.env.ORBITFLARE_RUNTIME === "node" ? ".next-node" : undefined,
	turbopack: {
		root: import.meta.dirname,
		resolveAlias: process.env.ORBITFLARE_RUNTIME === "node" ? {
			"cloudflare:workers": "./server/runtime/cloudflare-workers.ts",
		} : {},
	},
  allowedDevOrigins: ['mail.dev'],
	typescript: {
    // !! WARN !!
    // Dangerously allow production builds to successfully complete
    // even if your project has type errors.
    ignoreBuildErrors: true,
	  },
	// Native and server-only packages used by the self-hosted runtime; never bundle them.
	serverExternalPackages: ["better-sqlite3", "nodemailer", "smtp-server", "ws"],
	async rewrites() {
		return [
			{
				source: "/v1/:path*",
				destination: "/api/v1/:path*",
			},
			{
				source: "/emails/:path*",
				destination: "/api/v1/emails/:path*",
			},
			{
				source: "/emails",
				destination: "/api/v1/emails",
			},
			{
				source: "/v3/smtp/email",
				destination: "/api/v1/send",
			},
			{
				source: "/health/live",
				destination: "/api/health/live",
			},
			{
				source: "/health/ready",
				destination: "/api/health/ready",
			},
		];
	},
	async headers() {
		return [
			{
				source: "/(.*)",
				headers: getSecurityHeaders(),
			},
		];
	},
};

export default nextConfig;
