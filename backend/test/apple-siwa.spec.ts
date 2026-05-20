import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// SEV-M5 + SEV-V — Apple SIWA nonce verification & email_verified gate.
//
// We mock the `jose` JWT verifier so the tests can exercise the
// nonce / email_verified branches without hitting Apple's JWKS endpoint.
// All of the actual cryptographic verification is in the upstream jose
// library; what we cover here is the nonce hashing + the gate logic our
// own service adds on top.

const verifyMock = vi.fn();
vi.mock("jose", () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: (token: string, _keys: unknown, _options: unknown) =>
    verifyMock(token, _keys, _options),
}));

// Service is dynamically imported AFTER `vi.mock` so the mock takes effect.
async function loadService() {
  // Reset module cache so env mutations between describes are picked up.
  vi.resetModules();
  process.env.APPLE_CLIENT_ID = "com.example.test";
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

describe("verifyAppleIdentityToken — nonce handling", () => {
  beforeEach(() => {
    verifyMock.mockReset();
    delete process.env.APPLE_NONCE_REQUIRED;
  });

  it("rejects when client sent a nonce but token has no nonce claim", async () => {
    const { verifyAppleIdentityToken } = await loadService();
    verifyMock.mockResolvedValueOnce({
      payload: { sub: "001234.somesubject", email: "u@example.com", email_verified: true },
    });
    await expect(
      verifyAppleIdentityToken("fake.token", { rawNonce: VALID_RAW_NONCE }),
    ).rejects.toMatchObject({ message: "apple_nonce_mismatch", statusCode: 401 });
  });

  it("rejects when SHA-256(rawNonce) does not match the token nonce claim", async () => {
    const { verifyAppleIdentityToken } = await loadService();
    verifyMock.mockResolvedValueOnce({
      payload: {
        sub: "001234.somesubject",
        email: "u@example.com",
        email_verified: true,
        nonce: "deadbeef",
      },
    });
    await expect(
      verifyAppleIdentityToken("fake.token", { rawNonce: VALID_RAW_NONCE }),
    ).rejects.toMatchObject({ message: "apple_nonce_mismatch", statusCode: 401 });
  });

  it("accepts when SHA-256(rawNonce) matches the token nonce claim", async () => {
    const { verifyAppleIdentityToken } = await loadService();
    verifyMock.mockResolvedValueOnce({
      payload: {
        sub: "001234.somesubject",
        email: "u@example.com",
        email_verified: true,
        nonce: VALID_HASHED,
      },
    });
    const result = await verifyAppleIdentityToken("fake.token", {
      rawNonce: VALID_RAW_NONCE,
    });
    expect(result.sub).toBe("001234.somesubject");
    expect(result.nonce).toBe(VALID_HASHED);
  });

  it("requires the rawNonce when APPLE_NONCE_REQUIRED=true", async () => {
    process.env.APPLE_NONCE_REQUIRED = "true";
    const { verifyAppleIdentityToken } = await loadService();
    verifyMock.mockResolvedValueOnce({
      payload: {
        sub: "001234.somesubject",
        email: "u@example.com",
        email_verified: true,
        nonce: VALID_HASHED,
      },
    });
    await expect(verifyAppleIdentityToken("fake.token")).rejects.toMatchObject({
      message: "apple_nonce_required",
      statusCode: 400,
    });
  });

  it("legacy clients without a nonce are accepted when APPLE_NONCE_REQUIRED is unset", async () => {
    const { verifyAppleIdentityToken } = await loadService();
    verifyMock.mockResolvedValueOnce({
      payload: { sub: "001234.somesubject", email: "u@example.com", email_verified: true },
    });
    const result = await verifyAppleIdentityToken("fake.token");
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
    expect(result.user.id).toBeTruthy();
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
