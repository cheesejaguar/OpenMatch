import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildDailyDigest, runDailyDigestOnce } from "../src/workers/daily-digest.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

// MON-1 — daily digest worker.

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

    const digest = await buildDailyDigest(testPrisma);
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
