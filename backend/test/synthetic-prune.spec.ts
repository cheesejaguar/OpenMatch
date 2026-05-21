import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../src/env.js";
import ratelimitPlugin from "../src/plugins/ratelimit.js";
import {
  internalSyntheticRoutes,
  runSyntheticPruneOnce,
  SYNTHETIC_PRUNE_RETENTION_DAYS,
} from "../src/routes/internal/synthetic.js";
import { resetDb, testPrisma } from "./helpers/db.js";

// PERF-X9 — synthetic-check audit-table prune.
//
// Coverage:
//   - rows older than the retention window are deleted
//   - rows inside the window are retained
//   - bearer-token gate on the POST /run-synthetic-prune endpoint
//   - idempotent: a second run on the same table is a no-op

async function buildInternalApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate("prisma", testPrisma);
  await app.register(ratelimitPlugin);
  await app.register(internalSyntheticRoutes, { prefix: "/api/v1/internal" });
  return app;
}

async function seedRow(daysAgo: number, passed = true): Promise<void> {
  await testPrisma.syntheticCheckRun.create({
    data: {
      ranAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      durationMs: 42,
      passed,
      steps: [{ name: "ready", passed }] as never,
    },
  });
}

describe("synthetic prune worker", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("deletes rows older than the retention window and keeps fresh ones", async () => {
    // Two well past the cutoff, two well inside it.
    await seedRow(SYNTHETIC_PRUNE_RETENTION_DAYS + 5);
    await seedRow(SYNTHETIC_PRUNE_RETENTION_DAYS + 90);
    await seedRow(1);
    await seedRow(15);

    const report = await runSyntheticPruneOnce(testPrisma);

    expect(report.deleted).toBe(2);
    expect(typeof report.cutoff).toBe("string");
    expect(report.durationMs).toBeGreaterThanOrEqual(0);

    const remaining = await testPrisma.syntheticCheckRun.findMany({
      orderBy: { ranAt: "asc" },
    });
    expect(remaining).toHaveLength(2);
    const cutoff = new Date(report.cutoff).getTime();
    for (const row of remaining) {
      expect(row.ranAt.getTime()).toBeGreaterThanOrEqual(cutoff);
    }
  });

  it("is a no-op on an already-pruned table", async () => {
    await seedRow(1);
    await seedRow(2);

    const first = await runSyntheticPruneOnce(testPrisma);
    expect(first.deleted).toBe(0);

    const second = await runSyntheticPruneOnce(testPrisma);
    expect(second.deleted).toBe(0);

    expect(await testPrisma.syntheticCheckRun.count()).toBe(2);
  });

  it("respects a custom retention window argument", async () => {
    await seedRow(2);
    await seedRow(8);
    await seedRow(20);

    // 7-day window: rows from day 8 and day 20 should be purged.
    const report = await runSyntheticPruneOnce(testPrisma, 7);
    expect(report.deleted).toBe(2);
    expect(await testPrisma.syntheticCheckRun.count()).toBe(1);
  });

  it("rejects HTTP requests without the internal bearer token", async () => {
    const app = await buildInternalApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/internal/run-synthetic-prune",
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("prunes via the bearer-gated HTTP route", async () => {
    await seedRow(SYNTHETIC_PRUNE_RETENTION_DAYS + 1);
    await seedRow(1);

    const app = await buildInternalApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/internal/run-synthetic-prune",
        headers: {
          authorization: `Bearer ${env.INTERNAL_WORKER_TOKEN}`,
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { deleted: number; cutoff: string };
      expect(body.deleted).toBe(1);
      expect(typeof body.cutoff).toBe("string");
    } finally {
      await app.close();
    }

    expect(await testPrisma.syntheticCheckRun.count()).toBe(1);
  });
});
