import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import authPlugin from "../src/plugins/auth.js";
import ratelimitPlugin from "../src/plugins/ratelimit.js";
import { chatRoutes } from "../src/routes/chat.js";
import { messagesRoutes } from "../src/routes/messages.js";
import { postMessage } from "../src/services/chat.service.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

// Route-level coverage for the new chat affordances:
//   - POST /conversations/:id/read → bulk read-receipt
//   - POST /conversations/:id/messages/:messageId/read → single read
//   - POST /messages/:id/reactions / DELETE
//
// We run the routes through fastify.inject so the auth + rate-limit
// plugins are exercised end-to-end. Realtime publishes are no-ops when
// ABLY_API_KEY is unset, which matches the test environment.

async function build(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate("prisma", testPrisma);
  await app.register(authPlugin);
  await app.register(ratelimitPlugin);
  await app.register(chatRoutes, { prefix: "/api/v1/conversations" });
  await app.register(messagesRoutes, { prefix: "/api/v1/messages" });
  return app;
}

function bearer(userId: string, app: FastifyInstance): string {
  const token = app.jwt.sign({ sub: userId, scope: "user" });
  return `Bearer ${token}`;
}

async function makeConversationBetween(aId: string, bId: string) {
  const match = await testPrisma.match.create({
    data: { userAId: aId, userBId: bId, status: "active" },
  });
  return testPrisma.conversation.create({
    data: { matchId: match.id, status: "active" },
  });
}

describe("chat read receipts + reactions routes", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("POST /:id/read marks recipient-visible messages read", async () => {
    const app = await build();
    try {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      const convo = await makeConversationBetween(a.id, b.id);
      await postMessage(testPrisma, convo.id, a.id, "ping");

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${convo.id}/read`,
        headers: { authorization: bearer(b.id, app) },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { updated: number };
      expect(body.updated).toBe(1);

      const rows = await testPrisma.message.findMany({
        where: { conversationId: convo.id },
      });
      expect(rows.every((r) => r.readAt !== null)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("POST /:id/read returns 404 for a non-participant", async () => {
    const app = await build();
    try {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      const c = await createUser({ displayName: "C" });
      const convo = await makeConversationBetween(a.id, b.id);
      await postMessage(testPrisma, convo.id, a.id, "ping");

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${convo.id}/read`,
        headers: { authorization: bearer(c.id, app) },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("POST /messages/:id/reactions inserts a reaction and DELETE removes it", async () => {
    const app = await build();
    try {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      const convo = await makeConversationBetween(a.id, b.id);
      const msg = await postMessage(testPrisma, convo.id, a.id, "react me");

      const add = await app.inject({
        method: "POST",
        url: `/api/v1/messages/${msg.id}/reactions`,
        headers: { authorization: bearer(b.id, app) },
        payload: { emoji: "🔥" },
      });
      expect(add.statusCode).toBe(201);

      const afterAdd = await testPrisma.messageReaction.findMany({
        where: { messageId: msg.id },
      });
      expect(afterAdd).toHaveLength(1);

      const remove = await app.inject({
        method: "DELETE",
        url: `/api/v1/messages/${msg.id}/reactions?emoji=${encodeURIComponent("🔥")}`,
        headers: { authorization: bearer(b.id, app) },
      });
      expect(remove.statusCode).toBe(200);
      const afterRemove = await testPrisma.messageReaction.findMany({
        where: { messageId: msg.id },
      });
      expect(afterRemove).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("reactions endpoint forbids a third party", async () => {
    const app = await build();
    try {
      const a = await createUser({ displayName: "A" });
      const b = await createUser({ displayName: "B" });
      const c = await createUser({ displayName: "C" });
      const convo = await makeConversationBetween(a.id, b.id);
      const msg = await postMessage(testPrisma, convo.id, a.id, "private");

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/messages/${msg.id}/reactions`,
        headers: { authorization: bearer(c.id, app) },
        payload: { emoji: "🔥" },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});
