import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

// Round D — observability hardening.
//
// AsyncLocalStorage-backed request context. Every Fastify request runs
// inside a `requestContext.run({ requestId })` frame so the Pino mixin
// and Sentry beforeSend filter can tag log lines / events with the
// active request id without threading it through every function call.
//
// Workers (cron entry points) wrap themselves with `workerRun(label)` so
// their log output carries `requestId: worker.<label>.<uuid>` and the
// same observability story applies whether code runs inside a request
// or a scheduled invocation.

export interface RequestContext {
  requestId: string;
  userId?: string;
  adminUserId?: string;
  cohortLabel?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  get: (): RequestContext | undefined => storage.getStore(),
  run: <T>(ctx: RequestContext, fn: () => Promise<T> | T): Promise<T> | T => storage.run(ctx, fn),
  // Convenience: spawn a worker context with a fresh request id so every
  // log line emitted from inside the worker is tagged consistently.
  // When called from inside an existing request context (e.g. a worker
  // invoked from an internal route handler) the inherited requestId is
  // preserved instead of spawning a new one — keeps the audit chain
  // legible.
  workerRun: <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    const existing = storage.getStore();
    if (existing) return Promise.resolve(fn());
    return storage.run({ requestId: `worker.${label}.${randomUUID()}` }, fn);
  },
  set(partial: Partial<RequestContext>): void {
    const cur = storage.getStore();
    if (cur) Object.assign(cur, partial);
  },
};
