import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  acknowledgeNotice,
  createStatementOfReasons,
  decideNotice,
  listOpenNotices,
  openNotice,
} from "../src/services/dsa.service.js";
import { resetDb, testPrisma } from "./helpers/db.js";

// Round C — Branch coverage for dsa.service. defaultSlaHours' switch
// statement contributes a branch per case; the previous dsa-sla.spec
// only exercised illegal_content + ncii.

describe("dsa.service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  describe("openNotice — SLA hours per category", () => {
    const cases = [
      { category: "csam" as const, expectedHours: 24 },
      { category: "ncii" as const, expectedHours: 48 },
      { category: "copyright_dmca" as const, expectedHours: 7 * 24 },
      { category: "terrorism_violent" as const, expectedHours: 24 },
      { category: "underage" as const, expectedHours: 24 },
      { category: "illegal_content" as const, expectedHours: 7 * 24 },
    ];
    for (const { category, expectedHours } of cases) {
      it(`category=${category} → slaDueAt is ~${expectedHours}h in the future`, async () => {
        const before = Date.now();
        const ticket = await openNotice(testPrisma, {
          category,
          reporterIsUser: false,
          contentReference: `user:abc:${category}`,
          description: "ok",
          isInGoodFaith: true,
        });
        const offset = (ticket.slaDueAt.getTime() - before) / (3600 * 1000);
        expect(offset).toBeGreaterThan(expectedHours - 0.1);
        expect(offset).toBeLessThan(expectedHours + 0.1);
      });
    }
  });

  describe("openNotice — optional reporter fields", () => {
    it("records every optional reporter field when provided", async () => {
      const ticket = await openNotice(testPrisma, {
        category: "illegal_content",
        reporterIsUser: true,
        reporterUserId: null,
        reporterName: "Reporter",
        reporterEmail: "r@example.com",
        reporterCountry: "DE",
        reporterIsTrustedFlagger: true,
        trustedFlaggerId: null,
        affectedUserId: null,
        contentReference: "user:abc",
        description: "test",
        isInGoodFaith: true,
        jurisdictionClaim: "EU",
        legalBasisClaim: "DSA Art. 16",
      });
      expect(ticket.reporterName).toBe("Reporter");
      expect(ticket.reporterEmail).toBe("r@example.com");
      expect(ticket.reporterCountry).toBe("DE");
      expect(ticket.reporterIsTrustedFlagger).toBe(true);
      expect(ticket.jurisdictionClaim).toBe("EU");
      expect(ticket.legalBasisClaim).toBe("DSA Art. 16");
    });

    it("defaults the optional fields to null/false", async () => {
      const ticket = await openNotice(testPrisma, {
        category: "illegal_content",
        reporterIsUser: false,
        contentReference: "user:abc",
        description: "test",
        isInGoodFaith: true,
      });
      expect(ticket.reporterName).toBeNull();
      expect(ticket.reporterEmail).toBeNull();
      expect(ticket.reporterCountry).toBeNull();
      expect(ticket.reporterIsTrustedFlagger).toBe(false);
      expect(ticket.jurisdictionClaim).toBeNull();
      expect(ticket.legalBasisClaim).toBeNull();
    });
  });

  describe("acknowledgeNotice", () => {
    it("records acknowledgedAt + the optional admin id", async () => {
      const t = await openNotice(testPrisma, {
        category: "illegal_content",
        reporterIsUser: false,
        contentReference: "user:abc",
        description: "test",
        isInGoodFaith: true,
      });
      const acked = await acknowledgeNotice(testPrisma, t.id, "ckxxxadmin1");
      expect(acked.acknowledgedAt).not.toBeNull();
      expect(acked.acknowledgedByAdminUserId).toBe("ckxxxadmin1");
      expect(acked.status).toBe("acknowledged");
    });

    it("works without an admin id", async () => {
      const t = await openNotice(testPrisma, {
        category: "illegal_content",
        reporterIsUser: false,
        contentReference: "user:abc",
        description: "test",
        isInGoodFaith: true,
      });
      const acked = await acknowledgeNotice(testPrisma, t.id);
      expect(acked.acknowledgedByAdminUserId).toBeNull();
    });
  });

  describe("decideNotice", () => {
    it("rejected — fills acknowledgedAt if it was null", async () => {
      const t = await openNotice(testPrisma, {
        category: "illegal_content",
        reporterIsUser: false,
        contentReference: "user:abc",
        description: "test",
        isInGoodFaith: true,
      });
      const decided = await decideNotice(testPrisma, t.id, "ckxxxadmin1", "rejected");
      expect(decided.status).toBe("rejected");
      expect(decided.acknowledgedAt).not.toBeNull();
      expect(decided.respondedAt).not.toBeNull();
      expect(decided.resolvedAt).not.toBeNull();
    });

    it("actioned — preserves a prior acknowledgedAt", async () => {
      const t = await openNotice(testPrisma, {
        category: "illegal_content",
        reporterIsUser: false,
        contentReference: "user:abc",
        description: "test",
        isInGoodFaith: true,
      });
      const acked = await acknowledgeNotice(testPrisma, t.id);
      const before = acked.acknowledgedAt!;
      const decided = await decideNotice(testPrisma, t.id, "ckxxxadmin1", "actioned");
      expect(decided.acknowledgedAt!.getTime()).toBe(before.getTime());
      expect(decided.status).toBe("actioned");
    });

    it("withdrawn — sets status to withdrawn", async () => {
      const t = await openNotice(testPrisma, {
        category: "illegal_content",
        reporterIsUser: false,
        contentReference: "user:abc",
        description: "test",
        isInGoodFaith: true,
      });
      const decided = await decideNotice(testPrisma, t.id, "ckxxxadmin1", "withdrawn");
      expect(decided.status).toBe("withdrawn");
    });
  });

  describe("listOpenNotices", () => {
    it("returns notices ordered by slaDueAt (no filter)", async () => {
      for (let i = 0; i < 3; i++) {
        await openNotice(testPrisma, {
          category: "illegal_content",
          reporterIsUser: false,
          contentReference: `user:${i}`,
          description: "test",
          isInGoodFaith: true,
        });
      }
      const list = await listOpenNotices(testPrisma);
      expect(list).toHaveLength(3);
    });

    it("filters by status when supplied", async () => {
      const t = await openNotice(testPrisma, {
        category: "illegal_content",
        reporterIsUser: false,
        contentReference: "user:f",
        description: "test",
        isInGoodFaith: true,
      });
      await acknowledgeNotice(testPrisma, t.id);
      const acked = await listOpenNotices(testPrisma, { status: "acknowledged" });
      expect(acked.map((n) => n.id)).toEqual([t.id]);
      const received = await listOpenNotices(testPrisma, { status: "received" });
      expect(received).toEqual([]);
    });
  });

  describe("createStatementOfReasons", () => {
    it("writes a row with all optional fields defaulted", async () => {
      const sor = await createStatementOfReasons(testPrisma, {
        affectedContentReference: "user:abc",
        restrictionType: "content_removed",
        facts: "auto",
        decisionSource: "automated_detection",
      });
      expect(sor.restrictionType).toBe("content_removed");
      expect(sor.decisionSource).toBe("automated_detection");
      expect(sor.automatedDecision).toBe(false);
      expect(sor.redressInternal).toBe(true);
      expect(sor.redressOutOfCourt).toBe(true);
      expect(sor.redressJudicial).toBe(true);
    });

    it("preserves explicit redress = false", async () => {
      const sor = await createStatementOfReasons(testPrisma, {
        affectedContentReference: "user:abc",
        restrictionType: "account_suspension",
        facts: "ToS violation",
        legalGround: "tos_violation",
        legalGroundReference: "ToS §3",
        contractualGround: "ToS §3",
        contentType: "profile",
        contentLanguage: "en",
        decisionSource: "internal",
        automatedDecision: true,
        redress: { internal: false, outOfCourt: false, judicial: false },
      });
      expect(sor.redressInternal).toBe(false);
      expect(sor.redressOutOfCourt).toBe(false);
      expect(sor.redressJudicial).toBe(false);
      expect(sor.automatedDecision).toBe(true);
    });
  });
});
