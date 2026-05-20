import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { decryptTotpSecret, encryptTotpSecret } from "../../lib/crypto/totp-encryption.js";

// Round 3 (ADMIN-9): TOTP-based 2FA. The flow is:
//
//   1. admin completes magic-link verify -> we mint an AdminSession,
//      but `twoFactorAt` is null.
//   2. admin POSTs /totp/enroll  -> we generate a secret + 8 recovery
//      codes, persist the secret + hashes, return the otpauth URI and
//      recovery codes ONCE.
//   3. admin POSTs /totp/verify with a code from their app  -> we set
//      `twoFactorAt` on the bearer session.
//   4. admin route gate (admin-auth plugin) requires `twoFactorAt` to
//      be non-null when the AdminUser's `twoFactorRequired` flag is set
//      and `ADMIN_2FA_OPTIONAL` is `false`.
//
// Implementation: RFC 6238 TOTP (SHA-1, 30-second step, 6-digit codes).
// The verifier accepts +/- 1 step of clock skew. We intentionally avoid
// pulling a third-party OTP library; the algorithm is ~30 lines and the
// supply-chain cost of an external dep here is not justified.

const STEP_SECONDS = 30;
const CODE_DIGITS = 6;
const WINDOW = 1; // accept current step +/- WINDOW

// RFC 4648 base32 alphabet. We avoid padding ("=") in the encoded form
// because most authenticator apps reject it.
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/=+$/g, "").toUpperCase().replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("invalid_base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  // Counter is a 64-bit big-endian integer; we keep it safe by using
  // BigInt arithmetic so values beyond 2^32 still encode correctly.
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const slice = hmac.subarray(offset, offset + 4);
  const code = ((slice[0]! & 0x7f) << 24) | (slice[1]! << 16) | (slice[2]! << 8) | slice[3]!;
  const mod = code % 10 ** CODE_DIGITS;
  return mod.toString().padStart(CODE_DIGITS, "0");
}

export function generateTotpCode(secretBase32: string, now: number = Date.now()): string {
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(now / 1000 / STEP_SECONDS);
  return hotp(secret, counter);
}

// Constant-time string compare. Returns false on length mismatch
// (intentional: lengths leaking would be a marginal vector but the API
// is `string == string` so callers pass two 6-digit strings). Uses
// `crypto.timingSafeEqual` after Buffer-coercing.
function constantTimeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function verifyTotpAgainstSecret(
  secretBase32: string,
  code: string,
  now: number = Date.now(),
): boolean {
  const cleaned = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  let secret: Buffer;
  try {
    secret = base32Decode(secretBase32);
  } catch {
    return false;
  }
  const counter = Math.floor(now / 1000 / STEP_SECONDS);
  // Iterate every offset before returning so the wall-clock time is
  // a function of WINDOW size, not whether the input matched. The
  // per-iteration comparison uses crypto.timingSafeEqual.
  let matched = false;
  for (let drift = -WINDOW; drift <= WINDOW; drift += 1) {
    const candidate = hotp(secret, counter + drift);
    if (constantTimeStringEqual(candidate, cleaned)) {
      matched = true;
    }
  }
  return matched;
}

export interface EnrollResult {
  otpauthUri: string;
  secret: string;
  recoveryCodes: string[];
}

export function hashRecoveryCode(code: string): string {
  // Recovery codes are short (10 chars, base32) and one-time-use. A
  // single SHA-256 hash is sufficient: the input space is small enough
  // that brute force is moot once the code is consumed, and a bcrypt
  // round per attempt would needlessly slow normal verifies.
  return createHash("sha256").update(code.replace(/\s+/g, "").toUpperCase()).digest("hex");
}

function generateRecoveryCode(): string {
  // 10 chars from a no-ambiguous-glyph alphabet. ~50 bits of entropy
  // per code; we issue 8 of them. Uses rejection sampling so each
  // alphabet position is exactly equiprobable — `byte % alphabet.length`
  // alone is modulo-biased whenever 256 % len !== 0 (here 256/32 = 8
  // so the bias is mathematically zero, but rejection sampling makes
  // that explicit for static analysis tools).
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const len = alphabet.length;
  const maxAcceptable = Math.floor(256 / len) * len; // 256 for len=32
  const picks: number[] = [];
  while (picks.length < 10) {
    const batch = randomBytes(16);
    for (const b of batch) {
      if (b < maxAcceptable) {
        picks.push(b % len);
        if (picks.length === 10) break;
      }
    }
  }
  let out = "";
  for (let i = 0; i < 10; i += 1) {
    out += alphabet[picks[i]!];
    if (i === 4) out += "-"; // human-readable midpoint
  }
  return out;
}

function buildOtpauthUri(secret: string, label: string, issuer: string): string {
  const enc = (s: string) => encodeURIComponent(s);
  return `otpauth://totp/${enc(issuer)}:${enc(label)}?secret=${secret}&issuer=${enc(issuer)}&algorithm=SHA1&digits=${CODE_DIGITS}&period=${STEP_SECONDS}`;
}

