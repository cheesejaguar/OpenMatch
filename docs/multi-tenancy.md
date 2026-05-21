# Multi-tenancy

## Decision

**OpenMatch is an explicitly single-tenant codebase.** Every Postgres
row belongs to one logical product. There is no `tenant_id` column on
`User`, `Profile`, `Match`, or anywhere else.

The recommended way to run multiple brands is to **deploy multiple
instances** (Vercel projects + Neon databases), each with its own
`openmatch.config.ts`. This isolation:

* Keeps the matching algorithm, the discovery queries, and the swipe /
  message indices simple — no per-tenant fan-out, no row-level security.
* Means a brand-specific bug, schema migration, or operational
  incident can't bleed across products.
* Makes it trivial to scale tenants independently — one fork can sit
  on a different Postgres tier than another.

If you need true in-process multi-tenancy (one deployment serving
multiple brands), see the `MultiTenantHooks` interface below and the
experimental tenant_id branch documented in
[../CONTRIBUTING.md](../CONTRIBUTING.md). It is *not* something the
core repo supports today.

## Tenant-resolution hook

Even though every deployment is single-tenant, the request pipeline
*does* carry a `TenantContext` on `req.tenant`. This serves two
purposes:

1. **Observability** — every log line and Sentry event is tagged with
   `tenantId` via the request-context AsyncLocalStorage frame. For
   single-tenant deploys `tenantId='default'`, which is still useful
   when aggregating dashboards across multiple deployments in one
   logging backend.
2. **Forks can plug in** — a fork that wants true multi-tenancy
   implements the `MultiTenantHooks` interface in
   `backend/src/lib/tenant.ts` and registers it via
   `setTenantResolver(...)`. Every existing route handler gets the
   resolved tenant on `req.tenant` without per-handler changes.

### Default resolution

The plugin at `backend/src/lib/tenant.ts` resolves the tenant in this
order:

1. `x-openmatch-tenant` request header (test override).
2. First DNS label of `Host` when:
   * the host has ≥ 3 labels (e.g. `acme.openmatch.app`),
   * the first label isn't a reserved name (`www`, `api`, `admin`, `app`),
   * the first label matches `^[a-z0-9][a-z0-9-]{0,62}$`.
3. `'default'` fallback.

### The `TenantContext` shape

```ts
interface TenantContext {
  tenantId: string;          // 'default' for single-tenant deploys
  config: OpenMatchConfig;   // resolved platform config
}
```

For single-tenant deploys every request gets the same shared `config`.
A multi-tenant fork can return a different config per tenant.

### Custom resolver

```ts
import { setTenantResolver } from "./lib/tenant.js";

setTenantResolver(async (req) => {
  const tenantId = await lookupTenantFromAuth(req);
  const config = await loadConfigForTenant(tenantId);
  return { tenantId, config };
});
```

Call this once at boot, before any request is served.

## Migration path: when you DO want true multi-tenancy

If a fork outgrows the multi-deployment story and wants `tenant_id`
columns:

1. **Resolve the tenant first.** Implement a `MultiTenantHooks.resolve`
   that derives the tenant from the auth token or subdomain. Until
   this lands, every other change is dangerous.
2. **Add `tenantId` to the Prisma schema** — start with `User`,
   `Profile`, `Match`, and `Message`. Backfill existing rows with
   `'default'`.
3. **Add a Prisma middleware** that injects
   `where: { tenantId: req.tenant.tenantId }` into every read and
   `data: { tenantId: req.tenant.tenantId }` into every write.
4. **Backfill indexes.** Every `(userId, ...)` index becomes
   `(tenantId, userId, ...)`.
5. **Tighten Postgres RLS** as a defence-in-depth layer.
6. **Audit cross-tenant joins.** The matching query already joins
   `Profile ↔ Preferences`; that join must stay intra-tenant.

None of this is required to ship a fork — it's a *future* migration
hook, not a precondition. The single-tenant codebase is the
recommended path for 99 % of OpenMatch deployments.

## What this hook does NOT do today

* It does **not** filter queries by tenant. Forks must add a Prisma
  middleware to do that.
* It does **not** namespace Vercel Blob storage keys.
* It does **not** isolate Redis rate-limit buckets.
* It does **not** partition the analytics pipeline.

The hook is intentionally narrow: tag the request with a tenant id and
expose the resolver. Everything downstream is left for the fork to
implement, and the migration path above is the recipe.
