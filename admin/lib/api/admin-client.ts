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

export async function adminFetch<T = unknown>(
  path: string,
  opts: ClientOptions = {},
): Promise<{ status: number; data: T }> {
  const e = env();
  assertNoPreviewToProd(e.ADMIN_API_BASE_URL);
  const session = await readSession();
  const url = new URL(path.startsWith("/") ? path : `/${path}`, e.ADMIN_API_BASE_URL);
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

// Unauthenticated POST — used for /admin/auth/start and /verify, which
// don't have a session yet.
export async function adminPublicFetch<T = unknown>(
  path: string,
  body: unknown,
): Promise<{ status: number; data: T }> {
  const e = env();
  assertNoPreviewToProd(e.ADMIN_API_BASE_URL);
  const url = new URL(path.startsWith("/") ? path : `/${path}`, e.ADMIN_API_BASE_URL);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}
