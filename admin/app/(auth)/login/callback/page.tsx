import { redirect } from "next/navigation";
import { adminPublicFetch } from "../../../../lib/api/admin-client";
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
  // We've got an admin access token. Call /me to load roles and
  // permissions so we can embed them in the session cookie (and avoid an
  // extra hop on every page render).
  const me = await fetch(
    new URL("/api/v1/admin/auth/me", process.env.ADMIN_API_BASE_URL ?? "http://localhost:8080"),
    {
      headers: { authorization: `Bearer ${verify.data.accessToken}` },
      cache: "no-store",
    },
  );
  const meData = (await me.json()) as MeResponse;
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
