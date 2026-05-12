import { type NextRequest, NextResponse } from "next/server";

// Lightweight auth gate. We only check for the presence of the signed
// session cookie here; full validation happens server-side in each route
// handler via readSession() + a backend round-trip.

const PUBLIC_PATHS = ["/login", "/login/callback", "/api/auth"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  const cookie = req.cookies.get("om_admin_session");
  if (!cookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
