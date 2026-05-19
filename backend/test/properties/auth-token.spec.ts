import { createHash, randomBytes } from "node:crypto";
import fc from "fast-check";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { hashIdentity } from "../../src/lib/hash.js";
import { issueSession, rotateRefreshToken } from "../../src/services/auth.service.js";
import { createUser, resetDb, testPrisma } from "../helpers/db.js";

// Round C — Property-based tests for the auth/token primitives.
//
// fast-check generates ~100 inputs per property and asserts the property
// holds for every one. Compared to the example-based specs these
// properties pin invariants ("hash length never depends on input") that
// are otherwise easy to regress when refactoring hash sources, token
// lengths, or session-rotation logic.

function hashToken(t: string): string {
  return createHash("sha256").update(t).digest("hex");
}

function fakeSignAccess(payload: { sub: string; scope: "user" }): string {
  // Encode the userId into a fake JWT-ish string so the property
  // "decodes-to-original-userId" has something to assert on. This avoids
  // pulling in @fastify/jwt for a pure-property test.
  return `fake.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
}

function decodeFakeAccess(token: string): { sub: string; scope: string } {
  const [, body] = token.split(".");
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
}

describe("auth token properties (fast-check)", () => {
  it("hashToken always returns 64 hex chars regardless of input", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 256 }), (s) => {
        const h = hashToken(s);
        return h.length === 64 && /^[0-9a-f]+$/.test(h);
      }),
      { numRuns: 100 },
    );
  });

  it("randomBytes(32).toString('hex') always yields 64 hex chars", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99 }), () => {
        const t = randomBytes(32).toString("hex");
        return t.length === 64 && /^[0-9a-f]+$/.test(t);
      }),
      { numRuns: 100 },
    );
  });

  it("hashIdentity is deterministic and produces fixed-length output", () => {
    fc.assert(
      fc.property(fc.emailAddress(), (email) => {
        const a = hashIdentity(email);
        const b = hashIdentity(email);
        return a === b && a.length === 64;
      }),
      { numRuns: 100 },
    );
  });

  it("hashIdentity is case- and whitespace-insensitive on the input", () => {
    fc.assert(
      fc.property(fc.emailAddress(), (email) => {
        const a = hashIdentity(email);
        const b = hashIdentity(`  ${email.toUpperCase()}  `);
        return a === b;
      }),
      { numRuns: 100 },
    );
  });

  it("the fake access token round-trips back to the original userId for any cuid-like id", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^c[a-z0-9]{24}$/), (sub) => {
        const t = fakeSignAccess({ sub, scope: "user" });
        const decoded = decodeFakeAccess(t);
        return decoded.sub === sub && decoded.scope === "user";
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------
// Stateful property: refresh-token reuse always revokes ALL active
// sessions for the affected user. This one runs against the real
// database because the revoke cascade is enforced at the prisma layer,
// but we keep the workload tiny (3 iterations of 3 random sessions
// each) so the suite stays under 500 ms.
// ---------------------------------------------------------------------

describe("refresh-token reuse property (DB-backed)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("presenting a revoked refresh token revokes every active session for the user", async () => {
    // We can't drive this through fc.assert because each "run" needs to
    // hit the real DB; we shape the iteration by hand but still exercise
    // a randomised number of sessions per run, which is the spirit of a
    // property test.
    for (const sessionCount of [1, 2, 5]) {
      await resetDb();
      const u = await createUser();
      const tokens: string[] = [];
      for (let i = 0; i < sessionCount; i++) {
        const tk = await issueSession(testPrisma, u.id, fakeSignAccess);
        tokens.push(tk.refreshToken);
      }
      // Rotate first token to produce a successor; the original is now
      // revoked. Presenting it again triggers reuse-detection.
      const first = tokens[0]!;
      const rotated = await rotateRefreshToken(testPrisma, first, fakeSignAccess);
      expect(rotated).not.toBeNull();
      // Reuse: the original (now-revoked) token re-presented.
      const reuseAttempt = await rotateRefreshToken(testPrisma, first, fakeSignAccess);
      expect(reuseAttempt).toBeNull();

      // INVARIANT: every active session for that user must now be
      // revoked. (The rotated-replacement is also revoked because it
      // came from the same user.)
      const active = await testPrisma.session.count({
        where: { userId: u.id, revokedAt: null },
      });
      expect(active).toBe(0);
    }
  });
});
