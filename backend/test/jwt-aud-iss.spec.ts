import { decodeJwt, SignJWT } from "jose";
import { afterAll, describe, expect, it } from "vitest";
import { env } from "../src/env.js";
import { ADMIN_JWT_AUDIENCE, ADMIN_JWT_ISSUER } from "../src/plugins/admin-auth.js";
import { CONSUMER_JWT_AUDIENCE, CONSUMER_JWT_ISSUER } from "../src/plugins/auth.js";
import { buildServer } from "../src/server.js";

// SEV-V3 / SEV-A13: every minted JWT must carry `iss` and `aud` and
// the verifier must reject tokens with the wrong values for either.
// The two namespaces use disjoint issuer/audience strings so a
// consumer token cannot be replayed against an admin endpoint and
// vice versa.

const app = await buildServer();

afterAll(async () => {
  await app.close();
});

describe("SEV-V3 JWT aud/iss enforcement", () => {
  it("consumer-signed token carries the consumer iss + aud", () => {
    const signed = app.jwt.sign({ sub: "u-123", scope: "user" });
    const decoded = decodeJwt(signed);
    expect(decoded.iss).toBe(CONSUMER_JWT_ISSUER);
    expect(decoded.aud).toBe(CONSUMER_JWT_AUDIENCE);
  });

  it("admin-signed token carries the admin iss + aud", () => {
    const signed = app.signAdminAccessToken("admin-1", "session-1");
    const decoded = decodeJwt(signed);
    expect(decoded.iss).toBe(ADMIN_JWT_ISSUER);
    expect(decoded.aud).toBe(ADMIN_JWT_AUDIENCE);
  });

  it("the two namespaces use disjoint iss + aud strings", () => {
    expect(CONSUMER_JWT_ISSUER).not.toBe(ADMIN_JWT_ISSUER);
    expect(CONSUMER_JWT_AUDIENCE).not.toBe(ADMIN_JWT_AUDIENCE);
  });

  it("a token manually-forged with the consumer secret but admin iss/aud is rejected by /me", async () => {
    // Mint a token with the consumer secret + admin claims. The
    // consumer auth gate must reject it because the consumer verifier
    // requires `iss: CONSUMER_JWT_ISSUER`. (Even if the secrets ever
    // collided between namespaces, the iss/aud constraint stops a
    // cross-namespace replay.)
    const forged = await new SignJWT({ sub: "u-123", scope: "user" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(ADMIN_JWT_ISSUER)
      .setAudience(ADMIN_JWT_AUDIENCE)
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(env.JWT_SECRET));
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/profile/me/profile",
      headers: { authorization: `Bearer ${forged}` },
    });
    expect(res.statusCode).toBe(401);
  });
});
