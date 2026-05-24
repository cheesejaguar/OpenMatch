import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { __clearMatchingPresetsCache } from "../src/lib/matching-presets.js";
import { buildServer } from "../src/server.js";
import { buildDeck } from "../src/services/discovery.service.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

const app = await buildServer();
const fastify = app;

afterAll(async () => {
  await fastify.close();
  await testPrisma.$disconnect();
});

async function seedPreset(data: {
  key: string;
  strategyId: string;
  weights?: Record<string, number>;
  isDefault?: boolean;
}) {
  return testPrisma.matchingPreset.create({
    data: {
      key: data.key,
      label: data.key,
      description: "test",
      strategyId: data.strategyId,
      weights: data.weights ?? {},
      enabled: true,
      isDefault: data.isDefault ?? false,
      sortOrder: 0,
    },
  });
}

describe("preferences matching-preset endpoints", () => {
  beforeEach(async () => {
    __clearMatchingPresetsCache();
    await resetDb();
  });

  it("lists enabled presets (falls back to built-ins when catalog empty)", async () => {
    const user = await createUser({ displayName: "A" });
    const token = fastify.jwt.sign({ sub: user.id, scope: "user" });
    const res = await fastify.inject({
      method: "GET",
      url: "/api/v1/preferences/matching-presets",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.defaultKey).toBe("balanced");
    expect(body.presets.map((p: { key: string }) => p.key)).toContain("nearby-first");
  });

  it("accepts a valid discoveryPresetKey and rejects an invalid one", async () => {
    const user = await createUser({ displayName: "A" });
    await seedPreset({ key: "serious-intent", strategyId: "reciprocal", isDefault: true });
    __clearMatchingPresetsCache();
    const token = fastify.jwt.sign({ sub: user.id, scope: "user" });

    const ok = await fastify.inject({
      method: "PATCH",
      url: "/api/v1/preferences/me",
      headers: { authorization: `Bearer ${token}` },
      payload: { discoveryPresetKey: "serious-intent" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().discoveryPresetKey).toBe("serious-intent");

    const bad = await fastify.inject({
      method: "PATCH",
      url: "/api/v1/preferences/me",
      headers: { authorization: `Bearer ${token}` },
      payload: { discoveryPresetKey: "does-not-exist" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("allows clearing the selection with null", async () => {
    const user = await createUser({ displayName: "A" });
    const token = fastify.jwt.sign({ sub: user.id, scope: "user" });
    const res = await fastify.inject({
      method: "PATCH",
      url: "/api/v1/preferences/me",
      headers: { authorization: `Bearer ${token}` },
      payload: { discoveryPresetKey: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().discoveryPresetKey).toBeNull();
  });
});

describe("discovery honors the selected preset", () => {
  beforeEach(async () => {
    __clearMatchingPresetsCache();
    await resetDb();
  });

  it("uses the strategy pinned by the viewer's selected preset", async () => {
    const a = await createUser({ displayName: "A" });
    await createUser({ displayName: "B" });
    await seedPreset({ key: "serious-intent", strategyId: "reciprocal", isDefault: false });
    await testPrisma.preferences.update({
      where: { userId: a.id },
      data: { discoveryPresetKey: "serious-intent" },
    });
    __clearMatchingPresetsCache();

    const deck = await buildDeck({
      prisma: testPrisma,
      viewerUserId: a.id,
      limit: 10,
      deckSessionId: "s",
    });
    expect(deck.strategyId).toBe("reciprocal");
  });

  it("falls back to the default strategy when no preset is selected", async () => {
    const a = await createUser({ displayName: "A" });
    await createUser({ displayName: "B" });
    __clearMatchingPresetsCache();
    const deck = await buildDeck({
      prisma: testPrisma,
      viewerUserId: a.id,
      limit: 10,
      deckSessionId: "s",
    });
    expect(deck.strategyId).toBe("weighted-sum");
  });
});
