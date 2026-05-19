import { type NextRequest, NextResponse } from "next/server";
import { adminFetchWithToken, adminPublicFetch } from "../../../../lib/api/admin-client";
import { setSessionCookie } from "../../../../lib/auth/session";

interface VerifyResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

interface MeResponse {
  adminUserId: string;
  email: string;
  roles: string[];
  permissions: string[];
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const challengeId = url.searchParams.get("challengeId");
  const token = url.searchParams.get("token");
  const next = url.searchParams.get("next") ?? "/overview";

  if (!challengeId || !token) {
    return NextResponse.redirect(new URL("/login?error=missing_parameters", url));
  }

  const verify = await adminPublicFetch<VerifyResponse>("/api/v1/admin/auth/verify", {
    challengeId,
    token,
  });
  if (!verify.ok) {
    return NextResponse.redirect(
      new URL(`/login?error=verify_failed&code=${encodeURIComponent(verify.error.code)}`, url),
    );
  }

  const meRes = await adminFetchWithToken<MeResponse>(
    "/api/v1/admin/auth/me",
    verify.data.accessToken,
  );
  if (!meRes.ok) {
    return NextResponse.redirect(
      new URL(`/login?error=me_failed&code=${encodeURIComponent(meRes.error.code)}`, url),
    );
  }
  const meData = meRes.data;
  await setSessionCookie({
    adminUserId: meData.adminUserId,
    email: meData.email,
    roles: meData.roles,
    permissions: meData.permissions,
    accessToken: verify.data.accessToken,
    refreshToken: verify.data.refreshToken,
    accessExpiresAt: verify.data.expiresAt,
  });

  // Round 3 (ADMIN-9): after a successful magic-link verify the session
  // is NOT yet 2FA-elevated. We probe /totp/status and route to either
  // the enrolment page (first-time admins) or the verify page (returning
  // admins). The destination `next` is forwarded so post-2FA we land on
  // the originally-requested page.
  const statusRes = await adminFetchWithToken<{
    enrolled: boolean;
    twoFactorAt: string | null;
    twoFactorRequired: boolean;
  }>("/api/v1/admin/auth/totp/status", verify.data.accessToken);
  if (statusRes.ok && statusRes.data.twoFactorRequired) {
    if (!statusRes.data.enrolled) {
      return NextResponse.redirect(
        new URL(`/login/totp-enroll?next=${encodeURIComponent(next)}`, url),
      );
    }
    if (!statusRes.data.twoFactorAt) {
      return NextResponse.redirect(
        new URL(`/login/totp-verify?next=${encodeURIComponent(next)}`, url),
      );
    }
  }
  return NextResponse.redirect(new URL(next, url));
}
