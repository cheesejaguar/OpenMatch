import { type NextRequest, NextResponse } from "next/server";

import { negotiateLocale } from "./lib/i18n";

// Lightweight auth gate. We only check for the presence of the signed
// session cookie here; full validation happens server-side in each route
// handler via readSession() + a backend round-trip.

// /status is the public status page — anyone can hit it without auth.
// Keep it in this allowlist so anonymous visitors checking platform
// uptime don't get redirected to /login.
const PUBLIC_PATHS = ["/login", "/login/callback", "/api/auth", "/status"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // I18N — pick a locale per request and forward it via a custom
  // request header (read by `lib/i18n.ts#getLocale`). Order of
  // precedence: explicit `?locale=` → `Accept-Language` → "en".
  const explicit = req.nextUrl.searchParams.get("locale");
  const locale = negotiateLocale(req.headers.get("accept-language"), explicit);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-om-locale", locale);

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isPublic) {
    const cookie = req.cookies.get("om_admin_session");
    if (!cookie) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
