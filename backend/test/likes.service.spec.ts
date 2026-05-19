import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { listIncomingLikes, rejectIncomingLike } from "../src/services/likes.service.js";
import { recordSwipe } from "../src/services/swipe.service.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

// Round C — likes service coverage. The incoming-likes endpoint is the
// only path consumers have for seeing who liked them and is therefore
// the visibility-preference enforcement point — these tests pin that
// behaviour.

const META = {
  algorithmVersion: "test-v1",
  rankingConfigVersion: "test-v1",
  deckSessionId: "test-session",
};

async function makeLike(fromUserId: string, toUserId: string) {
  await recordSwipe(testPrisma, {
    viewerUserId: fromUserId,
    targetUserId: toUserId,
    decision: "like",
    ...META,
  });
}

describe("likes service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  describe("listIncomingLikes", () => {
    it("returns visibility=visible with the full list by default", async () => {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      await makeLike(b.id, a.id);

      const out = await listIncomingLikes(testPrisma, a.id);
      expect(out.visibility).toBe("visible");
      expect(out.count).toBe(1);
      expect(out.likes).toHaveLength(1);
      expect(out.likes[0]?.fromUserId).toBe(b.id);
    });

    it("returns visibility=count_only without like rows when caller opted in", async () => {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      await makeLike(b.id, a.id);
      await testPrisma.preferences.update({
        where: { userId: a.id },
        data: { likesVisibility: "count_only" },
      });

      const out = await listIncomingLikes(testPrisma, a.id);
      expect(out.visibility).toBe("count_only");
      expect(out.count).toBe(1);
      expect(out.likes).toEqual([]);
    });

    it("returns visibility=hidden with null count and no rows", async () => {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      await makeLike(b.id, a.id);
      await testPrisma.preferences.update({
        where: { userId: a.id },
        data: { likesVisibility: "hidden" },
      });

      const out = await listIncomingLikes(testPrisma, a.id);
      expect(out.visibility).toBe("hidden");
      expect(out.count).toBeNull();
      expect(out.likes).toEqual([]);
    });

    it("only surfaces likes with status=active (rejected likes drop out)", async () => {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      const c = await createUser({ displayName: "C" });
      await makeLike(b.id, a.id);
      await makeLike(c.id, a.id);
      const cLike = await testPrisma.like.findUnique({
        where: { fromUserId_toUserId: { fromUserId: c.id, toUserId: a.id } },
      });
      await testPrisma.like.update({
        where: { id: cLike!.id },
        data: { status: "rejected" },
      });

      const out = await listIncomingLikes(testPrisma, a.id);
      expect(out.count).toBe(1);
      expect(out.likes.map((l) => l.fromUserId)).toEqual([b.id]);
    });

    it("returns visibility=visible / count=0 when the viewer has no incoming likes", async () => {
      const a = await createUser({ displayName: "A" });
      const out = await listIncomingLikes(testPrisma, a.id);
      expect(out.visibility).toBe("visible");
      expect(out.count).toBe(0);
      expect(out.likes).toEqual([]);
    });
  });

  describe("rejectIncomingLike", () => {
    it("rejects a like that belongs to the caller", async () => {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      await makeLike(b.id, a.id);
      const like = await testPrisma.like.findFirst({ where: { toUserId: a.id } });

      const res = await rejectIncomingLike(testPrisma, like!.id, a.id);
      expect(res.rejected).toBe(true);
      const after = await testPrisma.like.findUnique({ where: { id: like!.id } });
      expect(after?.status).toBe("rejected");
    });

    it("returns rejected=false when the like belongs to someone else", async () => {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      const c = await createUser({ displayName: "C" });
      await makeLike(b.id, a.id);
      const like = await testPrisma.like.findFirst({ where: { toUserId: a.id } });

      const res = await rejectIncomingLike(testPrisma, like!.id, c.id);
      expect(res.rejected).toBe(false);
      const after = await testPrisma.like.findUnique({ where: { id: like!.id } });
      expect(after?.status).toBe("active");
    });

    it("returns rejected=false when the like id is unknown", async () => {
      const a = await createUser({ displayName: "A" });
      const res = await rejectIncomingLike(testPrisma, "nope", a.id);
      expect(res.rejected).toBe(false);
    });
  });
});
