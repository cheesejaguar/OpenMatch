import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { acknowledgeNotice, decideNotice, openNotice } from "../src/services/dsa.service.js";
import { runDsaSlaCheckOnce } from "../src/workers/dsa-sla.js";
import { resetDb, testPrisma } from "./helpers/db.js";

// SAFE-4 — DSA Art. 16 SLA tracking.
//
// Coverage:
//   - opening a notice populates slaAckDueAt + slaDecisionDueAt
//   - sla-check before deadlines: no breach recorded
//   - sla-check after deadlines with no ack: breach recorded once,
//     idempotent on re-run (no duplicate audit rows)
//   - acknowledging stops the ack-SLA clock; deciding stops the
//     decision clock.

describe("DSA SLA worker", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("populates ack + decision deadlines on notice creation", async () => {
    const before = Date.now();
    const ticket = await openNotice(testPrisma, {
      category: "illegal_content",
      reporterIsUser: false,
      contentReference: "user:abc",
      description: "test",
      isInGoodFaith: true,
    });
    expect(ticket.slaAckDueAt).toBeInstanceOf(Date);
    expect(ticket.slaDecisionDueAt).toBeInstanceOf(Date);
    // 24h ack, 48h decision — generous tolerance for clock skew.
    const ackOffset = (ticket.slaAckDueAt!.getTime() - before) / (3600 * 1000);
    const decOffset = (ticket.slaDecisionDueAt!.getTime() - before) / (3600 * 1000);
    expect(ackOffset).toBeGreaterThan(23.9);
    expect(ackOffset).toBeLessThan(24.1);
    expect(decOffset).toBeGreaterThan(47.9);
    expect(decOffset).toBeLessThan(48.1);
  });

  it("records no breach before the deadlines", async () => {
    await openNotice(testPrisma, {
      category: "ncii",
      reporterIsUser: false,
      contentReference: "user:abc",
      description: "test",
      isInGoodFaith: true,
    });
    const report = await runDsaSlaCheckOnce(testPrisma);
    expect(report.ackBreached).toBe(0);
    expect(report.decisionBreached).toBe(0);
  });

  it("records ack + decision breaches once when deadlines pass", async () => {
    const ticket = await openNotice(testPrisma, {
      category: "illegal_content",
      reporterIsUser: false,
      contentReference: "user:abc",
      description: "test",
      isInGoodFaith: true,
    });
    // Fast-forward both deadlines into the past.
    await testPrisma.noticeAndActionReport.update({
      where: { id: ticket.id },
      data: {
        slaAckDueAt: new Date(Date.now() - 60_000),
        slaDecisionDueAt: new Date(Date.now() - 60_000),
      },
    });
    const report = await runDsaSlaCheckOnce(testPrisma);
    expect(report.ackBreached).toBe(1);
    expect(report.decisionBreached).toBe(1);

    const fresh = await testPrisma.noticeAndActionReport.findUnique({ where: { id: ticket.id } });
    expect(fresh?.slaAckBreachedAt).toBeInstanceOf(Date);
    expect(fresh?.slaDecisionBreachedAt).toBeInstanceOf(Date);

    // Re-run: must not double-record.
    const second = await runDsaSlaCheckOnce(testPrisma);
    expect(second.ackBreached).toBe(0);
    expect(second.decisionBreached).toBe(0);
  });

  it("acknowledgement and decision update the right timestamps", async () => {
    const admin = await testPrisma.adminUser.create({
      data: { email: `admin-dsa-${Date.now()}@openmatch.local`, displayName: "DSA Admin" },
    });
    const ticket = await openNotice(testPrisma, {
      category: "scam_fraud",
      reporterIsUser: false,
      contentReference: "user:abc",
      description: "test",
      isInGoodFaith: true,
    });
    const acked = await acknowledgeNotice(testPrisma, ticket.id, admin.id);
    expect(acked.acknowledgedAt).toBeInstanceOf(Date);
    expect(acked.acknowledgedByAdminUserId).toBe(admin.id);

    const decided = await decideNotice(testPrisma, ticket.id, admin.id, "actioned");
    expect(decided.status).toBe("actioned");
    expect(decided.respondedAt).toBeInstanceOf(Date);
    expect(decided.decidedByAdminUserId).toBe(admin.id);

    // Run the SLA checker after the deadlines pass — neither breach
    // should fire because both timestamps are recorded.
    await testPrisma.noticeAndActionReport.update({
      where: { id: ticket.id },
      data: {
        slaAckDueAt: new Date(Date.now() - 60_000),
        slaDecisionDueAt: new Date(Date.now() - 60_000),
      },
    });
    const report = await runDsaSlaCheckOnce(testPrisma);
    expect(report.ackBreached).toBe(0);
    expect(report.decisionBreached).toBe(0);
  });
});
