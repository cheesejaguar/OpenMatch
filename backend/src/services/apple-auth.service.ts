import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../env.js";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = new URL("https://appleid.apple.com/auth/keys");

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(APPLE_JWKS_URL, {
      cacheMaxAge: 24 * 60 * 60 * 1000,
      cooldownDuration: 60_000,
    });
  }
  return jwks;
}

export interface VerifiedAppleIdentity {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  /** The `nonce` claim from the identity token, if Apple included one. */
  nonce?: string;
}

export interface VerifyAppleOptions {
  /**
   * Raw (unhashed) nonce the iOS client used when constructing its
   * ASAuthorizationAppleIDRequest. Apple sets the JWT's `nonce` claim to
   * SHA-256(rawNonce); we recompute the hash and compare. Pass `null` /
   * omit when the client did not send a nonce (legacy clients pre-iOS
   * SDK lane). When env.APPLE_NONCE_REQUIRED is true, omitting the
   * nonce is rejected with `apple_nonce_required` by the caller.
   */
  rawNonce?: string | null;
}

export async function verifyAppleIdentityToken(
  token: string,
  options: VerifyAppleOptions = {},
): Promise<VerifiedAppleIdentity> {
  if (!env.APPLE_CLIENT_ID) {
    throw Object.assign(new Error("apple_not_configured"), { statusCode: 501 });
  }
  const { payload } = await jwtVerify(token, getJwks(), {
    issuer: APPLE_ISSUER,
    audience: env.APPLE_CLIENT_ID,
  });
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw Object.assign(new Error("apple_invalid_sub"), { statusCode: 400 });
  }

  // Nonce verification (SEV-M5).
  //
  // ASAuthorizationAppleIDRequest accepts a `nonce` field. Apple hashes
  // it with SHA-256 and puts the hex digest in the JWT's `nonce` claim.
  // The server must SHA-256 the raw nonce the client sent in the POST
  // body and compare. This binds the identity token to a single login
  // attempt: even if an attacker replays a stolen token to the backend,
  // they need the original raw nonce too.
  const tokenNonceClaim = typeof payload.nonce === "string" ? payload.nonce : undefined;
  if (options.rawNonce != null && options.rawNonce.length > 0) {
    if (!tokenNonceClaim) {
      // Client sent a nonce but Apple didn't echo one back — that's a
      // protocol failure on the iOS side or an intercepted token.
      throw Object.assign(new Error("apple_nonce_mismatch"), { statusCode: 401 });
    }
    const expected = createHash("sha256").update(options.rawNonce).digest("hex");
    if (!safeEqual(expected, tokenNonceClaim)) {
      throw Object.assign(new Error("apple_nonce_mismatch"), { statusCode: 401 });
    }
  } else if (env.APPLE_NONCE_REQUIRED) {
    // Feature flag wants strict mode; caller must supply a nonce.
    throw Object.assign(new Error("apple_nonce_required"), { statusCode: 400 });
  }

  const email = typeof payload.email === "string" ? payload.email : undefined;
  const emailVerified =
    payload.email_verified === true || payload.email_verified === "true" || undefined;
  return {
    sub: payload.sub,
    email,
    emailVerified,
    nonce: tokenNonceClaim,
  };
}

// Length-checked constant-time comparison. `crypto.timingSafeEqual` requires
// equal-length inputs; we short-circuit on length mismatch first.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
