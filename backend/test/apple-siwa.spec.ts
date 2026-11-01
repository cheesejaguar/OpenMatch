import { createHash } from "node:crypto";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// SEV-M5 + SEV-V — Apple SIWA nonce verification & email_verified gate.
//
// The real `jose` verifier runs end-to-end. The only thing replaced is
// the network boundary: Apple's JWKS endpoint
// (https://appleid.apple.com/auth/keys) is served from a stubbed
// `fetch` that returns a locally generated RS256 public key. Tokens are
// real JWTs signed with the matching private key, so signature, issuer
// and audience checks are exercised alongside the nonce / email_verified
// logic our own service adds on top.

const APPLE_ISSUER = "https://appleid.apple.com";
const CLIENT_ID = "com.example.test";
const KID = "test-kid";

let privateKey: CryptoKey;
let publicJwk: JWK;
let otherPrivateKey: CryptoKey;
const jwksRequests: string[] = [];

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: "RS256", use: "sig" };
  otherPrivateKey = (await generateKeyPair("RS256")).privateKey;
});

beforeEach(() => {
  jwksRequests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      jwksRequests.push(url);
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function signAppleToken(
  claims: Record<string, unknown>,
  opts: { issuer?: string; audience?: string; key?: CryptoKey } = {},
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(opts.issuer ?? APPLE_ISSUER)
    .setAudience(opts.audience ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(opts.key ?? privateKey);
}

// Service is dynamically imported after resetting the module cache so
// env mutations (APPLE_NONCE_REQUIRED) and the cached JWKS set are fresh.
async function loadService() {
  vi.resetModules();
  process.env.APPLE_CLIENT_ID = CLIENT_ID;
  return await import("../src/services/apple-auth.service.js");
}

async function loadAuthService() {
  return await import("../src/services/auth.service.js");
}

async function loadPrisma() {
  const { testPrisma } = await import("./helpers/db.js");
  return testPrisma;
}

const VALID_RAW_NONCE = "abcd1234efgh5678";
const VALID_HASHED = createHash("sha256").update(VALID_RAW_NONCE).digest("hex");

describe("verifyAppleIdentityToken — signature, issuer, audience", () => {
  beforeEach(() => {
    delete process.env.APPLE_NONCE_REQUIRED;
  });

  it("fetches Apple's JWKS and returns the verified identity", async () => {
    const { verifyAppleIdentityToken } = await loadService();
    const token = await signAppleToken({
      sub: "001234.somesubject",
      email: "u@example.com",
      email_verified: "true",
    });
    const result = await verifyAppleIdentityToken(token);
    expect(result).toEqual({
      sub: "001234.somesubject",
      email: "u@example.com",
      emailVerified: true,
      nonce: undefined,
    });
    expect(jwksRequests).toEqual(["https://appleid.apple.com/auth/keys"]);
  });

  it("leaves emailVerified undefined when Apple reports email_verified=false", async () => {
    const { verifyAppleIdentityToken } = await loadService();
    const token = await signAppleToken({
      sub: "001234.somesubject",
      email: "u@example.com",
      email_verified: false,
    });
    const result = await verifyAppleIdentityToken(token);
    expect(result.emailVerified).toBeUndefined();
  });

  it("rejects a token signed by a key not in Apple's JWKS", async () => {
    const { verifyAppleIdentityToken } = await loadService();
    const token = await signAppleToken({ sub: "001234.x" }, { key: otherPrivateKey });
    await expect(verifyAppleIdentityToken(token)).rejects.toMatchObject({
      code: "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
    });
  });

  it("rejects a token minted for a different audience", async () => {
    const { verifyAppleIdentityToken } = await loadService();
    const token = await signAppleToken({ sub: "001234.x" }, { audience: "com.attacker.app" });
    await expect(verifyAppleIdentityToken(token)).rejects.toMatchObject({
      code: "ERR_JWT_CLAIM_VALIDATION_FAILED",
      claim: "aud",
    });
  });

  it("rejects a token from a different issuer", async () => {
    const { verifyAppleIdentityToken } = await loadService();
    const token = await signAppleToken({ sub: "001234.x" }, { issuer: "https://evil.example" });
    await expect(verifyAppleIdentityToken(token)).rejects.toMatchObject({
      code: "ERR_JWT_CLAIM_VALIDATION_FAILED",
      claim: "iss",
    });
  });

  it("rejects a verified token with no sub claim", async () => {
    const { verifyAppleIdentityToken } = await loadService();
    const token = await signAppleToken({ email: "u@example.com" });
    await expect(verifyAppleIdentityToken(token)).rejects.toMatchObject({
      message: "apple_invalid_sub",
      statusCode: 400,
    });
  });
});

describe("verifyAppleIdentityToken — nonce handling", () => {
  beforeEach(() => {
    delete process.env.APPLE_NONCE_REQUIRED;
  });

  it("rejects when client sent a nonce but token has no nonce claim", async () => {
    const { verifyAppleIdentityToken } = await loadService();
    const token = await signAppleToken({
      sub: "001234.somesubject",
      email: "u@example.com",
      email_verified: true,
    });
    await expect(
      verifyAppleIdentityToken(token, { rawNonce: VALID_RAW_NONCE }),
    ).rejects.toMatchObject({ message: "apple_nonce_mismatch", statusCode: 401 });
  });

  it("rejects when SHA-256(rawNonce) does not match the token nonce claim", async () => {
    const { verifyAppleIdentityToken } = await loadService();
    const token = await signAppleToken({
      sub: "001234.somesubject",
      email: "u@example.com",
      email_verified: true,
      nonce: "deadbeef",
    });
    await expect(
      verifyAppleIdentityToken(token, { rawNonce: VALID_RAW_NONCE }),
    ).rejects.toMatchObject({ message: "apple_nonce_mismatch", statusCode: 401 });
  });

  it("accepts when SHA-256(rawNonce) matches the token nonce claim", async () => {
    const { verifyAppleIdentityToken } = await loadService();
    const token = await signAppleToken({
      sub: "001234.somesubject",
      email: "u@example.com",
      email_verified: true,
      nonce: VALID_HASHED,
    });
    const result = await verifyAppleIdentityToken(token, {
      rawNonce: VALID_RAW_NONCE,
    });
    expect(result.sub).toBe("001234.somesubject");
    expect(result.nonce).toBe(VALID_HASHED);
  });

  it("requires the rawNonce when APPLE_NONCE_REQUIRED=true", async () => {
    process.env.APPLE_NONCE_REQUIRED = "true";
    const { verifyAppleIdentityToken } = await loadService();
    const token = await signAppleToken({
      sub: "001234.somesubject",
      email: "u@example.com",
      email_verified: true,
      nonce: VALID_HASHED,
    });
    await expect(verifyAppleIdentityToken(token)).rejects.toMatchObject({
      message: "apple_nonce_required",
      statusCode: 400,
    });
  });

  it("legacy clients without a nonce are accepted when APPLE_NONCE_REQUIRED is unset", async () => {
    const { verifyAppleIdentityToken } = await loadService();
    const token = await signAppleToken({
      sub: "001234.somesubject",
      email: "u@example.com",
      email_verified: true,
    });
    const result = await verifyAppleIdentityToken(token);
    expect(result.sub).toBe("001234.somesubject");
  });
});

describe("upsertAppleUser — email_verified gate (SEV-V)", () => {
  beforeEach(async () => {
    const prisma = await loadPrisma();
    const { resetDb } = await import("./helpers/db.js");
    await resetDb();
    void prisma;
  });

  afterAll(async () => {
    const prisma = await loadPrisma();
    await prisma.$disconnect();
  });

  it("blocks new-user signup when email_verified is false", async () => {
    const prisma = await loadPrisma();
    const { upsertAppleUser } = await loadAuthService();
    await expect(
      upsertAppleUser(prisma, {
        sub: "001234.newuser",
        email: "unverified@example.com",
        emailVerified: false,
      }),
    ).rejects.toMatchObject({ message: "apple_email_unverified", statusCode: 400 });
  });

  it("blocks new-user signup when email_verified is undefined but email is present", async () => {
    const prisma = await loadPrisma();
    const { upsertAppleUser } = await loadAuthService();
    await expect(
      upsertAppleUser(prisma, {
        sub: "001234.newuser2",
        email: "missing-flag@example.com",
      }),
    ).rejects.toMatchObject({ message: "apple_email_unverified", statusCode: 400 });
  });

  it("allows new-user signup when email_verified is true", async () => {
    const prisma = await loadPrisma();
    const { upsertAppleUser } = await loadAuthService();
    const result = await upsertAppleUser(prisma, {
      sub: "001234.newuser3",
      email: "verified@example.com",
      emailVerified: true,
    });
    expect(result.isNewUser).toBe(true);
    expect(result.user.authSubject).toBe("001234.newuser3");
  });

  it("allows new-user signup when no email at all (private-relay opt-out)", async () => {
    const prisma = await loadPrisma();
    const { upsertAppleUser } = await loadAuthService();
    const result = await upsertAppleUser(prisma, { sub: "001234.norow-email" });
    expect(result.isNewUser).toBe(true);
  });

  it("allows existing user to sign in even with email_verified=false", async () => {
    const prisma = await loadPrisma();
    const { upsertAppleUser } = await loadAuthService();
    // Pre-create the user as if they signed up earlier when their email was verified.
    const existing = await prisma.user.create({
      data: {
        authProvider: "apple",
        authSubject: "001234.existing",
        dateOfBirth: new Date("2000-01-01"),
        isAgeVerified: false,
      },
    });
    const result = await upsertAppleUser(prisma, {
      sub: "001234.existing",
      email: "now-unverified@example.com",
      emailVerified: false,
    });
    expect(result.isNewUser).toBe(false);
    expect(result.user.id).toBe(existing.id);
  });
});
