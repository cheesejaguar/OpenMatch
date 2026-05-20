import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { issueSession } from "../src/services/auth.service.js";
import { scheduleAccountDeletion } from "../src/services/privacy.service.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

// SEV-A6 — scheduling account deletion must:
//   1. Revoke every active session for the user (refresh tokens
//      `revokedAt != null`).
//   2. Delete every APNs / push device token row.
//   3. Close every active Match so matched peers no longer see the
//      deleted user in their conversation list / decks.
//   4. Reject any still-valid access JWT at the `authenticate` plugin
//      so the attacker cannot keep using the account during the
//      grace window.
//   5. Reject refresh-token rotation for paused accounts so a stolen
//      refresh token cannot mint a fresh access token.
//
// Reactivation via magic-link inside the grace window is still
// permitted (covered separately in the email-login flow) — without
// that, the cancel UX would be unreachable after sessions are
// revoked.

const app = await buildServer();

afterAll(async () => {
  await app.close();
  await testPrisma.$disconnect();
});

describe("SEV-A6 — account deletion lockout", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("revokes every active session and deletes device tokens on schedule", async () => {
    const user = await createUser();
    const s1 = await issueSession(testPrisma, user.id, (p) => app.jwt.sign(p));
    const s2 = await issueSession(testPrisma, user.id, (p) => app.jwt.sign(p));
    void s1;
    void s2;
    await testPrisma.deviceToken.create({
      data: { userId: user.id, token: "device-token-1", platform: "ios" },
    });
    await testPrisma.deviceToken.create({
      data: { userId: user.id, token: "device-token-2", platform: "ios" },
    });

    await scheduleAccountDeletion(testPrisma, { userId: user.id });

    const live = await testPrisma.session.count({
      where: { userId: user.id, revokedAt: null },
    });
    expect(live).toBe(0);
    const tokens = await testPrisma.deviceToken.count({ where: { userId: user.id } });
    expect(tokens).toBe(0);
  });

  it("closes every active match so matched peers stop seeing the user", async () => {
    const a = await createUser();
    const b = await createUser();
    await testPrisma.match.create({
      data: { userAId: a.id, userBId: b.id, status: "active" },
    });

    await scheduleAccountDeletion(testPrisma, { userId: a.id });

    const matches = await testPrisma.match.findMany({
      where: {
        OR: [{ userAId: a.id }, { userBId: a.id }],
      },
      select: { status: true, unmatchedAt: true, unmatchedByUserId: true },
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.status).toBe("unmatched");
    expect(matches[0]!.unmatchedAt).not.toBeNull();
    expect(matches[0]!.unmatchedByUserId).toBe(a.id);
  });

  it("refuses still-valid access JWTs from the paused user", async () => {
    const user = await createUser();
    const session = await issueSession(testPrisma, user.id, (p) => app.jwt.sign(p));
    // Token is valid before the deletion is scheduled.
    const before = await app.inject({
      method: "GET",
      url: "/api/v1/profile/me/profile",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(before.statusCode).toBe(200);

    await scheduleAccountDeletion(testPrisma, { userId: user.id });

    const after = await app.inject({
      method: "GET",
      url: "/api/v1/profile/me/profile",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    // The JWT is still chronologically valid, but the user is paused
    // so authenticate must refuse it. The exact code is 401 — the
    // pre-existing route never sees the request.
    expect(after.statusCode).toBe(401);
  });
});
