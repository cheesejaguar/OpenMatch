import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  isEmailAdminAllowed,
  issueAdminSession,
  revokeAdminSession,
  rotateAdminSession,
  startAdminLogin,
  verifyAdminLogin,
} from "../src/services/admin/auth.service.js";
import { createAdmin, resetDb, testPrisma } from "./helpers/db.js";

// Round C — admin auth service coverage. The dev branches of
// startAdminLogin (auto-provision + open allowlist), the rotation path
// (with and without 2FA preservation), and the revoke path were not
// exercised by the existing admin-2fa spec; this file fills those gaps.

const fakeSign = (adminUserId: string, sessionId?: string): string =>
  `fake.${Buffer.from(JSON.stringify({ adminUserId, sessionId })).toString("base64url")}.sig`;

describe("admin auth service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  describe("isEmailAdminAllowed", () => {
    it("allows any email in non-production when the allowlist is empty", () => {
      // ADMIN_ALLOWED_EMAILS is unset / empty in the test env, NODE_ENV=test,
      // so the function returns true.
      expect(isEmailAdminAllowed("anyone@openmatch.local")).toBe(true);
    });
  });

  describe("startAdminLogin", () => {
    it("returns a real challenge with a devToken in non-production", async () => {
      const result = await startAdminLogin(testPrisma, "admin@openmatch.local");
      expect(result.challengeId).toBeTruthy();
      expect(result.devToken).toBeTruthy();
      expect(result.devToken!.length).toBe(64);
      const challenge = await testPrisma.adminAuthChallenge.findUnique({
        where: { id: result.challengeId },
      });
      expect(challenge).not.toBeNull();
      expect(challenge!.email).toBe("admin@openmatch.local");
    });

    it("returns a fake challenge id (not a real row) for inactive admins", async () => {
      const admin = await createAdmin();
      await testPrisma.adminUser.update({
        where: { id: admin.id },
        data: { status: "disabled" },
      });
      const result = await startAdminLogin(testPrisma, admin.email);
      // We can't tell from the response whether the challenge was real;
      // we just check no real challenge row exists for this email.
      const real = await testPrisma.adminAuthChallenge.findFirst({
        where: { email: admin.email.toLowerCase() },
      });
      expect(real).toBeNull();
      expect(result.challengeId).toBeTruthy();
    });
  });

  describe("verifyAdminLogin", () => {
    it("rejects an unknown challenge id", async () => {
      await expect(
        verifyAdminLogin(testPrisma, "does-not-exist", "deadbeef"),
      ).rejects.toMatchObject({ message: "invalid_challenge" });
    });

    it("rejects an already-consumed challenge", async () => {
      const start = await startAdminLogin(testPrisma, "admin@openmatch.local");
      // First verify consumes the challenge.
      await verifyAdminLogin(testPrisma, start.challengeId, start.devToken!);
      // Second verify must fail.
      await expect(
        verifyAdminLogin(testPrisma, start.challengeId, start.devToken!),
      ).rejects.toMatchObject({ message: "challenge_used" });
    });

    it("rejects a token mismatch with invalid_token", async () => {
      const start = await startAdminLogin(testPrisma, "admin@openmatch.local");
      await expect(
        verifyAdminLogin(testPrisma, start.challengeId, "0".repeat(64)),
      ).rejects.toMatchObject({ message: "invalid_token" });
    });

    it("rejects an expired challenge", async () => {
      const start = await startAdminLogin(testPrisma, "admin@openmatch.local");
      await testPrisma.adminAuthChallenge.update({
        where: { id: start.challengeId },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
      await expect(
        verifyAdminLogin(testPrisma, start.challengeId, start.devToken!),
      ).rejects.toMatchObject({ message: "challenge_expired" });
    });

    it("succeeds on a fresh challenge and updates lastLoginAt", async () => {
      const start = await startAdminLogin(testPrisma, "admin2@openmatch.local");
      const result = await verifyAdminLogin(testPrisma, start.challengeId, start.devToken!);
      expect(result.email).toBe("admin2@openmatch.local");
      const admin = await testPrisma.adminUser.findUnique({
        where: { id: result.adminUserId },
      });
      expect(admin?.lastLoginAt).not.toBeNull();
    });
  });

  describe("issueAdminSession / rotateAdminSession / revokeAdminSession", () => {
    it("issues a session whose refreshToken is hex-64 and persisted hashed", async () => {
      const admin = await createAdmin();
      const tokens = await issueAdminSession(testPrisma, admin.id, fakeSign);
      expect(tokens.refreshToken.length).toBe(64);
      expect(/^[0-9a-f]+$/.test(tokens.refreshToken)).toBe(true);
      const session = await testPrisma.adminSession.findUnique({
        where: { id: tokens.sessionId },
      });
      expect(session).not.toBeNull();
      // Persisted token must be the hash, not the raw value.
      expect(session!.refreshToken).not.toBe(tokens.refreshToken);
    });

    it("rotateAdminSession returns null on unknown token", async () => {
      const out = await rotateAdminSession(testPrisma, "deadbeef".repeat(8), fakeSign);
      expect(out).toBeNull();
    });

    it("rotateAdminSession returns null on expired session", async () => {
      const admin = await createAdmin();
      const tokens = await issueAdminSession(testPrisma, admin.id, fakeSign);
      await testPrisma.adminSession.update({
        where: { id: tokens.sessionId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const out = await rotateAdminSession(testPrisma, tokens.refreshToken, fakeSign);
      expect(out).toBeNull();
    });

    it("rotateAdminSession returns null on already-revoked session", async () => {
      const admin = await createAdmin();
      const tokens = await issueAdminSession(testPrisma, admin.id, fakeSign);
      await testPrisma.adminSession.update({
        where: { id: tokens.sessionId },
        data: { revokedAt: new Date() },
      });
      const out = await rotateAdminSession(testPrisma, tokens.refreshToken, fakeSign);
      expect(out).toBeNull();
    });

    it("rotateAdminSession preserves twoFactorAt across rotation", async () => {
      const admin = await createAdmin();
      const tokens = await issueAdminSession(testPrisma, admin.id, fakeSign);
      const twoFactorAt = new Date();
      await testPrisma.adminSession.update({
        where: { id: tokens.sessionId },
        data: { twoFactorAt },
      });
      const next = await rotateAdminSession(testPrisma, tokens.refreshToken, fakeSign);
      expect(next).not.toBeNull();
      const newSession = await testPrisma.adminSession.findUnique({
        where: { id: next!.sessionId },
      });
      expect(newSession?.twoFactorAt).not.toBeNull();
    });

    it("rotateAdminSession rotates a fresh, never-revoked session", async () => {
      const admin = await createAdmin();
      const tokens = await issueAdminSession(testPrisma, admin.id, fakeSign);
      const next = await rotateAdminSession(testPrisma, tokens.refreshToken, fakeSign);
      expect(next).not.toBeNull();
      expect(next!.refreshToken).not.toBe(tokens.refreshToken);
      // Old session should now be revoked.
      const oldSession = await testPrisma.adminSession.findUnique({
        where: { id: tokens.sessionId },
      });
      expect(oldSession?.revokedAt).not.toBeNull();
    });

    it("revokeAdminSession marks the session revoked", async () => {
      const admin = await createAdmin();
      const tokens = await issueAdminSession(testPrisma, admin.id, fakeSign);
      await revokeAdminSession(testPrisma, tokens.refreshToken);
      const session = await testPrisma.adminSession.findUnique({
        where: { id: tokens.sessionId },
      });
      expect(session?.revokedAt).not.toBeNull();
    });

    it("revokeAdminSession is a no-op for an unknown token", async () => {
      await expect(revokeAdminSession(testPrisma, "ff".repeat(32))).resolves.toBeUndefined();
    });

    it("issueAdminSession records userAgent and ipHash when provided", async () => {
      const admin = await createAdmin();
      const tokens = await issueAdminSession(testPrisma, admin.id, fakeSign, {
        userAgent: "Mozilla/test",
        ipHash: "deadbeef".repeat(4),
      });
      const session = await testPrisma.adminSession.findUnique({
        where: { id: tokens.sessionId },
      });
      expect(session?.userAgent).toBe("Mozilla/test");
      expect(session?.ipHash).toBe("deadbeef".repeat(4));
    });
  });
});
