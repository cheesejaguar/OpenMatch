import { vi } from "vitest";
import type { AdminSessionPayload } from "../lib/auth/session";

// Shared test boundary for admin specs.
//
// The admin dashboard talks to the OpenMatch backend over HTTP. Instead
// of mocking our own admin-client / session / server-action modules,
// specs stub only the two things that don't exist outside a running
// Next.js server + backend:
//   1. global `fetch` — the network hop to the backend API, recorded so
//      specs can assert on the exact request the real admin client built.
//   2. `next/headers` cookies() — Next's request-scoped cookie store. The
//      session cookie inside it is produced by the real `encode()` so
//      `readSession()` runs its real HMAC verification.
//
// ADMIN_API_BASE_URL is pinned in test/setup.ts.

export const API_BASE = "https://api.openmatch.test";

export interface RecordedRequest {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
}

export interface FakeResponse {
  status?: number;
  body?: unknown;
  /** Raw body text (skips JSON encoding). */
  text?: string;
  contentType?: string;
}

export type BackendHandler = (req: RecordedRequest) => FakeResponse | undefined;

export function stubBackend(handler: BackendHandler): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      const rawBody = typeof init.body === "string" ? init.body : undefined;
      const req: RecordedRequest = {
        method: init.method ?? "GET",
        url,
        headers: new Headers(init.headers),
        body: rawBody === undefined ? undefined : JSON.parse(rawBody),
      };
      requests.push(req);
      const res = handler(req);
      if (!res) {
        return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
      }
      const status = res.status ?? 200;
      const text =
        res.text ?? (res.body === undefined || status === 204 ? null : JSON.stringify(res.body));
      const headers: Record<string, string> = {};
      if (res.contentType) headers["content-type"] = res.contentType;
      else if (text !== null && res.text === undefined)
        headers["content-type"] = "application/json";
      return new Response(text, { status, headers });
    }),
  );
  return requests;
}

export const TEST_SESSION: AdminSessionPayload = {
  adminUserId: "admin-1",
  email: "admin@openmatch.local",
  roles: ["super_admin"],
  permissions: [],
  accessToken: "test-access-token",
  refreshToken: "test-refresh-token",
  accessExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
};

const SESSION_COOKIE = "om_admin_session";
const cookieJar = new Map<string, string>();

// Dynamic import: lib/auth/session imports next/headers, whose mock
// resolves to this module, so a static import would be circular.
export async function signIn(session: AdminSessionPayload = TEST_SESSION): Promise<void> {
  const { encode } = await import("../lib/auth/session");
  cookieJar.set(SESSION_COOKIE, encode(session));
}

export function setRawSessionCookie(value: string): void {
  cookieJar.set(SESSION_COOKIE, value);
}

export function signOut(): void {
  cookieJar.clear();
}

/** Factory for `vi.mock("next/headers", ...)`. */
export const nextHeaders = {
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
};
