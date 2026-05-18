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
}

export async function verifyAppleIdentityToken(token: string): Promise<VerifiedAppleIdentity> {
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
  const email = typeof payload.email === "string" ? payload.email : undefined;
  const emailVerified =
    payload.email_verified === true || payload.email_verified === "true" || undefined;
  return { sub: payload.sub, email, emailVerified };
}
