import { NextRequest, NextResponse } from "next/server";

// Lightweight gate: anything that isn't /login, /forbidden, or a Next internal
// requires a session cookie. The route handlers themselves re-check via
// requireSession()/requirePermission() — the middleware exists only to push
// unauthenticated browsers to /login without rendering server work.
const PUBLIC_PATHS = ["/login", "/forbidden", "/_next", "/favicon.ico"];

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => url.pathname.startsWith(p))) return NextResponse.next();
  const cookie = req.cookies.get("om_admin_session")?.value;
  if (!cookie) {
    const next = url.pathname + url.search;
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent(next)}`, req.url),
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/health|_next/static|_next/image|favicon.ico).*)"],
};
