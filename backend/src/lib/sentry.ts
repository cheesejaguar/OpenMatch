import * as Sentry from "@sentry/node";
import type { FastifyRequest } from "fastify";
import { env } from "../env.js";

// OPS-3 — Sentry SDK wiring.
//
// Initialised at module load (before any handler can throw) but kept
// behind an env-driven flag so dev/CI without a DSN remain quiet and
// don't ship synthetic errors to Sentry's free tier.
//
// Per-request user tagging hooks the `req.userId` populated by the auth
// plugin onto each scope, so a 5xx captured below carries the actor's
// id in the Sentry UI without leaking it into headers.

let initialised = false;

export function initSentry(): void {
  if (initialised) return;
  if (!env.SENTRY_DSN) {
    // eslint-disable-next-line no-console
    console.warn("[sentry] SENTRY_DSN not set — Sentry disabled");
    initialised = true;
    return;
  }
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release: env.SENTRY_RELEASE,
    tracesSampleRate: 0.1,
    // Profiling stays off unless someone explicitly opts in by
    // installing @sentry/profiling-node; the import is dynamic so
    // production deployments don't pull in the native binding when
    // they don't want it.
    profilesSampleRate: 0.1,
  });
  initialised = true;
}

export async function sentryUserHook(req: FastifyRequest): Promise<void> {
  if (!env.SENTRY_DSN) return;
  const userId = (req as FastifyRequest & { userId?: string }).userId;
  if (!userId) return;
  Sentry.getCurrentScope().setUser({ id: userId });
}

export function sentryFastifyErrorHook(req: FastifyRequest, err: unknown): void {
  if (!env.SENTRY_DSN) return;
  Sentry.withScope((scope) => {
    const userId = (req as FastifyRequest & { userId?: string }).userId;
    if (userId) scope.setUser({ id: userId });
    scope.setTag("route", req.routeOptions?.url ?? req.url);
    scope.setTag("method", req.method);
    Sentry.captureException(err);
  });
}
