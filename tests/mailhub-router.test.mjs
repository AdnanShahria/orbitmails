import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "mailhub-router-test-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

async function bundle(entry, outfile) {
	await build({
		entryPoints: [join(root, entry)],
		outfile: join(outDir, outfile),
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node22",
		logLevel: "silent",
		alias: { "@": join(root, "src") },
	});
	return import(pathToFileURL(join(outDir, outfile)).href);
}

const mailhub = await bundle("src/lib/mailhub/index.ts", "mailhub.mjs");
const {
	calculateProviderScore,
	normalizePriority,
	determineCostTier,
	calculateFailurePenalty,
	buildCandidateProviders,
	selectOptimalProvider,
	getQuotaKey,
	getCircuitBreakerKey,
	COST_TIER_WEIGHTS,
} = mailhub;

// Sample fixtures representing Aurelia, LifeSolver, and Luvio
const MOCK_CREDENTIALS = [
	{
		id: "cred_brevo_main",
		provider: "brevo",
		label: "Brevo Shared Account (300/day total)",
		dailyLimit: 300,
		costPerK: 0,
		enabled: true,
	},
	{
		id: "cred_resend_main",
		provider: "resend",
		label: "Resend Shared Account (100/day total)",
		dailyLimit: 100,
		costPerK: 0,
		enabled: true,
	},
	{
		id: "cred_ses_backup",
		provider: "ses",
		label: "Amazon SES Metered Backup",
		dailyLimit: 50000,
		costPerK: 0.1,
		enabled: true,
	},
];

const MOCK_AURELIA_ALLOCATIONS = [
	{
		projectId: "proj_aurelia",
		providerCredId: "cred_brevo_main",
		dailySlice: 120,
		priority: 1, // Primary: Brevo 120/day
	},
	{
		projectId: "proj_aurelia",
		providerCredId: "cred_resend_main",
		dailySlice: 50,
		priority: 2, // Secondary: Resend 50/day
	},
	{
		projectId: "proj_aurelia",
		providerCredId: "cred_ses_backup",
		dailySlice: 0, // 0 = unlimited paid fallback
		priority: 3, // Tertiary: SES paid
	},
];

const MOCK_LIFESOLVER_ALLOCATIONS = [
	{
		projectId: "proj_lifesolver",
		providerCredId: "cred_brevo_main",
		dailySlice: 80,
		priority: 1,
	},
	{
		projectId: "proj_lifesolver",
		providerCredId: "cred_ses_backup",
		dailySlice: 0,
		priority: 2,
	},
];

test("Scoring Heuristic - Exact Mathematical Formula Verification", () => {
	// Formula: Score = (CostTierWeight * 1000) + (PriorityScore * 100) + (RemainingQuotaRatio * 10) - (FailurePenalty)
	const scoreResult = calculateProviderScore({
		providerCredId: "cred_brevo_main",
		provider: "brevo",
		dailySlice: 120,
		usedToday: 20, // 100 left -> ratio = 100/120 = 0.8333
		priority: 1, // PriorityScore = 10 -> 1000 pts
		costPerK: 0, // Free Tier -> CostTierWeight = 10 -> 10000 pts
		healthScore: 1.0,
		consecutiveFailures: 0,
		circuitState: "closed",
		enabled: true,
	});

	assert.equal(scoreResult.costTier, "free");
	assert.equal(scoreResult.costTierWeight, 10);
	assert.equal(scoreResult.costTierScore, 10000);
	assert.equal(scoreResult.priorityScore, 10);
	assert.equal(scoreResult.priorityPoints, 1000);
	assert.equal(scoreResult.remainingQuota, 100);
	assert.equal(scoreResult.remainingQuotaRatio, 0.8333);
	assert.equal(scoreResult.quotaPoints, 8.33);
	assert.equal(scoreResult.failurePenalty, 0);
	assert.equal(scoreResult.score, 11008.33);
	assert.equal(scoreResult.eligible, true);
	assert.equal(scoreResult.disqualificationReason, undefined);
});

