import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { blockUser } from "../src/services/safety.service.js";
import { __forTest, recordSwipe, undoSwipe } from "../src/services/swipe.service.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

// End-to-end coverage for the swipe / like / match / undo paths. These
// hit a real Postgres + PostGIS so the SQL / Prisma layer is exercised
// the same way it will be in production on Neon.

const SWIPE_META = {
  algorithmVersion: "test-v1",
  rankingConfigVersion: "test-v1",
  deckSessionId: "test-session",
};

describe("swipe + match flow", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("rejects self-swipes with statusCode 400", async () => {
    const u = await createUser();
    await expect(
      recordSwipe(testPrisma, {
        viewerUserId: u.id,
        targetUserId: u.id,
        decision: "like",
        ...SWIPE_META,
      }),
    ).rejects.toMatchObject({ message: "cannot_swipe_self", statusCode: 400 });
  });

  it("one-sided like records a Like but creates no Match", async () => {
    const a = await createUser();
    const b = await createUser();

    const result = await recordSwipe(testPrisma, {
      viewerUserId: a.id,
      targetUserId: b.id,
      decision: "like",
      ...SWIPE_META,
    });

    expect(result.matched).toBe(false);
    expect(result.matchId).toBeUndefined();
    expect(result.swipeId).toBeTruthy();

    const like = await testPrisma.like.findUnique({
      where: { fromUserId_toUserId: { fromUserId: a.id, toUserId: b.id } },
    });
    expect(like?.status).toBe("active");
    expect(await testPrisma.match.count()).toBe(0);
    expect(await testPrisma.conversation.count()).toBe(0);
  });

  it("a reject decision records the swipe with no Like and no Match", async () => {
    const a = await createUser();
    const b = await createUser();

    const result = await recordSwipe(testPrisma, {
      viewerUserId: a.id,
      targetUserId: b.id,
      decision: "reject",
      ...SWIPE_META,
    });

    expect(result.matched).toBe(false);
    expect(await testPrisma.like.count()).toBe(0);
    expect(await testPrisma.match.count()).toBe(0);
  });

  it("reciprocal likes create exactly one Match and one Conversation", async () => {
    const a = await createUser();
    const b = await createUser();

    await recordSwipe(testPrisma, {
      viewerUserId: a.id,
      targetUserId: b.id,
      decision: "like",
      ...SWIPE_META,
    });
    const second = await recordSwipe(testPrisma, {
      viewerUserId: b.id,
      targetUserId: a.id,
      decision: "like",
      ...SWIPE_META,
    });

    expect(second.matched).toBe(true);
    expect(second.matchId).toBeTruthy();

    // Canonical ordering: userAId is the lexicographically smaller id.
    const [expectedA, expectedB] = [a.id, b.id].sort();
    const match = await testPrisma.match.findUnique({
      where: { userAId_userBId: { userAId: expectedA!, userBId: expectedB! } },
      include: { conversation: true },
    });
    expect(match).toBeTruthy();
    expect(match?.status).toBe("active");
    expect(match?.conversation).toBeTruthy();

    // Both Likes flipped to "matched".
    const likes = await testPrisma.like.findMany({});
    expect(likes).toHaveLength(2);
    expect(likes.every((l) => l.status === "matched")).toBe(true);
  });

  it("liking the same user twice is idempotent (no duplicate Like, single Match)", async () => {
    const a = await createUser();
    const b = await createUser();

    await recordSwipe(testPrisma, {
      viewerUserId: a.id,
      targetUserId: b.id,
      decision: "like",
      ...SWIPE_META,
    });
    await recordSwipe(testPrisma, {
      viewerUserId: a.id,
      targetUserId: b.id,
      decision: "like",
      ...SWIPE_META,
    });

    expect(await testPrisma.like.count()).toBe(1);
    expect(await testPrisma.swipeAction.count()).toBe(2);
  });

  it("returns null swipeId for swipes against blocked users (no Swipe/Like recorded)", async () => {
    const a = await createUser();
    const b = await createUser();
    await blockUser(testPrisma, a.id, b.id);

    const result = await recordSwipe(testPrisma, {
      viewerUserId: a.id,
      targetUserId: b.id,
      decision: "like",
      ...SWIPE_META,
    });
    expect(result.swipeId).toBeNull();
    expect(result.matched).toBe(false);

    expect(await testPrisma.swipeAction.count()).toBe(0);
    expect(await testPrisma.like.count()).toBe(0);
  });

  it("treats reverse-direction blocks identically (block target → viewer also blocks)", async () => {
    const a = await createUser();
    const b = await createUser();
    await blockUser(testPrisma, b.id, a.id);

    const result = await recordSwipe(testPrisma, {
      viewerUserId: a.id,
      targetUserId: b.id,
      decision: "like",
      ...SWIPE_META,
    });
    expect(result.swipeId).toBeNull();
    expect(await testPrisma.like.count()).toBe(0);
  });

  it("blocking after a match closes that match", async () => {
    const a = await createUser();
    const b = await createUser();
    await recordSwipe(testPrisma, {
      viewerUserId: a.id,
      targetUserId: b.id,
      decision: "like",
      ...SWIPE_META,
    });
    await recordSwipe(testPrisma, {
      viewerUserId: b.id,
      targetUserId: a.id,
      decision: "like",
      ...SWIPE_META,
    });
    expect(await testPrisma.match.count()).toBe(1);

    await blockUser(testPrisma, a.id, b.id);

    const match = await testPrisma.match.findFirst({});
    expect(match?.status).toBe("unmatched");
    expect(match?.unmatchedByUserId).toBe(a.id);
    expect(match?.unmatchedAt).toBeTruthy();
  });

  it("undoSwipe within the 5-minute window withdraws the Like and marks the swipe undone", async () => {
    const a = await createUser();
    const b = await createUser();
    const swipe = await recordSwipe(testPrisma, {
      viewerUserId: a.id,
      targetUserId: b.id,
      decision: "like",
      ...SWIPE_META,
    });
    expect(swipe.swipeId).not.toBeNull();

    const result = await undoSwipe(testPrisma, a.id, swipe.swipeId!);
    expect(result.undone).toBe(true);

    const persisted = await testPrisma.swipeAction.findUnique({
      where: { id: swipe.swipeId! },
    });
    expect(persisted?.undoneAt).toBeTruthy();

    const like = await testPrisma.like.findUnique({
      where: { fromUserId_toUserId: { fromUserId: a.id, toUserId: b.id } },
    });
    expect(like?.status).toBe("withdrawn");
    expect(like?.withdrawnAt).toBeTruthy();
  });

  it("undoSwipe outside the window fails", async () => {
    const a = await createUser();
    const b = await createUser();
    const swipe = await recordSwipe(testPrisma, {
      viewerUserId: a.id,
      targetUserId: b.id,
      decision: "like",
      ...SWIPE_META,
    });

    // Push createdAt past the undo window.
    await testPrisma.swipeAction.update({
      where: { id: swipe.swipeId! },
      data: { createdAt: new Date(Date.now() - __forTest.UNDO_WINDOW_MS - 1000) },
    });

    const result = await undoSwipe(testPrisma, a.id, swipe.swipeId!);
    expect(result.undone).toBe(false);
  });

  it("undoSwipe by a different user fails", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const swipe = await recordSwipe(testPrisma, {
      viewerUserId: a.id,
      targetUserId: b.id,
      decision: "like",
      ...SWIPE_META,
    });

    const result = await undoSwipe(testPrisma, c.id, swipe.swipeId!);
    expect(result.undone).toBe(false);

    const swipeRow = await testPrisma.swipeAction.findUnique({
      where: { id: swipe.swipeId! },
    });
    expect(swipeRow?.undoneAt).toBeNull();
  });
});
