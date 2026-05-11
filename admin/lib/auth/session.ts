import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "../env";

// Session cookie carries (a) the backend access token, (b) the refresh
// token, (c) admin metadata, signed with ADMIN_SESSION_SECRET so the
// browser cannot tamper with it. The actual access token verification
// happens on the backend on every request; this signature is only to
// detect cookie tampering, not as the authoritative auth check.

export interface AdminSessionPayload {
  adminUserId: string;
  email: string;
  roles: string[];
  permissions: string[];
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
}

const COOKIE_NAME = "om_admin_session";
const SEPARATOR = ".";

function sign(value: string): string {
  return createHmac("sha256", env().ADMIN_SESSION_SECRET).update(value).digest("base64url");
}

export function encode(payload: AdminSessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}${SEPARATOR}${sign(body)}`;
}

export function decode(raw: string | undefined | null): AdminSessionPayload | null {
  if (!raw) return null;
  const [body, mac] = raw.split(SEPARATOR);
  if (!body || !mac) return null;
  const expected = sign(body);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export async function setSessionCookie(payload: AdminSessionPayload): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, encode(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: env().NODE_ENV === "production",
    path: "/",
    // Tie the cookie lifetime to the refresh token's max-age. Server-side
    // we further enforce expiry against accessExpiresAt before each
    // backend call, so this is just a defense-in-depth.
    maxAge: 24 * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function readSession(): Promise<AdminSessionPayload | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  return decode(raw);
}
