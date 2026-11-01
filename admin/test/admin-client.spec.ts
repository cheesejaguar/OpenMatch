import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../lib/api/error-codes";
import { API_BASE, setRawSessionCookie, signIn, signOut, TEST_SESSION } from "./backend";

// Round B — verifies the typed Result<T, AdminApiError> the admin client
// returns. The real env, session and URL-builder code runs; only Next's
// request-scoped cookie store and the network (global fetch) are stubbed.

vi.mock("next/headers", async () => (await import("./backend")).nextHeaders);

function mockResponse(opts: { status: number; body?: string; contentType?: string }): Response {
  const headers: Record<string, string> = {};
  if (opts.contentType) headers["content-type"] = opts.contentType;
  return new Response(opts.body ?? "", {
    status: opts.status,
    headers,
  });
}

describe("admin client request construction", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(mockResponse({ status: 200, body: "{}" }));
    signOut();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("anchors the path to ADMIN_API_BASE_URL and serialises query + JSON body", async () => {
    const { adminFetch } = await import("../lib/api/admin-client");
    await adminFetch("/api/v1/admin/users", {
      method: "POST",
      query: { q: "alice", limit: 20, skip: undefined, none: null, active: true },
      body: { reason: "spam" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${API_BASE}/api/v1/admin/users?q=alice&limit=20&active=true`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ reason: "spam" }));
    expect(init.headers).toMatchObject({
      accept: "application/json",
      "content-type": "application/json",
    });
    expect(init.headers.authorization).toBeUndefined();
  });

  it("sends the session access token as a bearer header when signed in", async () => {
    await signIn();
    const { adminFetch } = await import("../lib/api/admin-client");
    await adminFetch("/api/v1/admin/me");
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.headers.authorization).toBe(`Bearer ${TEST_SESSION.accessToken}`);
  });

  it("ignores a session cookie whose signature has been tampered with", async () => {
    await signIn();
    const { encode } = await import("../lib/auth/session");
    const [body] = encode(TEST_SESSION).split(".");
    setRawSessionCookie(`${body}.forged-signature`);
    const { adminFetch } = await import("../lib/api/admin-client");
    await adminFetch("/api/v1/admin/me");
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers.authorization).toBeUndefined();
  });

  it.each([
    "//attacker.example/steal",
    "https://attacker.example/steal",
    "/api/v1/admin/users/<script>",
    "/api/v1/admin/users/a b",
    "",
  ])("refuses to build a request for unsafe path %j", async (path) => {
    const { adminFetch } = await import("../lib/api/admin-client");
    await expect(adminFetch(path)).rejects.toThrow(/admin api path/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws a typed error when throwOnError is set", async () => {
    const { adminFetch } = await import("../lib/api/admin-client");
    fetchMock.mockResolvedValueOnce(
      mockResponse({ status: 403, body: JSON.stringify({ error: "admin_rbac_denied" }) }),
    );
    await expect(
      adminFetch("/api/v1/admin/users/u1/ban", { method: "POST", throwOnError: true }),
    ).rejects.toMatchObject({
      status: 403,
      error: { code: ErrorCodes.ADMIN_RBAC_DENIED },
    });
  });
});

describe("admin client typed error parsing", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok: true on 200 with parsed body", async () => {
    const { adminFetch } = await import("../lib/api/admin-client");
    fetchMock.mockResolvedValueOnce(
      mockResponse({ status: 200, body: JSON.stringify({ hello: "world" }) }),
    );
    const res = await adminFetch<{ hello: string }>("/api/v1/admin/ping");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.hello).toBe("world");
      expect(res.status).toBe(200);
    }
  });

  it("returns ok: true on 204 with null data", async () => {
    const { adminFetch } = await import("../lib/api/admin-client");
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 204 }));
    const res = await adminFetch("/api/v1/admin/empty");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.status).toBe(204);
      expect(res.data).toBeNull();
    }
  });

  it("parses an error code from a 4xx body", async () => {
    const { adminFetch } = await import("../lib/api/admin-client");
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 403,
        body: JSON.stringify({ error: "admin_rbac_denied", required: "user.ban" }),
      }),
    );
    const res = await adminFetch("/api/v1/admin/users/u1/ban", { method: "POST" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe(ErrorCodes.ADMIN_RBAC_DENIED);
      expect(res.error.payload?.required).toBe("user.ban");
      expect(res.status).toBe(403);
    }
  });

  it("surfaces validation fields from validation_failed", async () => {
    const { adminFetch } = await import("../lib/api/admin-client");
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 400,
        body: JSON.stringify({
          error: "validation_failed",
          fields: [
            { path: "email", message: "required" },
            { path: "displayName", message: "too short", code: "min_length" },
          ],
        }),
      }),
    );
    const res = await adminFetch("/api/v1/admin/admin-users", {
      method: "POST",
      body: {},
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe(ErrorCodes.VALIDATION_FAILED);
      expect(res.error.fields).toEqual([
        { path: "email", message: "required" },
        { path: "displayName", message: "too short", code: "min_length" },
      ]);
    }
  });

  it("returns internal_error on a non-JSON 5xx body", async () => {
    const { adminFetch } = await import("../lib/api/admin-client");
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 502,
        body: "<html><body>Bad Gateway</body></html>",
        contentType: "text/html",
      }),
    );
    const res = await adminFetch("/api/v1/admin/health");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(res.error.message).toContain("non-json");
      expect(res.status).toBe(502);
    }
  });

  it("returns internal_error on an empty 5xx body", async () => {
    const { adminFetch } = await import("../lib/api/admin-client");
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 500, body: "" }));
    const res = await adminFetch("/api/v1/admin/health");
    // Empty body parses as JSON null successfully; we surface it as
    // INTERNAL_ERROR because the response wasn't an object.
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it("maps unknown error codes through INTERNAL_ERROR", async () => {
    const { adminFetch } = await import("../lib/api/admin-client");
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 418,
        body: JSON.stringify({ error: "im_a_teapot", message: "short and stout" }),
      }),
    );
    const res = await adminFetch("/api/v1/admin/teapot");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(res.error.message).toBe("short and stout");
    }
  });

  it("preserves payload-bearing fields on outside_metro", async () => {
    const { adminFetch } = await import("../lib/api/admin-client");
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 451,
        body: JSON.stringify({ error: "outside_metro", nearestKm: 42.7 }),
      }),
    );
    const res = await adminFetch("/api/v1/admin/probe");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe(ErrorCodes.OUTSIDE_METRO);
      expect(res.error.payload?.nearestKm).toBe(42.7);
    }
  });

  it("preserves payload-bearing fields on country_not_supported", async () => {
    const { adminFetch } = await import("../lib/api/admin-client");
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 451,
        body: JSON.stringify({
          error: "country_not_supported",
          reason: "sanctions",
          note: "Try again later.",
        }),
      }),
    );
    const res = await adminFetch("/api/v1/admin/probe");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe(ErrorCodes.COUNTRY_NOT_SUPPORTED);
      expect(res.error.payload?.reason).toBe("sanctions");
      expect(res.error.payload?.note).toBe("Try again later.");
    }
  });

  it("preserves the unauthorized code on 401", async () => {
    const { adminFetch } = await import("../lib/api/admin-client");
    fetchMock.mockResolvedValueOnce(
      mockResponse({ status: 401, body: JSON.stringify({ error: "unauthorized" }) }),
    );
    const res = await adminFetch("/api/v1/admin/me");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    }
  });

  it("handles 429 rate_limited", async () => {
    const { adminFetch } = await import("../lib/api/admin-client");
    fetchMock.mockResolvedValueOnce(
      mockResponse({ status: 429, body: JSON.stringify({ error: "rate_limited" }) }),
    );
    const res = await adminFetch("/api/v1/admin/ping");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe(ErrorCodes.RATE_LIMITED);
    }
  });
});
