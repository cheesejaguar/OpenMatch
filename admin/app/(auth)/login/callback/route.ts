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
  if (verify.status !== 200) {
    return NextResponse.redirect(new URL("/login?error=verify_failed", url));
  }

  const meRes = await adminFetchWithToken<MeResponse>(
    "/api/v1/admin/auth/me",
    verify.data.accessToken,
  );
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
  return NextResponse.redirect(new URL(next, url));
}
