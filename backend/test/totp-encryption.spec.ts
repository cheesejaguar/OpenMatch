import { afterEach, describe, expect, it } from "vitest";
import {
  _resetTotpKeyCacheForTests,
  decryptTotpSecret,
  encryptTotpSecret,
  isEncryptedTotpSecret,
} from "../src/lib/crypto/totp-encryption.js";

// SEV-V8: envelope encryption for AdminUser.totpSecret. The helpers
// must round-trip cleanly when ADMIN_TOTP_KEK is set, must fall back
// to plaintext when it's unset (dev-only behaviour with a documented
// warning), and must transparently read legacy plaintext rows during
// the migration window.

const PRIOR_KEK = process.env.ADMIN_TOTP_KEK;

afterEach(() => {
  // process.env.X = undefined stores the literal string "undefined";
  // explicitly delete instead so the env schema's `optional()`
  // semantics observe a true absence between tests.
  if (PRIOR_KEK === undefined) {
    delete process.env.ADMIN_TOTP_KEK;
  } else {
    process.env.ADMIN_TOTP_KEK = PRIOR_KEK;
  }
  _resetTotpKeyCacheForTests();
});

describe("SEV-V8 totp envelope encryption", () => {
  it("falls back to plaintext when ADMIN_TOTP_KEK is unset", () => {
    delete process.env.ADMIN_TOTP_KEK;
    _resetTotpKeyCacheForTests();
    const result = encryptTotpSecret("JBSWY3DPEHPK3PXP");
    expect(result.encrypted).toBe(false);
    expect(result.stored).toBe("JBSWY3DPEHPK3PXP");
    expect(isEncryptedTotpSecret(result.stored)).toBe(false);
  });

  it("decryptTotpSecret transparently returns legacy plaintext", () => {
    delete process.env.ADMIN_TOTP_KEK;
    _resetTotpKeyCacheForTests();
    expect(decryptTotpSecret("JBSWY3DPEHPK3PXP")).toBe("JBSWY3DPEHPK3PXP");
  });

  // The env schema only reads ADMIN_TOTP_KEK at module-load time and
  // caches it via the `env` object, so we can't flip it mid-test for
  // the encryption path. These two assertions cover the fallback /
  // legacy-read paths; the encrypted-write path is covered by the
  // integration test suite when ADMIN_TOTP_KEK is exported in CI.
});
