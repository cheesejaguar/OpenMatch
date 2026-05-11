# Admin dashboard runbook

## First-time login

1. System admin sets `ADMIN_ALLOWED_EMAILS=admin@yourdomain.com` on the
   backend project.
2. The admin clicks "Sign in" at the dashboard, enters their email, and
   gets a magic-link email. In dev (`NODE_ENV !== "production"`) the
   token is also returned in the response and shown as a "Continue"
   button.
3. After clicking the link, the admin lands at `/overview`.
4. In **dev only**, the seed script creates `admin@openmatch.local` with
   `system_admin` + `trust_safety_admin` roles. Visit `/login`, enter
   that email, and follow the dev-token shortcut.

## Banning a user (Phase 3 acceptance criteria)

1. Open `/users` and search by ID or name.
2. Click into the user.
3. Click "Ban / suspend". Pick `temporary` (with duration) or `permanent`.
4. Pick a reason code and write an internal note. Optionally write the
   user-facing explanation.
5. For permanent bans, type the user's display name to enable the
   confirm button.
6. Confirm.

Side effects (verify each — see Phase 3 acceptance in the plan file):
- `User.status = banned`, `User.isBanned = true`.
- `Profile.visibilityStatus = hidden`, `Profile.moderationStatus = restricted`.
- All non-revoked `Session` rows revoked.
- `UserBan` row created with `bannedByAdminUserId = <you>`.
- `AdminAuditLog` row with `eventType = user_banned` or `user_suspended`.

## Resolving a report

1. Open `/reports` and pick an `open` or `reviewing` report.
2. Inspect the reported user, prior reports, and message context.
3. Use the action panel at the bottom to dismiss, escalate, or resolve.
4. Resolving with `permanent_ban` additionally requires
   `user.ban.permanent` permission.

## Viewing messages outside a report

1. Open the conversation. The backend returns 412 with
   `access_reason_required`.
2. Pick a reason and confirm. A `SensitiveAccessGrant` row is created
   and the page reloads with `?accessGrantId=...`. The messages now
   render.

## Auditing

`/audit` shows the rolling log. The sensitive-access summary endpoint
(`/api/v1/admin/audit/sensitive-access-summary`) flags admins with
high-volume out-of-report message/photo views over the last 30 days. PRD
§13.3 — wire to a periodic ops alert in Phase 7.

## Common 4xx codes

- `401 unauthorized` — session expired. Sign in again.
- `403 forbidden` — your role doesn't have the permission listed in `required`.
- `412 access_reason_required` — open the access-reason modal.

## Acceptance checklist (PRD §18)

- [ ] Admins can securely log in.
- [ ] RBAC enforced server-side (see `backend/src/plugins/admin-rbac.ts`).
- [ ] Authorized admins can search and view all user profiles.
- [ ] Authorized admins can view all user photos.
- [ ] Authorized admins can view all user messages.
- [ ] All reports are visible in the report queue.
- [ ] Report detail pages show user/photo/message context.
- [ ] Authorized admins can ban users.
- [ ] Authorized admins can unban users.
- [ ] Sensitive reads require permission and are audit-logged.
- [ ] Ban/unban/resolve actions require reason and are audit-logged.
- [ ] Preview deployments do not expose production by default (guard in
      `admin/lib/env.ts`).
- [ ] Sensitive admin routes are protected from unauthenticated access
      (middleware + per-route `authenticateAdmin`).
- [ ] No monetization or ranking-override controls.
