# OpenMatch Admin Dashboard

Internal moderation console for OpenMatch. Implements the must-haves from
[`docs/product/openmatch-admin-prd.md`](../docs/product/openmatch-admin-prd.md)
§14.1 as a Vercel-hosted Next.js 15 app.

This is a **Phase 0 prototype** (PRD §20.1). It ships with:

- SSO-style admin login that lets you sign in as one of the seeded admin
  identities (Viewer, Moderator, Senior Moderator, Trust & Safety Admin,
  System Admin, Auditor).
- Server-side RBAC with the permission catalog defined in PRD §3.2.
- Server actions for every mutation (ban, unban, resolve, assign, photo
  action, role change, internal note) — every one is wrapped in a permission
  check + audit-log write.
- Sensitive-access reason capture for full message and full photo views
  (PRD §3.3, §6.5, §16.4).
- Append-only audit log viewer (PRD §6.9, §10.3).
- An in-memory mock data store seeded with realistic users, photos, messages,
  reports, bans, and audit events.

The mock store is **per process** and resets on cold start. It is intentionally
unconnected to production data (PRD §8.7). For Phase 1 (PRD §20.2), wire
`lib/data/store.ts` to the Admin API, and replace `lib/auth/session.ts` with
an OIDC + MFA flow.

## Run locally

```bash
npm install
npm run dev -w @openmatch/admin
# open http://localhost:3001
```

Sign in as any of the seeded admins. Try:

- Sign in as **Moderator Mira** → open `/reports/report_001` → resolve with a
  warning. Notice the audit log entry appears under `/audit` once you re-sign
  in as **Audit Ada** (auditor role).
- Sign in as **Senior Sam** → open `/users/user_007` → ban permanently with
  reason "scam or spam". Confirm the user status flips to `banned` and the
  ban appears under moderation history.
- Sign in as **T&S Tasha** → open the banned user → Unban with reason; require
  verification before reactivation.
- Sign in as **Sys Sage** → `/settings` → toggle roles for an admin and watch
  the role change show up in the audit log.
- Sign in as **Viewer Vee** → confirm that the sidebar hides Audit Logs and
  that opening a banned-user detail still respects field masking.

## Deploy to Vercel

This app is a separate Vercel project from the consumer backend. Treat it as
a protected internal service:

1. Create a new Vercel project pointing at this directory (`admin/`).
2. Enable Vercel password protection or SSO on **all** environments
   (production *and* previews). PRD §8.7.
3. Set environment variables from `.env.example`. Production must set
   `ADMIN_API_BASE_URL`, `ADMIN_SESSION_SECRET`, and OIDC values.
4. Confirm preview deployments **do not** see production data by leaving
   `ADMIN_API_BASE_URL` unset (the mock store will be used) or by pointing
   it at a staging Admin API.
5. Configure the Vercel project to deny build deploys from forks.

The included `vercel.json` sets `Cache-Control: no-store`, denies framing,
and adds a `noindex` robots tag for safety.

## Architecture

```
admin/
  app/
    login/                 # SSO-style sign-in
    forbidden/             # 403 page
    api/health/            # health check
    (dashboard)/
      overview/
      users/, users/[userId]/
      reports/, reports/[reportId]/
      messages/
      conversations/[conversationId]/
      photos/
      audit/
      settings/
  components/              # UI building blocks (sidebar, modals, forms, badges)
  lib/
    auth/                  # session + permissions + RBAC checks
    audit/                 # append-only audit log writer
    actions/               # server actions for every mutation
    data/                  # in-memory store, types, seed data, ID helpers
  middleware.ts            # unauthenticated requests redirect to /login
```

Every server action follows the §8.5 pattern:

1. `requirePermission(...)` — looks up the cookie session, verifies the role
   has the permission, redirects to `/forbidden` if not.
2. Validate input with `zod`.
3. Mutate the data store.
4. `writeAudit(...)` records the event with admin id, role at action, target
   entity, optional report id, optional access reason, and request metadata.
5. `revalidatePath(...)` to refresh server-rendered pages.

Sensitive reads (full conversation, all photos, private profile fields)
require an active `SensitiveAccessGrant` keyed by admin × target. The
`AccessReasonForm` component requests one before unlocking the view.

## Wiring to the real Admin API

Each function in `lib/data/store.ts` corresponds to one of the endpoints
sketched in PRD §16. Replace the in-memory implementation with a typed
client that calls `process.env.ADMIN_API_BASE_URL`:

- `getUserById` → `GET /admin/v1/users/{userId}`
- `listUsers` → `GET /admin/v1/users`
- `listMessagesForConversation` → `GET /admin/v1/conversations/{id}/messages`
- `insertBan` → `POST /admin/v1/users/{userId}/ban`
- ... etc.

The Admin API is the place to enforce backend-side authorization; the
dashboard's permission checks are defense in depth, not the only line of
defense (PRD §6.2).

The Prisma admin model definitions are kept under
`backend/prisma/admin.prisma` for review before being merged into the
backend's main schema.
