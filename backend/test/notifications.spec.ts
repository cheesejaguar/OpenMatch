import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import authPlugin from "../src/plugins/auth.js";
import ratelimitPlugin from "../src/plugins/ratelimit.js";
import { notificationsRoutes } from "../src/routes/notifications.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

async function build(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate("prisma", testPrisma);
  await app.register(authPlugin);
  await app.register(ratelimitPlugin);
  await app.register(notificationsRoutes, { prefix: "/api/v1/notifications" });
  return app;
}

function bearer(userId: string, app: FastifyInstance): string {
  const token = app.jwt.sign({ sub: userId, scope: "user" });
  return `Bearer ${token}`;
}

describe("POST /api/v1/notifications/device-token", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("upserts a NotificationDevice row idempotently", async () => {
    const app = await build();
    try {
      const u = await createUser();
      const token = "a".repeat(64);

      const first = await app.inject({
        method: "POST",
        url: "/api/v1/notifications/device-token",
        headers: { authorization: bearer(u.id, app) },
        payload: { platform: "ios", token, appVersion: "0.1.0", osVersion: "iOS 18.4" },
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: "POST",
        url: "/api/v1/notifications/device-token",
        headers: { authorization: bearer(u.id, app) },
        payload: { platform: "ios", token, appVersion: "0.1.1", osVersion: "iOS 18.4" },
      });
      expect(second.statusCode).toBe(200);

      const rows = await testPrisma.notificationDevice.findMany({ where: { userId: u.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.appVersion).toBe("0.1.1");
    } finally {
      await app.close();
    }
  });

  it("rejects unauthenticated requests", async () => {
    const app = await build();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/notifications/device-token",
        payload: { platform: "ios", token: "x" },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
