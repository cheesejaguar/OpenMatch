import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../src/env.js";
import { buildServer } from "../src/server.js";
import { resetDb, testPrisma } from "./helpers/db.js";

// Round D — synthetic check probe.
//
// Coverage:
//   - bearer-token gate (401 without it)
//   - happy path returns 200 + { passed, steps[4] }
//   - a SyntheticCheckRun audit row is persisted

const app = await buildServer();

afterAll(async () => {
  await app.close();
  await testPrisma.$disconnect();
});

describe("/api/v1/internal/run-synthetic-check", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("rejects requests without the internal bearer token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/internal/run-synthetic-check",
    });
    expect(res.statusCode).toBe(401);
  });

  it("runs the four probe steps and persists a SyntheticCheckRun row", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/internal/run-synthetic-check",
      headers: {
        authorization: `Bearer ${env.INTERNAL_WORKER_TOKEN}`,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      passed: boolean;
      durationMs: number;
      ranAt: string;
      steps: Array<{ name: string; passed: boolean }>;
    };
    expect(body.steps).toHaveLength(4);
    const names = body.steps.map((s) => s.name);
    expect(names).toEqual(["ready", "auth_start", "discovery_deck_gate", "admin_health_snapshot"]);
    // The auth-start step accepts either a real challenge or one of
    // the known gate errors; the discovery step accepts 401 (no auth)
    // OR 200. In a clean test DB without invite gating these should
    // all pass.
    expect(body.steps.every((s) => s.passed)).toBe(true);
    expect(body.passed).toBe(true);

    const rows = await testPrisma.syntheticCheckRun.findMany({
      orderBy: { ranAt: "desc" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.passed).toBe(true);
    expect(rows[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(rows[0]?.steps)).toBe(true);
  });
});
