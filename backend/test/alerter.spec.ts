import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  detectAlerts,
  REPORT_QUEUE_AGE_HOURS,
  resolveAlertCondition,
  runAlertCheckOnce,
} from "../src/workers/alerter.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

// MON-2 — alerter worker.

describe("alerter", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("fires report_queue_age when oldest open report > 4h", async () => {
    const a = await createUser();
    const b = await createUser();
    await testPrisma.report.create({
      data: {
        reporterUserId: a.id,
        reportedUserId: b.id,
        reason: "harassment",
        status: "open",
        createdAt: new Date(Date.now() - (REPORT_QUEUE_AGE_HOURS + 1) * 3600_000),
      },
    });
    const candidates = await detectAlerts(testPrisma);
    expect(candidates.some((c) => c.kind === "report_queue_age")).toBe(true);
  });

  it("does not fire below thresholds", async () => {
    const candidates = await detectAlerts(testPrisma);
    expect(candidates).toHaveLength(0);
  });

  it("dedupes a repeat alert within a single resolved cycle", async () => {
    const a = await createUser();
    const b = await createUser();
    await testPrisma.report.create({
      data: {
        reporterUserId: a.id,
        reportedUserId: b.id,
        reason: "harassment",
        status: "open",
        createdAt: new Date(Date.now() - 5 * 3600_000),
      },
    });
    const first = await runAlertCheckOnce(testPrisma);
    expect(first.fired).toBeGreaterThan(0);
    const second = await runAlertCheckOnce(testPrisma);
    expect(second.fired).toBe(0);
    expect(second.suppressed).toBeGreaterThan(0);
    // After resolution, the alert can fire again on the next check.
    await resolveAlertCondition(testPrisma, "report_queue_age");
    const third = await runAlertCheckOnce(testPrisma);
    expect(third.fired).toBeGreaterThan(0);
  });

  it("fires error_rate_5m when 5xx share exceeds threshold", async () => {
    // Seed >20 events with >5% error share.
    for (let i = 0; i < 15; i++) {
      await testPrisma.analyticsEvent.create({ data: { eventName: "ok.event" } });
    }
    for (let i = 0; i < 10; i++) {
      await testPrisma.analyticsEvent.create({ data: { eventName: "error.something" } });
    }
    const candidates = await detectAlerts(testPrisma);
    expect(candidates.some((c) => c.kind === "error_rate_5m")).toBe(true);
  });
});
