import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildSuggestedOpeners } from "../src/services/suggested-openers.service.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

// DISC-Q2 — conversation-starter suggestions.
//
// The endpoint contract is the load-bearing thing: GET
// /conversations/:id/suggested-openers -> { openers: [{ text,
// sourcePromptQuestion? }] }. We verify:
//   * the call is gated to participants (404-shaped response upstream
//     when a non-participant asks),
//   * prompts from the OTHER party drive the templated openers,
//   * we top up with generic openers when prompts are sparse,
//   * we never return more than 3 openers.

async function makeMatchedPair(opts: {
  meDisplay?: string;
  themDisplay?: string;
  themPrompts?: { question: string; answer: string }[];
}) {
  const me = await createUser({ displayName: opts.meDisplay ?? "Me" });
  const them = await createUser({ displayName: opts.themDisplay ?? "Them" });

  // Wire up a Match + Conversation directly — that's all the service
  // needs for authorization + lookup.
  const match = await testPrisma.match.create({
    data: { userAId: me.id, userBId: them.id, status: "active" },
  });
  const conversation = await testPrisma.conversation.create({
    data: { matchId: match.id, status: "active" },
  });

  if (opts.themPrompts) {
    await testPrisma.profile.update({
      where: { userId: them.id },
      data: { prompts: opts.themPrompts as never },
    });
  }
  return { me, them, conversation };
}

describe("buildSuggestedOpeners", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("returns null for non-participants", async () => {
    const { conversation } = await makeMatchedPair({});
    const stranger = await createUser({ displayName: "Stranger" });
    const result = await buildSuggestedOpeners(testPrisma, conversation.id, stranger.id);
    expect(result).toBeNull();
  });

  it("returns null when the conversation does not exist", async () => {
    const me = await createUser({ displayName: "Me" });
    const result = await buildSuggestedOpeners(testPrisma, "no-such-id", me.id);
    expect(result).toBeNull();
  });

  it("always returns exactly 3 openers", async () => {
    const { me, conversation } = await makeMatchedPair({
      themPrompts: [{ question: "Best meal you've cooked?", answer: "Slow-braised short ribs." }],
    });
    const result = await buildSuggestedOpeners(testPrisma, conversation.id, me.id);
    expect(result?.openers).toHaveLength(3);
  });

  it("derives openers from the OTHER party's prompts, ranked by answer length", async () => {
    const longest =
      "I taught myself to make kimchi last winter and now I'm hooked on fermentation.";
    const middling = "I bake sourdough on weekends.";
    const shortest = "Cooking.";
    const { me, conversation } = await makeMatchedPair({
      themPrompts: [
        { question: "Short Q", answer: shortest },
        { question: "Long Q", answer: longest },
        { question: "Mid Q", answer: middling },
      ],
    });
    const result = await buildSuggestedOpeners(testPrisma, conversation.id, me.id);
    const openers = result?.openers ?? [];
    expect(openers).toHaveLength(3);
    // First opener references the longest answer.
    expect(openers[0]?.text).toContain(longest);
    expect(openers[0]?.sourcePromptQuestion).toBe("Long Q");
    // Second opener references the middling answer.
    expect(openers[1]?.text).toContain(middling);
    expect(openers[1]?.sourcePromptQuestion).toBe("Mid Q");
    // Third opener references the shortest answer.
    expect(openers[2]?.text).toContain(shortest);
    expect(openers[2]?.sourcePromptQuestion).toBe("Short Q");
  });

  it("tops up with generic openers when prompts are sparse", async () => {
    const { me, conversation } = await makeMatchedPair({
      themPrompts: [{ question: "Q1", answer: "I love hiking." }],
    });
    const result = await buildSuggestedOpeners(testPrisma, conversation.id, me.id);
    const openers = result?.openers ?? [];
    expect(openers).toHaveLength(3);
    // First is prompt-derived.
    expect(openers[0]?.sourcePromptQuestion).toBe("Q1");
    // Remaining are generic — no sourcePromptQuestion.
    expect(openers[1]?.sourcePromptQuestion).toBeUndefined();
    expect(openers[2]?.sourcePromptQuestion).toBeUndefined();
  });

  it("returns 3 generic openers when the other party has zero prompts", async () => {
    const { me, conversation } = await makeMatchedPair({});
    const result = await buildSuggestedOpeners(testPrisma, conversation.id, me.id);
    const openers = result?.openers ?? [];
    expect(openers).toHaveLength(3);
    for (const o of openers) {
      expect(o.sourcePromptQuestion).toBeUndefined();
      expect(o.text.length).toBeGreaterThan(0);
    }
  });

  it("sanitizes answers — strips newlines and rewrites quotes", async () => {
    const { me, conversation } = await makeMatchedPair({
      themPrompts: [
        {
          question: "Anything goes",
          answer: 'I love "sourdough"\nand long walks.',
        },
      ],
    });
    const result = await buildSuggestedOpeners(testPrisma, conversation.id, me.id);
    const text = result?.openers[0]?.text ?? "";
    // No raw newlines or unescaped double-quotes inside the answer span.
    expect(text).not.toContain("\n");
    expect(text).toContain("'sourdough'");
  });

  it("the viewer's own prompts never drive the openers", async () => {
    // Belt-and-braces: even if me has prompts, the opener should be
    // built from THEM's prompts (or generics if THEM has none).
    const { me, them, conversation } = await makeMatchedPair({});
    await testPrisma.profile.update({
      where: { userId: me.id },
      data: {
        prompts: [
          { question: "Mine", answer: "This is my own prompt and should NOT appear." },
        ] as never,
      },
    });
    void them; // unused

    const result = await buildSuggestedOpeners(testPrisma, conversation.id, me.id);
    for (const o of result?.openers ?? []) {
      expect(o.text).not.toContain("my own prompt and should NOT appear");
    }
  });
});
