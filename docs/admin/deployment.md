# Admin dashboard deployment

The admin dashboard ships as a **separate Vercel project** from the backend.

## Backend Vercel project (existing)

No changes to layout. Add the following environment variables in addition
to the existing ones:

| Variable | Required | Notes |
|----------|----------|-------|
| `ADMIN_JWT_SECRET` | yes (prod) | Distinct from `JWT_SECRET`. Used to sign admin access tokens. |
| `ADMIN_MAGIC_LINK_TTL_SECONDS` | no | Defaults to 600 (10 min). |
| `ADMIN_ALLOWED_EMAILS` | yes (prod) | Comma-separated allow-list. Empty = no one in production. |
| `ADMIN_ACCESS_GRANT_TTL_SECONDS` | no | Sensitive-access grant lifetime. Defaults to 1800. |
| `ADMIN_CORS_ORIGIN` | yes | Set to your admin dashboard origin (e.g. `https://admin.openmatch.app`). |
| `ADMIN_ACCESS_TTL_SECONDS` | no | Admin access token TTL. Defaults to 900. |
| `ADMIN_REFRESH_TTL_SECONDS` | no | Admin refresh token TTL. Defaults to 86,400 (1 day). |

## Admin Vercel project (new)

1. In Vercel, create a new project. Root directory: `admin/`.
2. Framework preset: **Next.js**.
3. Set environment variables:

| Variable | Required | Notes |
|----------|----------|-------|
| `ADMIN_API_BASE_URL` | yes | URL of the backend Vercel project. Use staging URL for preview. |
| `ADMIN_SESSION_SECRET` | yes | 32+ byte random string. Signs the admin session cookie. |
| `ADMIN_ALLOW_PREVIEW_PROD` | no | `true` only to intentionally point preview at production. |

4. Enable **Vercel Password Protection** on preview deployments per PRD §8.7.
5. Add the admin dashboard origin to the backend's `ADMIN_CORS_ORIGIN`.

## Preview safety

`admin/lib/env.ts` includes `assertNoPreviewToProd()` which refuses to call
a URL containing `prod` / `production` from `VERCEL_ENV=preview` unless
`ADMIN_ALLOW_PREVIEW_PROD=true`. This is defense-in-depth: the primary
control is using a dedicated staging backend URL for preview.

## First-time setup

After backend deploy with the new schema:

```bash
cd backend
npx prisma migrate deploy
ALLOW_DEV_LOGIN=true npm run seed   # creates default admin roles + a dev admin
```

In production, system admins create additional admins via the dashboard at
`/settings/admins`. The first admin must be created with a one-time
script:

```bash
node -e "require('@prisma/client') /* see scripts/bootstrap-admin.ts */"
```

(See `docs/admin/runbook.md`.)
