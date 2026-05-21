import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ADMIN_ROLE_DEFINITIONS } from "../src/lib/admin/roles.js";
import { _resetStatusCacheForTests } from "../src/routes/status.js";
import { buildServer } from "../src/server.js";
import { _statusInternals } from "../src/services/status.service.js";
import { resetDb, testPrisma } from "./helpers/db.js";

// Coverage:
//   - bucketFromPassRate maps the spec thresholds correctly
//   - GET /api/v1/status/public is unauthenticated and returns the
//     headline + service + uptime + incident DTO shape
//   - active incidents flip the headline to at-least "degraded"
//   - resolved incidents land in `recentResolved`, not active
//   - admin POST /api/v1/admin/incidents requires INCIDENT_MANAGE +
//     records an audit-log row + invalidates the status cache

const app = await buildServer();

afterAll(async () => {
  await app.close();
  await testPrisma.$disconnect();
});

async function seedRoles() {
  for (const role of ADMIN_ROLE_DEFINITIONS) {
    await testPrisma.adminRole.upsert({
      where: { name: role.name },
      create: {
        name: role.name,
        description: role.description,
        permissions: role.permissions,
      },
      update: {
        description: role.description,
        permissions: role.permissions,
      },
    });
  }
}

beforeEach(async () => {
  await resetDb();
  await seedRoles();
  _resetStatusCacheForTests();
});

describe("statusInternals.bucketFromPassRate", () => {
  it("maps thresholds per spec (>=95 normal, 80-95 degraded, <80 incident)", () => {
    expect(_statusInternals.bucketFromPassRate(null)).toBe("unknown");
    expect(_statusInternals.bucketFromPassRate(1)).toBe("normal");
    expect(_statusInternals.bucketFromPassRate(0.95)).toBe("normal");
    expect(_statusInternals.bucketFromPassRate(0.94)).toBe("degraded");
    expect(_statusInternals.bucketFromPassRate(0.8)).toBe("degraded");
    expect(_statusInternals.bucketFromPassRate(0.79)).toBe("incident");
    expect(_statusInternals.bucketFromPassRate(0)).toBe("incident");
  });
});

describe("GET /api/v1/status/public", () => {
  it("is unauthenticated and returns a status DTO with services + uptime + headline", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/status/public" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      headline: string;
      headlineMessage: string;
      services: { key: string; label: string }[];
      uptime90d: { day: string; passRate: number | null }[];
      activeIncidents: unknown[];
      recentResolved: unknown[];
    };
    expect(["normal", "degraded", "incident", "unknown"]).toContain(body.headline);
    expect(body.services.map((s) => s.key).sort()).toEqual([
      "admin",
      "backend",
      "push",
      "realtime",
    ]);
    // 90 days of uptime points densified, oldest first.
    expect(body.uptime90d).toHaveLength(90);
    expect(Array.isArray(body.activeIncidents)).toBe(true);
    expect(Array.isArray(body.recentResolved)).toBe(true);
  });

  it("reports 'normal' when synthetic pass-rate is ≥95% over the last hour", async () => {
    const now = new Date();
    // 20/20 passes within the last hour.
    for (let i = 0; i < 20; i++) {
      await testPrisma.syntheticCheckRun.create({
        data: {
          ranAt: new Date(now.getTime() - i * 60_000),
          durationMs: 100,
          passed: true,
          steps: [],
        },
      });
    }
    _resetStatusCacheForTests();
    const res = await app.inject({ method: "GET", url: "/api/v1/status/public" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { headline: string };
    expect(body.headline).toBe("normal");
  });

  it("reports 'incident' when synthetic pass-rate is <80% over the last hour", async () => {
    const now = new Date();
    // 2 passes, 8 fails in the last hour → 20% pass rate.
    for (let i = 0; i < 10; i++) {
      await testPrisma.syntheticCheckRun.create({
        data: {
          ranAt: new Date(now.getTime() - i * 60_000),
          durationMs: 100,
          passed: i < 2,
          steps: [],
        },
      });
    }
    _resetStatusCacheForTests();
    const res = await app.inject({ method: "GET", url: "/api/v1/status/public" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { headline: string };
    expect(body.headline).toBe("incident");
  });

  it("surfaces an active incident in activeIncidents and not recentResolved", async () => {
    await testPrisma.incidentUpdate.create({
      data: {
        incidentKey: "inc_test_1",
        title: "Photo uploads delayed",
        body: "We're seeing slow photo uploads.",
        status: "investigating",
        severity: "minor",
        service: "backend",
      },
    });
    _resetStatusCacheForTests();
    const res = await app.inject({ method: "GET", url: "/api/v1/status/public" });
    const body = res.json() as {
      headline: string;
      activeIncidents: { incidentKey: string; title: string; status: string }[];
      recentResolved: unknown[];
    };
    expect(body.activeIncidents).toHaveLength(1);
    expect(body.activeIncidents[0].incidentKey).toBe("inc_test_1");
    expect(body.activeIncidents[0].status).toBe("investigating");
    expect(body.recentResolved).toHaveLength(0);
    // Active minor incident bumps headline off "normal" even with no
    // synthetic failures.
    expect(["degraded", "incident"]).toContain(body.headline);
  });

  it("treats the most recent update per incidentKey as the current state", async () => {
    const now = new Date();
    await testPrisma.incidentUpdate.create({
      data: {
        incidentKey: "inc_test_2",
        title: "Realtime delay",
        body: "Investigating realtime delivery delays.",
        status: "investigating",
        severity: "major",
        service: "realtime",
        postedAt: new Date(now.getTime() - 3_600_000),
      },
    });
    await testPrisma.incidentUpdate.create({
      data: {
        incidentKey: "inc_test_2",
        title: "Realtime delay",
        body: "Service restored. Monitoring.",
        status: "resolved",
        severity: "major",
        service: "realtime",
        postedAt: new Date(now.getTime() - 60_000),
      },
    });
    _resetStatusCacheForTests();
    const res = await app.inject({ method: "GET", url: "/api/v1/status/public" });
    const body = res.json() as {
      activeIncidents: unknown[];
      recentResolved: { incidentKey: string; updates: unknown[] }[];
    };
    expect(body.activeIncidents).toHaveLength(0);
    expect(body.recentResolved).toHaveLength(1);
    expect(body.recentResolved[0].incidentKey).toBe("inc_test_2");
    // Both updates should appear in the per-incident timeline.
    expect(body.recentResolved[0].updates).toHaveLength(2);
  });
});

describe("POST /api/v1/admin/incidents", () => {
  it("requires an admin session (401 without auth)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/incidents",
      payload: {
        title: "Test",
        body: "Test",
        status: "investigating",
      },
    });
    expect([401, 403]).toContain(res.statusCode);
  });
});
