import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import fp from "fastify-plugin";
import ws from "ws";
import { env } from "../env.js";
import { ensureConnectionLimit } from "../lib/db-url.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

// Neon's serverless driver speaks WebSockets when running in Node (vs. native
// `fetch` in Edge). Wire the ws shim once per process.
if (typeof WebSocket === "undefined") {
  neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
}

type GlobalWithPrisma = typeof globalThis & { __omPrisma?: PrismaClient };
const g = globalThis as GlobalWithPrisma;

// Slow-query telemetry threshold. Queries running longer than this are
// logged at WARN with the (parameterised) statement so we can spot
// regressions before they hit user-visible latency. 200ms is the audit's
// recommended trigger — typical Prisma + Neon round-trip is 5-30ms, so
// anything beyond 200ms suggests either a missing index, a planner
// regression, or a runaway N+1.
const SLOW_QUERY_MS = Number(env.SLOW_QUERY_LOG_THRESHOLD_MS ?? 200);

function buildClient(): PrismaClient {
  // In test/dev against a vanilla Postgres (the docker-compose service or
  // the CI container), the Neon WebSocket adapter doesn't speak the same
  // protocol and connections hang. Use adapter-pg in those environments —
  // production still uses Neon.
  const useNeonAdapter = env.NODE_ENV === "production" || /\.neon\.tech\b/.test(env.DATABASE_URL);
  // PERF-1: append connection_limit=20 if the operator didn't set one.
  // Bounds the per-instance pool so we don't exhaust Neon's connection
  // ceiling under Fluid Compute's many-instance concurrency.
  const url = ensureConnectionLimit(env.DATABASE_URL);
  const adapter = useNeonAdapter ? new PrismaNeon({ connectionString: url }) : new PrismaPg(url);
  return new PrismaClient({
    adapter,
    // PERF-TELEMETRY: surface slow queries via Prisma's `query` event so
    // future perf work is data-driven. The `event` log level routes to
    // `$on('query', ...)` rather than to stdout, so it doesn't double up
    // with Pino's request-level logging.
    log: [{ emit: "event", level: "query" }],
  });
}

if (!g.__omPrisma) {
  g.__omPrisma = buildClient();
}
export const prisma: PrismaClient = g.__omPrisma;

export default fp(async (app) => {
  app.decorate("prisma", prisma);

  // PERF-TELEMETRY: log slow queries (> SLOW_QUERY_MS) with the
  // parameterised SQL + duration. Routes through the request-scoped
  // Pino logger when available so the slow-query record carries the
  // requestId / userId of the request that triggered it. The query
  // event itself is parameterised — no PII appears in `e.query`.
  // biome-ignore lint/suspicious/noExplicitAny: Prisma's event types
  // are not surfaced uniformly across versions; we narrow at use site.
  (prisma as unknown as { $on: (e: string, cb: (event: any) => void) => void }).$on(
    "query",
    (e: { query: string; duration: number; params: string }) => {
      if (e.duration < SLOW_QUERY_MS) return;
      app.log.warn(
        {
          event: "prisma.slow_query",
          durationMs: e.duration,
          // The parameter array is stringified by Prisma — we redact
          // the values and keep only the placeholder count so logs
          // never carry user-provided data (emails, ids, etc.).
          paramCount: (e.params.match(/\$\d+/g) ?? []).length,
          query: e.query.slice(0, 500),
        },
        "prisma_slow_query",
      );
    },
  );
});
