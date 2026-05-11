import { type NextRequest, NextResponse } from "next/server";
import { adminFetch } from "../../../../lib/api/admin-client";
import { clearSessionCookie, readSession } from "../../../../lib/auth/session";

export async function POST(req: NextRequest) {
  const session = await readSession();
  if (session?.refreshToken) {
    await adminFetch("/api/v1/admin/auth/logout", {
      method: "POST",
      body: { refreshToken: session.refreshToken },
    }).catch(() => {});
  }
  await clearSessionCookie();
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
