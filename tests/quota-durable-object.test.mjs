import assert from "node:assert/strict";
import test from "node:test";
import {
	checkAndIncrementQuota,
	peekQuota,
	refundQuota,
	getProjectQuotaUsage,
	getAllQuotaUsage,
	resetQuota,
	syncQuotaFromD1,
	LocalQuotaFallback,
} from "../src/lib/router/quota-client.ts";
import {
	getTodayUtcDateBucket,
	getNextUtcMidnightMs,
	getUtcDateBucketOffsetDays,
} from "../src/lib/router/quota-types.ts";

// Helper mock env without DO (exercises resilient local fallback)
const mockEnv = {};

test.beforeEach(() => {
	LocalQuotaFallback.getInstance().clear();
});

test("quota: date bucket and midnight timestamp calculations", () => {
	const now = new Date("2026-11-02T15:30:00.000Z");
	const bucket = getTodayUtcDateBucket(now);
	assert.equal(bucket, "2026-11-02");

	const nextMidnight = getNextUtcMidnightMs(now);
	const expectedMidnight = Date.UTC(2026, 10, 3, 0, 0, 0, 0); // Month is 0-indexed: 10 = Nov
	assert.equal(nextMidnight, expectedMidnight);

	const yesterday = getUtcDateBucketOffsetDays(-1, now);
	assert.equal(yesterday, "2026-11-01");

	const tomorrow = getUtcDateBucketOffsetDays(1, now);
	assert.equal(tomorrow, "2026-11-03");
});

test("quota: atomic check and increment within slice limit", async () => {
	const dateBucket = "2026-11-02";
	const projectId = "proj_aurelia";
	const providerId = "brevo_free";
	const sliceLimit = 3;

	// Request 1: 0 used -> allowed, 1 used, 2 remaining
	const res1 = await checkAndIncrementQuota(mockEnv, {
		projectId,
		providerId,
		sliceLimit,
		dateBucket,
	});
	assert.equal(res1.allowed, true);
	assert.equal(res1.currentUsed, 1);
	assert.equal(res1.remaining, 2);
	assert.equal(res1.sliceLimit, 3);
	assert.equal(res1.dateBucket, dateBucket);

	// Request 2: 1 used -> allowed, 2 used, 1 remaining
	const res2 = await checkAndIncrementQuota(mockEnv, {
		projectId,
		providerId,
		sliceLimit,
		dateBucket,
	});
	assert.equal(res2.allowed, true);
	assert.equal(res2.currentUsed, 2);
	assert.equal(res2.remaining, 1);

	// Request 3: 2 used -> allowed, 3 used, 0 remaining
	const res3 = await checkAndIncrementQuota(mockEnv, {
		projectId,
		providerId,
		sliceLimit,
		dateBucket,
	});
	assert.equal(res3.allowed, true);
	assert.equal(res3.currentUsed, 3);
	assert.equal(res3.remaining, 0);

	// Request 4: 3 used -> DENIED! (allowed = false, remaining = 0)
	const res4 = await checkAndIncrementQuota(mockEnv, {
		projectId,
		providerId,
		sliceLimit,
		dateBucket,
	});
	assert.equal(res4.allowed, false);
	assert.equal(res4.currentUsed, 3);
	assert.equal(res4.remaining, 0);
});

test("quota: high concurrency prevents race conditions and overspending", async () => {
	const dateBucket = "2026-11-02";
	const projectId = "proj_lifesolver";
	const providerId = "brevo_shared";
	const sliceLimit = 5;

	// Launch 25 concurrent check-and-increment requests
	const concurrentPromises = Array.from({ length: 25 }, () =>
		checkAndIncrementQuota(mockEnv, {
			projectId,
			providerId,
			sliceLimit,
			dateBucket,
		})
	);

	const results = await Promise.all(concurrentPromises);
	const allowedCount = results.filter((r) => r.allowed).length;
	const deniedCount = results.filter((r) => !r.allowed).length;

	assert.equal(allowedCount, 5, "Exactly 5 requests should be allowed");
	assert.equal(deniedCount, 20, "Exactly 20 requests should be denied");

	// Peek to ensure final count is strictly equal to sliceLimit
	const peek = await peekQuota(mockEnv, {
		projectId,
		providerId,
		sliceLimit,
		dateBucket,
	});
	assert.equal(peek.currentUsed, 5);
	assert.equal(peek.remaining, 0);
	assert.equal(peek.allowed, false);
});

