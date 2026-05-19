import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildDeck } from "../src/services/discovery.service.js";
import { recordSwipe } from "../src/services/swipe.service.js";
import { createUser, resetDb, seedTestMetroSF, testPrisma } from "./helpers/db.js";

// Round C — discovery service coverage. The deck-builder is the most
// complex SQL/business-logic surface in the backend; these tests exercise
// the documented filter ordering (self, blocks, prior likes, geo,
// preference radius, metro overlay).
//
// `buildDeck` returns a DeckResponse from @openmatch/matching whose card
// list lives at `.cards` (one entry per surviving candidate, in ranked
// order).

const META = {
  algorithmVersion: "test-v1",
  rankingConfigVersion: "test-v1",
  deckSessionId: "test-session",
};

async function runDeck(viewerId: string, limit = 50) {
  return buildDeck({
    prisma: testPrisma,
    viewerUserId: viewerId,
    limit,
    deckSessionId: "test-session-1",
  });
}

async function rawBlock(blockerId: string, blockedId: string) {
  // The safety.service.blockUser flow needs the candidate to be a "real"
  // user with reports/auth context; for the deck filter it's enough to
  // assert that the Block row exists, so we write it directly.
  await testPrisma.block.create({
    data: { blockerUserId: blockerId, blockedUserId: blockedId },
  });
}

describe("discovery.buildDeck", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("throws viewer_not_initialized when the viewer has no profile", async () => {
    const orphan = await testPrisma.user.create({
      data: {
        authProvider: "email",
        dateOfBirth: new Date("1995-01-01"),
        isAgeVerified: true,
        emailHash: `orphan-${Date.now()}`,
      },
    });
    await expect(runDeck(orphan.id)).rejects.toMatchObject({
      message: "viewer_not_initialized",
      statusCode: 400,
    });
  });

  it("returns an empty deck when no other users exist", async () => {
    const a = await createUser();
    const deck = await runDeck(a.id);
    expect(deck.cards).toEqual([]);
  });

  it("never includes the viewer themselves", async () => {
    const a = await createUser();
    await createUser({ displayName: "B" });
    const deck = await runDeck(a.id);
    expect(deck.cards.find((c) => c.userId === a.id)).toBeUndefined();
  });

  it("excludes users the viewer has blocked", async () => {
    const a = await createUser({ displayName: "A" });
    const b = await createUser({ displayName: "B" });
    await rawBlock(a.id, b.id);
    const deck = await runDeck(a.id);
    expect(deck.cards.find((c) => c.userId === b.id)).toBeUndefined();
  });

  it("excludes users who have blocked the viewer", async () => {
    const a = await createUser({ displayName: "A" });
    const b = await createUser({ displayName: "B" });
    await rawBlock(b.id, a.id);
    const deck = await runDeck(a.id);
    expect(deck.cards.find((c) => c.userId === b.id)).toBeUndefined();
  });

  it("excludes candidates the viewer has already liked", async () => {
    const a = await createUser({ displayName: "A" });
    const b = await createUser({ displayName: "B" });
    await recordSwipe(testPrisma, {
      viewerUserId: a.id,
      targetUserId: b.id,
      decision: "like",
      ...META,
    });
    const deck = await runDeck(a.id);
    expect(deck.cards.find((c) => c.userId === b.id)).toBeUndefined();
  });

  it("respects the viewer's maxDistanceKm preference", async () => {
    const a = await createUser({
      displayName: "A",
      lat: 37.7749,
      lng: -122.4194,
      maxDistanceKm: 10,
    });
    // ~0.5 km away — in.
    await createUser({ displayName: "Near", lat: 37.78, lng: -122.4194 });
    // ~600 km away (San Diego) — out.
    await createUser({ displayName: "Far", lat: 32.7157, lng: -117.1611 });
    const deck = await runDeck(a.id);
    const names = deck.cards.map((c) => c.profileId);
    expect(names.length).toBeGreaterThan(0);
    const farProfile = await testPrisma.profile.findFirst({
      where: { displayName: "Far" },
    });
    expect(names).not.toContain(farProfile!.id);
  });

  it("with a metro overlay, drops candidates outside the metro radius", async () => {
    await seedTestMetroSF();
    const a = await createUser({
      displayName: "A",
      lat: 37.7749,
      lng: -122.4194,
      maxDistanceKm: 1000,
    });
    // Inside SF Bay metro.
    await createUser({ displayName: "Inside", lat: 37.7749, lng: -122.4194 });
    // Outside metro (Los Angeles), but within the viewer's 1000 km radius.
    await createUser({ displayName: "Outside", lat: 34.0522, lng: -118.2437 });
    const deck = await runDeck(a.id);
    const profileIds = deck.cards.map((c) => c.profileId);
    const inside = await testPrisma.profile.findFirst({
      where: { displayName: "Inside" },
    });
    const outside = await testPrisma.profile.findFirst({
      where: { displayName: "Outside" },
    });
    expect(profileIds).toContain(inside!.id);
    expect(profileIds).not.toContain(outside!.id);
  });

  it("emits an algorithm + ranking config version that matches the deck", async () => {
    const a = await createUser({ displayName: "A" });
    await createUser({ displayName: "B" });
    const deck = await runDeck(a.id);
    expect(deck.algorithmVersion).toBeTruthy();
    expect(deck.rankingConfigVersion).toBeTruthy();
    expect(deck.deckSessionId).toBe("test-session-1");
  });

  it("respects the limit parameter", async () => {
    const a = await createUser({ displayName: "A" });
    for (let i = 0; i < 5; i++) {
      await createUser({ displayName: `B${i}` });
    }
    const deck = await runDeck(a.id, 2);
    expect(deck.cards.length).toBeLessThanOrEqual(2);
  });
});
