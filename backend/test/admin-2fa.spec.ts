import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_ROLE_DEFINITIONS } from "../src/lib/admin/roles.js";
import { buildServer } from "../src/server.js";
import {
  generateTotpCode,
  hashRecoveryCode,
  verifyTotpAgainstSecret,
} from "../src/services/admin/totp.service.js";
import { resetDb, testPrisma } from "./helpers/db.js";

// Round 3 (ADMIN-9): exercises the TOTP enrol -> verify -> recover ->
// disable flow end-to-end through the real Fastify server. Opt into the
// 2FA gate enforcement for this file only via `ADMIN_2FA_TEST_ENFORCE=1`
// (default test env short-circuits the gate so the rest of the suite
// keeps using helper-minted access tokens).

const PRIOR = process.env.ADMIN_2FA_TEST_ENFORCE;

beforeAll(() => {
  process.env.ADMIN_2FA_TEST_ENFORCE = "true";
});

const app = await buildServer();
const fastify = app;

afterAll(async () => {
  process.env.ADMIN_2FA_TEST_ENFORCE = PRIOR ?? "";
  await fastify.close();
  await testPrisma.$disconnect();
});

interface VerifyResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

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

async function startAndVerifyLogin(
  email: string,
  options: { roles?: string[] } = {},
): Promise<VerifyResponse> {
  // Pre-create the AdminUser so dev auto-provision isn't required, and
  // attach any requested roles so route-level permission gates pass.
  const admin = await testPrisma.adminUser.upsert({
    where: { email },
    update: {},
    create: { email, displayName: email.split("@")[0] ?? "admin" },
  });
  for (const name of options.roles ?? []) {
    const role = await testPrisma.adminRole.findUnique({ where: { name } });
    if (role) {
      await testPrisma.adminUserRole.upsert({
        where: { adminUserId_adminRoleId: { adminUserId: admin.id, adminRoleId: role.id } },
        update: {},
        create: { adminUserId: admin.id, adminRoleId: role.id },
      });
    }
  }
  const startRes = await fastify.inject({
    method: "POST",
    url: "/api/v1/admin/auth/start",
    payload: { email },
  });
  expect(startRes.statusCode).toBe(200);
  const { challengeId, devToken } = startRes.json() as {
    challengeId: string;
    devToken: string;
  };
  const verifyRes = await fastify.inject({
    method: "POST",
    url: "/api/v1/admin/auth/verify",
    payload: { challengeId, token: devToken },
  });
  expect(verifyRes.statusCode).toBe(200);
  return verifyRes.json() as VerifyResponse;
}