test("quota: peek does not increment counter", async () => {
	const dateBucket = "2026-11-02";
	const projectId = "proj_luvio";
	const providerId = "resend_prod";
	const sliceLimit = 50;

	const peekBefore = await peekQuota(mockEnv, {
		projectId,
		providerId,
		sliceLimit,
		dateBucket,
	});
	assert.equal(peekBefore.allowed, true);
	assert.equal(peekBefore.currentUsed, 0);
	assert.equal(peekBefore.remaining, 50);

	// Perform 1 increment
	await checkAndIncrementQuota(mockEnv, {
		projectId,
		providerId,
		sliceLimit,
		dateBucket,
	});

	// Peek again
	const peekAfter = await peekQuota(mockEnv, {
		projectId,
		providerId,
		sliceLimit,
		dateBucket,
	});
	assert.equal(peekAfter.allowed, true);
	assert.equal(peekAfter.currentUsed, 1);
	assert.equal(peekAfter.remaining, 49);

	// Multiple consecutive peeks do not change usage
	await peekQuota(mockEnv, { projectId, providerId, sliceLimit, dateBucket });
	await peekQuota(mockEnv, { projectId, providerId, sliceLimit, dateBucket });

	const peekFinal = await peekQuota(mockEnv, {
		projectId,
		providerId,
		sliceLimit,
		dateBucket,
	});
	assert.equal(peekFinal.currentUsed, 1);
});

test("quota: refund restores quota slot on provider dispatch failure", async () => {
	const dateBucket = "2026-11-02";
	const projectId = "proj_ovijatric";
	const providerId = "ses_main";
	const sliceLimit = 1;

	// Use the only slot
	const res1 = await checkAndIncrementQuota(mockEnv, {
		projectId,
		providerId,
		sliceLimit,
		dateBucket,
	});
	assert.equal(res1.allowed, true);

	// Quota is now full
	const resDenied = await checkAndIncrementQuota(mockEnv, {
		projectId,
		providerId,
		sliceLimit,
		dateBucket,
	});
	assert.equal(resDenied.allowed, false);

	// Provider failed -> refund slot
	const refundRes = await refundQuota(mockEnv, {
		projectId,
		providerId,
		dateBucket,
		count: 1,
	});
	assert.equal(refundRes.refunded, true);
	assert.equal(refundRes.currentUsed, 0);

	// Can now send again!
	const resRetry = await checkAndIncrementQuota(mockEnv, {
		projectId,
		providerId,
		sliceLimit,
		dateBucket,
	});
	assert.equal(resRetry.allowed, true);
	assert.equal(resRetry.currentUsed, 1);
});

test("quota: project and global usage queries", async () => {
	const dateBucket = "2026-11-02";

	// Aurelia sends 2 on Brevo, 1 on Resend
	await checkAndIncrementQuota(mockEnv, {
		projectId: "proj_aurelia",
		providerId: "brevo",
		sliceLimit: 100,
		dateBucket,
	});
	await checkAndIncrementQuota(mockEnv, {
		projectId: "proj_aurelia",
		providerId: "brevo",
		sliceLimit: 100,
		dateBucket,
	});
	await checkAndIncrementQuota(mockEnv, {
		projectId: "proj_aurelia",
		providerId: "resend",
		sliceLimit: 50,
		dateBucket,
	});

	// LifeSolver sends 3 on Brevo
	await checkAndIncrementQuota(mockEnv, {
		projectId: "proj_lifesolver",
		providerId: "brevo",
		sliceLimit: 100,
		dateBucket,
	});
	await checkAndIncrementQuota(mockEnv, {
		projectId: "proj_lifesolver",
		providerId: "brevo",
		sliceLimit: 100,
		dateBucket,
	});
	await checkAndIncrementQuota(mockEnv, {
		projectId: "proj_lifesolver",
		providerId: "brevo",
		sliceLimit: 100,
		dateBucket,
	});

	// Query project usage for Aurelia
	const aureliaUsage = await getProjectQuotaUsage(mockEnv, "proj_aurelia", dateBucket);
	assert.equal(aureliaUsage.brevo.currentUsed, 2);
	assert.equal(aureliaUsage.resend.currentUsed, 1);

	// Query global usage
	const allUsage = await getAllQuotaUsage(mockEnv, dateBucket);
	assert.equal(allUsage.proj_aurelia.brevo, 2);
	assert.equal(allUsage.proj_aurelia.resend, 1);
	assert.equal(allUsage.proj_lifesolver.brevo, 3);
});

test("quota: reset quota restores slice to 0", async () => {
	const dateBucket = "2026-11-02";
	const projectId = "proj_aurelia";
	const providerId = "brevo";

	await checkAndIncrementQuota(mockEnv, {
		projectId,
		providerId,
		sliceLimit: 10,
		dateBucket,
	});
	await checkAndIncrementQuota(mockEnv, {
		projectId,
		providerId,
		sliceLimit: 10,
		dateBucket,
	});

	await resetQuota(mockEnv, projectId, providerId, dateBucket);

	const peek = await peekQuota(mockEnv, {
		projectId,
		providerId,
		sliceLimit: 10,
		dateBucket,
	});
	assert.equal(peek.currentUsed, 0);
	assert.equal(peek.remaining, 10);
	assert.equal(peek.allowed, true);
});

