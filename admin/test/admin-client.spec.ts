import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../lib/api/error-codes";

// Round B — verifies the typed Result<T, AdminApiError> the admin client
// now returns. Mocks the env + session modules so the URL builder and
// SSRF guard run, then stubs global fetch with a synthetic Response.

vi.mock("server-only", () => ({}));

vi.mock("../lib/env", () => ({
  env: () => ({ ADMIN_API_BASE_URL: "https://api.example.com" }),
  assertNoPreviewToProd: vi.fn(),
}));

vi.mock("../lib/auth/session", () => ({
  readSession: vi.fn(async () => null),
}));

function mockResponse(opts: { status: number; body?: string; contentType?: string }): Response {
  const headers: Record<string, string> = {};
  if (opts.contentType) headers["content-type"] = opts.contentType;
  return new Response(opts.body ?? "", {
    status: opts.status,
    headers,
  });
}

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
