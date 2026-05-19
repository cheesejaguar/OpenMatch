import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../env.js";

// /health vs /ready (OPS-5).
//
//   /health — minimal liveness probe. Returns 200 if the process is up
//             and the route can answer; no dependency checks. Vercel /
//             k8s use this as the liveness probe.
//   /ready  — readiness probe. Checks Postgres + Ably (configured?) +
//             Upstash Redis (configured?) and returns 200 only when
//             every configured dependency answers. Vercel / k8s use
//             this as the traffic-eligibility gate.
//
// Both endpoints are unauthenticated. Results from /ready are cached
// for 5 seconds so a probing flood doesn't hammer the dependency layer.

type CheckResult = {
  ok: boolean;
  configured: boolean;
  latencyMs?: number;
  error?: string;
};

export type ReadyChecks = {
  postgres: CheckResult;
  ably: CheckResult;
  redis: CheckResult;
};

export interface ReadyResponse {
  ok: boolean;
  checkedAt: string;
  checks: ReadyChecks;
}

const READY_CACHE_MS = 5_000;
const CHECK_TIMEOUT_MS = 1_000;

type CachedReady = { snapshot: ReadyResponse; expiresAt: number };
let cached: CachedReady | null = null;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

async function checkPostgres(app: import("fastify").FastifyInstance): Promise<CheckResult> {
  const started = Date.now();
  try {
    await withTimeout(app.prisma.$queryRawUnsafe("SELECT 1"), CHECK_TIMEOUT_MS);
    return { ok: true, configured: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      latencyMs: Date.now() - started,
      error: (err as Error).message,
    };
  }
}

async function checkAbly(): Promise<CheckResult> {
  if (!env.ABLY_API_KEY) {
    return { ok: true, configured: false };
  }
  const started = Date.now();
  try {
    // Light-touch Ably reachability: hit the time-endpoint (no auth
    // required if the API key is in the URL Basic-auth header). 1s
    // timeout — anything slower means the realtime layer is unhealthy
    // even if the API is technically up.
    const [keyName, keySecret] = env.ABLY_API_KEY.split(":");
    if (!keyName || !keySecret) {
      return { ok: false, configured: true, error: "invalid_ably_key_format" };
    }
    const auth = Buffer.from(`${keyName}:${keySecret}`).toString("base64");
    const res = await withTimeout(
      fetch("https://rest.ably.io/time", { headers: { Authorization: `Basic ${auth}` } }),
      CHECK_TIMEOUT_MS,
    );
    if (!res.ok) {
      return {
        ok: false,
        configured: true,
        latencyMs: Date.now() - started,
        error: `ably_status_${res.status}`,
      };
    }
    return { ok: true, configured: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      latencyMs: Date.now() - started,
      error: (err as Error).message,
    };
  }
}

async function checkRedis(app: import("fastify").FastifyInstance): Promise<CheckResult> {
  if (!app.redis) {
    return { ok: true, configured: false };
  }
  const started = Date.now();
  try {
    const pong = await withTimeout(app.redis.ping(), CHECK_TIMEOUT_MS);
    if (pong !== "PONG") {
      return {
        ok: false,
        configured: true,
        latencyMs: Date.now() - started,
        error: `unexpected_ping_response`,
      };
    }
    return { ok: true, configured: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      latencyMs: Date.now() - started,
      error: (err as Error).message,
    };
  }
}

export async function buildReadySnapshot(
  app: import("fastify").FastifyInstance,
): Promise<ReadyResponse> {
  const [postgres, ably, redis] = await Promise.all([
    checkPostgres(app),
    checkAbly(),
    checkRedis(app),
  ]);
  // Overall ok iff every CONFIGURED dependency responded ok.
  const ok = [postgres, ably, redis].every((c) => !c.configured || c.ok);
  return {
    ok,
    checkedAt: new Date().toISOString(),
    checks: { postgres, ably, redis },
  };
}

async function getCachedReady(app: import("fastify").FastifyInstance): Promise<ReadyResponse> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.snapshot;
  }
  const snapshot = await buildReadySnapshot(app);
  cached = { snapshot, expiresAt: now + READY_CACHE_MS };
  return snapshot;
}

// Test-only escape hatch so a spec can simulate Postgres being down
// without actually killing the connection pool. Not exported elsewhere.
export function _resetReadyCacheForTests() {
  cached = null;
}

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/ready", async (_req: FastifyRequest, reply: FastifyReply) => {
    const snapshot = await getCachedReady(app);
    return reply.code(snapshot.ok ? 200 : 503).send(snapshot);
  });
};
