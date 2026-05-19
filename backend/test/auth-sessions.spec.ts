import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import {
  issueSession,
  listUserSessions,
  revokeAllUserSessions,
  revokeSession,
  revokeUserSession,
  rotateRefreshToken,
} from "../src/services/auth.service.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

// Round 3 (TEST-2): direct service-level tests for session management.
// Existing route tests cover the happy path through HTTP, but these
// exercise the rotation / reuse / multi-session paths that the route
// integration tests skip.

const app = await buildServer();

afterAll(async () => {
  await app.close();
  await testPrisma.$disconnect();
});

const signAccess = (payload: { sub: string; scope: "user" }) => app.jwt.sign(payload);

describe("auth.service session management", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("issueSession + listUserSessions returns the new session", async () => {
    const u = await createUser();
    const a = await issueSession(testPrisma, u.id, signAccess, {
      userAgent: "Test/1.0",
      ip: "10.0.0.1",
    });
    expect(a.accessToken).toBeTruthy();
    expect(a.refreshToken).toBeTruthy();
    const sessions = await listUserSessions(testPrisma, u.id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.userAgent).toBe("Test/1.0");
    // ipHash should be a hash, not the raw IP.
    expect(sessions[0]?.ipHash).not.toBe("10.0.0.1");
  });

  it("rotateRefreshToken returns fresh tokens and revokes the prior", async () => {
    const u = await createUser();
    const a = await issueSession(testPrisma, u.id, signAccess);
    const b = await rotateRefreshToken(testPrisma, a.refreshToken, signAccess);
    expect(b).not.toBeNull();
    expect(b!.refreshToken).not.toBe(a.refreshToken);
    // Old refresh token can't be rotated again.
    const reuse = await rotateRefreshToken(testPrisma, a.refreshToken, signAccess);
    expect(reuse).toBeNull();
  });

  it("rotateRefreshToken returns null for an unknown token", async () => {
    const r = await rotateRefreshToken(testPrisma, "deadbeef".repeat(8), signAccess);
    expect(r).toBeNull();
  });

  it("refresh-token reuse revokes the entire session family", async () => {
    const u = await createUser();
    const a = await issueSession(testPrisma, u.id, signAccess);
    const b = await issueSession(testPrisma, u.id, signAccess);
    // Rotate `a` to a successor.
    const aNext = await rotateRefreshToken(testPrisma, a.refreshToken, signAccess);
    expect(aNext).not.toBeNull();
    // Now replay `a.refreshToken` — this is the reuse signal and should
    // burn down all of the user's outstanding sessions, including `b`.
    let reuseSeen: string | null = null;
    await rotateRefreshToken(testPrisma, a.refreshToken, signAccess, {
      logReuse: (uid) => {
        reuseSeen = uid;
      },
    });
    expect(reuseSeen).toBe(u.id);
    const live = await testPrisma.session.findMany({
      where: { userId: u.id, revokedAt: null },
    });
    expect(live).toHaveLength(0);
    // Even the unrelated session `b` is dead.
    const next = await rotateRefreshToken(testPrisma, b.refreshToken, signAccess);
    expect(next).toBeNull();
  });

  it("rotateRefreshToken refuses an expired session", async () => {
    const u = await createUser();
    const a = await issueSession(testPrisma, u.id, signAccess);
    // Force-expire the session in place.
    await testPrisma.session.updateMany({
      where: { userId: u.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const r = await rotateRefreshToken(testPrisma, a.refreshToken, signAccess);
    expect(r).toBeNull();
  });

  it("revokeSession revokes by the raw refresh token", async () => {
    const u = await createUser();
    const a = await issueSession(testPrisma, u.id, signAccess);
    await revokeSession(testPrisma, a.refreshToken);
    const r = await rotateRefreshToken(testPrisma, a.refreshToken, signAccess);
    // Revoked then immediately reused → reuse detection trips and the
    // family is killed; we expect null either way.
    expect(r).toBeNull();
  });

  it("revokeUserSession returns revoked=false for an unowned session", async () => {
    const u1 = await createUser();
    const u2 = await createUser();
    const a = await issueSession(testPrisma, u1.id, signAccess);
    const me = await testPrisma.session.findFirstOrThrow({
      where: { userId: u1.id },
    });
    // u2 attempting to revoke u1's session must be a no-op.
    const denied = await revokeUserSession(testPrisma, u2.id, me.id);
    expect(denied.revoked).toBe(false);
    // u1 revoking their own session works.
    const ok = await revokeUserSession(testPrisma, u1.id, me.id);
    expect(ok.revoked).toBe(true);
    // Idempotent: second call returns revoked=false (no rows match the
    // `revokedAt: null` filter anymore).
    const again = await revokeUserSession(testPrisma, u1.id, me.id);
    expect(again.revoked).toBe(false);
    void a;
  });

  it("revokeAllUserSessions optionally keeps one session live", async () => {
    const u = await createUser();
    await issueSession(testPrisma, u.id, signAccess);
    await issueSession(testPrisma, u.id, signAccess);
    const keepRaw = await issueSession(testPrisma, u.id, signAccess);
    const sessions = await listUserSessions(testPrisma, u.id);
    const keepId = sessions[0]!.id; // most-recent
    const { revokedCount } = await revokeAllUserSessions(testPrisma, u.id, {
      keepSessionId: keepId,
    });
    expect(revokedCount).toBe(2);
    const remaining = await listUserSessions(testPrisma, u.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(keepId);
    void keepRaw;
  });
});
