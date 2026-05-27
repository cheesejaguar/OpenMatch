import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { __clearMatchingPresetsCache } from "../src/lib/matching-presets.js";
import { buildServer } from "../src/server.js";
import { buildDeck } from "../src/services/discovery.service.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

const app = await buildServer();
const fastify = app;
const tok = (id: string) => fastify.jwt.sign({ sub: id, scope: "user" });

afterAll(async () => {
  await fastify.close();
  await testPrisma.$disconnect();
});

beforeEach(async () => {
  __clearMatchingPresetsCache();
  await resetDb();
});

async function makeMatch(aId: string, bId: string, createdAt?: Date) {
  const match = await testPrisma.match.create({
    data: { userAId: aId, userBId: bId, status: "active", ...(createdAt && { createdAt }) },
  });
  const convo = await testPrisma.conversation.create({ data: { matchId: match.id } });
  return { match, convo };
}

describe("content catalogs", () => {
  it("serves values, prompts, question sets, and coaching tips", async () => {
    const u = await createUser({ displayName: "A" });
    const res = await fastify.inject({
      method: "GET",
      url: "/api/v1/content/catalogs",
      headers: { authorization: `Bearer ${tok(u.id)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.values.map((v: { key: string }) => v.key)).toContain("family");
    expect(body.questionSets.length).toBe(3);
    expect(body.coachingTips.length).toBeGreaterThan(0);
  });
});

describe("preferences: verifiedOnly / focusMode / dealbreakers", () => {
  it("accepts the new fields and rejects unknown dealbreakers", async () => {
    const u = await createUser({ displayName: "A" });
    const ok = await fastify.inject({
      method: "PATCH",
      url: "/api/v1/preferences/me",
      headers: { authorization: `Bearer ${tok(u.id)}` },
      payload: { verifiedOnly: true, focusMode: true, dealbreakers: ["wants_kids"] },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().verifiedOnly).toBe(true);
    expect(ok.json().dealbreakers).toEqual(["wants_kids"]);

    const bad = await fastify.inject({
      method: "PATCH",
      url: "/api/v1/preferences/me",
      headers: { authorization: `Bearer ${tok(u.id)}` },
      payload: { dealbreakers: ["not_a_real_key"] },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe("profile: values", () => {
  it("accepts catalog value keys and rejects unknown ones", async () => {
    const u = await createUser({ displayName: "A" });
    const ok = await fastify.inject({
      method: "PATCH",
      url: "/api/v1/profile/me/profile",
      headers: { authorization: `Bearer ${tok(u.id)}` },
      payload: { values: ["family", "growth"] },
    });
    expect(ok.statusCode).toBe(200);

    const bad = await fastify.inject({
      method: "PATCH",
      url: "/api/v1/profile/me/profile",
      headers: { authorization: `Bearer ${tok(u.id)}` },
      payload: { values: ["bogus_value"] },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe("discovery: verifiedOnly filter and focus mode", () => {
  it("verifiedOnly hides unverified candidates", async () => {
    const a = await createUser({ displayName: "A" });
    const verified = await createUser({ displayName: "V" });
    const unverified = await createUser({ displayName: "U" });
    await testPrisma.profile.update({
      where: { userId: verified.id },
      data: { isPhotoVerified: true },
    });
    await testPrisma.preferences.update({
      where: { userId: a.id },
      data: { verifiedOnly: true },
    });
    const deck = await buildDeck({
      prisma: testPrisma,
      viewerUserId: a.id,
      limit: 50,
      deckSessionId: "s",
    });
    const ids = deck.cards.map((c) => c.userId);
    expect(ids).toContain(verified.id);
    expect(ids).not.toContain(unverified.id);
  });

  it("focus mode returns an empty deck", async () => {
    const a = await createUser({ displayName: "A" });
    await createUser({ displayName: "B" });
    await testPrisma.preferences.update({ where: { userId: a.id }, data: { focusMode: true } });
    const deck = await buildDeck({
      prisma: testPrisma,
      viewerUserId: a.id,
      limit: 50,
      deckSessionId: "s",
    });
    expect(deck.cards).toEqual([]);
  });
});

describe("date feedback (#1/#11)", () => {
  it("submits feedback and lists pending matches", async () => {
    const a = await createUser({ displayName: "A" });
    const b = await createUser({ displayName: "B" });
    // Backdate the match so it's feedback-eligible (>3 days old).
    const old = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const { match } = await makeMatch(a.id, b.id, old);

    const pending = await fastify.inject({
      method: "GET",
      url: "/api/v1/date-feedback/pending",
      headers: { authorization: `Bearer ${tok(a.id)}` },
    });
    expect(pending.json().items.map((i: { matchId: string }) => i.matchId)).toContain(match.id);

    const sub = await fastify.inject({
      method: "POST",
      url: `/api/v1/date-feedback/${match.id}`,
      headers: { authorization: `Bearer ${tok(a.id)}` },
      payload: { met: true, wantToContinue: true, respectful: true, matchedProfile: true },
    });
    expect(sub.statusCode).toBe(200);

    // Now no longer pending for A.
    const pending2 = await fastify.inject({
      method: "GET",
      url: "/api/v1/date-feedback/pending",
      headers: { authorization: `Bearer ${tok(a.id)}` },
    });
    expect(pending2.json().items.map((i: { matchId: string }) => i.matchId)).not.toContain(
      match.id,
    );
  });

  it("rejects a non-participant", async () => {
    const a = await createUser({ displayName: "A" });
    const b = await createUser({ displayName: "B" });
    const c = await createUser({ displayName: "C" });
    const { match } = await makeMatch(a.id, b.id);
    const res = await fastify.inject({
      method: "POST",
      url: `/api/v1/date-feedback/${match.id}`,
      headers: { authorization: `Bearer ${tok(c.id)}` },
      payload: { met: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it("negative 'not respectful' feedback files a report into the safety pipeline", async () => {
    const a = await createUser({ displayName: "A" });
    const b = await createUser({ displayName: "B" });
    const { match } = await makeMatch(a.id, b.id);
    await fastify.inject({
      method: "POST",
      url: `/api/v1/date-feedback/${match.id}`,
      headers: { authorization: `Bearer ${tok(a.id)}` },
      payload: { met: true, respectful: false },
    });
    const report = await testPrisma.report.findFirst({
      where: { reporterUserId: a.id, reportedUserId: b.id },
    });
    expect(report).toBeTruthy();
  });
});

describe("chat: awaiting-reply nudge (#7)", () => {
  it("lists conversations where it's the viewer's turn", async () => {
    const a = await createUser({ displayName: "A" });
    const b = await createUser({ displayName: "B" });
    const { match, convo } = await makeMatch(a.id, b.id);
    // B sent the last message 1 day ago → it's A's turn.
    await testPrisma.conversation.update({
      where: { id: convo.id },
      data: {
        lastMessageSenderUserId: b.id,
        lastMessageAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });
    const res = await fastify.inject({
      method: "GET",
      url: "/api/v1/conversations/awaiting-reply",
      headers: { authorization: `Bearer ${tok(a.id)}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items.map((i: { matchId: string }) => i.matchId)).toContain(match.id);

    // For B (who sent last) it should NOT be awaiting their reply.
    const resB = await fastify.inject({
      method: "GET",
      url: "/api/v1/conversations/awaiting-reply",
      headers: { authorization: `Bearer ${tok(b.id)}` },
    });
    expect(resB.json().items.map((i: { matchId: string }) => i.matchId)).not.toContain(match.id);
  });
});
