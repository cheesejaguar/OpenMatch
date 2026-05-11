import { redirect } from "next/navigation";
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

interface Params {
  searchParams: Promise<{ challengeId?: string; token?: string; next?: string }>;
}

export default async function CallbackPage({ searchParams }: Params) {
  const sp = await searchParams;
  if (!sp.challengeId || !sp.token) {
    redirect("/login?error=missing_parameters");
  }
  const verify = await adminPublicFetch<VerifyResponse>("/api/v1/admin/auth/verify", {
    challengeId: sp.challengeId,
    token: sp.token,
  });
  if (verify.status !== 200) {
    redirect("/login?error=verify_failed");
  }
  // We've got an admin access token but no session cookie yet, so call
  // /me with an explicit bearer through the same anchored URL builder
  // used elsewhere.
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
  redirect(sp.next ?? "/overview");
}
