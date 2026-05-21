import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  decideSelfieVerification,
  generateNonce,
  pickPosePrompt,
  startSelfieVerification,
} from "../src/services/verification.service.js";
import { createAdmin, createUser, resetDb, testPrisma } from "./helpers/db.js";

// Trust & safety automation — verification service integration test.
// Real Postgres; exercises the (start → submit nonce roll → admin
// decide → User.isAgeVerified + Profile.isPhotoVerified flip) chain.

describe("verification service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  describe("pickPosePrompt", () => {
    it("returns a non-empty prompt for any seed", () => {
      for (let i = 0; i < 16; i++) {
        const p = pickPosePrompt(i);
        expect(p.length).toBeGreaterThan(5);
      }
    });

    it("is stable for a given seed", () => {
      expect(pickPosePrompt(0)).toBe(pickPosePrompt(0));
    });
  });

  describe("generateNonce", () => {
    it("produces a base64url string ≥ 24 chars", () => {
      const n = generateNonce();
      expect(n.length).toBeGreaterThanOrEqual(24);
      expect(n).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("does not collide across 1000 calls", () => {
      const set = new Set<string>();
      for (let i = 0; i < 1000; i++) set.add(generateNonce());
      expect(set.size).toBe(1000);
    });
  });

  describe("startSelfieVerification", () => {
    it("creates a pending row with a fresh challenge nonce", async () => {
      const u = await createUser();
      const r = await startSelfieVerification({ prisma: testPrisma, userId: u.id });
      expect(r.requestId).toBeDefined();
      expect(r.challengeNonce).toBeDefined();
      expect(r.challengePrompt.length).toBeGreaterThan(0);
      const row = await testPrisma.verificationRequest.findUnique({
        where: { id: r.requestId },
      });
      expect(row?.status).toBe("pending");
      expect(row?.userId).toBe(u.id);
    });

    it("expires older pending rows when a new one is requested", async () => {
      const u = await createUser();
      const first = await startSelfieVerification({ prisma: testPrisma, userId: u.id });
      const second = await startSelfieVerification({ prisma: testPrisma, userId: u.id });
      const firstRow = await testPrisma.verificationRequest.findUnique({
        where: { id: first.requestId },
      });
      const secondRow = await testPrisma.verificationRequest.findUnique({
        where: { id: second.requestId },
      });
      expect(firstRow?.status).toBe("expired");
      expect(secondRow?.status).toBe("pending");
    });
  });

  describe("decideSelfieVerification", () => {
    it("flips isAgeVerified + isPhotoVerified on approval", async () => {
      const u = await createUser();
      const admin = await createAdmin();
      const start = await startSelfieVerification({ prisma: testPrisma, userId: u.id });

      const r = await decideSelfieVerification({
        prisma: testPrisma,
        requestId: start.requestId,
        adminUserId: admin.id,
        decision: "approved",
        decisionNote: "looks good",
      });
      expect(r).toEqual({ ok: true, userId: u.id });

      const refreshed = await testPrisma.user.findUnique({ where: { id: u.id } });
      expect(refreshed?.isAgeVerified).toBe(true);

      const profile = await testPrisma.profile.findUnique({ where: { userId: u.id } });
      expect(profile?.isPhotoVerified).toBe(true);
      expect(profile?.verificationStatus).toBe("verified");

      const req = await testPrisma.verificationRequest.findUnique({
        where: { id: start.requestId },
      });
      expect(req?.status).toBe("approved");
      expect(req?.reviewerAdminUserId).toBe(admin.id);
    });

    it("does not flip verified flags on rejection", async () => {
      const u = await createUser();
      const admin = await createAdmin();
      const start = await startSelfieVerification({ prisma: testPrisma, userId: u.id });

      const r = await decideSelfieVerification({
        prisma: testPrisma,
        requestId: start.requestId,
        adminUserId: admin.id,
        decision: "rejected",
      });
      expect(r).toEqual({ ok: true, userId: u.id });

      const profile = await testPrisma.profile.findUnique({ where: { userId: u.id } });
      expect(profile?.isPhotoVerified).toBe(false);
    });

    it("refuses to decide an already-decided request", async () => {
      const u = await createUser();
      const admin = await createAdmin();
      const start = await startSelfieVerification({ prisma: testPrisma, userId: u.id });
      await decideSelfieVerification({
        prisma: testPrisma,
        requestId: start.requestId,
        adminUserId: admin.id,
        decision: "approved",
      });
      const r2 = await decideSelfieVerification({
        prisma: testPrisma,
        requestId: start.requestId,
        adminUserId: admin.id,
        decision: "rejected",
      });
      expect(r2).toEqual({ ok: false, reason: "already_decided" });
    });

    it("returns not_found for an unknown request", async () => {
      const admin = await createAdmin();
      const r = await decideSelfieVerification({
        prisma: testPrisma,
        requestId: "missing",
        adminUserId: admin.id,
        decision: "approved",
      });
      expect(r).toEqual({ ok: false, reason: "not_found" });
    });
  });
});
