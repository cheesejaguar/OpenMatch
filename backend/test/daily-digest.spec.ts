import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildDailyDigest, runDailyDigestOnce } from "../src/workers/daily-digest.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

// MON-1 — daily digest worker.
//
// Round C — for the counting test we explicitly pass an `asOf` that
// sits one minute in the future of every row we just inserted. That
// guarantees the 24h window is `[asOf - 24h, asOf)` regardless of any
// drift between the Postgres clock and the JS clock.

describe("daily digest", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("counts signups, matches, messages, reports, deletions in the last 24h", async () => {
    const a = await createUser({ displayName: "A" });
    const b = await createUser({ displayName: "B" });
    // Match + message in the window.
    const match = await testPrisma.match.create({
      data: { userAId: a.id, userBId: b.id, status: "active" },
    });
    const convo = await testPrisma.conversation.create({
      data: { matchId: match.id, status: "active" },
    });
    await testPrisma.message.create({
      data: { conversationId: convo.id, senderUserId: a.id, body: "hi" },
    });
    await testPrisma.report.create({
      data: {
        reporterUserId: a.id,
        reportedUserId: b.id,
        reason: "harassment",
        status: "open",
      },
    });
    await testPrisma.accountDeletionRequest.create({
      data: {
        userId: b.id,
        gracePeriodEndsAt: new Date(Date.now() + 86_400_000),
        status: "scheduled",
      },
    });

    // Pull "real Postgres now + 1 minute" so the window strictly
    // includes every row we just inserted (avoids JS clock skew vs
    // Postgres clock breaking the window boundary).
    const [{ now: pgNow }] = await testPrisma.$queryRaw<{ now: Date }[]>`SELECT NOW() AS now`;
    const asOf = new Date(pgNow.getTime() + 60_000);
    const digest = await buildDailyDigest(testPrisma, asOf);
    expect(digest.signupsToday).toBe(2);
    expect(digest.matchesToday).toBe(1);
    expect(digest.messagesToday).toBe(1);
    expect(digest.reportsToday).toBe(1);
    expect(digest.deletionRequestsToday).toBe(1);
    expect(digest.activeUsersTotal).toBeGreaterThanOrEqual(2);
  });

  it("computes oldest-report age in hours", async () => {
    const a = await createUser({ displayName: "A" });
    const b = await createUser({ displayName: "B" });
    const old = new Date(Date.now() - 5 * 3600_000);
    await testPrisma.report.create({
      data: {
        reporterUserId: a.id,
        reportedUserId: b.id,
        reason: "harassment",
        status: "open",
        createdAt: old,
      },
    });
    const digest = await buildDailyDigest(testPrisma);
    expect(digest.oldestReportAgeHours).not.toBeNull();
    expect(digest.oldestReportAgeHours!).toBeGreaterThan(4.5);
    expect(digest.oldestReportAgeHours!).toBeLessThan(6);
  });

  it("runs without crashing when SMTP isn't configured", async () => {
    const out = await runDailyDigestOnce(testPrisma);
    expect(out.emailed).toBe(false);
    expect(out.digest.windowStart).toBeDefined();
    expect(out.digest.windowEnd).toBeDefined();
  });
});
