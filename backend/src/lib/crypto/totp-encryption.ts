import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { env } from "../../env.js";

// Envelope encryption for AdminUser.totpSecret. Addresses audit
// finding SEV-V8 (TOTP shared secret stored unencrypted at rest).
//
// Wire format (string column): "totpv1:<base64url(iv|tag|ciphertext)>"
// where:
//   - iv: 12 bytes (AES-GCM standard nonce size)
//   - tag: 16 bytes (AES-GCM authentication tag)
//   - ciphertext: plaintext base32-encoded TOTP secret, AES-256-GCM
//
// Key derivation: HKDF-like — scrypt(ADMIN_TOTP_KEK, "openmatch-totp", 32).
// We deliberately use the env value as the password rather than the
// raw key, so an operator can provision the env var as either a hex
// string, a base64 string, or a random passphrase.
//
// Backwards compatibility: when the stored value lacks the "totpv1:"
// prefix we treat it as legacy plaintext base32 and return it as-is.
// This lets the read path succeed during the migration window before
// a re-encryption migration sweeps the existing rows.
//
// When ADMIN_TOTP_KEK is unset we MUST refuse to encrypt (we'd be
// storing plaintext-equivalent data) and fall back to writing the
// legacy plaintext column. This is documented as dev-only behaviour;
// the production deployment runbook requires ADMIN_TOTP_KEK to be set.

const VERSION_PREFIX = "totpv1:";
const KEY_SALT = "openmatch-totp-kek-v1";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

let cachedKey: Buffer | null = null;

function deriveKey(): Buffer | null {
  if (cachedKey) return cachedKey;
  const kek = env.ADMIN_TOTP_KEK;
  if (!kek) return null;
  // scryptSync is deterministic for a given (password, salt, length).
  // N=16384/r=8/p=1 is the Node default and adequate for a startup-time
  // single derivation. We cache the result for the process lifetime.
  cachedKey = scryptSync(kek, KEY_SALT, KEY_LENGTH);
  return cachedKey;
}

export interface EncryptedTotpSecret {
  /**
   * The string value to persist in `AdminUser.totpSecret`. Either an
   * envelope-encrypted string (when ADMIN_TOTP_KEK is configured) or
   * the legacy plaintext base32 secret (dev-only fallback).
   */
  stored: string;
  /** True if the value is the envelope-encrypted form, false if plaintext. */
  encrypted: boolean;
}

/**
 * Encrypt a plaintext TOTP secret for storage at rest. Falls back to
 * returning the plaintext value when no KEK is configured (dev / local
 * loop only — production deployment runbook requires the KEK).
 */
export function encryptTotpSecret(plaintextBase32: string): EncryptedTotpSecret {
  const key = deriveKey();
  if (!key) {
    return { stored: plaintextBase32, encrypted: false };
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintextBase32, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob = Buffer.concat([iv, tag, ciphertext]).toString("base64url");
  return { stored: `${VERSION_PREFIX}${blob}`, encrypted: true };
}

/**
 * Decrypt a stored TOTP secret. Accepts both the envelope-encrypted
 * form ("totpv1:…") and the legacy plaintext base32 form so the
 * migration is non-breaking. Throws on tampered ciphertext.
 */
export function decryptTotpSecret(stored: string): string {
  if (!stored.startsWith(VERSION_PREFIX)) {
    // Legacy plaintext value persisted before ADMIN_TOTP_KEK was
    // configured. Read path returns as-is so existing 2FA enrolments
    // keep working through the migration window.
    return stored;
  }
  const key = deriveKey();
  if (!key) {
    // The column is encrypted but the env var was removed — refuse
    // loudly. Operators must re-provision ADMIN_TOTP_KEK to decrypt.
    throw new Error(
      "totp_kek_unavailable: stored secret is encrypted but ADMIN_TOTP_KEK is not set",
    );
  }
  const blob = Buffer.from(stored.slice(VERSION_PREFIX.length), "base64url");
  if (blob.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("totp_ciphertext_malformed");
  }
  const iv = blob.subarray(0, IV_LENGTH);
  const tag = blob.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

/** True iff `stored` is in the envelope-encrypted format. */
export function isEncryptedTotpSecret(stored: string): boolean {
  return stored.startsWith(VERSION_PREFIX);
}

/** Reset the in-memory cached key. Test-only. */
export function _resetTotpKeyCacheForTests(): void {
  cachedKey = null;
}
