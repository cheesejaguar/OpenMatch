import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { resetDb, testPrisma } from "./helpers/db.js";

// SEV-A14 — per-challenge attempt counter.
//
// /auth/verify is per-IP rate-limited at 20/min and the magic-link
// token is 256 bits, so direct brute-force is infeasible. The closed
// threat is a leaked `challengeId` (referer / log / MITM) that lets
// an attacker burn arbitrary token guesses against that specific row
// from a rotating proxy pool. After 5 wrong tokens the challenge is
// marked consumed so further guesses return `challenge_used`.

const app = await buildServer();

afterAll(async () => {
  await app.close();
  await testPrisma.$disconnect();
});

function hashToken(t: string): string {
  return createHash("sha256").update(t).digest("hex");
}

describe("SEV-A14 — per-challenge attempt cap", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("marks challenge consumed after 5 failed verify attempts", async () => {
    // Seed an AuthChallenge directly so we don't depend on the
    // country-gate / metro-gate / SMTP machinery that POST /auth/start
    // exercises. We use a fresh token so the row mimics a real one.
    const realToken = "real-token-not-known-to-attacker";
    const challenge = await testPrisma.authChallenge.create({
      data: {
        email: "a14@example.com",
        tokenHash: hashToken(realToken),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    // 5 wrong tokens via the public POST /auth/verify endpoint. The
    // country gate is bypassed because `req.ip` resolves to 127.0.0.1
    // (no XFF) which is allow-listed by default.
    for (let i = 0; i < 5; i += 1) {
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/auth/verify",
        headers: { "x-vercel-ip-country": "US" },
        payload: { challengeId: challenge.id, token: `wrong-${i}` },
      });
      expect(r.statusCode).toBe(400);
    }

    const updated = await testPrisma.authChallenge.findUnique({
      where: { id: challenge.id },
    });
    expect(updated?.failedAttempts).toBe(5);
    expect(updated?.consumedAt).not.toBeNull();

    // Even the correct token now fails — the challenge has been
    // marked consumed by the attempt cap.
    const after = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      headers: { "x-vercel-ip-country": "US" },
      payload: { challengeId: challenge.id, token: realToken },
    });
    expect(after.statusCode).toBe(400);
    expect((after.json() as { error: string }).error).toBe("challenge_used");
  });
});
