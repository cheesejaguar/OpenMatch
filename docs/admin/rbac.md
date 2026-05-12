# Admin RBAC

## Permissions catalog

Source of truth: `backend/src/lib/admin/permissions.ts`. UI mirror:
`admin/lib/rbac/permissions.ts`. The browser copy is only used to hide UI
affordances — the backend always re-checks server-side, and every
permission denial writes an `access_denied` row to `AdminAuditLog`.

## Built-in roles

Defined in `backend/src/lib/admin/roles.ts`, seeded from
`backend/prisma/seed.ts`.

| Role | Read users | Read photos | Read messages | Ban | Unban | Audit |
|------|------------|-------------|---------------|-----|-------|-------|
| `viewer` | summary | — | — | — | — | — |
| `moderator` | full | report-context | report-context | temp | — | — |
| `senior_moderator` | full + private | all (with reason) | all (with reason) | temp + perm | — | — |
| `trust_safety_admin` | full + private | all | all | temp + perm | yes | yes |
| `system_admin` | summary | — | — | — | — | yes |
| `auditor` | — | — | — | — | — | yes |

## Sensitive-access grants

The grant table records the **reason** an admin opened sensitive data
outside an active report. UI surfaces this as the access-reason modal at
`/conversations/[id]` and (in phase 5) at the photo-gallery view. Grants
expire after `ADMIN_ACCESS_GRANT_TTL_SECONDS` (default 30 minutes) and
are scoped to a single `(entityType, entityId)` pair.

## Adding a permission

1. Add the constant to `backend/src/lib/admin/permissions.ts` AND
   `admin/lib/rbac/permissions.ts`.
2. Grant it to relevant roles in `backend/src/lib/admin/roles.ts`.
3. Use `app.requirePermission(PERMISSIONS.YOUR_PERMISSION)` as a
   `preHandler` on the route.
4. Re-seed roles: `npm run seed -w @openmatch/backend`.
