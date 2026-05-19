import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import ratelimitPlugin from "../src/plugins/ratelimit.js";
import { waitlistRoutes } from "../src/routes/waitlist.js";
import { resetDb, testPrisma } from "./helpers/db.js";

// BETA-3 — public waitlist endpoint.

async function buildWaitlistApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate("prisma", testPrisma);
  await app.register(ratelimitPlugin);
  await app.register(waitlistRoutes, { prefix: "/api/v1/waitlist" });
  return app;
}

describe("waitlist endpoint", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("accepts a submission and returns a position", async () => {
    const app = await buildWaitlistApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/waitlist/",
        payload: { email: "alice@example.com", country: "US", city: "Seattle" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { position: number };
      expect(body.position).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("is idempotent for the same email", async () => {
    const app = await buildWaitlistApp();
    try {
      const a = await app.inject({
        method: "POST",
        url: "/api/v1/waitlist/",
        payload: { email: "bob@example.com" },
      });
      expect(a.statusCode).toBe(200);
      const b = await app.inject({
        method: "POST",
        url: "/api/v1/waitlist/",
        payload: { email: "BOB@EXAMPLE.com" },
      });
      expect(b.statusCode).toBe(200);
      const rows = await testPrisma.waitlistEntry.findMany();
      expect(rows).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("rejects invalid emails", async () => {
    const app = await buildWaitlistApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/waitlist/",
        payload: { email: "not-an-email" },
      });
      expect(res.statusCode).toBe(500); // zod throws → 500 via the route's parse
    } finally {
      await app.close();
    }
  });
});
