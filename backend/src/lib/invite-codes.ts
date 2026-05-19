import { randomBytes } from "node:crypto";

// Invite-code generation + normalisation.
//
// We avoid characters that are visually ambiguous (0/O, 1/I/L) so the
// codes survive being read aloud or hand-copied from email.

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateInviteCodeSuffix(length = 6): string {
  // Use a tight rejection-sampling loop on top of randomBytes so the
  // distribution stays uniform over the 31-char alphabet. (Math.random
  // would bias slightly because 256 % 31 != 0.)
  const out: string[] = [];
  while (out.length < length) {
    const buf = randomBytes(length * 2);
    for (let i = 0; i < buf.length && out.length < length; i++) {
      const v = buf[i]!;
      if (v < ALPHABET.length * Math.floor(256 / ALPHABET.length)) {
        out.push(ALPHABET[v % ALPHABET.length]!);
      }
    }
  }
  return out.join("");
}

export function cohortPrefix(cohortLabel: string): string {
  // "SF-week1" -> "SF-WK1"; fall back to upper-cased label if it doesn't
  // match the friendly pattern. The prefix is purely decorative — the
  // unique constraint is on the full code.
  const m = /^([A-Za-z]+)-week(\d+)/i.exec(cohortLabel);
  if (m) return `${m[1]!.toUpperCase()}-WK${m[2]}`;
  return cohortLabel
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildInviteCode(cohortLabel: string): string {
  return `${cohortPrefix(cohortLabel)}-${generateInviteCodeSuffix()}`;
}

export function normalizeInviteCode(raw: string): string {
  return raw.trim().toUpperCase();
}