test("quota: date bucket isolation (midnight rollover)", async () => {
	const projectId = "proj_aurelia";
	const providerId = "brevo";
	const sliceLimit = 2;

	const today = "2026-11-02";
	const tomorrow = "2026-11-03";

	// Exhaust today's quota
	await checkAndIncrementQuota(mockEnv, { projectId, providerId, sliceLimit, dateBucket: today });
	await checkAndIncrementQuota(mockEnv, { projectId, providerId, sliceLimit, dateBucket: today });
	const todayDenied = await checkAndIncrementQuota(mockEnv, { projectId, providerId, sliceLimit, dateBucket: today });
	assert.equal(todayDenied.allowed, false);

	// Tomorrow's quota starts fresh and allowed
	const tomorrowRes = await checkAndIncrementQuota(mockEnv, { projectId, providerId, sliceLimit, dateBucket: tomorrow });
	assert.equal(tomorrowRes.allowed, true);
	assert.equal(tomorrowRes.currentUsed, 1);
	assert.equal(tomorrowRes.remaining, 1);
});

test("quota: DO stub RPC path invocation", async () => {
	let rpcCalledWith = null;

	const mockStub = {
		async checkAndIncrement(projectId, providerId, sliceLimit, dateBucket) {
			rpcCalledWith = { projectId, providerId, sliceLimit, dateBucket };
			return {
				allowed: true,
				remaining: 4,
				currentUsed: 1,
				sliceLimit,
				dateBucket: dateBucket || "2026-11-02",
				resetAt: 1762128000000,
			};
		},
		async peekQuota() {},
		async refundQuota() {},
		async getProjectUsage() {},
		async getAllUsage() {},
		async resetQuota() {},
		async syncFromD1() {},
	};

	const envWithDo = {
		QUOTA_COORDINATOR: {
			getByName: (name) => {
				assert.equal(name, "global");
				return mockStub;
			},
		},
	};

	const result = await checkAndIncrementQuota(envWithDo, {
		projectId: "proj_aurelia",
		providerId: "brevo",
		sliceLimit: 5,
		dateBucket: "2026-11-02",
	});

	assert.equal(result.allowed, true);
	assert.equal(result.currentUsed, 1);
	assert.equal(result.remaining, 4);
	assert.deepEqual(rpcCalledWith, {
		projectId: "proj_aurelia",
		providerId: "brevo",
		sliceLimit: 5,
		dateBucket: "2026-11-02",
	});
});

test("quota: DO stub HTTP fetch fallback path", async () => {
	let fetchCalled = false;

	const mockFetchStub = {
		// No direct RPC methods, forcing HTTP fetch fallback
		async fetch(url, init) {
			fetchCalled = true;
			assert.equal(url, "https://mailhub-quota/check-and-increment");
			assert.equal(init.method, "POST");
			const body = JSON.parse(init.body);
			assert.equal(body.projectId, "proj_lifesolver");
			return new Response(
				JSON.stringify({
					allowed: true,
					remaining: 9,
					currentUsed: 1,
					sliceLimit: 10,
					dateBucket: "2026-11-02",
					resetAt: 1762128000000,
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } }
			);
		},
	};

	const envWithFetchOnlyDo = {
		QUOTA_COORDINATOR: {
			getByName: () => mockFetchStub,
		},
	};

	const result = await checkAndIncrementQuota(envWithFetchOnlyDo, {
		projectId: "proj_lifesolver",
		providerId: "resend",
		sliceLimit: 10,
		dateBucket: "2026-11-02",
	});

	assert.equal(fetchCalled, true);
	assert.equal(result.allowed, true);
	assert.equal(result.currentUsed, 1);
	assert.equal(result.remaining, 9);
});

test("quota: D1 cold-start sync call routing", async () => {
	let d1SyncCalled = false;

	const mockStub = {
		async syncFromD1(dateBucket) {
			d1SyncCalled = true;
			assert.equal(dateBucket, "2026-11-02");
			return { syncedRecords: 4 };
		},
	};

	const envWithDo = {
		QUOTA_COORDINATOR: {
			getByName: () => mockStub,
		},
	};

	const syncRes = await syncQuotaFromD1(envWithDo, "2026-11-02");
	assert.equal(d1SyncCalled, true);
	assert.equal(syncRes.syncedRecords, 4);
});
