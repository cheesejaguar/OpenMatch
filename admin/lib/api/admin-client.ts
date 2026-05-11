import "server-only";
import { readSession } from "../auth/session";
import { assertNoPreviewToProd, env } from "../env";

export interface ClientOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  // If true, throw on non-2xx; otherwise return the parsed JSON.
  throwOnError?: boolean;
}

// Build a URL that is anchored to ADMIN_API_BASE_URL no matter what the
// caller passes for `path`. The `new URL(path, base)` constructor by
// itself is vulnerable to SSRF when `path` is a protocol-relative URL
// like "//attacker.com/foo" — the constructor would resolve that to a
// different host. We defend by:
//   1. Refusing absolute URLs and protocol-relative paths.
//   2. Restricting the path to a safe character set (alnum, `-`, `_`,
//      `/`, `.`, `%`, no leading double-slash).
//   3. Setting `pathname` directly on a URL built solely from the base,
//      so the origin is fixed.
function buildAdminUrl(rawPath: string, baseUrl: string): URL {
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    throw new Error("invalid admin api path");
  }
  // Strip query/hash; we add the query separately below.
  const [pathOnly] = rawPath.split(/[?#]/);
  if (!pathOnly) throw new Error("invalid admin api path");
  // Disallow absolute URLs and protocol-relative paths.
  if (/^[a-z][a-z0-9+.-]*:/i.test(pathOnly) || pathOnly.startsWith("//")) {
    throw new Error("admin api path must be relative");
  }
  // Allow only conservative path characters. Route IDs are cuid()s + a
  // handful of fixed segments, so this set is plenty.
  if (!/^[A-Za-z0-9_\-./%]+$/.test(pathOnly)) {
    throw new Error("admin api path contains disallowed characters");
  }
  const normalized = pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`;
  const url = new URL(baseUrl);
  url.pathname = normalized;
  url.search = "";
  url.hash = "";
  return url;
}

export async function adminFetch<T = unknown>(
  path: string,
  opts: ClientOptions = {},
): Promise<{ status: number; data: T }> {
  const e = env();
  assertNoPreviewToProd(e.ADMIN_API_BASE_URL);
  const session = await readSession();
  const url = buildAdminUrl(path, e.ADMIN_API_BASE_URL);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (session) headers.authorization = `Bearer ${session.accessToken}`;
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as T;
  if (opts.throwOnError && (res.status < 200 || res.status >= 300)) {
    const err = new Error(`admin api ${url.pathname}: ${res.status}`);
    (err as Error & { status: number; data: unknown }).status = res.status;
    (err as Error & { status: number; data: unknown }).data = data;
    throw err;
  }
  return { status: res.status, data };
}

// Authenticated GET that takes an explicit bearer token. Used during
// the login callback where we have a fresh access token but no session
// cookie has been set yet.
export async function adminFetchWithToken<T = unknown>(
  path: string,
  accessToken: string,
): Promise<{ status: number; data: T }> {
  const e = env();
  assertNoPreviewToProd(e.ADMIN_API_BASE_URL);
  const url = buildAdminUrl(path, e.ADMIN_API_BASE_URL);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

// Unauthenticated POST — used for /admin/auth/start and /verify, which
// don't have a session yet.
export async function adminPublicFetch<T = unknown>(
  path: string,
  body: unknown,
): Promise<{ status: number; data: T }> {
  const e = env();
  assertNoPreviewToProd(e.ADMIN_API_BASE_URL);
  const url = buildAdminUrl(path, e.ADMIN_API_BASE_URL);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}
