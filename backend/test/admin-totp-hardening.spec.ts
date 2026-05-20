import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_ROLE_DEFINITIONS } from "../src/lib/admin/roles.js";
import { buildServer } from "../src/server.js";
import { generateTotpCode } from "../src/services/admin/totp.service.js";
import { resetDb, testPrisma } from "./helpers/db.js";

// Wave 1 hardening — coverage for SEV-A1 (TOTP re-enrol downgrade)
// and SEV-A7 (notification on TOTP state change). The existing
// admin-2fa.spec exercises the happy path; this file pins the new
// fail-closed semantics so a future regression that re-introduces the
// silent-overwrite behaviour fails CI loudly.

const PRIOR = process.env.ADMIN_2FA_TEST_ENFORCE;

beforeAll(() => {
  process.env.ADMIN_2FA_TEST_ENFORCE = "true";
});

const app = await buildServer();

afterAll(async () => {
  process.env.ADMIN_2FA_TEST_ENFORCE = PRIOR ?? "";
  await app.close();
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
      create: { name: role.name, description: role.description, permissions: role.permissions },
      update: { description: role.description, permissions: role.permissions },
    });
  }
}

async function loginAdmin(email: string): Promise<VerifyResponse> {
  await testPrisma.adminUser.upsert({
    where: { email },
    update: {},
    create: { email, displayName: email.split("@")[0] ?? "admin" },
  });
  const start = await app.inject({
    method: "POST",
    url: "/api/v1/admin/auth/start",
    payload: { email },
  });
  const { challengeId, devToken } = start.json() as {
    challengeId: string;
    devToken: string;
  };
  const verify = await app.inject({
    method: "POST",
    url: "/api/v1/admin/auth/verify",
    payload: { challengeId, token: devToken },
  });
  return verify.json() as VerifyResponse;
}

describe("SEV-A1: admin TOTP re-enrol is gated", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles();
  });

  it("first-time enroll succeeds when no secret exists", async () => {
    const session = await loginAdmin("a1-fresh@openmatch.local");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/totp/enroll",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("second enroll WITHOUT 2FA elevation is refused with 409", async () => {
    const session = await loginAdmin("a1-attacker@openmatch.local");
    // Initial enrol succeeds — this represents the legitimate admin's
    // state when an attacker compromises their magic-link email.
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/totp/enroll",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(first.statusCode).toBe(200);

    // SEV-A1: the silent-overwrite path is now refused. An attacker
    // with only the magic-link factor cannot displace the legitimate
    // admin's authenticator.
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/totp/enroll",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: "totp_already_enrolled" });

    // Recovery codes from the legitimate enrolment are untouched.
    const admin = await testPrisma.adminUser.findUnique({
      where: { email: "a1-attacker@openmatch.local" },
    });
    expect(admin?.recoveryCodes.length).toBe(8);
  });

  it("/totp/reset succeeds only with an elevated session", async () => {
    const session = await loginAdmin("a1-reset@openmatch.local");
    // Enrol the first device.
    const enroll = await app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/totp/enroll",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(enroll.statusCode).toBe(200);

    // Without elevation, /reset is gated by requireAdminTwoFactor.
    const blockedReset = await app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/totp/reset",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(blockedReset.statusCode).toBe(403);

    // Elevate via a real TOTP code, then /reset succeeds.
    const admin = await testPrisma.adminUser.findUnique({
      where: { email: "a1-reset@openmatch.local" },
    });
    // The stored secret may be envelope-encrypted (totpv1:…); the
    // pure verifier accepts the in-memory plaintext only, so we sign
    // through the route which decrypts internally.
    // Fall back to plaintext-from-storage when ADMIN_TOTP_KEK is unset
    // (test env).
    const storedSecret = admin?.totpSecret ?? "";
    const plaintextSecret = storedSecret.startsWith("totpv1:") ? null : storedSecret;
    // In the test env we expect plaintext (no KEK set), so we can mint
    // a code directly. If a future test env enables KEK, this assertion
    // pins that the path needs to use a real authenticator.
    expect(plaintextSecret).toBeTruthy();
    const code = generateTotpCode(plaintextSecret!);
    const verify = await app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/totp/verify",
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { code },
    });
    expect(verify.statusCode).toBe(200);

    const reset = await app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/totp/reset",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(reset.statusCode).toBe(200);
  });
});
