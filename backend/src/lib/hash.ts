import { createHash } from "node:crypto";

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

export function hashIdentity(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}
