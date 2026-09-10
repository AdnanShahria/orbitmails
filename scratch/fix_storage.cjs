const fs = require('fs');
let c = fs.readFileSync('src/lib/mailhub/storage.ts', 'utf8');
c = c.replace(
  /export async function getMailHubState\(env: MailHubEnv\): Promise<MailHubState> \{[\s\S]*?return inMemoryState;\r?\n\}/,
  `export async function getMailHubState(env: MailHubEnv): Promise<MailHubState> {
	let state: MailHubState = inMemoryState || JSON.parse(JSON.stringify(DEFAULT_MAILHUB_STATE));

	if (env.KV) {
		try {
			const saved = await env.KV.get(KV_STATE_KEY, 'json');
			if (saved && typeof saved === 'object' && (saved as any).projects) {
				state = saved as MailHubState;
			}
		} catch {
			// fallback
		}
	}

	try {
		const liveUsage = await getAllQuotaUsage(env as any);
		if (liveUsage && Object.keys(liveUsage).length > 0) {
			for (const alloc of state.allocations) {
				const projectLive = liveUsage[alloc.projectId];
				if (projectLive && typeof projectLive[alloc.providerId] === 'number') {
					alloc.usedToday = projectLive[alloc.providerId];
				}
			}
		}
	} catch {
		// keep current count
	}

	inMemoryState = state;
	return state;
}`
);
fs.writeFileSync('src/lib/mailhub/storage.ts', c, 'utf8');
console.log('Successfully updated src/lib/mailhub/storage.ts');

