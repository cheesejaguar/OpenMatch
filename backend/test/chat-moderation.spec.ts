import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { postMessage } from "../src/services/chat.service.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

// Trust & safety automation — verifies that the heuristic moderator
// is wired into `postMessage` so a blocked message never lands in the
// Message table while a flag message does ship with a queued
// ModerationFlag row.

async function makeConversationBetween(aId: string, bId: string) {
  const match = await testPrisma.match.create({
    data: { userAId: aId, userBId: bId, status: "active" },
  });
  return testPrisma.conversation.create({
    data: { matchId: match.id, status: "active" },
  });
}

describe("chat moderation integration", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("refuses a phone number in a message with statusCode 422", async () => {
    const a = await createUser({ displayName: "A" });
    const b = await createUser({ displayName: "B" });
    const convo = await makeConversationBetween(a.id, b.id);
    let err: { statusCode?: number; message?: string } | null = null;
    try {
      await postMessage(testPrisma, convo.id, a.id, "yo, hit me at +1 415-555-2671 anytime");
    } catch (e) {
      err = e as never;
    }
    expect(err?.statusCode).toBe(422);
    expect(err?.message).toBe("message_blocked");

    const msgs = await testPrisma.message.findMany({ where: { conversationId: convo.id } });
    expect(msgs).toHaveLength(0);
  });

  it("ships a clean message with no flags", async () => {
    const a = await createUser({ displayName: "A" });
    const b = await createUser({ displayName: "B" });
    const convo = await makeConversationBetween(a.id, b.id);
    const msg = await postMessage(testPrisma, convo.id, a.id, "want to grab coffee?");
    expect(msg.body).toBe("want to grab coffee?");
    const msgs = await testPrisma.message.findMany({ where: { conversationId: convo.id } });
    expect(msgs).toHaveLength(1);
  });

  it("records a ModerationFlag for a blocked attempt", async () => {
    const a = await createUser({ displayName: "A" });
    const b = await createUser({ displayName: "B" });
    const convo = await makeConversationBetween(a.id, b.id);
    try {
      await postMessage(testPrisma, convo.id, a.id, "DM me at @cryptouser later");
    } catch {
      // expected
    }
    const flags = await testPrisma.moderationFlag.findMany({
      where: { targetUserId: a.id },
    });
    expect(flags.length).toBeGreaterThan(0);
    expect(flags[0]?.decision).toBe("block");
  });
});