test("Priority Normalization - Higher preference rank (1) beats lower rank (2, 3)", () => {
	const p1 = normalizePriority(1);
	const p2 = normalizePriority(2);
	const p3 = normalizePriority(3);

	assert.equal(p1.priorityScore, 10);
	assert.equal(p1.priorityPoints, 1000);

	assert.equal(p2.priorityScore, 9);
	assert.equal(p2.priorityPoints, 900);

	assert.equal(p3.priorityScore, 8);
	assert.equal(p3.priorityPoints, 800);

	assert.ok(p1.priorityPoints > p2.priorityPoints);
	assert.ok(p2.priorityPoints > p3.priorityPoints);
});

test("Cost Tier Optimization - Free tier allocations always outscore paid SES tier", () => {
	const brevoFree = calculateProviderScore({
		providerCredId: "cred_brevo_main",
		provider: "brevo",
		dailySlice: 120,
		usedToday: 110, // Only 10 remaining (near exhaustion)
		priority: 2, // Even with lower priority
		costPerK: 0,
	});

	const sesPaid = calculateProviderScore({
		providerCredId: "cred_ses_backup",
		provider: "ses",
		dailySlice: 0, // Unlimited
		usedToday: 0,
		priority: 1, // Even with priority 1
		costPerK: 0.1, // Paid
	});

	// Free Brevo has CostTierWeight=10 (10,000 pts)
	// Paid SES has CostTierWeight=1 (1,000 pts)
	assert.ok(brevoFree.score > 10000, "Free tier must score > 10,000 points");
	assert.ok(sesPaid.score < 3000, "Paid tier must score < 3,000 points");
	assert.ok(brevoFree.score > sesPaid.score, "Free tier must strictly outrank paid tier when quota remains");
});

test("Quota Exhaustion Cascade - Aurelia seamlessly transitions Brevo -> Resend -> SES", async () => {
	const env = {};
	const dateBucket = "2026-11-02";

	// --- Step 1: Normal state (Brevo has plenty of slice left) ---
	let candidates = await buildCandidateProviders("proj_aurelia", dateBucket, env, {
		allocationsOverride: MOCK_AURELIA_ALLOCATIONS,
		credentialsOverride: MOCK_CREDENTIALS,
		usageOverride: {
			"proj_aurelia:cred_brevo_main:2026-11-02": 10, // 110 remaining
			"proj_aurelia:cred_resend_main:2026-11-02": 0, // 50 remaining
			"proj_aurelia:cred_ses_backup:2026-11-02": 0, // Unlimited
		},
	});

	assert.equal(candidates.length, 3);
	assert.equal(candidates[0].provider, "brevo", "Step 1: Brevo should be top candidate");
	assert.equal(candidates[0].remainingQuota, 110);
	assert.equal(candidates[1].provider, "resend", "Step 1: Resend should be backup");
	assert.equal(candidates[2].provider, "ses", "Step 1: SES should be tertiary");
	assert.equal(selectOptimalProvider(candidates)?.provider, "brevo");

	// --- Step 2: Aurelia exhausts Brevo slice (120 of 120 used) ---
	candidates = await buildCandidateProviders("proj_aurelia", dateBucket, env, {
		allocationsOverride: MOCK_AURELIA_ALLOCATIONS,
		credentialsOverride: MOCK_CREDENTIALS,
		usageOverride: {
			"proj_aurelia:cred_brevo_main:2026-11-02": 120, // EXHAUSTED!
			"proj_aurelia:cred_resend_main:2026-11-02": 5, // 45 remaining
			"proj_aurelia:cred_ses_backup:2026-11-02": 0,
		},
	});

	// Brevo is filtered out from eligible candidates by default
	assert.equal(candidates.length, 2, "Brevo should be excluded from active candidates");
	assert.equal(candidates[0].provider, "resend", "Step 2: Resend should automatically take over as top provider");
	assert.equal(candidates[0].remainingQuota, 45);
	assert.equal(candidates[1].provider, "ses", "Step 2: SES remains tertiary");
	assert.equal(selectOptimalProvider(candidates)?.provider, "resend");

	// --- Step 3: Both Brevo and Resend slices exhausted ---
	candidates = await buildCandidateProviders("proj_aurelia", dateBucket, env, {
		allocationsOverride: MOCK_AURELIA_ALLOCATIONS,
		credentialsOverride: MOCK_CREDENTIALS,
		usageOverride: {
			"proj_aurelia:cred_brevo_main:2026-11-02": 120, // EXHAUSTED
			"proj_aurelia:cred_resend_main:2026-11-02": 50, // EXHAUSTED
			"proj_aurelia:cred_ses_backup:2026-11-02": 15, // Unlimited
		},
	});

	assert.equal(candidates.length, 1, "Only SES should remain eligible");
	assert.equal(candidates[0].provider, "ses", "Step 3: SES automatically handles overflow to prevent dropped emails");
	assert.equal(selectOptimalProvider(candidates)?.provider, "ses");

	// Verify with includeExhausted=true that exhausted providers are tagged with reason
	const auditList = await buildCandidateProviders("proj_aurelia", dateBucket, env, {
		allocationsOverride: MOCK_AURELIA_ALLOCATIONS,
		credentialsOverride: MOCK_CREDENTIALS,
		includeExhausted: true,
		usageOverride: {
			"proj_aurelia:cred_brevo_main:2026-11-02": 120,
			"proj_aurelia:cred_resend_main:2026-11-02": 50,
			"proj_aurelia:cred_ses_backup:2026-11-02": 0,
		},
	});
	const brevoAudit = auditList.find((c) => c.provider === "brevo");
	assert.equal(brevoAudit.eligible, false);
	assert.equal(brevoAudit.disqualificationReason, "QUOTA_EXHAUSTED");
});

