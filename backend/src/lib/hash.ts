import { createHash, createHmac } from "node:crypto";
import { env } from "../env.js";

// Shared hashing helpers used by multiple compliance / auth paths.
// Centralised so the hash algorithm + truncation length stay consistent
// across SanctionsScreening, Session.ipHash, ConsentRecord.ipHash, etc.

export function hashIp(ip?: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// SEV-A11 — Identity hashing.
//
// The legacy form was `sha256(value.trim().toLowerCase())` — an
// unsalted SHA-256 that lets anyone who learns a single `emailHash`
// value confirm it against a candidate email in O(1). With
// IDENTITY_HASH_SECRET configured we switch new writes to
// HMAC-SHA256(secret, value), which forces an attacker who learns the
// hash to also learn the server-side secret before they can run the
// same confirmation.
//
// Rollout requires a read-side fallback because every existing User /
// WaitlistEntry / AuthChallenge row was written under the legacy
// algorithm. `hashIdentityCandidates(value)` returns the HMAC form
// first (preferred) and the legacy SHA-256 as a fallback so callers
// performing equality lookups can transparently match both. New
// writes always use the HMAC form when the secret is configured; a
// follow-up backfill migration re-hashes every legacy row in place so
// the read fallback can eventually be retired (tracked in
// `prisma/migrations/20260520010000_identity_hash_hmac_backfill`).

function legacyIdentityHash(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function hmacIdentityHash(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value.trim().toLowerCase()).digest("hex");
}

/**
 * Canonical identity hash for new writes. Prefers HMAC when
 * IDENTITY_HASH_SECRET is configured; falls back to the legacy
 * unsalted form otherwise (dev / test, until the operator provisions
 * the secret).
 */
export function hashIdentity(value: string): string {
  if (env.IDENTITY_HASH_SECRET) {
    return hmacIdentityHash(env.IDENTITY_HASH_SECRET, value);
  }
  return legacyIdentityHash(value);
}

/**
 * Candidate hashes ordered "preferred first" for equality lookups
 * during the cutover window. Callers issuing `findFirst({ where: {
 * emailHash: { in: hashIdentityCandidates(email) } } })` (or a
 * sequential per-form lookup) will match a row regardless of which
 * algorithm produced it.
 *
 * Once the backfill migration has re-hashed all legacy rows to the
 * HMAC form, this helper can be removed and `hashIdentity` alone is
 * sufficient.
 */
export function hashIdentityCandidates(value: string): string[] {
  if (env.IDENTITY_HASH_SECRET) {
    return [hmacIdentityHash(env.IDENTITY_HASH_SECRET, value), legacyIdentityHash(value)];
  }
  return [legacyIdentityHash(value)];
}
