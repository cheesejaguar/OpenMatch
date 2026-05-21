import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BasicModerationProvider } from "../src/lib/moderation-basic.js";
import {
  getModerationProvider,
  type ImageScanInput,
  type ImageScanResult,
  type ModerationProvider,
  NoopModerationProvider,
  setModerationProvider,
  type TextScanInput,
  type TextScanResult,
} from "../src/lib/moderation-provider.js";
import { postMessage } from "../src/services/chat.service.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

// PLATFORM-PLUGIN — contract tests for ModerationProvider + the chat
// wiring that consults it. The default Noop provider must preserve the
// pre-plugin behaviour; the BasicModerationProvider must surface the
// documented decisions; and the chat service must react to `block` /
// `flag` decisions correctly.

class FakeProvider implements ModerationProvider {
  readonly name = "fake";
  imageResult: ImageScanResult = { decision: "clean", categories: [], confidence: 0 };
  textResult: TextScanResult = { decision: "clean", categories: [], confidence: 0 };

  async scanImage(_input: ImageScanInput): Promise<ImageScanResult> {
    return this.imageResult;
  }
  async scanText(_input: TextScanInput): Promise<TextScanResult> {
    return this.textResult;
  }
}

async function makeConversationBetween(aId: string, bId: string) {
  const match = await testPrisma.match.create({
    data: { userAId: aId, userBId: bId, status: "active" },
  });
  return testPrisma.conversation.create({
    data: { matchId: match.id, status: "active" },
  });
}

describe("ModerationProvider", () => {
  afterAll(() => {
    setModerationProvider(new NoopModerationProvider());
  });

  describe("NoopModerationProvider", () => {
    it("returns clean for every image and text", async () => {
      const p = new NoopModerationProvider();
      expect((await p.scanImage({ blobPathname: "x", mimeType: "image/jpeg" })).decision).toBe(
        "clean",
      );
      expect((await p.scanText({ text: "anything goes", context: "message" })).decision).toBe(
        "clean",
      );
    });
  });

  describe("BasicModerationProvider", () => {
    const p = new BasicModerationProvider();

    it("returns clean on innocuous text", async () => {
      const r = await p.scanText({ text: "lunch on friday?", context: "message" });
      expect(r.decision).toBe("clean");
    });

    it("flags a single off-platform keyword", async () => {
      const r = await p.scanText({ text: "hit me up on telegram", context: "message" });
      expect(r.decision).toBe("flag");
      expect(r.categories).toContain("off_platform");
    });

    it("flags a URL on its own", async () => {
      const r = await p.scanText({ text: "check https://example.com", context: "bio" });
      expect(r.decision).toBe("flag");
      expect(r.categories).toContain("spam");
    });

    it("flags a phone number on its own", async () => {
      const r = await p.scanText({ text: "call me 555-123-4567", context: "message" });
      expect(r.decision).toBe("flag");
      expect(r.categories).toContain("scam");
    });

    it("blocks when two or more categories trip simultaneously", async () => {
      const r = await p.scanText({
        text: "telegram @scammer or call 555-123-4567",
        context: "message",
      });
      expect(r.decision).toBe("block");
      expect(r.categories.length).toBeGreaterThanOrEqual(2);
    });

    it("scanImage returns clean (no built-in image checker)", async () => {
      const r = await p.scanImage({ blobPathname: "a/b.jpg", mimeType: "image/jpeg" });
      expect(r.decision).toBe("clean");
    });
  });

  describe("getModerationProvider / setModerationProvider", () => {
    it("setModerationProvider swaps the active provider", () => {
      const fake = new FakeProvider();
      setModerationProvider(fake);
      expect(getModerationProvider()).toBe(fake);
    });
  });

  describe("chat.postMessage wiring", () => {
    beforeEach(async () => {
      await resetDb();
      setModerationProvider(new NoopModerationProvider());
    });

    it("delivers normally when the provider returns clean (default behaviour)", async () => {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      const convo = await makeConversationBetween(a.id, b.id);
      const msg = await postMessage(testPrisma, convo.id, a.id, "hi there");
      expect(msg.moderationStatus).toBe("clean");
    });

    it("rejects with statusCode 422 + message_rejected_by_moderation when the provider returns block", async () => {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      const convo = await makeConversationBetween(a.id, b.id);
      const fake = new FakeProvider();
      fake.textResult = { decision: "block", categories: ["spam"], confidence: 0.9 };
      setModerationProvider(fake);
      await expect(postMessage(testPrisma, convo.id, a.id, "anything")).rejects.toMatchObject({
        statusCode: 422,
        message: "message_rejected_by_moderation",
      });
      // No row written.
      const rows = await testPrisma.message.findMany({ where: { conversationId: convo.id } });
      expect(rows.length).toBe(0);
    });

    it("delivers with moderationStatus=under_review when the provider returns flag", async () => {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      const convo = await makeConversationBetween(a.id, b.id);
      const fake = new FakeProvider();
      fake.textResult = { decision: "flag", categories: ["off_platform"], confidence: 0.6 };
      setModerationProvider(fake);
      const msg = await postMessage(testPrisma, convo.id, a.id, "telegram me");
      expect(msg.moderationStatus).toBe("under_review");
    });
  });
});
