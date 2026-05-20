# OpenMatch Security Audit: Network, Dependency Hygiene & Infrastructure Surface

**Scope:** Read-only audit covering Fastify network controls, Vercel project
configuration, Next.js admin headers + routing, dependency hygiene,
GitHub Actions security, database / Redis / realtime / blob / email
configuration. Findings prefixed `SEV-N*` (network/infra).

**Excluded (already addressed by PRs #48-#52):** `npm audit` CI gate, Pino
PII redaction, request-context correlation.

---

## Summary

| Severity      | Count |
|---------------|-------|
| Critical      | 1     |
| High          | 6     |
| Medium        | 9     |
| Low           | 4     |
| Informational | 3     |

**Top risks (read-only).** The most acute gaps are:
1. SMTP transports disable TLS certificate verification
   (`rejectUnauthorized: false`) for both consumer + admin magic-link
   emails — opens the path to magic-link interception under an active
   network attacker (SEV-N1, critical).
2. The Fastify backend ships **no `@fastify/helmet`**, **no CSP**, **no
   HSTS**, **no `Permissions-Policy`**, and exposes `/api/v1/internal/*`
   behind a single shared bearer secret (SEV-N2, SEV-N3, SEV-N7).
3. The CORS origin list is built from comma-split env vars with no
   wildcard guard and is paired with `credentials: true` — an empty or
   malformed env variable yields `origin: [""]` and the allowlist is
   silently widened by typo (SEV-N4).
4. GitHub Actions reference third-party-style v-floating tags
   (`actions/checkout@v4`, `github/codeql-action/init@v3`, etc.) — none
   pinned to commit SHA, and `actions/setup-node` uses both `@v4` and
   `@v6` in different jobs (SEV-N11).
5. `npm audit` produces a `critical` finding in `happy-dom`
   (admin devDep, RCE via VM context escape) and `high` advisories in
   `@parse/node-apn` (node-forge), `@vercel/node` (esbuild,
   path-to-regexp, undici), `nodemailer`, and transitive `ws` and
   `tar`. The CI gate is `--audit-level=critical` and `--omit=dev`, so
   the critical happy-dom finding **is not currently caught** because
   it is a devDependency, and high-severity prod issues do **not** fail
   CI (SEV-N12, SEV-N13).
6. `BLOB_READ_WRITE_TOKEN` issues photos with `access: "public"` and
   `cdnUrl` is persisted to DB unsigned — once leaked, photos are
   indefinitely reachable; there is no signed-URL rotation, no
   `cache-control` cap, no enumeration defence beyond the random
   UUID inside the storage key (SEV-N16).

---

## Findings

### SEV-N1 — SMTP transports disable TLS certificate verification (Critical)

* **Location:** `backend/src/services/auth.service.ts:26`,
  `backend/src/services/admin/auth.service.ts:22`,
  `backend/src/workers/daily-digest.ts:181-189` (digest transport does
  not appear to set `rejectUnauthorized` but inherits the same `SMTP_HOST`
  / `SMTP_PORT` and shared SMTP_SECURE defaults).
* **Description:** Both nodemailer transports are constructed with
  `tls: { rejectUnauthorized: false }`. This means a network attacker
  between the Vercel function region (`iad1`) and the configured SMTP
  relay can present any TLS cert and the client will accept the
  connection, then transmit the **plaintext magic link** in `text:`. The
  magic link is the sole authenticator for user **and admin** logins
  (PRD §9 / §16). Combined with the admin link landing in
  `ADMIN_CORS_ORIGIN` and granting full admin access, this is a path to
  full compromise without ever touching the application stack.
* **Repro:** Stand up an MITM listener (e.g. `mitmproxy` in transparent
  mode) on the SMTP egress path; nodemailer accepts the self-signed
  cert; capture the magic link from the SMTP envelope; redeem it from
  any IP before the legitimate operator clicks it. The
  `GET /api/v1/auth/verify` (consumer) and `GET /login/callback`
  (admin) endpoints are HTTP GET with the secret in the query string,
  so server-side TLS for the *outbound* SMTP call is the only thing
  protecting the credential.
* **Recommendation:** Remove `rejectUnauthorized: false` unconditionally
  in production. If a self-signed corporate relay must be supported,
  gate it on `NODE_ENV !== "production"` AND a per-environment opt-in
  env var. Validate `SMTP_SECURE` is true (or port 587 with STARTTLS
  enforced via `requireTLS: true`) before transmitting any token.
  Independently, consider switching to a one-time-code email instead of
  embedding the redeemable secret in the URL.

---

### SEV-N2 — No `@fastify/helmet`, no CSP, no HSTS, no `Permissions-Policy` on the API (High)

* **Location:** `backend/src/server.ts` (full plugin registration list).
* **Description:** The backend registers `@fastify/cors`,
  `@fastify/multipart`, `@fastify/sensible`, `@fastify/rate-limit`,
  the OpenAPI plugin, and several custom plugins — but **no
  `@fastify/helmet`** or hand-rolled `onSend` adding security headers.
  Missing: `Strict-Transport-Security`, `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`,
  `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`,
  `Content-Security-Policy` (even a restrictive `default-src 'none'`
  for an API would harden the OpenAPI HTML and any error pages). Vercel
  does inject `X-Vercel-Id` but does not inject HSTS or CSP by default.
* **Repro:** `curl -I https://<backend-host>/health` returns only
  Fastify defaults + Vercel platform headers; no `strict-transport-security`,
  no `content-security-policy`, no `x-content-type-options`.
* **Recommendation:** Add `@fastify/helmet` with `contentSecurityPolicy:
  { directives: { "default-src": ["'none'"], "frame-ancestors":
  ["'none'"] } }` and `hsts: { maxAge: 63072000, includeSubDomains:
  true, preload: true }`. For the Swagger UI route, scope a more
  permissive CSP only to `/docs`.

---

### SEV-N3 — Internal cron endpoints protected by a single shared bearer + only IP rate limit (High)

* **Location:** `backend/src/routes/internal.ts:21-48`,
  `backend/src/env.ts:93-96`, `vercel.json:15-22`.
* **Description:** `/api/v1/internal/run-*` endpoints (deletion purge,
  DSA SLA, push retry, daily digest, alert check, synthetic check) are
  authenticated by `INTERNAL_WORKER_TOKEN`, a single static secret with
  no rotation, no per-cron scoping, no audience binding. The default
  value (`dev-internal-worker-token-please-change-32-chars`) is
  committed in the schema and passes the `min(32)` Zod check, so a
  production deployment that forgets to set it boots successfully with
  a known-plaintext credential. Rate limit is 5 req/min **per IP**, so
  a leaked token + Tor / proxy network can iterate freely. The cron
  routes are also `POST` with no idempotency key — replaying
  `run-deletion-purge` from leaked logs is possible.
* **Recommendation:**
  1. Reject the default value in production (env-time check, not just
     length).
  2. Bind to Vercel's `x-vercel-deployment-url` / `x-vercel-id` or
     verify the `Authorization` matches the rotating
     `CRON_SECRET` Vercel injects automatically (so manual hits from
     non-Vercel sources fail).
  3. Per-route distinct secrets (deletion purge is irreversible — its
     secret should not unlock the digest).
  4. Add a per-token rate limit (`keyGenerator` could compare the
     bearer prefix), not just per-IP.

---

### SEV-N4 — CORS allowlist built from naive split, paired with `credentials: true` (High)

* **Location:** `backend/src/server.ts:147-153`.
* **Description:**
  ```ts
  await app.register(cors, {
    origin: [
      ...env.CORS_ORIGIN.split(",").map((s) => s.trim()),
      ...env.ADMIN_CORS_ORIGIN.split(",").map((s) => s.trim()),
    ].filter(Boolean),
    credentials: true,
  });
  ```
  Several issues:
  1. There is no validation that each entry is a valid origin (`scheme://
     host[:port]` with no path). A typo like `https://admin.openmatch.app/`
     (trailing slash) or an entry containing a wildcard char silently
     passes; Fastify-cors string-matches the `Origin` header exactly,
     so trailing-slash bugs cause silent breakage rather than security
     issues — but a value like `*` or `null` would fail open.
  2. `credentials: true` plus an allowlist of multiple distinct origins
     means a successful preflight from any allowlisted origin can carry
     the JWT cookie / Authorization header. There is no per-origin
     scoping of which API surfaces are exposed.
  3. The defaults are `http://localhost:5173` and
     `http://localhost:3000`. In production these defaults still match
     if the operator forgets to override (allowing local-attacker
     pages — running on the victim's machine via a Service Worker or a
     phishing local-host page — to call the production API with the
     user's session).
* **Recommendation:** Parse + validate each entry through `new URL()`;
  reject if `pathname !== "/"` or hash/search present. Refuse boot in
  `NODE_ENV === "production"` if `CORS_ORIGIN` or `ADMIN_CORS_ORIGIN`
  contain `localhost`, `127.0.0.1`, or `*`. Consider splitting the
  consumer and admin CORS contexts into route-scoped CORS plugins so a
  cross-origin admin call from the consumer origin is impossible.

---

### SEV-N5 — `trustProxy: true` is unconditional outside test (Medium)

* **Location:** `backend/src/server.ts:119`.
* **Description:** `trustProxy: env.NODE_ENV !== "test"` trusts the
  full `X-Forwarded-For` chain whenever NODE_ENV is anything other
  than `"test"` — including `"development"` and any unset / misspelled
  value (defaults to `development`). The rate-limit plugin and country
  gate both derive identity from `req.ip`, so a header
  `X-Forwarded-For: <victim-ip>` will rotate the rate-limit bucket
  per-request and spoof country attribution. In production this is
  acceptable behind Vercel's edge (which always overwrites
  XFF), but the same code path is hit in any deployment without a
  trusted proxy (self-hosted Docker, Fly, Render, etc.).
* **Recommendation:** Use Fastify's array form
  `trustProxy: ["127.0.0.1", "::1", "<vercel-cidrs>"]` or accept a
  `TRUST_PROXY` env var that defaults to **false** and is set
  explicitly per deployment. Fail closed.

---

### SEV-N6 — Rate-limit key falls back to `"anon"` for unauthenticated requests on the same IP-less invocation (High)

* **Location:** `backend/src/plugins/ratelimit.ts:56`.
* **Description:**
  ```ts
  keyGenerator: (req) => (req as { userId?: string }).userId ?? req.ip ?? "anon",
  ```
  When `req.ip` is undefined (which happens in some Fluid Compute /
  serverless paths if `trustProxy` evaluation fails, and reliably in
  unit-test fakes), all anonymous requests share a single `"anon"`
  bucket. The global default is `max: 600 / minute` — a single misbehaved
  client can starve every other anonymous caller (auth start, magic
  link verify, waitlist signup) globally. Conversely, a logged-in
  attacker can rotate userId by re-authenticating to bypass per-user
  limits (no IP fallback once `userId` is set).
* **Recommendation:** Use a composite key
  (`${userId ?? "anon"}:${req.ip ?? "noip"}`) for the rate-limit
  bucket, and elevate sensitive routes (login start, verify, photo
  upload) to per-route limits keyed by `email` / `challengeId` /
  fingerprint as appropriate. Refuse to start the rate-limit plugin in
  production if Upstash is not wired (currently a silent fallback to
  in-memory, which under Fluid Compute is effectively unlimited).

---

### SEV-N7 — No CSP, no `Permissions-Policy` in the Next.js admin (Medium)

* **Location:** `admin/next.config.ts:7-19`.
* **Description:** The admin sets `Cache-Control: no-store`,
  `X-Frame-Options: DENY`, `X-Content-Type-Options`, and
  `Referrer-Policy`, but omits CSP, `Permissions-Policy`,
  `Strict-Transport-Security`, `Cross-Origin-Opener-Policy`, and
  `Cross-Origin-Embedder-Policy`. The admin renders user-submitted
  content (display names, message snippets, report text) so the lack
  of a CSP is a meaningful XSS amplifier. Note: Next.js 16 caches
  components patterns require per-route CSP nonce wiring; a static
  `script-src 'self'` directive without nonce would break the
  React framework, so the recommendation here needs the
  `headers()` callback + middleware nonce approach.
* **Recommendation:** Add a CSP via `middleware.ts` (per-request nonce,
  Next.js documented pattern), and add `Permissions-Policy:
  camera=(), microphone=(), geolocation=(), payment=()` plus
  `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  in `next.config.ts`. `frame-ancestors 'none'` in the CSP supersedes
  `X-Frame-Options` for modern browsers.

---

### SEV-N8 — `vercel.json` lacks `headers` section / region single-AZ exposure (Medium)

* **Location:** `vercel.json`, `admin/vercel.json`.
* **Description:**
  1. Neither `vercel.json` defines `headers` — all platform-level
     security headers must be added either at the framework layer
     (Next.js admin does some; backend does none) or by switching to
     `vercel.ts`. Backend cannot inject HSTS without `@fastify/helmet`.
  2. `regions: ["iad1"]` on both projects pins to a single AZ. Outside
     of failure-tolerance concerns this is OK, but combined with
     Neon's primary region selection it can produce a single-DC
     correlated outage. Not a security finding per se — operational.
  3. No `crons` `secret` or per-cron `authToken` — auth is delegated
     entirely to the backend bearer check (SEV-N3).
  4. The cron entries do not list `iad1` explicitly; on Hobby plans
     cron region is non-deterministic. Acceptable today, flag for
     migration to `vercel.ts` if multi-region is added later.
* **Recommendation:** Migrate to `vercel.ts` with a `headers` block
  setting HSTS + CSP at the edge, and a `crons` block that names the
  region explicitly when scaling.

---

### SEV-N9 — `/health` exposes Postgres pool statistics unauthenticated (Low)

* **Location:** `backend/src/server.ts:249-261`.
* **Description:** The unauthenticated `/health` endpoint returns
  `{ ok: true, pool: { activeConnections: <n> } }` from
  `pg_stat_activity`. The data is low-signal but lets an external
  observer fingerprint the database, infer scale (idle vs. busy), and
  time correlated requests against connection-pool exhaustion. Health
  endpoints should be a binary liveness probe.
* **Recommendation:** Move pool stats to `/health/internal` gated by
  `INTERNAL_WORKER_TOKEN` (or behind admin auth), keep `/health` as
  `{ ok: true }`.

---

### SEV-N10 — `ADMIN_JWT_SECRET` and `ADMIN_SESSION_SECRET` default values pass min-length validation (High)

* **Location:** `backend/src/env.ts:23` and `admin/lib/env.ts:9`.
* **Description:** Both secrets have `min(16)` Zod checks but supply
  hard-coded defaults
  (`"dev-admin-secret-please-change"` and
  `"dev-session-secret-please-change-me-please"`). A production
  deployment that forgets to override boots successfully with a
  publicly-known signing key, allowing **anyone reading the source**
  to mint a valid admin JWT and a valid admin session cookie.
  Similarly `INTERNAL_WORKER_TOKEN` has the default
  `dev-internal-worker-token-please-change-32-chars` which is exactly
  32 chars and passes the `min(32)` check (SEV-N3 covers the runtime
  consequence).
* **Recommendation:** Drop the defaults; require explicit values; OR
  add a `superRefine` that rejects values containing the string
  `please-change` when `NODE_ENV === "production"`.

---

### SEV-N11 — GitHub Actions reference floating major-tag refs, not commit SHAs (Medium)

* **Location:** `.github/workflows/{ci,codeql,ios}.yml`.
* **Description:** Every third-party (and first-party but
  externally-mutable) action is pinned to a major-version tag, not a
  commit SHA. `actions/upload-artifact@v7` (used in `ios.yml`) and
  `actions/upload-artifact@v4` (used in `ci.yml`) coexist — version
  drift is silent. CodeQL v3 family, `github/codeql-action/autobuild@v3`,
  `actions/cache@v4` are all SHA-floating. A compromise of any of
  these tags (well-precedented; see `tj-actions/changed-files` Mar
  2025) yields direct access to `GITHUB_TOKEN` (`pull-requests: write`
  in the `test-backend` job).
* **Recommendation:** Pin every `uses:` line to a 40-char commit SHA
  (`actions/checkout@<sha> # v4.2.0`). Enable Dependabot for the
  `github-actions` ecosystem so SHA bumps are PR'd.

---

### SEV-N12 — `npm audit` CI gate misses `critical` happy-dom and all `high` production findings (High)

* **Location:** `.github/workflows/ci.yml:112-124`, current
  `npm audit` shows `{ critical: 1, high: 8, moderate: 15 }`.
* **Description:** The gate is
  `npm audit --audit-level=critical --omit=dev`:
  * `--omit=dev` removes `happy-dom@<20.0.0` (admin devDep,
    `GHSA-37j7-fg3j-429f`, RCE via VM context escape). Even though
    happy-dom only runs in test, it executes against arbitrary HTML
    fixtures and admin SSR snapshots. If a contributor's PR adds a
    test fixture sourced from production data the test runner is now
    an RCE vector against the CI runner.
  * `--audit-level=critical` ignores 8 high-severity findings,
    including:
    * `@parse/node-apn` (high) via `node-forge` (used at runtime to
      sign APNs JWTs — a forged signature would let an attacker push
      arbitrary content to a victim device);
    * `@vercel/node` (high) via `path-to-regexp`, `undici`, `esbuild`;
    * `nodemailer` (high);
    * `ws@<8.20.1` (transitive, used by Neon WebSocket adapter).
* **Recommendation:** Tighten to
  `npm audit --audit-level=high --include=dev` (or run two
  passes — `critical` for production deps, `high` for the full tree).
  Track each finding in a `security-allowlist.json` with an explicit
  expiry date.

---

### SEV-N13 — Multiple direct dependencies are 1+ majors behind security fixes (Medium)

* **Location:** `backend/package.json`, `admin/package.json`.
* **Description:** `npm audit` indicates the following SemVer-major
  upgrades are required to clear advisories:
  * `@vercel/node` `^3.2.0` → `3.0.1` (note: audit reports the
    current installed range `>=2.1.1-canary.0` as vulnerable; pinning
    `^3.2.0` is a *prefix* but the actually-installed version was
    flagged as vulnerable — verify the lockfile resolution).
  * `@vercel/blob` `^0.23.0` → `2.4.0` (current at major v0.x).
  * `@parse/node-apn` `^7.1.0` → `8.1.0`.
  * `nodemailer` `^6.9.13` → `8.0.7`.
  * `prisma` `^7.8.0` reported with an associated `@prisma/dev` →
    `@hono/node-server` chain (`GHSA-92pp-h63x-v22m`).
  * `happy-dom` (admin) `^15.11.0` → `20.x` (critical, see SEV-N12).
  * `vitest` / `@vitest/coverage-v8` are on `^1.4.0` / `^1.6.1` with
    fix at `4.x` (two majors behind).
* **Recommendation:** Schedule a dependency-uplift PR train; do
  `nodemailer`, `@parse/node-apn`, `happy-dom`, `vitest` first
  (mechanical), then evaluate `@vercel/node`/`@vercel/blob` (API
  surface change). Caret-pinning is fine; the issue is the lockfile
  has not been refreshed.

---

### SEV-N14 — Neon SSL mode not enforced at code level (Medium)

* **Location:** `backend/src/lib/db-url.ts`,
  `backend/src/plugins/prisma.ts`.
* **Description:** `ensureConnectionLimit` only appends
  `connection_limit=20`. It does NOT verify `sslmode=require` (or
  `verify-full`) is present. Neon URLs include it by default, but the
  invariant is not enforced — if an operator pastes a copied URL
  stripped of query params (common when copying via psql `\conninfo`),
  the connection silently downgrades to non-TLS where Postgres allows
  it. The `PrismaPg` (non-Neon) branch is used in CI and any
  self-hosted vanilla Postgres, where SSL enforcement is the
  operator's responsibility — but there is no preflight check.
* **Recommendation:** In `ensureConnectionLimit` (or a sibling
  `ensureSsl`), require `sslmode` in (`require`, `verify-ca`,
  `verify-full`) for `NODE_ENV === "production"`. Add a startup probe
  that runs `SHOW ssl` and refuses to boot if `off`.

---

### SEV-N15 — Single DB user (read+write) for all backend access (Low)

* **Location:** Prisma client construction
  (`backend/src/plugins/prisma.ts`), DATABASE_URL env.
* **Description:** There is no second DATABASE_URL_READONLY for the
  admin analytics / synthetic / metrics / digest workers, all of which
  are read-mostly. A single write-capable role is used for everything,
  so a SQL injection or Prisma raw-query bug in a read-only surface
  (`pg_stat_activity` in `/health`, the EXPLAIN queries in the admin
  analytics surface, `$queryRawUnsafe` in profile location updates)
  can mutate state.
* **Recommendation:** Create a `openmatch_ro` Postgres role with
  `SELECT` only, plumb `DATABASE_URL_READONLY` into a second Prisma
  client used by analytics / health / digest / synthetic routes.

---

### SEV-N16 — Vercel Blob URLs are `access: "public"`, persisted unsigned, no rotation (High)

* **Location:** `backend/src/lib/media.ts:72-80`.
* **Description:**
  ```ts
  const blob = await put(storageKey, bytes, {
    access: "public",
    contentType: args.contentType,
    token: env.BLOB_READ_WRITE_TOKEN,
  });
  return { storageKey: blob.pathname, cdnUrl: blob.url };
  ```
  The `cdnUrl` is then persisted in `ProfilePhoto.cdnUrl` (DB) and
  served back to any authenticated client that reaches the
  discovery / match / chat surfaces. There is no signed-URL flow, no
  expiry, no rotation on user block / report / delete (`del()` is
  called but Blob CDN edges cache for hours). Practically:
  * Anyone who scrapes the discovery feed once retains permanent
    access to those photos even after the user deletes the account
    (the URL is the only credential, and it embeds nothing
    user-specific).
  * Storage-key randomness (`randomUUID()`) is good (122 bits) so
    enumeration is infeasible — but the URL itself is the
    capability. Photos meant only for matched users leak to anyone
    who briefly saw them via a one-shot like.
  * `del()` on rotation is best-effort with a swallowed catch
    (`// intentionally swallowed`) — orphan photos are reachable
    forever if Blob returns a transient error.
* **Recommendation:** Move to `access: "private"` plus a backend
  signed-URL endpoint that issues short-lived (5–15 min) signed
  redirects, scoped by viewer permissions (match active /
  conversation open). On photo delete, retry `del()` until success,
  and persist a `pending_deletion` row for the cron sweep.

---

### SEV-N17 — Push payload content includes sender PII (Medium)

* **Location:** `backend/src/services/push.service.ts:153-163` plus
  every caller of `tryDispatchPush` (`message`/`match`/`like`/`safety`
  categories).
* **Description:** `buildApnNotification` sends `alert: { title, body }`
  directly to APNs (encrypted in transit by Apple, but visible to
  Apple infrastructure and rendered in plaintext on the lock screen).
  Callers in the chat service send the message body verbatim, which
  may include user-identifying information from another user. APNs
  payloads should treat the lock-screen text as adversarial: the
  device may be in another person's hands, screen sharing, OBS, etc.
  Need to confirm by reading every `tryDispatchPush` caller (not done
  in this read-only pass).
* **Recommendation:** Default to neutral copy ("New message",
  "Someone liked you"); require an explicit per-user opt-in to
  rich previews; never include the counter-party's display name in
  the unencrypted payload.

---

### SEV-N18 — Ably realtime: token capability is correct, but client-side `ABLY_API_KEY` MUST never be exposed (Informational)

* **Location:** `backend/src/lib/realtime.ts`,
  `backend/src/routes/realtime.ts`.
* **Description:** Server uses the full `Ably.Rest` API key
  (`subscribe` + `publish` + `presence` + admin caps) to mint
  short-lived token requests scoped to the user's active
  conversation IDs. The token approach is correct. Verify in deploy
  that `ABLY_API_KEY` is **only** present in the backend Vercel
  project, not in `admin` or iOS. (Inspection of `env.ts` confirms
  this.) The capability map grants `subscribe` + `presence`
  per-channel — a user cannot publish from the client (good), and a
  blocked / unmatched user gets no channel capability (good). The
  one risk to track: tokens last 1h and capabilities are not
  re-evaluated mid-token — if a match is closed mid-call the
  attacker keeps `subscribe` for up to 60 minutes. Reduce TTL to
  10–15 minutes and rely on iOS auto-refresh.
* **Recommendation:** Reduce `ttl` to 10 min; emit Ably channel
  presence-revoke on unmatch via the `channels:detail` admin REST
  call.

---

### SEV-N19 — Magic-link tokens transmitted via HTTP GET query string (Medium)

* **Location:** `backend/src/services/auth.service.ts:77`,
  `backend/src/services/admin/auth.service.ts:100`.
* **Description:** Both consumer and admin verify endpoints accept
  the secret in `?token=…`. GET-with-secret-in-querystring writes the
  credential into:
  * Vercel function logs / access logs,
  * Sentry breadcrumbs / `req.url`,
  * Browser history,
  * Referer headers leaked to embedded resources on the landing page,
  * Any HTTP intermediary's logs.
  Pino redaction (PR #48-52) covers `req.headers`,
  `req.body.token`, but `req.url` is not in the redact path list
  (see `backend/src/server.ts:73-87`), so the token DOES leak to
  logs.
* **Recommendation:** Add `req.url` / `req.raw.url` /
  `*.searchParams.token` to the Pino redact list immediately. Move
  the verify flow to POST with body, or send a 6-digit OTP via email
  instead of a redeemable URL.

---

### SEV-N20 — `multipart` limits permit a small set of fields but unlimited per-request part size for non-file fields (Low)

* **Location:** `backend/src/server.ts:154-162`.
* **Description:** Config sets `files: 1`, `fileSize: 5MB`, `fields: 4`
  — but does not set `fieldSize` (per-field byte cap) or `parts`. A
  malicious caller can send `fields: 4` text fields each ~1MB
  (default `fieldSize` is 1MB in busboy, but Fastify exposes no
  current override here). On a Vercel function with a 4.5MB body
  limit this is small, but the absence of an explicit cap reads as
  unbounded.
* **Recommendation:** Set `fieldSize: 1024` (1KB is enough for any
  metadata field we send today), `fieldNameSize: 100`, `parts: 6`,
  `headerPairs: 2000`.

---

### SEV-N21 — `pull-requests: write` granted to the test job (Low)

* **Location:** `.github/workflows/ci.yml:264-266`.
* **Description:** `test-backend` declares `permissions: { contents:
  read, pull-requests: write }` so it can post a failure comment via
  `gh pr comment`. PRs from forks normally cannot escalate this, but
  any compromised step in the long install/test chain could now
  delete or comment on arbitrary PRs in the repo. The token only
  needs write on the **specific** PR.
* **Recommendation:** Either (a) move the failure-comment step to a
  separate `workflow_run`-triggered job that runs in the trusted
  repo context and has minimal scope, or (b) accept the risk and add
  an explicit allowlist of label-gated PRs.

---

### SEV-N22 — `ALLOW_DEV_LOGIN` is a runtime boolean — make sure it can never be true in production (Informational)

* **Location:** `backend/src/env.ts:73-80`.
* **Description:** No `superRefine` enforces
  `ALLOW_DEV_LOGIN === false` when `NODE_ENV === "production"`. A
  misconfigured Vercel env yields a backdoor (`/api/v1/auth/dev-login`
  bypasses email entirely; behaviour confirmed from the env var name
  and the comment).
* **Recommendation:** Add a Zod refinement that rejects
  `ALLOW_DEV_LOGIN=true` when `NODE_ENV==="production"`.

---

### SEV-N23 — Apple Sign-In service file present but unaudited in this pass (Informational)

* **Location:** `backend/src/services/apple-auth.service.ts` (new,
  untracked in git status at audit time).
* **Description:** Not within scope of this read-only network/deps
  audit. Flagging for the next pass: validate nonce binding,
  audience binding to bundle ID, JWK refresh cache, and refusal of
  unsigned tokens.

---

### SEV-N24 — iOS Ably + Sentry packages pinned by `from:`, not `exactVersion:` (Low)

* **Location:** `ios/project.yml:19-25`.
* **Description:** SwiftPM `from: "1.2.30"` allows any non-major
  release ahead of the floor. The lockfile (`Package.resolved`,
  generated at build time) does pin, but `xcodegen generate` re-runs
  in CI on every PR, and the cache key
  (`hashFiles('ios/project.yml')`) does not include the resolved
  lockfile — a transparent upgrade on a `1.2.x` release can land in
  CI without a code change.
* **Recommendation:** Commit `Package.resolved` to git and add the
  resolved file to the cache key, or move to `exactVersion:`.

---

## Method

Files read end-to-end:
- `backend/src/server.ts`, `backend/src/env.ts`, `backend/src/plugins/{ratelimit,auth,prisma,redis,country-gate}.ts`
- `backend/src/lib/{realtime,media,db-url}.ts`
- `backend/src/services/{auth.service,push.service}.ts`, `backend/src/services/admin/auth.service.ts`
- `backend/src/routes/{internal,realtime,profile}.ts`
- `vercel.json`, `admin/vercel.json`, `admin/next.config.ts`, `admin/middleware.ts`
- `admin/lib/{env.ts,auth/session.ts,api/admin-client.ts}`, `admin/app/(auth)/login/callback/route.ts`
- `.github/workflows/{ci,codeql,ios}.yml`
- `ios/project.yml`
- `npm audit --json` (summary + full record for direct deps)

Files **not read in this pass** (flagged for follow-up):
- `backend/src/services/apple-auth.service.ts` (Apple Sign-In) — SEV-N23.
- `backend/src/routes/internal/synthetic.ts` — auth pattern likely shared with `internal.ts`.
- `backend/src/services/safety/*` — image safety, EXIF.
- `backend/src/workers/{alerter,daily-digest,deletion,dsa-sla}.ts` beyond their imports.
- iOS networking layer (`ios/OpenMatch/Networking/`) — pinning, TLS, ATS exemptions.
