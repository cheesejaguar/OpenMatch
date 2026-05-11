# OpenMatch Admin Dashboard

## What it is

A separately deployed Next.js web application that gives authorized trust-and-safety operators
the controls described in [the PRD](#) — view profiles, photos, messages, and reports; ban
and unban users; resolve reports; review the audit log. The dashboard never talks to the
production database directly; every action goes through `/api/v1/admin/*` on the OpenMatch
backend, which enforces RBAC and writes an immutable audit row for every sensitive read or
state change.

## Architecture at a glance

```
Admin Browser
   ↓ (signed session cookie, HttpOnly)
Vercel: admin/ Next.js BFF (server actions, route handlers)
   ↓ (Bearer admin JWT, server-side only)
Vercel: backend/ Fastify Admin API  (RBAC + audit at the boundary)
   ↓
Neon Postgres   ← AdminAuditLog (append-only at the application layer)
```

- Browser never sees the admin JWT or the backend URL directly.
- The session cookie is HMAC-signed with `ADMIN_SESSION_SECRET`.
- Backend issues admin JWTs signed with `ADMIN_JWT_SECRET` — a distinct
  namespace from consumer JWTs, so a leaked consumer secret can't mint
  admin tokens.

## Roles and permissions

Defined in `backend/src/lib/admin/roles.ts`. Six built-in roles:
`viewer`, `moderator`, `senior_moderator`, `trust_safety_admin`,
`system_admin`, `auditor`. The permission catalog lives in
`backend/src/lib/admin/permissions.ts` and is mirrored to the UI in
`admin/lib/rbac/permissions.ts`. The browser copy is only used to hide UI
affordances; backend always re-checks.

## Sensitive access

Reading photos for a user not currently being investigated, or opening
arbitrary conversations, requires a `SensitiveAccessGrant` whose `reason`
ends up on the corresponding `AdminAuditLog.accessReason` field. The UI
shows the access-reason modal when the backend returns
`412 access_reason_required`.

See `docs/admin/rbac.md` for the matrix and `docs/admin/deployment.md`
for environment + Vercel setup. The operational runbook is in
`docs/admin/runbook.md`.
