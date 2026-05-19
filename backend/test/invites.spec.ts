import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { __clearFlagsCache } from "../src/lib/flags.js";
import { buildInviteCode, normalizeInviteCode } from "../src/lib/invite-codes.js";
import { reserveInviteCode, verifyEmailLogin } from "../src/services/auth.service.js";
import { createAdmin, resetDb, testPrisma } from "./helpers/db.js";

// End-to-end coverage for invite-code redemption. Verifies happy path
// (validate, redeem at signup), all the rejection paths (revoked,
// expired, over-max), and case normalisation.

async function seedInvite(
  opts: { cohortLabel?: string; maxUses?: number; expiresAt?: Date | null; revoked?: boolean } = {},
) {
  const admin = await createAdmin();
  return testPrisma.betaInviteCode.create({
    data: {
      code: buildInviteCode(opts.cohortLabel ?? "SF-week1"),
      cohortLabel: opts.cohortLabel ?? "SF-week1",
      maxUses: opts.maxUses ?? 1,
      createdByAdminUserId: admin.id,
      expiresAt: opts.expiresAt ?? null,
      revokedAt: opts.revoked ? new Date() : null,
    },
  });
}

async function startChallengeForEmail(email: string): Promise<{ challengeId: string }> {
  // Bypass mailer by writing the challenge row directly with a known
  // token. We hash the token the same way the service does.
  const { createHash, randomBytes } = await import("node:crypto");
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const challenge = await testPrisma.authChallenge.create({
    data: {
      email,
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  // Smuggle the raw token back out through a side channel on the
  // returned object. We re-derive it in the test that needs it.
  return { challengeId: challenge.id, ...({ token } as { token: string }) };
}

describe("invite-code redemption", () => {
  beforeEach(async () => {
    __clearFlagsCache();
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("normalizeInviteCode upper-cases + trims whitespace", () => {
    expect(normalizeInviteCode("  sf-wk1-ab12cd ")).toBe("SF-WK1-AB12CD");
  });

  it("buildInviteCode prefixes with cohort + 6-char suffix", () => {
    const code = buildInviteCode("SF-week1");
    expect(code.startsWith("SF-WK1-")).toBe(true);
    expect(code.length).toBe("SF-WK1-".length + 6);
  });

  it("reserveInviteCode increments usedCount on the happy path", async () => {
    const invite = await seedInvite();
    await testPrisma.$transaction(async (tx) => {
      const result = await reserveInviteCode(tx, invite.code);
      expect(result.cohortLabel).toBe(invite.cohortLabel);
    });
    const reloaded = await testPrisma.betaInviteCode.findUnique({ where: { id: invite.id } });
    expect(reloaded?.usedCount).toBe(1);
  });

  it("reserveInviteCode rejects a revoked code", async () => {
    const invite = await seedInvite({ revoked: true });
    await expect(
      testPrisma.$transaction(async (tx) => reserveInviteCode(tx, invite.code)),
    ).rejects.toMatchObject({ message: "invite_revoked", statusCode: 400 });
  });

  it("reserveInviteCode rejects an expired code", async () => {
    const invite = await seedInvite({ expiresAt: new Date(Date.now() - 60_000) });
    await expect(
      testPrisma.$transaction(async (tx) => reserveInviteCode(tx, invite.code)),
    ).rejects.toMatchObject({ message: "invite_expired", statusCode: 400 });
  });

  it("reserveInviteCode rejects an exhausted code", async () => {
    const invite = await seedInvite({ maxUses: 1 });
    await testPrisma.$transaction(async (tx) => reserveInviteCode(tx, invite.code));
    await expect(
      testPrisma.$transaction(async (tx) => reserveInviteCode(tx, invite.code)),
    ).rejects.toMatchObject({ message: "invite_exhausted" });
  });

  it("reserveInviteCode normalises case", async () => {
    const invite = await seedInvite();
    await testPrisma.$transaction(async (tx) => {
      const result = await reserveInviteCode(tx, invite.code.toLowerCase());
      expect(result.cohortLabel).toBe(invite.cohortLabel);
    });
  });

  it("reserveInviteCode rejects an unknown code", async () => {
    await expect(
      testPrisma.$transaction(async (tx) => reserveInviteCode(tx, "XX-NONE-000000")),
    ).rejects.toMatchObject({ message: "invite_invalid" });
  });

  it("verifyEmailLogin with inviteRequired=true rejects when no code supplied", async () => {
    const ch = (await startChallengeForEmail("new@example.com")) as {
      challengeId: string;
      token: string;
    };
    await expect(
      verifyEmailLogin(
        testPrisma,
        { challengeId: ch.challengeId, token: ch.token },
        { inviteRequired: true },
      ),
    ).rejects.toMatchObject({ message: "invite_code_required", statusCode: 400 });
  });

  it("verifyEmailLogin with inviteRequired=true creates the user AND a redemption row", async () => {
    const invite = await seedInvite();
    const ch = (await startChallengeForEmail("new@example.com")) as {
      challengeId: string;
      token: string;
    };
    const result = await verifyEmailLogin(
      testPrisma,
      { challengeId: ch.challengeId, token: ch.token, inviteCode: invite.code },
      { inviteRequired: true },
    );
    expect(result.isNewUser).toBe(true);
    const redemption = await testPrisma.betaInviteRedemption.findUnique({
      where: { userId: result.userId },
    });
    expect(redemption?.inviteCodeId).toBe(invite.id);
    const reloaded = await testPrisma.betaInviteCode.findUnique({ where: { id: invite.id } });
    expect(reloaded?.usedCount).toBe(1);
  });
});