test("Multi-Project Quota Slicing & Isolation - Aurelia exhaustion does not affect LifeSolver", async () => {
	const env = {};
	const dateBucket = "2026-11-02";

	// Aurelia has exhausted its 120 slice on Brevo
	const aureliaCandidates = await buildCandidateProviders("proj_aurelia", dateBucket, env, {
		allocationsOverride: MOCK_AURELIA_ALLOCATIONS,
		credentialsOverride: MOCK_CREDENTIALS,
		usageOverride: {
			"proj_aurelia:cred_brevo_main:2026-11-02": 120, // Aurelia exhausted
			"proj_lifesolver:cred_brevo_main:2026-11-02": 30, // LifeSolver only used 30 of 80!
		},
	});

	// LifeSolver still has 50 emails left in its slice
	const lifesolverCandidates = await buildCandidateProviders("proj_lifesolver", dateBucket, env, {
		allocationsOverride: MOCK_LIFESOLVER_ALLOCATIONS,
		credentialsOverride: MOCK_CREDENTIALS,
		usageOverride: {
			"proj_aurelia:cred_brevo_main:2026-11-02": 120,
			"proj_lifesolver:cred_brevo_main:2026-11-02": 30,
		},
	});

	// Aurelia must NOT be able to use Brevo
	assert.notEqual(selectOptimalProvider(aureliaCandidates)?.provider, "brevo");
	assert.equal(selectOptimalProvider(aureliaCandidates)?.provider, "resend");

	// LifeSolver MUST continue using Brevo normally
	assert.equal(selectOptimalProvider(lifesolverCandidates)?.provider, "brevo");
	assert.equal(lifesolverCandidates[0].remainingQuota, 50);
});

