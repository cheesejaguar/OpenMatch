import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { _resetReadyCacheForTests, healthRoutes } from "../src/routes/health.js";
import { resetDb, testPrisma } from "./helpers/db.js";

// OPS-5 — /ready endpoint.
//
// Coverage:
//   - happy path: postgres up, ably/redis unconfigured → ok=true, 200
//   - postgres failure: ok=false, 503
//   - response is cached for 5s

async function build(prisma: unknown): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate("prisma", prisma);
  app.decorate("redis", null);
  await app.register(healthRoutes);
  return app;
}

describe("/ready", () => {
  beforeEach(async () => {
    await resetDb();
    _resetReadyCacheForTests();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("returns 200 + ok=true when postgres is reachable and other deps are unconfigured", async () => {
    const app = await build(testPrisma);
    try {
      const res = await app.inject({ method: "GET", url: "/ready" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        ok: boolean;
        checks: {
          postgres: { ok: boolean; configured: boolean; latencyMs?: number };
          ably: { ok: boolean; configured: boolean };
          redis: { ok: boolean; configured: boolean };
        };
      };
      expect(body.ok).toBe(true);
      expect(body.checks.postgres.ok).toBe(true);
      expect(body.checks.postgres.configured).toBe(true);
      // ABLY_API_KEY and Upstash creds are not set in the test env.
      expect(body.checks.ably.configured).toBe(false);
      expect(body.checks.redis.configured).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("returns 503 when postgres simulated down", async () => {
    // Inject a stub prisma that throws on $queryRawUnsafe.
    const stub = {
      $queryRawUnsafe: async () => {
        throw new Error("connection refused");
      },
    } as unknown;
    const app = await build(stub);
    try {
      const res = await app.inject({ method: "GET", url: "/ready" });
      expect(res.statusCode).toBe(503);
      const body = res.json() as { ok: boolean; checks: { postgres: { ok: boolean } } };
      expect(body.ok).toBe(false);
      expect(body.checks.postgres.ok).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("caches the snapshot across rapid calls", async () => {
    let calls = 0;
    const stub = {
      $queryRawUnsafe: async () => {
        calls += 1;
        return [{ "?column?": 1 }];
      },
    } as unknown;
    const app = await build(stub);
    try {
      await app.inject({ method: "GET", url: "/ready" });
      await app.inject({ method: "GET", url: "/ready" });
      await app.inject({ method: "GET", url: "/ready" });
      // Three requests, but the dependency probe should only run once
      // within the 5s cache window.
      expect(calls).toBe(1);
    } finally {
      await app.close();
    }
  });
});
