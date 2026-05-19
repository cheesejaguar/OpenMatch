import * as Sentry from "@sentry/node";
import type { FastifyRequest } from "fastify";
import { env } from "../env.js";
import { requestContext } from "./request-context.js";

// OPS-3 + Round D — Sentry SDK wiring.
//
// Initialised at module load (before any handler can throw) but kept
// behind an env-driven flag so dev/CI without a DSN remain quiet and
// don't ship synthetic errors to Sentry's free tier.
//
// Per-request user tagging hooks the `req.userId` populated by the auth
// plugin onto each scope, so a 5xx captured below carries the actor's
// id in the Sentry UI without leaking it into headers.
//
// Round D adds `beforeSend` to drop expected client errors (4xx + rate
// limits + aborts) and to tag every event with the AsyncLocalStorage
// request id. We also re-export `beforeSendForTest` so unit tests can
// exercise the filter without booting the SDK.

let initialised = false;

interface MaybeHttpError {
  statusCode?: number;
  code?: string;
  name?: string;
}

export function beforeSendForTest(
  event: Sentry.ErrorEvent,
  hint?: Sentry.EventHint,
): Sentry.ErrorEvent | null {
  const err = hint?.originalException as MaybeHttpError | undefined;
  // Drop expected 4xx errors (HttpError shape from Round A).
  if (err?.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
    return null;
  }
  // Drop rate-limit errors regardless of the exact statusCode plumbing.
  if (err?.code === "RATE_LIMITED" || err?.statusCode === 429) {
    return null;
  }
  // Drop expected aborts (URLSession cancels, client disconnects, etc.).
  if (err?.name === "AbortError") return null;
  // Tag with request id from AsyncLocalStorage when present.
  const ctx = requestContext.get();
  if (ctx) {
    event.tags = { ...event.tags, requestId: ctx.requestId };
    if (ctx.userId) event.user = { ...event.user, id: ctx.userId };
    if (ctx.adminUserId) {
      event.tags = { ...event.tags, adminUserId: ctx.adminUserId };
    }
  }
  return event;
}

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
    beforeSend: beforeSendForTest,
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
