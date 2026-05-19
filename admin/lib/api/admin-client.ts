import "server-only";
import { readSession } from "../auth/session";
import { assertNoPreviewToProd, env } from "../env";
import { type ErrorCode, ErrorCodes, isKnownErrorCode } from "./error-codes";

// Round B — typed Result<T, AdminApiError>.
//
// Every admin server-side fetch returns a discriminated union so call
// sites can pattern-match on the failure mode (validation, RBAC,
// not-found, etc.) instead of inspecting raw status codes. Unknown
// error codes are funnelled through INTERNAL_ERROR so future codes
// added to the backend registry don't silently break the UI.

export interface AdminApiValidationField {
  path: string;
  message: string;
  code?: string;
}

export interface AdminApiError {
  /** Typed error code from `backend/src/lib/error-codes.ts`. */
  code: ErrorCode;
  /** Server-supplied human-readable message, when present. */
  message?: string;
  /** Populated when `code === validation_failed`. */
  fields?: AdminApiValidationField[];
  /**
   * Extra payload carried by codes like `outside_metro` (nearestKm),
   * `country_not_supported` (reason, note), and `admin_rbac_denied`
   * (required permission).
   */
  payload?: Record<string, unknown>;
}

export type AdminApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: AdminApiError };

export interface ClientOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /**
   * Legacy escape hatch: throw on non-2xx instead of returning
   * { ok: false }. Only kept for one call site that wants Next.js's
   * default error UI (admin/app/(auth)/login/callback).
   */
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

// Parses an arbitrary error body into the typed AdminApiError shape.
// Exported for tests so they can verify the parsing logic without
// standing up a live backend.
export function parseAdminApiError(status: number, raw: unknown): AdminApiError {
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const rawCode = typeof obj.error === "string" ? obj.error : undefined;
    const code: ErrorCode =
      rawCode && isKnownErrorCode(rawCode) ? rawCode : ErrorCodes.INTERNAL_ERROR;
    const message = typeof obj.message === "string" ? obj.message : undefined;
    const fieldsRaw = Array.isArray(obj.fields) ? obj.fields : undefined;
    const fields: AdminApiValidationField[] | undefined = fieldsRaw
      ?.map((f): AdminApiValidationField | null => {
        if (!f || typeof f !== "object") return null;
        const r = f as Record<string, unknown>;
        if (typeof r.path !== "string" || typeof r.message !== "string") {
          return null;
        }
        const fieldCode = typeof r.code === "string" ? r.code : undefined;
        const field: AdminApiValidationField = { path: r.path, message: r.message };
        if (fieldCode !== undefined) field.code = fieldCode;
        return field;
      })
      .filter((f): f is AdminApiValidationField => f !== null);

    // Anything beyond {error, message, fields} is payload (outside_metro
    // nearestKm, country_not_supported reason/note, admin_rbac_denied
    // required, etc.).
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "error" || k === "message" || k === "fields") continue;
      payload[k] = v;
    }

    return {
      code,
      message,
      ...(fields && fields.length > 0 ? { fields } : {}),
      ...(Object.keys(payload).length > 0 ? { payload } : {}),
    };
  }

  // Non-object body. Surface as a typed internal error so callers don't
  // have to special-case it.
  return {
    code: ErrorCodes.INTERNAL_ERROR,
    message: status >= 500 ? "Server returned a non-JSON response." : undefined,
  };
}

// Safely parses the response body. If the body isn't JSON we still
// produce a typed result rather than silently dropping the failure on
// the floor like the old code did.
async function parseBody(res: Response): Promise<{
  parsed: unknown;
  ok: boolean;
  rawText?: string;
}> {
  // 204 / 205 carry no body.
  if (res.status === 204 || res.status === 205) {
    return { parsed: null, ok: true };
  }
  const text = await res.text();
  if (text.length === 0) {
    return { parsed: null, ok: true, rawText: "" };
  }
  try {
    return { parsed: JSON.parse(text), ok: true, rawText: text };
  } catch {
    return { parsed: null, ok: false, rawText: text };
  }
}

function makeError(
  status: number,
  parsed: unknown,
  parseOk: boolean,
  rawText: string | undefined,
): AdminApiError {
  if (!parseOk) {
    return {
      code: ErrorCodes.INTERNAL_ERROR,
      message:
        rawText && rawText.length > 0
          ? `non-json response: ${rawText.slice(0, 256)}`
          : "non-json response",
    };
  }
  return parseAdminApiError(status, parsed);
}

export async function adminFetch<T = unknown>(
  path: string,
  opts: ClientOptions = {},
): Promise<AdminApiResult<T>> {
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
  const { parsed, ok: parseOk, rawText } = await parseBody(res);
  if (res.status < 200 || res.status >= 300) {
    const error = makeError(res.status, parsed, parseOk, rawText);
    if (opts.throwOnError) {
      const err = new Error(`admin api ${url.pathname}: ${res.status} ${error.code}`);
      (err as Error & { status: number; error: AdminApiError }).status = res.status;
      (err as Error & { status: number; error: AdminApiError }).error = error;
      throw err;
    }
    return { ok: false, status: res.status, error };
  }
  return { ok: true, status: res.status, data: (parsed as T) ?? (null as unknown as T) };
}

// Authenticated GET that takes an explicit bearer token. Used during
// the login callback where we have a fresh access token but no session
// cookie has been set yet.
export async function adminFetchWithToken<T = unknown>(
  path: string,
  accessToken: string,
): Promise<AdminApiResult<T>> {
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
  const { parsed, ok: parseOk, rawText } = await parseBody(res);
  if (res.status < 200 || res.status >= 300) {
    return {
      ok: false,
      status: res.status,
      error: makeError(res.status, parsed, parseOk, rawText),
    };
  }
  return { ok: true, status: res.status, data: (parsed as T) ?? (null as unknown as T) };
}

// Unauthenticated POST — used for /admin/auth/start and /verify, which
// don't have a session yet.
export async function adminPublicFetch<T = unknown>(
  path: string,
  body: unknown,
): Promise<AdminApiResult<T>> {
  const e = env();
  assertNoPreviewToProd(e.ADMIN_API_BASE_URL);
  const url = buildAdminUrl(path, e.ADMIN_API_BASE_URL);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const { parsed, ok: parseOk, rawText } = await parseBody(res);
  if (res.status < 200 || res.status >= 300) {
    return {
      ok: false,
      status: res.status,
      error: makeError(res.status, parsed, parseOk, rawText),
    };
  }
  return { ok: true, status: res.status, data: (parsed as T) ?? (null as unknown as T) };
}
