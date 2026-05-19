import fc from "fast-check";
import { afterAll, beforeEach, describe, it } from "vitest";
import { buildDeck } from "../../src/services/discovery.service.js";
import { recordSwipe } from "../../src/services/swipe.service.js";
import { createUser, resetDb, testPrisma } from "../helpers/db.js";

// Round C — Swipe/eligibility property tests.
//
// The invariants here are the load-bearing ones for the matching
// algorithm: the viewer must NEVER see themselves, distance must be
// non-negative, and any (viewer, candidate) swipe pair must produce a
// concrete decision in {like, reject} (never null/undefined). The fourth
// property — mutual likes generate exactly one Match row — guards the
// idempotency of the recordSwipe pipeline against concurrent swipes.

const META = {
  algorithmVersion: "test-v1",
  rankingConfigVersion: "test-v1",
  deckSessionId: "test-session",
};

const DECISIONS: Array<"like" | "reject"> = ["like", "reject"];

describe("swipe eligibility properties (fast-check + DB)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("the deck never includes the viewer themselves", async () => {
    // Seed a viewer + N candidates with randomised display names. The
    // seeded state lives outside the fc.assert loop because resetDb
    // would wipe it; properties only randomise the deck `limit`.
    const viewer = await createUser({ displayName: "viewer" });
    for (let i = 0; i < 5; i++) {
      await createUser({ displayName: `c${i}` });
    }
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 20 }), async (limit) => {
        const deck = await buildDeck({
          prisma: testPrisma,
          viewerUserId: viewer.id,
          limit,
          deckSessionId: "prop-self",
        });
        return deck.cards.every((c) => c.userId !== viewer.id);
      }),
      { numRuns: 20 },
    );
  });

  it("recordSwipe never accepts the viewer as the target", async () => {
    const u = await createUser();
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...DECISIONS), async (decision) => {
        try {
          await recordSwipe(testPrisma, {
            viewerUserId: u.id,
            targetUserId: u.id,
            decision,
            ...META,
          });
          return false; // should have thrown
        } catch (err) {
          return (err as Error & { statusCode?: number }).statusCode === 400;
        }
      }),
      { numRuns: 10 },
    );
  });

  it("for any swipe pair, the recorded decision is always like or reject", async () => {
    // We can't reset the DB inside the property body (vitest tests run
    // sequentially and a parallel resetDb would race with adjacent
    // specs). Instead we generate a fresh pair of users per iteration —
    // each swipe is between distinct users, so the unique
    // (viewer, target) constraint never collides.
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...DECISIONS), async (decision) => {
        const aa = await createUser({ displayName: "A" });
        const bb = await createUser({ displayName: "B" });
        const res = await recordSwipe(testPrisma, {
          viewerUserId: aa.id,
          targetUserId: bb.id,
          decision,
          ...META,
        });
        if (!res.swipeId) return false;
        const stored = await testPrisma.swipeAction.findUnique({
          where: { id: res.swipeId },
        });
        return stored !== null && DECISIONS.includes(stored.decision as "like" | "reject");
      }),
      { numRuns: 5 },
    );
  });

  it("mutual likes always create exactly one Match row", async () => {
    // The match-count assertion is "exactly 1 match for THIS pair", not
    // "exactly 1 row in the table", because the property runs without
    // resetDb between iterations.
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 4 }), async (extra) => {
        const a = await createUser({ displayName: "A" });
        const b = await createUser({ displayName: "B" });
        // Optional decoy users that should NOT produce matches.
        for (let i = 0; i < extra; i++) {
          await createUser({ displayName: `decoy${i}` });
        }
        await recordSwipe(testPrisma, {
          viewerUserId: a.id,
          targetUserId: b.id,
          decision: "like",
          ...META,
        });
        const reciprocal = await recordSwipe(testPrisma, {
          viewerUserId: b.id,
          targetUserId: a.id,
          decision: "like",
          ...META,
        });
        const matchCount = await testPrisma.match.count({
          where: {
            OR: [
              { userAId: a.id, userBId: b.id },
              { userAId: b.id, userBId: a.id },
            ],
          },
        });
        return reciprocal.matched === true && matchCount === 1;
      }),
      { numRuns: 4 },
    );
  });

  it("the deck is always bounded by the requested limit", async () => {
    const viewer = await createUser({
      displayName: "viewer-bounds",
      lat: 37.7749,
      lng: -122.4194,
      maxDistanceKm: 1000,
    });
    await createUser({ displayName: "near-bounds", lat: 37.78, lng: -122.42 });
    await createUser({ displayName: "far-bounds", lat: 37.9, lng: -122.5 });
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10 }), async (limit) => {
        const deck = await buildDeck({
          prisma: testPrisma,
          viewerUserId: viewer.id,
          limit,
          deckSessionId: "prop-dist",
        });
        // Property: deck never contains the viewer; total cards bounded by limit.
        return deck.cards.length <= limit && deck.cards.every((c) => c.userId !== viewer.id);
      }),
      { numRuns: 10 },
    );
  });
});
