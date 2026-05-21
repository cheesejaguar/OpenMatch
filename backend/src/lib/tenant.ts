import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { config, type OpenMatchConfig } from "./config.js";
import { requestContext } from "./request-context.js";

// Tenant resolution hook.
//
// OpenMatch is a single-tenant codebase (see docs/multi-tenancy.md).
// This module decorates every request with `req.tenant: TenantContext`
// so that:
//
//   1. Log lines + Sentry events carry a `tenantId` field via the
//      request-context AsyncLocalStorage frame (the Pino mixin already
//      reads from there).
//   2. Forks adding true per-tenant data partitioning have a single
//      place to plug in: implement the `MultiTenantHooks` interface,
//      register it via `setTenantResolver`, and every existing route
//      gets the resolved tenant on `req.tenant` without per-handler
//      changes.
//
// The default resolver returns `{ tenantId: 'default', config }` for
// every request — exactly today's behaviour. The lookup precedence is:
//
//   1. `x-openmatch-tenant` request header (test override).
//   2. The first DNS label of `Host` when the host has ≥3 labels and
//      the first label isn't `www` or `api` — e.g. `acme.openmatch.app`
//      resolves to `tenantId=acme`.
//   3. `'default'` fallback.
//
// Forks that DO want per-tenant config can supply a custom resolver via
// `setTenantResolver(fn)` — for example, loading a per-subdomain config
// from a database. The hook signature accepts an async function so the
// resolver can do I/O.

export interface TenantContext {
  tenantId: string;
  config: OpenMatchConfig;
}

export type TenantResolver = (req: FastifyRequest) => Promise<TenantContext> | TenantContext;

/**
 * Optional integration surface for forks that add true multi-tenancy
 * later. The middleware exposed here is the place to plug in a
 * per-tenant config + tenant_id lookup once the data model supports
 * it.
 */
export interface MultiTenantHooks {
  /** Resolve a tenant from the incoming request (subdomain, header, etc.). */
  resolve: TenantResolver;
}

let activeResolver: TenantResolver = defaultResolver;

/**
 * Replace the default tenant resolver. Idempotent; call at boot before
 * any request is served. Tests reset between cases via
 * `resetTenantResolver()`.
 */
export function setTenantResolver(resolver: TenantResolver): void {
  activeResolver = resolver;
}

/** Restore the default subdomain/header resolver. */
export function resetTenantResolver(): void {
  activeResolver = defaultResolver;
}

/** Visible only for tests. */
export function __getActiveResolverForTests(): TenantResolver {
  return activeResolver;
}

const RESERVED_SUBDOMAINS = new Set(["www", "api", "admin", "app"]);
const SAFE_TENANT_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

function extractTenantFromHost(host: string | undefined): string | null {
  if (!host) return null;
  // Strip port. Lowercase for case-insensitive subdomain matching.
  const bare = host.split(":")[0]?.toLowerCase() ?? "";
  const labels = bare.split(".");
  if (labels.length < 3) return null;
  const first = labels[0]!;
  if (RESERVED_SUBDOMAINS.has(first)) return null;
  if (!SAFE_TENANT_ID.test(first)) return null;
  return first;
}

function defaultResolver(req: FastifyRequest): TenantContext {
  // 1. Explicit header override. Useful from integration tests and
  //    internal admin tooling that calls the API from a known origin.
  const headerVal = req.headers["x-openmatch-tenant"];
  const headerTenant = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (typeof headerTenant === "string" && SAFE_TENANT_ID.test(headerTenant)) {
    return { tenantId: headerTenant, config };
  }
  // 2. Subdomain inference.
  const sub = extractTenantFromHost(req.headers.host);
  if (sub) return { tenantId: sub, config };
  // 3. Fallback — single-tenant deploy.
  return { tenantId: "default", config };
}

/**
 * Fastify plugin that decorates every request with `req.tenant` and
 * tags the request-context AsyncLocalStorage frame with `tenantId`
 * so log lines carry it automatically.
 */
async function tenantPlugin(app: FastifyInstance) {
  app.decorateRequest("tenant", null as unknown as TenantContext);
  app.addHook("onRequest", async (req) => {
    const ctx = await activeResolver(req);
    (req as FastifyRequest & { tenant: TenantContext }).tenant = ctx;
    requestContext.set({ tenantId: ctx.tenantId });
  });
}

export default fp(tenantPlugin, {
  name: "tenant",
});

// Type augmentation: every Fastify request has `req.tenant` after the
// plugin registers.
declare module "fastify" {
  interface FastifyRequest {
    tenant: TenantContext;
  }
}
