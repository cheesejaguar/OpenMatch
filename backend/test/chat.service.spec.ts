import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  authorizedForConversation,
  listConversations,
  listMessages,
  postMessage,
} from "../src/services/chat.service.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

// Round C — chat service coverage. Exercises the message-write and
// conversation-membership invariants that gate every realtime path. Each
// case runs against a real Postgres so the conversation/match/message FKs
// and the implicit transaction in postMessage are validated end-to-end.

async function makeConversationBetween(aId: string, bId: string) {
  const match = await testPrisma.match.create({
    data: { userAId: aId, userBId: bId, status: "active" },
  });
  return testPrisma.conversation.create({
    data: { matchId: match.id, status: "active" },
  });
}

describe("chat service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  describe("authorizedForConversation", () => {
    it("returns false when the conversation id is unknown", async () => {
      const u = await createUser();
      expect(await authorizedForConversation(testPrisma, "nope", u.id)).toBe(false);
    });

    it("returns true for both participants on an active match + convo", async () => {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      const convo = await makeConversationBetween(a.id, b.id);
      expect(await authorizedForConversation(testPrisma, convo.id, a.id)).toBe(true);
      expect(await authorizedForConversation(testPrisma, convo.id, b.id)).toBe(true);
    });

    it("returns false for a third-party user", async () => {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      const c = await createUser({ displayName: "C" });
      const convo = await makeConversationBetween(a.id, b.id);
      expect(await authorizedForConversation(testPrisma, convo.id, c.id)).toBe(false);
    });

    it("returns false once the match is closed", async () => {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      const convo = await makeConversationBetween(a.id, b.id);
      await testPrisma.match.update({
        where: { id: convo.matchId },
        data: { status: "unmatched" },
      });
      expect(await authorizedForConversation(testPrisma, convo.id, a.id)).toBe(false);
    });

    it("returns false once the conversation is archived", async () => {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      const convo = await makeConversationBetween(a.id, b.id);
      await testPrisma.conversation.update({
        where: { id: convo.id },
        data: { status: "closed" },
      });
      expect(await authorizedForConversation(testPrisma, convo.id, a.id)).toBe(false);
    });
  });

  describe("postMessage", () => {
    it("rejects empty body with statusCode 400", async () => {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      const convo = await makeConversationBetween(a.id, b.id);
      await expect(postMessage(testPrisma, convo.id, a.id, "   ")).rejects.toMatchObject({
        statusCode: 400,
        message: "empty_message",
      });
    });

    it("rejects bodies over 2000 chars with statusCode 400", async () => {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      const convo = await makeConversationBetween(a.id, b.id);
      const huge = "x".repeat(2001);
      await expect(postMessage(testPrisma, convo.id, a.id, huge)).rejects.toMatchObject({
        statusCode: 400,
        message: "message_too_long",
      });
    });

    it("rejects non-participants with statusCode 403", async () => {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      const c = await createUser({ displayName: "C" });
      const convo = await makeConversationBetween(a.id, b.id);
      await expect(postMessage(testPrisma, convo.id, c.id, "hi")).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it("creates the message and bumps the conversation updatedAt", async () => {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      const convo = await makeConversationBetween(a.id, b.id);
      const before = convo.updatedAt;
      // Force a small delay so the bumped updatedAt is observably later
      // than the original. Postgres NOW() is microsecond-granular so a
      // ~5ms wait is enough.
      await new Promise((r) => setTimeout(r, 10));
      const msg = await postMessage(testPrisma, convo.id, a.id, "  hello world  ");
      expect(msg.body).toBe("  hello world  ");
      const reloaded = await testPrisma.conversation.findUnique({
        where: { id: convo.id },
      });
      expect(reloaded!.updatedAt.getTime()).toBeGreaterThan(before.getTime());
    });
  });

  describe("listConversations / listMessages", () => {
    it("returns only conversations whose match is active for the caller", async () => {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      const c = await createUser({ displayName: "C" });
      const active = await makeConversationBetween(a.id, b.id);
      const closed = await makeConversationBetween(a.id, c.id);
      await testPrisma.match.update({
        where: { id: closed.matchId },
        data: { status: "unmatched" },
      });
      const rows = await listConversations(testPrisma, a.id);
      expect(rows.map((r) => r.id)).toEqual([active.id]);
    });

    it("listMessages returns null for unauthorized callers", async () => {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      const c = await createUser({ displayName: "C" });
      const convo = await makeConversationBetween(a.id, b.id);
      await postMessage(testPrisma, convo.id, a.id, "hi");
      expect(await listMessages(testPrisma, convo.id, c.id)).toBeNull();
    });

    it("listMessages returns messages in ascending order excluding soft-deleted ones", async () => {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      const convo = await makeConversationBetween(a.id, b.id);
      const m1 = await postMessage(testPrisma, convo.id, a.id, "first");
      await new Promise((r) => setTimeout(r, 5));
      await postMessage(testPrisma, convo.id, b.id, "second");
      await testPrisma.message.update({
        where: { id: m1.id },
        data: { deletedAt: new Date() },
      });
      const rows = await listMessages(testPrisma, convo.id, a.id);
      expect(rows!.map((r) => r.body)).toEqual(["second"]);
    });
  });
});
