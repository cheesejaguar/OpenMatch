import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import authPlugin from "../src/plugins/auth.js";
import ratelimitPlugin from "../src/plugins/ratelimit.js";
import { feedbackRoutes } from "../src/routes/feedback.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

async function build(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate("prisma", testPrisma);
  await app.register(authPlugin);
  await app.register(ratelimitPlugin);
  await app.register(feedbackRoutes, { prefix: "/api/v1/feedback" });
  return app;
}

function bearer(userId: string, app: FastifyInstance): string {
  const token = app.jwt.sign({ sub: userId, scope: "user" });
  return `Bearer ${token}`;
}

describe("POST /api/v1/feedback", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("persists the feedback row with the user id and version metadata", async () => {
    const app = await build();
    try {
      const u = await createUser();
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/feedback",
        headers: { authorization: bearer(u.id, app) },
        payload: {
          category: "bug",
          body: "The swipe deck flickered when I rotated.",
          appVersion: "0.1.0",
          osVersion: "iOS 18.4",
          deviceModel: "iPhone 16 Pro",
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBeTruthy();

      const row = await testPrisma.betaFeedback.findUnique({ where: { id: body.id } });
      expect(row?.userId).toBe(u.id);
      expect(row?.category).toBe("bug");
      expect(row?.body).toMatch(/swipe deck/);
      expect(row?.appVersion).toBe("0.1.0");
      expect(row?.resolvedAt).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("rejects unauthenticated requests", async () => {
    const app = await build();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/feedback",
        payload: { category: "praise", body: "love it" },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
