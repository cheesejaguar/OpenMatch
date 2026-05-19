// PERF-1 — Postgres connection-pool tuning.
//
// Append a `connection_limit` query parameter to DATABASE_URL when none
// is set. Centralised here so the Prisma plugin can normalise the URL at
// startup and the tests can exercise the parse/append logic directly.
//
// Default = 20: enough headroom for the request-handler concurrency we
// see in production (Vercel Functions reuse instances under Fluid Compute,
// so a small pool per instance multiplied by N instances stays well
// under the 100-connection Neon free-tier ceiling).

const DEFAULT_CONNECTION_LIMIT = 20;

export function ensureConnectionLimit(
  rawUrl: string,
  limit: number = DEFAULT_CONNECTION_LIMIT,
): string {
  if (!rawUrl) return rawUrl;
  // We can't always rely on `URL` (some pgbouncer URLs use unusual
  // characters that older Node versions choke on). Fall back to a
  // light-touch split when URL parsing fails.
  try {
    const u = new URL(rawUrl);
    if (u.searchParams.has("connection_limit")) return rawUrl;
    u.searchParams.set("connection_limit", String(limit));
    return u.toString();
  } catch {
    if (/[?&]connection_limit=/.test(rawUrl)) return rawUrl;
    const sep = rawUrl.includes("?") ? "&" : "?";
    return `${rawUrl}${sep}connection_limit=${limit}`;
  }
}

export const __forTest = {
  DEFAULT_CONNECTION_LIMIT,
};
