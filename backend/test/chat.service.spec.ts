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

    // PERF-B3 — keyset pagination + take cap. Default page should be the
    // 50 most recent messages, ordered oldest→newest within the page; a
    // cursor walks back through older history one page at a time.
    it("listMessages caps the default page to 50 most-recent messages", async () => {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      const convo = await makeConversationBetween(a.id, b.id);
      // Seed 60 messages so the default page (50) leaves 10 older
      // messages behind the cursor.
      const created: { id: string; body: string }[] = [];
      for (let i = 0; i < 60; i++) {
        const msg = await postMessage(testPrisma, convo.id, a.id, `msg-${i}`);
        created.push({ id: msg.id, body: msg.body });
      }
      const page1 = await listMessages(testPrisma, convo.id, a.id);
      expect(page1).not.toBeNull();
      expect(page1!.length).toBe(50);
      // Within the page rows are oldest → newest. The first row is the
      // 11th message we created (index 10); the last is the 60th
      // (index 59).
      expect(page1![0].body).toBe("msg-10");
      expect(page1![49].body).toBe("msg-59");
    });

    it("listMessages cursor returns the page of messages immediately before", async () => {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      const convo = await makeConversationBetween(a.id, b.id);
      const created: { id: string; body: string }[] = [];
      for (let i = 0; i < 60; i++) {
        const msg = await postMessage(testPrisma, convo.id, a.id, `msg-${i}`);
        created.push({ id: msg.id, body: msg.body });
      }
      const page1 = await listMessages(testPrisma, convo.id, a.id);
      // Cursor = oldest message currently rendered (first of page1).
      const cursor = page1![0].id;
      const page2 = await listMessages(testPrisma, convo.id, a.id, { cursor });
      expect(page2).not.toBeNull();
      // 10 older messages (msg-0 .. msg-9), oldest first.
      expect(page2!.map((m) => m.body)).toEqual([
        "msg-0",
        "msg-1",
        "msg-2",
        "msg-3",
        "msg-4",
        "msg-5",
        "msg-6",
        "msg-7",
        "msg-8",
        "msg-9",
      ]);
    });

    it("listMessages drops the moderation-only / internal columns from the select", async () => {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      const convo = await makeConversationBetween(a.id, b.id);
      await postMessage(testPrisma, convo.id, a.id, "hello");
      const rows = await listMessages(testPrisma, convo.id, a.id);
      const msg = rows![0] as Record<string, unknown>;
      // Allow-listed by MESSAGE_LIST_SELECT.
      expect(msg.id).toBeDefined();
      expect(msg.body).toBe("hello");
      expect(msg.senderUserId).toBe(a.id);
      // Not in the select — must be absent (not just null).
      expect("deletedAt" in msg).toBe(false);
    });

    it("listMessages with an unknown cursor returns the first page (degraded benign)", async () => {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      const convo = await makeConversationBetween(a.id, b.id);
      await postMessage(testPrisma, convo.id, a.id, "only one");
      const rows = await listMessages(testPrisma, convo.id, a.id, { cursor: "does-not-exist" });
      expect(rows!.map((m) => m.body)).toEqual(["only one"]);
    });
  });
});
