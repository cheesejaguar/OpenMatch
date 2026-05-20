import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

// Short-lived signed tokens for the photo-serve proxy.
//
// Why HMAC rather than a real JWT here? The token carries three fields
// (photoId, audienceUserId, expiry) plus a signature. A 64-char HMAC
// keeps URLs short, avoids pulling JWT verify code into the hot photo
// path, and is verified in microseconds. The signing secret is derived
// from JWT_SECRET so there is no new key to rotate. Tokens are scoped
// to a specific photo + audience so a token leaked from user A's
// session cannot be replayed against user B's request.

const TOKEN_VERSION = "v1";
const DEFAULT_TTL_SECONDS = 300; // 5 minutes
const SECRET_DERIVATION_LABEL = "photo-serve:";

export interface SignedPhotoToken {
  photoId: string;
  audienceUserId: string | null; // null for public/admin contexts
  expiresAt: number; // unix seconds
}

function signingKey(): string {
  // Derive a per-purpose secret so a leaked photo token cannot be replayed
  // against the user-session JWT verifier and vice versa.
  return SECRET_DERIVATION_LABEL + env.JWT_SECRET;
}

function payloadString(p: SignedPhotoToken): string {
  return `${TOKEN_VERSION}.${p.photoId}.${p.audienceUserId ?? ""}.${p.expiresAt}`;
}

export function signPhotoToken(
  p: { photoId: string; audienceUserId: string | null },
  options: { ttlSeconds?: number; now?: number } = {},
): string {
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const nowSec = Math.floor((options.now ?? Date.now()) / 1000);
  const expiresAt = nowSec + ttl;
  const full: SignedPhotoToken = {
    photoId: p.photoId,
    audienceUserId: p.audienceUserId,
    expiresAt,
  };
  const sig = createHmac("sha256", signingKey()).update(payloadString(full)).digest("hex");
  return `${TOKEN_VERSION}.${p.photoId}.${p.audienceUserId ?? ""}.${expiresAt}.${sig}`;
}

export type VerifyResult =
  | { ok: true; payload: SignedPhotoToken }
  | { ok: false; reason: "malformed" | "expired" | "bad_signature" | "wrong_audience" };

export function verifyPhotoToken(
  token: string,
  expected: { photoId: string; audienceUserId: string | null },
  options: { now?: number } = {},
): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 5) return { ok: false, reason: "malformed" };
  const [version, photoId, audStr, expStr, sig] = parts as [string, string, string, string, string];
  if (version !== TOKEN_VERSION) return { ok: false, reason: "malformed" };
  const expiresAt = Number.parseInt(expStr, 10);
  if (!Number.isFinite(expiresAt)) return { ok: false, reason: "malformed" };
  if (photoId !== expected.photoId) return { ok: false, reason: "wrong_audience" };
  const audienceUserId = audStr === "" ? null : audStr;
  if (audienceUserId !== expected.audienceUserId) {
    return { ok: false, reason: "wrong_audience" };
  }
  const payload: SignedPhotoToken = { photoId, audienceUserId, expiresAt };
  const expectedSig = createHmac("sha256", signingKey()).update(payloadString(payload)).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(sig, "hex");
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  if (provided.length !== expectedSig.length) return { ok: false, reason: "bad_signature" };
  if (!timingSafeEqual(provided, expectedSig)) return { ok: false, reason: "bad_signature" };
  const nowSec = Math.floor((options.now ?? Date.now()) / 1000);
  if (expiresAt < nowSec) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}
