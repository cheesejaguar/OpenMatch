import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ErrorCodes } from "../src/lib/error-codes.js";
import { buildServer } from "../src/server.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

// Round A (Error contract).
//
// Every error code in src/lib/error-codes.ts must be reachable from at
// least one HTTP path so a regression — wrong code, wrong status, or
// wrong body shape — fails a test before it ships. This spec drives the
// most commonly-emitted codes via the public API and asserts the exact
// `error` string in the response body.
//
// Codes that are inherently hard to trigger via injected requests in CI
// (e.g. APPLE_NOT_CONFIGURED depends on env, REFRESH_TOKEN_REUSED needs
// timing, INTERNAL_ERROR is the catch-all) are exercised in their
// dedicated specs (admin-2fa, auth-sessions, etc.) — we don't duplicate
// them here.

const app = await buildServer();

afterAll(async () => {
  await app.close();
  await testPrisma.$disconnect();
});

const bearer = (userId: string) => `Bearer ${app.jwt.sign({ sub: userId, scope: "user" })}`;

// Tests inject from localhost, which has no inferred country. The
// country gate then 451s. Send a known-good country so the gate
// short-circuits to `allow=true` and the test exercises the intended
// handler logic.
const allowCountry = { "x-vercel-ip-country": "US" } as const;

beforeEach(async () => {
  await resetDb();
});

describe("error contract", () => {
  it("POST /api/v1/auth/start with method=email and no email returns email_required", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/start",
      headers: allowCountry,
      payload: { method: "email" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe(ErrorCodes.EMAIL_REQUIRED);
  });

  it("POST /api/v1/auth/start with method=dev when ALLOW_DEV_LOGIN=false returns dev_login_disabled", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/start",
      headers: allowCountry,
      payload: { method: "dev", devUserId: "anyone" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe(ErrorCodes.DEV_LOGIN_DISABLED);
  });

  it("POST /api/v1/auth/start with method=apple and no token returns apple_identity_token_required", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/start",
      headers: allowCountry,
      payload: { method: "apple" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe(ErrorCodes.APPLE_IDENTITY_TOKEN_REQUIRED);
  });

  it("POST /api/v1/auth/refresh with garbage token returns invalid_refresh_token (401)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: "nonsense".repeat(8) },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe(ErrorCodes.INVALID_REFRESH_TOKEN);
  });

  it("GET /api/v1/profile/me/profile without auth returns 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/profile/me/profile" });
    // Fastify's authenticate hook emits a 401 by default; the body still
    // flows through the unified error handler.
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/v1/profile/<unknown> returns not_found", async () => {
    const u = await createUser();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/profile/does-not-exist",
      headers: { authorization: bearer(u.id) },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe(ErrorCodes.NOT_FOUND);
  });

  it("PATCH /api/v1/preferences/me with minAge > maxAge returns min_age_above_max", async () => {
    const u = await createUser();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/preferences/me",
      headers: { authorization: bearer(u.id) },
      payload: { minAge: 50, maxAge: 30 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe(ErrorCodes.MIN_AGE_ABOVE_MAX);
  });

  it("PATCH /api/v1/profile/me/profile with dateOfBirth < 18 returns underage", async () => {
    const u = await createUser();
    // 10 years old.
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 10);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/profile/me/profile",
      headers: { authorization: bearer(u.id) },
      payload: { dateOfBirth: dob.toISOString() },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe(ErrorCodes.UNDERAGE);
  });

  it("PATCH /api/v1/profile/me/profile with garbage dateOfBirth returns invalid_dob", async () => {
    const u = await createUser();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/profile/me/profile",
      headers: { authorization: bearer(u.id) },
      payload: { dateOfBirth: "not-a-date" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe(ErrorCodes.INVALID_DOB);
  });

  it("POST /api/v1/swipes against an unknown profileId returns target_not_found", async () => {
    const u = await createUser();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/swipes",
      headers: { authorization: bearer(u.id) },
      payload: {
        targetProfileId: "ckno-such-profile-id",
        decision: "like",
        deckSessionId: "any",
        algorithmVersion: "x",
        rankingConfigVersion: "y",
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe(ErrorCodes.TARGET_NOT_FOUND);
  });

  it("POST /api/v1/swipes/:id/undo on an unknown id returns undo_not_available", async () => {
    const u = await createUser();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/swipes/ck-unknown/undo",
      headers: { authorization: bearer(u.id) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe(ErrorCodes.UNDO_NOT_AVAILABLE);
  });

  it("POST /api/v1/likes/:likeId/accept on an unknown like returns not_found", async () => {
    const u = await createUser();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/likes/ck-no-such-like/accept",
      headers: { authorization: bearer(u.id) },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe(ErrorCodes.NOT_FOUND);
  });

  it("GET /api/v1/matches/:id when the match doesn't exist returns not_found", async () => {
    const u = await createUser();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/matches/ck-no-such-match",
      headers: { authorization: bearer(u.id) },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe(ErrorCodes.NOT_FOUND);
  });

  it("GET /api/v1/conversations/:id/messages on an unknown convo returns not_found", async () => {
    const u = await createUser();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/ck-unknown/messages",
      headers: { authorization: bearer(u.id) },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe(ErrorCodes.NOT_FOUND);
  });

  it("POST /api/v1/realtime/token without Ably configured returns realtime_unconfigured", async () => {
    // ABLY_API_KEY is unset in the CI / vitest env (see env.ts default),
    // so the gate returns 503.
    const u = await createUser();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/realtime/token",
      headers: { authorization: bearer(u.id) },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe(ErrorCodes.REALTIME_UNCONFIGURED);
  });

  it("POST /api/v1/internal/run-deletion-purge with no bearer returns unauthorized", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/internal/run-deletion-purge",
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe(ErrorCodes.UNAUTHORIZED);
  });

  it("POST /api/v1/internal/run-deletion-purge with a wrong bearer returns unauthorized", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/internal/run-deletion-purge",
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe(ErrorCodes.UNAUTHORIZED);
  });

  it("GET /api/v1/discovery/deck?limit=notanumber returns validation_failed with fields[]", async () => {
    const u = await createUser();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/discovery/deck?limit=notanumber",
      headers: { authorization: bearer(u.id) },
    });
    // Now that the deck route uses zod for querystring, garbage input is
    // surfaced via the central error handler as validation_failed.
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe(ErrorCodes.VALIDATION_FAILED);
    expect(Array.isArray(body.fields)).toBe(true);
  });

  it("body shape: every error response carries an `error` string from the registry", async () => {
    // A handful of representative requests; the assertion is on shape
    // not specific code (those are covered by the cases above).
    const samples = [
      {
        method: "POST" as const,
        url: "/api/v1/auth/start",
        headers: allowCountry,
        payload: { method: "email" },
      },
      {
        method: "POST" as const,
        url: "/api/v1/auth/refresh",
        payload: { refreshToken: "x".repeat(40) },
      },
      { method: "POST" as const, url: "/api/v1/internal/run-deletion-purge" },
    ];
    for (const s of samples) {
      const res = await app.inject(s);
      const body = res.json();
      expect(typeof body.error).toBe("string");
      // Every code in the body must exist in the registry.
      expect(Object.values(ErrorCodes)).toContain(body.error);
    }
  });
});