test("Provider Outage & Circuit Breaker - Immediate automatic rerouting on outage", async () => {
	const env = {};
	const dateBucket = "2026-11-02";

	// Scenario A: Degraded Health (e.g. 50% errors, 2 consecutive failures)
	let candidates = await buildCandidateProviders("proj_aurelia", dateBucket, env, {
		allocationsOverride: MOCK_AURELIA_ALLOCATIONS,
		credentialsOverride: MOCK_CREDENTIALS,
		usageOverride: {
			"proj_aurelia:cred_brevo_main:2026-11-02": 10,
			"proj_aurelia:cred_resend_main:2026-11-02": 5,
		},
		healthOverride: {
			cred_brevo_main: {
				healthScore: 0.5, // 50% health -> penalty = 250
				consecutiveFailures: 2, // 2 failures -> penalty = 200 -> total penalty = 450
				circuitState: "closed",
			},
		},
	});

	// Resend (score ~10,909) will leapfrog degraded Brevo (score ~11,008 - 450 = 10,558)
	assert.equal(candidates[0].provider, "resend", "Resend should leapfrog degraded Brevo due to FailurePenalty");

	// Scenario B: Circuit Breaker Trips (Open Circuit due to 3 consecutive failures)
	candidates = await buildCandidateProviders("proj_aurelia", dateBucket, env, {
		allocationsOverride: MOCK_AURELIA_ALLOCATIONS,
		credentialsOverride: MOCK_CREDENTIALS,
		healthOverride: {
			cred_brevo_main: {
				healthScore: 0.0,
				consecutiveFailures: 3,
				circuitState: "open", // Tripped!
			},
		},
	});

	assert.equal(candidates.find((c) => c.provider === "brevo"), undefined, "Tripped provider must be excluded from candidates");
	assert.equal(candidates[0].provider, "resend", "Traffic immediately redirects to healthy Resend");

	// Scenario C: Half-open recovery probation
	candidates = await buildCandidateProviders("proj_aurelia", dateBucket, env, {
		allocationsOverride: MOCK_AURELIA_ALLOCATIONS,
		credentialsOverride: MOCK_CREDENTIALS,
		includeCircuitOpen: true,
		healthOverride: {
			cred_brevo_main: {
				healthScore: 0.9,
				consecutiveFailures: 0,
				circuitState: "half-open", // Probationary trial
			},
		},
	});

	const brevoHalfOpen = candidates.find((c) => c.provider === "brevo");
	assert.ok(brevoHalfOpen.failurePenalty >= 300, "Half-open circuit must carry 300 pt probationary penalty");
});

test("Priority Dynamic Rebalancing - Instant reallocation without manual deployment", async () => {
	const env = {};
	const dateBucket = "2026-11-02";

	// Rebalance allocations: Resend becomes Priority 1, Brevo becomes Priority 2
	const rebalancedAllocations = [
		{
			projectId: "proj_aurelia",
			providerCredId: "cred_resend_main",
			dailySlice: 50,
			priority: 1, // Promoted to Priority 1
		},
		{
			projectId: "proj_aurelia",
			providerCredId: "cred_brevo_main",
			dailySlice: 120,
			priority: 2, // Demoted to Priority 2
		},
	];

	const candidates = await buildCandidateProviders("proj_aurelia", dateBucket, env, {
		allocationsOverride: rebalancedAllocations,
		credentialsOverride: MOCK_CREDENTIALS,
		usageOverride: {
			"proj_aurelia:cred_brevo_main:2026-11-02": 0,
			"proj_aurelia:cred_resend_main:2026-11-02": 0,
		},
	});

	assert.equal(candidates[0].provider, "resend", "Resend must rank #1 following priority rebalance");
	assert.equal(candidates[1].provider, "brevo", "Brevo must rank #2");
	assert.ok(candidates[0].score > candidates[1].score);
});

test("Real-Time KV and Durable Object Key Formatting", () => {
	const qKey = getQuotaKey("proj_aurelia", "cred_brevo_main", "2026-11-02");
	assert.equal(qKey, "quota:proj_aurelia:cred_brevo_main:2026-11-02");

	const cbKey = getCircuitBreakerKey("cred_brevo_main");
	assert.equal(cbKey, "cb:cred_brevo_main");
});
