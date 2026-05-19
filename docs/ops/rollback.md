# Rollback runbook

This runbook covers reverting an OpenMatch release across the four
deployable surfaces (backend, admin, database, iOS) when a launch goes
sideways. It is the operator's one-page reference. Keep it short; link
out for detail.

## Backend (Vercel)

1. Identify the broken deploy: `vercel inspect <url>` or open the Deploys
   tab on the `openmatch-backend` project and find the new red row.
2. Identify the last-known-good deploy commit + URL. Production aliases
   point at the most recent `vercel --prod` deploy; older builds are
   still alive and reachable by their immutable URL.
3. Roll back:

   ```bash
   vercel rollback <deployment-url>
   # or
   vercel promote <good-url> --scope=<team>
   ```

4. Confirm `https://api.openmatch.app/health` returns `{ "ok": true }`
   (with the pool snapshot from PERF-1) and the rollback is now serving.
5. Confirm no in-flight production deploy:

   ```bash
   gh api repos/cheesejaguar/OpenMatch/actions/runs --jq '.workflow_runs[0]'
   ```

## Admin (Vercel)

Same flow as backend. Admin is a separate Vercel project
(`openmatch-admin`); a backend rollback does not roll back the admin
console, and vice versa. After admin rollback, log in once on each role
profile to verify TOTP elevation still works end-to-end.

## Database (Neon)

For schema regressions (a broken `prisma migrate deploy`):

1. Identify the bad migration:

   ```bash
   cd backend
   npx prisma migrate status
   ```

2. Roll back at Neon. We use Neon's point-in-time recovery — find a
   timestamp ~5 minutes before the bad migration ran and restore.
3. Re-apply migrations up to (but not including) the bad one:

   ```bash
   cd backend
   DATABASE_URL=... npx prisma migrate deploy
   ```

4. Cut the next backend deploy with the bad migration reverted out.

For data-only regressions (no schema change), prefer a forward fix over
PITR unless the data corruption is widespread.

## iOS

iOS rollbacks happen via TestFlight build promotion or expedited App
Store review. There is no platform-level "rollback button."

- For beta testers: promote the previous TestFlight build to the
  active External test group. Tell testers to install the older build.
- For App Store releases: request an expedited review citing the
  critical safety bug. Apple historically grants expedites for child
  safety, NCII, and security regressions; mention the specific class.

## Verifying rollback

Run each step against the production hostname after rollback:

1. **Synthetic signup** with a known invite code: must succeed end to
   end (start → email link → verify → first profile fetch).
2. **Push notification** to a known device token: must arrive in
   under 30 s after a synthetic match.
3. **Admin overview** metrics page loads without 5xx — log in fresh
   so the TOTP step is exercised.
4. **Sentry dashboard** shows no new error spike in the 15 minutes
   following the rollback.

## Communication

- Page the on-call operator if you haven't already.
- Update the public status page (once `status.openmatch.app` is
  provisioned).
- Post a short note in the internal `#ops` Slack channel summarising:
  what broke, what the rollback was, what's the forward fix, ETA.

See also: [`incident-template.md`](./incident-template.md) for the
post-mortem stub.