export interface EnrollOptions {
  issuer?: string;
}

export interface EnrollOptionsInternal extends EnrollOptions {
  /**
   * When true, allows the enrol path to overwrite an existing TOTP
   * secret. Caller MUST have verified the request is authorised to do
   * so (admin has presented a current TOTP code, supplied a recovery
   * code, or otherwise been elevated). Defaults to false; the default
   * fails closed with `totp_already_enrolled` (HTTP 409).
   *
   * Audit reference: SEV-A1 (admin TOTP downgrade via re-enrolment).
   */
  allowOverwrite?: boolean;
}

export async function enrollTotp(
  prisma: PrismaClient,
  adminUserId: string,
  options: EnrollOptionsInternal = {},
): Promise<EnrollResult> {
  const admin = await prisma.adminUser.findUnique({ where: { id: adminUserId } });
  if (!admin) throw Object.assign(new Error("admin_not_found"), { statusCode: 404 });

  // SEV-A1: fail closed on re-enrolment. The previous behaviour silently
  // overwrote the existing secret, which let a magic-link-only attacker
  // displace the legitimate admin's authenticator. The route layer is
  // responsible for routing legitimate device-replacement requests
  // through `/totp/reset` (which requires an elevated session).
  if (admin.totpSecret && !options.allowOverwrite) {
    throw Object.assign(new Error("totp_already_enrolled"), { statusCode: 409 });
  }

  // 20 random bytes = 160 bits of entropy; that's the RFC 6238 SHOULD.
  const secret = base32Encode(randomBytes(20));
  const issuer = options.issuer ?? "OpenMatch Admin";
  const otpauthUri = buildOtpauthUri(secret, admin.email, issuer);

  const recoveryCodes = Array.from({ length: 8 }, generateRecoveryCode);
  const recoveryHashes = recoveryCodes.map(hashRecoveryCode);

  // SEV-V8: encrypt the secret at rest (envelope-encrypted with
  // ADMIN_TOTP_KEK). Falls back to plaintext in dev when KEK is unset.
  const stored = encryptTotpSecret(secret);

  await prisma.adminUser.update({
    where: { id: adminUserId },
    data: {
      totpSecret: stored.stored,
      totpEnrolledAt: new Date(),
      recoveryCodes: recoveryHashes,
    },
  });

  return { otpauthUri, secret, recoveryCodes };
}

export async function verifyTotpCode(
  prisma: PrismaClient,
  adminUserId: string,
  code: string,
): Promise<boolean> {
  const admin = await prisma.adminUser.findUnique({ where: { id: adminUserId } });
  if (!admin || !admin.totpSecret) return false;
  let plaintext: string;
  try {
    plaintext = decryptTotpSecret(admin.totpSecret);
  } catch {
    // Stored ciphertext that we can't decrypt (KEK missing or tampered).
    // Fail closed; the operator must investigate before the admin can
    // verify again.
    return false;
  }
  return verifyTotpAgainstSecret(plaintext, code);
}

export interface RecoveryResult {
  ok: boolean;
  remainingCodes: number;
}

export async function consumeRecoveryCode(
  prisma: PrismaClient,
  adminUserId: string,
  rawCode: string,
): Promise<RecoveryResult> {
  const admin = await prisma.adminUser.findUnique({ where: { id: adminUserId } });
  if (!admin) return { ok: false, remainingCodes: 0 };
  const target = hashRecoveryCode(rawCode);
  // SEV-V2: replace `Array.prototype.includes` with a constant-time
  // sweep across the stored hashes. `includes` short-circuits on the
  // first byte mismatch, which is a per-position timing oracle when
  // the list is small. Iterate every element and accumulate the
  // result so wall-clock time is constant w.r.t. position.
  const targetBuf = Buffer.from(target, "utf8");
  let matched = false;
  for (const stored of admin.recoveryCodes) {
    const storedBuf = Buffer.from(stored, "utf8");
    if (storedBuf.length === targetBuf.length && timingSafeEqual(storedBuf, targetBuf)) {
      matched = true;
    }
  }
  if (!matched) {
    return { ok: false, remainingCodes: admin.recoveryCodes.length };
  }
  const remaining = admin.recoveryCodes.filter((h) => h !== target);
  await prisma.adminUser.update({
    where: { id: adminUserId },
    data: { recoveryCodes: remaining },
  });
  return { ok: true, remainingCodes: remaining.length };
}

export async function elevateAdminSession(prisma: PrismaClient, sessionId: string): Promise<void> {
  await prisma.adminSession.update({
    where: { id: sessionId },
    data: { twoFactorAt: new Date() },
  });
}

export async function disableTotp(prisma: PrismaClient, adminUserId: string): Promise<void> {
  await prisma.adminUser.update({
    where: { id: adminUserId },
    data: { totpSecret: null, totpEnrolledAt: null, recoveryCodes: [] },
  });
}
