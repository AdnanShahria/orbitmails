import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Auto-discover Cloudflare credentials from Wrangler
function getWranglerToken() {
  const possiblePaths = [
    path.join(os.homedir(), 'AppData', 'Roaming', 'xdg.config', '.wrangler', 'config', 'default.toml'),
    path.join(os.homedir(), '.config', '.wrangler', 'config', 'default.toml'),
    path.join(os.homedir(), '.wrangler', 'config', 'default.toml')
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8');
      const match = content.match(/oauth_token\s*=\s*"([^"]+)"/);
      if (match) return match[1];
    }
  }
  return null;
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '14666fcfc8a4015d8ff3565860e33002';
const databaseId = process.env.CLOUDFLARE_DATABASE_ID || 'b4c4e894-377a-4b7d-87e1-22bcdab33bb2';
const token = process.env.CLOUDFLARE_D1_TOKEN || getWranglerToken();

if (!token) {
  console.error('❌ Could not find Cloudflare authentication token.');
  console.error('Please run "npx wrangler login" or set CLOUDFLARE_D1_TOKEN in your environment.');
  process.exit(1);
}

console.log('🚀 Starting Drizzle Studio connected to Cloudflare D1 (remote)...');
console.log(`📦 Database: orbitflare (${databaseId})`);
console.log(`🏢 Account:  ${accountId}`);

process.env.CLOUDFLARE_ACCOUNT_ID = accountId;
process.env.CLOUDFLARE_DATABASE_ID = databaseId;
process.env.CLOUDFLARE_D1_TOKEN = token;

const isWindows = process.platform === 'win32';
const npxCmd = isWindows ? 'npx.cmd' : 'npx';

const child = spawn(npxCmd, ['drizzle-kit', 'studio', '--config=drizzle.config.d1.ts'], {
  stdio: 'inherit',
  shell: isWindows,
  env: process.env
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