describe("admin TOTP 2FA", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles();
  });

  it("enroll returns a valid otpauth URI and 8 recovery codes", async () => {
    const session = await startAndVerifyLogin("twofa-1@openmatch.local");
    const res = await fastify.inject({
      method: "POST",
      url: "/api/v1/admin/auth/totp/enroll",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { otpauthUri: string; recoveryCodes: string[] };
    expect(body.otpauthUri).toMatch(
      /^otpauth:\/\/totp\/OpenMatch%20Admin:twofa-1%40openmatch\.local\?secret=[A-Z2-7]+&/,
    );
    expect(body.recoveryCodes).toHaveLength(8);
    for (const code of body.recoveryCodes) {
      expect(code).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
    }

    const admin = await testPrisma.adminUser.findUnique({
      where: { email: "twofa-1@openmatch.local" },
    });
    expect(admin?.totpSecret).toBeTruthy();
    expect(admin?.totpEnrolledAt).toBeInstanceOf(Date);
    expect(admin?.recoveryCodes).toHaveLength(8);
    // Recovery codes must be stored as hashes, never plaintext.
    for (const stored of admin?.recoveryCodes ?? []) {
      expect(stored).toMatch(/^[0-9a-f]{64}$/);
      expect(body.recoveryCodes).not.toContain(stored);
    }
  });

  it("verify accepts the current TOTP code and elevates the session", async () => {
    const session = await startAndVerifyLogin("twofa-2@openmatch.local");
    const enrollRes = await fastify.inject({
      method: "POST",
      url: "/api/v1/admin/auth/totp/enroll",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(enrollRes.statusCode).toBe(200);
    const admin = await testPrisma.adminUser.findUnique({
      where: { email: "twofa-2@openmatch.local" },
    });
    const code = generateTotpCode(admin!.totpSecret!);

    const verifyRes = await fastify.inject({
      method: "POST",
      url: "/api/v1/admin/auth/totp/verify",
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { code },
    });
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json()).toEqual({ ok: true });

    // The current AdminSession should now have a twoFactorAt timestamp.
    const sessions = await testPrisma.adminSession.findMany({
      where: { adminUserId: admin!.id, revokedAt: null },
    });
    expect(sessions[0]?.twoFactorAt).toBeInstanceOf(Date);
  });

  it("verify rejects an obviously-wrong code with 401", async () => {
    const session = await startAndVerifyLogin("twofa-3@openmatch.local");
    await fastify.inject({
      method: "POST",
      url: "/api/v1/admin/auth/totp/enroll",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    const verifyRes = await fastify.inject({
      method: "POST",
      url: "/api/v1/admin/auth/totp/verify",
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { code: "000000" },
    });
    expect(verifyRes.statusCode).toBe(401);
    expect(verifyRes.json()).toMatchObject({ error: "invalid_totp_code" });
  });

  it("recovery code is consumed and cannot be reused", async () => {
    const session = await startAndVerifyLogin("twofa-4@openmatch.local");
    const enrollRes = await fastify.inject({
      method: "POST",
      url: "/api/v1/admin/auth/totp/enroll",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    const { recoveryCodes } = enrollRes.json() as { recoveryCodes: string[] };
    const target = recoveryCodes[0]!;

    const first = await fastify.inject({
      method: "POST",
      url: "/api/v1/admin/auth/totp/recover",
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { recoveryCode: target },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ ok: true, remainingCodes: 7 });

    const second = await fastify.inject({
      method: "POST",
      url: "/api/v1/admin/auth/totp/recover",
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { recoveryCode: target },
    });
    expect(second.statusCode).toBe(401);
  });

  it("admin route is blocked with 403 totp_enrollment_required until enrol", async () => {
    const session = await startAndVerifyLogin("twofa-5@openmatch.local", {
      roles: ["viewer"],
    });
    // The admin has not enrolled yet — analytics should be blocked.
    const blocked = await fastify.inject({
      method: "GET",
      url: "/api/v1/admin/analytics/funnel",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ error: "totp_enrollment_required" });
  });

  it("admin route is blocked with two_factor_required after enrol until verify", async () => {
    const session = await startAndVerifyLogin("twofa-6@openmatch.local", {
      roles: ["viewer"],
    });
    await fastify.inject({
      method: "POST",
      url: "/api/v1/admin/auth/totp/enroll",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    const blocked = await fastify.inject({
      method: "GET",
      url: "/api/v1/admin/analytics/funnel",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ error: "two_factor_required" });
  });

  it("admin route succeeds once the session is elevated", async () => {
    const session = await startAndVerifyLogin("twofa-7@openmatch.local", {
      roles: ["viewer"],
    });
    await fastify.inject({
      method: "POST",
      url: "/api/v1/admin/auth/totp/enroll",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    const admin = await testPrisma.adminUser.findUnique({
      where: { email: "twofa-7@openmatch.local" },
    });
    const verifyRes = await fastify.inject({
      method: "POST",
      url: "/api/v1/admin/auth/totp/verify",
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { code: generateTotpCode(admin!.totpSecret!) },
    });
    expect(verifyRes.statusCode).toBe(200);
    const ok = await fastify.inject({
      method: "GET",
      url: "/api/v1/admin/analytics/funnel",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(ok.statusCode).toBe(200);
  });

  it("disable requires an elevated session and clears the secret", async () => {
    const session = await startAndVerifyLogin("twofa-8@openmatch.local");
    await fastify.inject({
      method: "POST",
      url: "/api/v1/admin/auth/totp/enroll",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });

    // Without elevation, /disable should be gated by requireAdminTwoFactor.
    const blocked = await fastify.inject({
      method: "POST",
      url: "/api/v1/admin/auth/totp/disable",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(blocked.statusCode).toBe(403);

    // Elevate then retry.
    const admin = await testPrisma.adminUser.findUnique({
      where: { email: "twofa-8@openmatch.local" },
    });
    await fastify.inject({
      method: "POST",
      url: "/api/v1/admin/auth/totp/verify",
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { code: generateTotpCode(admin!.totpSecret!) },
    });
    const ok = await fastify.inject({
      method: "POST",
      url: "/api/v1/admin/auth/totp/disable",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(ok.statusCode).toBe(200);
    const after = await testPrisma.adminUser.findUnique({
      where: { email: "twofa-8@openmatch.local" },
    });
    expect(after?.totpSecret).toBeNull();
    expect(after?.totpEnrolledAt).toBeNull();
    expect(after?.recoveryCodes).toEqual([]);
  });

  it("status reports enrol + elevation state", async () => {
    const session = await startAndVerifyLogin("twofa-9@openmatch.local");
    const before = await fastify.inject({
      method: "GET",
      url: "/api/v1/admin/auth/totp/status",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(before.json()).toMatchObject({
      enrolled: false,
      twoFactorAt: null,
      twoFactorRequired: true,
    });
  });
});

describe("TOTP service (pure functions)", () => {
  it("verifyTotpAgainstSecret accepts the freshly-generated code", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const code = generateTotpCode(secret);
    expect(verifyTotpAgainstSecret(secret, code)).toBe(true);
  });

  it("rejects non-digit or wrong-length codes", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    expect(verifyTotpAgainstSecret(secret, "abcdef")).toBe(false);
    expect(verifyTotpAgainstSecret(secret, "12345")).toBe(false);
    expect(verifyTotpAgainstSecret(secret, "1234567")).toBe(false);
  });

  it("rejects a code from far in the past", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const ancient = generateTotpCode(secret, Date.now() - 5 * 60 * 1000);
    expect(verifyTotpAgainstSecret(secret, ancient)).toBe(false);
  });

  it("hashRecoveryCode produces deterministic SHA-256 hex", () => {
    expect(hashRecoveryCode("ABCDE-FGHIJ")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode("ABCDE-FGHIJ")).toBe(hashRecoveryCode("ABCDE-FGHIJ"));
    expect(hashRecoveryCode("abcde-fghij")).toBe(hashRecoveryCode("ABCDE-FGHIJ"));
  });
});
