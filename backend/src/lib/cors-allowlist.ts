// SEV-N4 — strict CORS allowlist parsing.
//
// The previous implementation was `env.CORS_ORIGIN.split(",")` paired
// with `credentials: true`, which had three failure modes:
//   1. Trailing slash / hash / search path on an entry would silently
//      break matching without warning (fastify-cors string-matches the
//      Origin header exactly).
//   2. A literal `*` or `null` entry would fail open under
//      `credentials: true`, exposing every API to any origin.
//   3. The default values point at `http://localhost:*` — in production
//      this means a local-host attacker page (Service Worker, local AV
//      proxy, dev tunnel) can call the production API with the user's
//      session intact.
//
// This helper validates each entry through `new URL()`, normalises it to
// `${origin}` (scheme + host + optional port — no path, no fragment), and
// refuses to boot in production when an allowlist entry would broaden
// the surface (localhost / 127.0.0.1 / `*`).

const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

export class CorsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorsConfigError";
  }
}

function normaliseOrigin(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new CorsConfigError("empty entry in CORS allowlist");
  }
  if (trimmed === "*" || trimmed === "null") {
    throw new CorsConfigError(`forbidden CORS allowlist entry: ${trimmed}`);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new CorsConfigError(`invalid CORS allowlist entry (not a URL): ${trimmed}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CorsConfigError(`unsupported scheme in CORS allowlist: ${trimmed}`);
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new CorsConfigError(`CORS allowlist entry must not include a path: ${trimmed}`);
  }
  if (
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new CorsConfigError(
      `CORS allowlist entry must not include credentials/query/fragment: ${trimmed}`,
    );
  }
  return parsed.origin;
}

function isLocalhostOrigin(origin: string): boolean {
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  return LOCALHOST_HOSTS.has(u.hostname);
}

/**
 * Parse and validate the CORS allowlist. Returns a deduped list of origin
 * strings (scheme + host + optional port) suitable for `@fastify/cors`'s
 * `origin` option.
 *
 * Throws `CorsConfigError` for any malformed entry. Refuses to boot in
 * production if the resulting allowlist contains localhost / loopback —
 * production must explicitly override `CORS_ORIGIN` and `ADMIN_CORS_ORIGIN`.
 */
export function parseCorsAllowlist(
  consumer: string,
  admin: string,
  nodeEnv: "development" | "test" | "production",
): string[] {
  const merged = [...consumer.split(","), ...admin.split(",")]
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (merged.length === 0) {
    if (nodeEnv === "production") {
      throw new CorsConfigError(
        "CORS_ORIGIN and ADMIN_CORS_ORIGIN are both empty; production requires an explicit allowlist",
      );
    }
    return [];
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of merged) {
    const origin = normaliseOrigin(raw);
    if (seen.has(origin)) continue;
    seen.add(origin);
    out.push(origin);
  }

  if (nodeEnv === "production") {
    const offenders = out.filter(isLocalhostOrigin);
    if (offenders.length > 0) {
      throw new CorsConfigError(
        `CORS allowlist must not include localhost in production: ${offenders.join(", ")}`,
      );
    }
  }

  return out;
}
