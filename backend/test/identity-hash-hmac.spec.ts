import { createHash, createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// SEV-A11 — HMAC identity-hash cutover.
//
// `hashIdentity` should:
//   - emit HMAC-SHA256(secret, value) when IDENTITY_HASH_SECRET is set
//   - emit legacy SHA-256(value) when the secret is absent (back-compat)
// `hashIdentityCandidates` should return BOTH forms (preferred first)
// during the cutover so lookups against legacy rows still match.
//
// The helpers normalise whitespace + casing identically across both
// algorithms — verified here so a regression that drifts the
// normalisation between forms is caught.

const PRIOR_SECRET = process.env.IDENTITY_HASH_SECRET;

afterAll(() => {
  if (PRIOR_SECRET === undefined) delete process.env.IDENTITY_HASH_SECRET;
  else process.env.IDENTITY_HASH_SECRET = PRIOR_SECRET;
});

async function loadHashModule() {
  // Force a fresh module load so the captured `env` snapshot reflects
  // the current process.env value of IDENTITY_HASH_SECRET.
  vi.resetModules();
  return import("../src/lib/hash.js");
}

const sample = "  User@Example.COM  ";
const normalised = "user@example.com";

describe("hashIdentity — SEV-A11 cutover", () => {
  beforeEach(() => {
    delete process.env.IDENTITY_HASH_SECRET;
  });

  it("legacy SHA-256 form when no secret is configured", async () => {
    delete process.env.IDENTITY_HASH_SECRET;
    const { hashIdentity, hashIdentityCandidates } = await loadHashModule();
    const expected = createHash("sha256").update(normalised).digest("hex");
    expect(hashIdentity(sample)).toBe(expected);
    expect(hashIdentityCandidates(sample)).toEqual([expected]);
  });

  it("HMAC-SHA256 form when IDENTITY_HASH_SECRET is set", async () => {
    process.env.IDENTITY_HASH_SECRET = "test-identity-hash-secret-32-bytes-min-padding-bytes";
    const { hashIdentity, hashIdentityCandidates } = await loadHashModule();
    const expected = createHmac("sha256", process.env.IDENTITY_HASH_SECRET)
      .update(normalised)
      .digest("hex");
    expect(hashIdentity(sample)).toBe(expected);
    // Read-fallback list: HMAC first, legacy SHA-256 second.
    const legacy = createHash("sha256").update(normalised).digest("hex");
    expect(hashIdentityCandidates(sample)).toEqual([expected, legacy]);
  });

  it("HMAC value is distinguishable from legacy SHA-256 of the same input", async () => {
    process.env.IDENTITY_HASH_SECRET = "test-identity-hash-secret-32-bytes-min-padding-bytes";
    const { hashIdentity } = await loadHashModule();
    const legacy = createHash("sha256").update(normalised).digest("hex");
    expect(hashIdentity(sample)).not.toBe(legacy);
  });
});
