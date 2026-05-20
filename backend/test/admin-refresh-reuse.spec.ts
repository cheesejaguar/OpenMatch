import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { issueAdminSession, rotateAdminSession } from "../src/services/admin/auth.service.js";
import { createAdmin, resetDb, testPrisma } from "./helpers/db.js";

// SEV-A2: admin refresh-token reuse detection. When a previously
// rotated (revoked) refresh token is presented again, the service
// MUST revoke every active session in the family, mirroring the
// consumer flow in auth.service.ts.

const fakeSign = (adminUserId: string, sessionId?: string): string =>
  `fake.${Buffer.from(JSON.stringify({ adminUserId, sessionId })).toString("base64url")}.sig`;

describe("SEV-A2 admin refresh-token reuse detection", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("detects reuse of a revoked refresh token and revokes the session family", async () => {
    const admin = await createAdmin();
    // Issue two sessions for the same admin so the "family revocation"
    // semantics have something to revoke.
    const a = await issueAdminSession(testPrisma, admin.id, fakeSign);
    const b = await issueAdminSession(testPrisma, admin.id, fakeSign);

    // Rotate `a` once — this is the legitimate flow. `a.refreshToken`
    // is now revoked.
    const rotated = await rotateAdminSession(testPrisma, a.refreshToken, fakeSign);
    expect(rotated).not.toBeNull();

    // Reuse `a.refreshToken` — should return null AND revoke the
    // remaining live session `b`.
    let loggedAdminId: string | null = null;
    const reuse = await rotateAdminSession(testPrisma, a.refreshToken, fakeSign, {
      logReuse: (id) => {
        loggedAdminId = id;
      },
    });
    expect(reuse).toBeNull();
    expect(loggedAdminId).toBe(admin.id);

    // Session `b` should now be revoked. So should the freshly-rotated
    // session that came from `a`. The legitimate admin is fully
    // signed out — they must re-authenticate.
    const all = await testPrisma.adminSession.findMany({
      where: { adminUserId: admin.id, revokedAt: null },
    });
    expect(all).toHaveLength(0);

    // The reuse event must be in AdminAuditLog.
    const audit = await testPrisma.adminAuditLog.findFirst({
      where: { adminUserId: admin.id, eventType: "admin_refresh_reuse" },
    });
    expect(audit).not.toBeNull();

    // Ignore unused-variable warning for `b` — pinned for clarity.
    void b;
  });

  it("rotateAdminSession still returns null for an unknown token", async () => {
    const out = await rotateAdminSession(testPrisma, "deadbeef".repeat(8), fakeSign);
    expect(out).toBeNull();
  });
});
