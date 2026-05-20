# OpenMatch — Validation, Cryptography & Secret-Handling Audit

**Scope:** Read-only audit of the OpenMatch Fastify backend (`backend/src/`),
Prisma schema, `.env.example` files, and security-adjacent helpers (TOTP,
hashing, EXIF stripping, sensitive-access grants, Apple SIWA verifier).

**Auditor stance:** Findings focus on gaps not yet addressed by the FAANG
hardening pass (PRs #48–#52). Items already covered by the error-code
registry, response schemas, `npm audit` CI, or OpenAPI export are not
re-reported. Each finding is numbered `SEV-V<n>`.

---

## Summary

| Severity        | Count | IDs                                                  |
|-----------------|-------|------------------------------------------------------|
| Critical        | 0     | —                                                    |
| High            | 5     | SEV-V1, SEV-V2, SEV-V3, SEV-V4, SEV-V11              |
| Medium          | 7     | SEV-V5, SEV-V6, SEV-V7, SEV-V8, SEV-V9, SEV-V12, SEV-V13 |
| Low             | 5     | SEV-V10, SEV-V14, SEV-V15, SEV-V16, SEV-V17          |
| Informational   | 2     | SEV-V18, SEV-V19                                     |

**Total: 19 findings**

### Highlights

- **Mass-assignment vectors** in `PATCH /profile/me/profile` and
  `PATCH /preferences/me` (`...body` / `update: body as never`) — the Prisma
  type system has been escaped with `as never`, so the only thing keeping
  callers from writing to arbitrary Profile/Preferences columns is the Zod
  schema. The schema currently allows-lists today's columns, but the
  pattern is fragile and a future column rename without updating the
  schema becomes an immediate privilege escalation.
- **TOTP code comparison is not constant-time** (`hotp(...) === cleaned`),
  and recovery codes are matched with `Array.prototype.includes` over a
  SHA-256-hashed list — also not constant-time. Recovery-code generation
  entropy is good (rejection sampling on 32-char alphabet → exactly
  unbiased), but the secret string `${secret}` is interpolated into the
  `otpauth://` URI without base32 length sanity check on the issuer-supplied
  `label` (admin email), and the TOTP shared secret is stored
  unencrypted-at-rest in the `AdminUser.totpSecret` column.
- **JWT signing omits `aud` and `iss` claims** in both the consumer and
  admin JWT plugins (`backend/src/plugins/auth.ts:30-33`,
  `backend/src/plugins/admin-auth.ts:42-49`). The two namespaces share the
  HS256 algorithm and only diverge on the secret. The "deferred in
  A_PLUS_SCORECARD line 104" item is still open.
- **Apple SIWA verification accepts `email_verified === "true"` (string)**
  as truthy without rejecting unverified emails (`apple-auth.service.ts:36-38`).
  An attacker with an unverified Apple sub can still complete signup; we
  never gate signup on `emailVerified === true`.
- **`x-forwarded-for` parsing without validation** (multiple routes:
  `auth.ts:22-24`, `privacy.ts:94-95`) — `req.headers['x-forwarded-for']`
  is a user-controllable header. We split on `,` and use the first
  element, but never check it's a syntactically valid IP, never normalise
  IPv6, and feed the result directly into `hashIp(...)` and rate-limit
  keys. A client can supply an arbitrary string and pin its
  account-level rate-limit bucket to a value of its choice on the dev
  login path (`trustProxy: true` is enabled in non-test envs).
- **Public DSA ticket lookup uses `===` for email-based authz**
  (`dsa.ts:169`). Combined with the 30 req/min rate-limit per IP and 21
  ticket IDs guessable from cuid prefix collisions, a timing attack can
  reveal the email on a ticket given a known ticket id. Low practical
  exploitability but the comparison should use `timingSafeEqual`.
- **Default `ADMIN_JWT_SECRET=dev-admin-secret-please-change` ships to
  prod if operator forgets to override** (`env.ts:23`). The env schema
  only requires `min(16)`; the literal default trivially satisfies it,
  so an unset prod env starts the server with a documented secret.
  Compare to `JWT_SECRET` which is `z.string().min(16)` with NO default —
  the asymmetry is the bug.

---

## Findings

### SEV-V1 — Mass assignment via unchecked spread into Prisma `data`

- **Severity:** High
- **Location:**
  - `backend/src/routes/profile.ts:125-136`
  - `backend/src/routes/preferences.ts:45-49`
- **Description:**
  Both routes parse the body with a Zod schema and then spread the
  *entire* parsed object into Prisma's `data` field, casting through
  `as never` / `as Record<string, unknown>`. Today the Zod schema is the
  only thing preventing writes to columns like `Profile.verificationStatus`,
  `Profile.moderationStatus`, or future sensitive columns. If a future
  PR adds a column AND adds it to the Zod schema (a likely pairing),
  the column becomes user-writable by default.

  This same pattern is in `routes/admin/metros.ts:41` (`data: { ...body }`)
  and `routes/admin/flags.ts:60-68` — admin-only, lower blast radius,
  but the same fragility.

- **Repro:** Append `verificationStatus: "verified"` to the Zod
  `updateSchema` in `profile.ts` (e.g. via a typo when adding a
  feature) and the field becomes user-settable. The Prisma type system
  is bypassed by `as never`.

- **Recommendation:**
  Replace `...(data as Record<string, unknown>)` and `update: data as never`
  with an explicit allow-list mapping:

  ```ts
  const update: Prisma.ProfileUpdateInput = {
    ...(data.displayName !== undefined && { displayName: data.displayName }),
    ...(data.bio !== undefined && { bio: data.bio }),
    // ...one line per allowed field
  };
  ```

  Drop the `as never` cast — let Prisma's generated types fail closed.

---

### SEV-V2 — TOTP code comparison is not constant-time

- **Severity:** High
- **Location:** `backend/src/services/admin/totp.service.ts:99-102`

  ```ts
  for (let drift = -WINDOW; drift <= WINDOW; drift += 1) {
    if (hotp(secret, counter + drift) === cleaned) return true;
  }
  ```

- **Description:**
  String equality (`===`) in V8 short-circuits on the first mismatching
  byte. Combined with the same-process `verifyTotpAgainstSecret` shape
  used for both correct and incorrect codes, a remote attacker can in
  principle distinguish near-matches via timing. Practical exploitability
  is low (the TOTP space is 10⁶ and the route is rate-limited to 20/min)
  but the codebase already uses `constantTimeEqual` for the internal
  worker token, so the asymmetry is gratuitous.

- **Repro:** Static — `===` is in the source.

- **Recommendation:**
  Compare with `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))`,
  guarding for length:

  ```ts
  function ctEq(a: string, b: string): boolean {
    const ab = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
  }
  ```

  Same fix applies to recovery-code lookup
  (`consumeRecoveryCode` — `admin.recoveryCodes.includes(target)` at
  `totp.service.ts:207`). `Array.prototype.includes` is also not
  constant-time across the list.

---

### SEV-V3 — JWT tokens omit `aud` and `iss` claims

- **Severity:** High
- **Location:**
  - `backend/src/plugins/auth.ts:30-33`
  - `backend/src/plugins/admin-auth.ts:42-49`
- **Description:**
  Tokens are signed with only `sub` + `scope` + `iat` + `exp`. There is
  no `aud` (audience) or `iss` (issuer) claim. If the same `JWT_SECRET`
  is ever shared with another service (e.g. a future analytics worker,
  or an inadvertent re-use during local-dev), tokens minted for one
  service work in the other. `A_PLUS_SCORECARD.md:104` calls this out
  as deferred — the gap is still present.

- **Repro:** Decode any access token; `aud` and `iss` are absent.

- **Recommendation:**
  Set `sign.aud` and `sign.iss` in both `@fastify/jwt` registrations
  (e.g. `aud: "openmatch.api"` and `iss: env.APP_BASE_URL`), and add the
  matching `verify` constraints. Same fix for the admin namespace.

---

### SEV-V4 — Apple SIWA accepts unverified email; no email-verified gate

- **Severity:** High
- **Location:** `backend/src/services/apple-auth.service.ts:24-39`,
  consumed by `backend/src/routes/auth.ts:174-209`
- **Description:**
  `verifyAppleIdentityToken` extracts `email_verified` but the consumer
  (`auth.ts → upsertAppleUser`) never checks it. If the Apple identity
  token contains `"email_verified": "false"`, signup still proceeds and
  binds the (potentially attacker-controlled) email to a new account.
  Apple permits unverified relay emails in rare edge cases; we should
  fail closed.

  Also: `email_verified === "true"` (string) and `=== true` (bool) are
  both treated as verified. Apple's spec only allows the string form
  for HTTP form-encoded responses; the JWT form is the boolean. Accepting
  both is harmless but the asymmetry should be noted.

- **Recommendation:**
  In `auth.ts:179` after `verifyAppleIdentityToken`, reject when
  `identity.email` is present and `identity.emailVerified !== true`. Log
  the rejection as `auth.apple_email_unverified` for telemetry.

---

### SEV-V5 — Trust of `x-forwarded-for` header without IP validation

- **Severity:** Medium
- **Location:**
  - `backend/src/routes/auth.ts:22-24`
  - `backend/src/routes/privacy.ts:94-95`
  - `backend/src/lib/hash.ts:7-10`
- **Description:**
  Many handlers extract IP via `(req.headers['x-forwarded-for'] as string)
  ?.split(",")[0]?.trim() ?? req.ip`. The result is passed into:
  (a) the `ipHash` field of `Session.ipHash` / `ConsentRecord.ipHash`,
  (b) signed via `hashIp` (SHA-256, 32-char truncation), and
  (c) used as a per-IP rate-limit key in the auth-start path
  (the rate-limit plugin uses `req.ip` directly, which is OK, but
  `requestContext` exposes the unvalidated string).

  No syntactic validation that the value is a valid IPv4 / IPv6 string.
  A client can submit `X-Forwarded-For: not-an-ip-just-a-string` and
  have it persisted as their "IP hash" forever.

  `trustProxy: true` is set in non-test envs (`server.ts:119`), which
  means Fastify already extracts `req.ip` from XFF reliably; the
  redundant manual XFF parsing in handlers should be removed in favour
  of `req.ip`.

- **Recommendation:**
  Drop the manual XFF parsing; rely on `req.ip`. If a forensic audit
  needs the full XFF chain, capture it separately as a known-untrusted
  field.

---

### SEV-V6 — DSA public ticket lookup: non-constant-time email comparison

- **Severity:** Medium
- **Location:** `backend/src/routes/dsa.ts:165-172`

  ```ts
  if (claimed.length > 0 && onTicket.length > 0 && claimed === onTicket) {
    authorised = true;
  }
  ```

- **Description:**
  Unauthenticated path. Given a known ticket id and a guessed
  reporter email, a timing oracle on `===` can incrementally reveal the
  email char-by-char. The 30 req/min rate-limit and cuid randomness
  reduce the practical exploit window, but the comparison should be
  constant-time on principle.

- **Repro:** Static.

- **Recommendation:**
  Use `crypto.timingSafeEqual` after Buffer-coercing both sides; ensure
  the length-check branch always runs even on length mismatch (to avoid
  early-exit timing leak).

---

### SEV-V7 — `ADMIN_JWT_SECRET` ships with a publicly-known default

- **Severity:** Medium
- **Location:** `backend/src/env.ts:23`

  ```ts
  ADMIN_JWT_SECRET: z.string().min(16).default("dev-admin-secret-please-change"),
  ```

- **Description:**
  `JWT_SECRET` is correctly required (`z.string().min(16)` no default),
  but `ADMIN_JWT_SECRET` has a documented dev-default. If an operator
  forgets to set `ADMIN_JWT_SECRET` in prod the server starts happily
  and mints admin tokens signed with a value that is in the public
  GitHub repo. This is a complete admin compromise.

  Same pattern affects `INTERNAL_WORKER_TOKEN`
  (`env.ts:93-96`, default `"dev-internal-worker-token-please-change-32-chars"`).

- **Recommendation:**
  In production (`NODE_ENV === "production"`) refuse to start if the
  value equals the documented default. Easiest:

  ```ts
  ADMIN_JWT_SECRET: z.string().min(32).refine(
    (v) => process.env.NODE_ENV !== "production" || v !== "dev-admin-secret-please-change",
    { message: "ADMIN_JWT_SECRET must be overridden in production" }
  ),
  ```

  Same fix for `INTERNAL_WORKER_TOKEN`. Increase minimum length to 32
  for all secret-class env vars.

---

### SEV-V8 — TOTP secret stored unencrypted at rest

- **Severity:** Medium
- **Location:**
  - `backend/src/services/admin/totp.service.ts:172-179`
  - `backend/prisma/schema.prisma` — `AdminUser.totpSecret`
- **Description:**
  TOTP shared secrets are persisted in plaintext base32 in the
  `AdminUser.totpSecret` column. A DB read (or backup leak) yields the
  shared secret directly. Industry-standard is to encrypt at rest with
  a column key separate from `DATABASE_URL` (envelope encryption via
  AWS KMS / GCP KMS, or at minimum AES-256-GCM with a key from a
  distinct env var). Recovery codes are correctly hashed (SHA-256),
  but the TOTP secret itself is not.

- **Recommendation:**
  Encrypt `totpSecret` on write with a dedicated `ADMIN_TOTP_KEK`
  symmetric key (32 bytes, AES-256-GCM). Decrypt only inside
  `verifyTotpAgainstSecret`. Rotate by adding a key-id prefix to the
  stored ciphertext.

---

### SEV-V9 — Email allow-list bypass when `ADMIN_ALLOWED_EMAILS` is empty

- **Severity:** Medium
- **Location:** `backend/src/services/admin/auth.service.ts:36-45`

  ```ts
  if (list.size === 0) {
    return env.NODE_ENV !== "production";
  }
  ```

- **Description:**
  In `production`, empty `ADMIN_ALLOWED_EMAILS` returns `false` —
  correct. But the check is `env.NODE_ENV !== "production"` rather
  than `=== "development"`, so any value that isn't literally
  `"production"` (e.g. `NODE_ENV=staging`, `NODE_ENV=qa`,
  `NODE_ENV=prod`, or a typo `NODE_ENV=Production`) is treated as a
  dev environment and permits **any email** to receive admin
  magic-links. Combined with the dev auto-provision branch on lines
  70-75 it auto-creates an AdminUser row for any caller.

- **Recommendation:**
  Default to fail-closed for unknown env strings:

  ```ts
  if (list.size === 0) return env.NODE_ENV === "development";
  ```

  Alternately, narrow `env.NODE_ENV` to the strict enum in `env.ts`
  (it already is — but the comparison should still be `===`).

---

### SEV-V10 — `req.body` reused before any per-route validation in `swipes` undo route

- **Severity:** Low
- **Location:** `backend/src/routes/swipes.ts:78-99`
- **Description:**
  `r.post("/:swipeId/undo", { schema: { params: z.object({ swipeId: z.string() }) }, ... })`
  validates `swipeId` only as `z.string()` — no length cap, no
  character-set restriction. A 1MB string is accepted and passed to
  `prisma.swipeAction.findUnique`. Prisma silently returns null but the
  parser cost (and any logging) is unbounded.

  This same `z.string()`-only pattern recurs in many places
  (`/me/photos/:photoId`, `/matches/:matchId`, every admin `:id` param,
  every `cursor` query param). cuid is a 25-char prefix; capping the
  string at e.g. `max(100)` is cheap and reduces DoS surface.

- **Recommendation:**
  Define a shared `idSchema = z.string().min(1).max(100)` and use it
  for every path-param and cursor.

---

### SEV-V11 — `data: req.body` mass-assignment risk in metros, flags, roles routes

- **Severity:** High
- **Location:** `backend/src/routes/admin/metros.ts:41`,
  `backend/src/routes/admin/flags.ts:53-94`
- **Description:**
  `data: { ...body, countryCode: body.countryCode.toUpperCase() }` in
  metros works today only because the Zod `createSchema` exactly mirrors
  the writable columns. If a future column (e.g.
  `createdByAdminUserId`, `lastEditedBy`) is added to `MetroBoundary`
  AND the operator extends the Zod schema by mistake, that column
  becomes admin-writable when it should be server-set.

  Admin-only blast radius — but the principle of least privilege
  argues for explicit field selection.

- **Recommendation:**
  Same as SEV-V1: explicit Prisma type, no `as never` escape, no
  `...body` spread.

---

### SEV-V12 — Audit-log query: `targetEntityType`, `accessReason` filters not type-checked

- **Severity:** Medium
- **Location:** `backend/src/routes/admin/audit.ts:5-33`
- **Description:**
  The `listSchema` accepts `eventType`, `targetEntityType`, `accessReason`
  as free-form `z.string().optional()` and writes them straight into
  the Prisma `where` clause. Prisma will reject unknown enum values at
  runtime with a generic 500, but it's preferable to validate against
  the enum at the route layer. More importantly, the un-capped string
  length means an attacker can DoS the audit search by submitting
  multi-MB filter values that travel through Prisma → Postgres before
  failing.

- **Recommendation:**
  Restrict each filter to `z.enum([...])` or
  `z.string().min(1).max(60)`.

---

### SEV-V13 — Magic-link tokens returned in response body when `NODE_ENV !== production`

- **Severity:** Medium
- **Location:**
  - `backend/src/services/auth.service.ts:92-94` (`devToken`)
  - `backend/src/services/admin/auth.service.ts:113-116` (`devToken`)
- **Description:**
  In any environment that isn't literally `"production"` the magic-link
  token is returned in the JSON response body. Pino redaction
  (`server.ts:73-87`) catches `req.body.token`, but the response
  payload is not redacted, and Vercel preview deployments default to
  `NODE_ENV=preview` which is NOT `"production"`. A preview-env access
  log leaks unconsumed magic-link tokens.

  The intent — dev-loop convenience — is reasonable, but the
  exposure boundary is too wide.

- **Recommendation:**
  Gate `devToken` on `NODE_ENV === "development"` (strict equality),
  not the negative check. Same as SEV-V9.

---

### SEV-V14 — `verify` route accepts the magic-link via GET querystring

- **Severity:** Low
- **Location:** `backend/src/routes/auth.ts:269-293`
- **Description:**
  `GET /api/v1/auth/verify?challengeId=...&token=...` is a convenience
  for clicking the email link in a browser, but it places the bearer
  token in:
  - server request logs (even with Pino redaction enabled, the URL
    path is not redacted),
  - browser history,
  - the `Referer` header on any cross-origin asset on the landing
    page,
  - upstream proxy / CDN logs.

  Consumer convenience justifies the trade-off, but a POST-only flow
  with a small client-side redirect page is the safer pattern.

- **Recommendation:**
  Add the `Referrer-Policy: no-referrer` header on the GET handler,
  consume the token in a same-page redirect, and add the `?token=`
  parameter to Pino path redaction.

---

### SEV-V15 — `interestedGenders`, `relationshipGoals` accept unbounded array of strings

- **Severity:** Low
- **Location:** `backend/src/routes/preferences.ts:10-15`

  ```ts
  interestedGenders: z.array(z.string()).optional(),
  relationshipGoals: z.array(z.string()).optional(),
  educationLevels: z.array(z.string()).optional(),
  colleges: z.array(z.string()).optional(),
  ```

- **Description:**
  No `.max(N)` on the array or per-item `.max(M)`. An attacker can post
  a 50MB array of 1KB strings; Fastify will buffer the body, Zod will
  iterate, Prisma will reject downstream — but the cost of getting to
  the rejection is non-trivial CPU.

  Compare to the well-bounded sibling fields:

  ```ts
  languages: z.array(z.string().max(60)).max(20).optional(),
  interests: z.array(z.string().max(60)).max(30).optional(),
  ```

  in `profile.ts:36-37` — the same pattern was applied to profile but
  not preferences.

- **Recommendation:**
  Add per-array caps consistent with `profile.ts`.

---

### SEV-V16 — Photo upload: no magic-byte verification; MIME-spoof accepted

- **Severity:** Low
- **Location:** `backend/src/routes/profile.ts:174-189`,
  `backend/src/lib/media.ts:51-91`
- **Description:**
  Upload trusts `file.mimetype` (controlled by the client). The EXIF
  stripper (`lib/safety/exif.ts:48-74`) sniffs the magic bytes per
  format, but it returns `format: "other"` and the bytes-unchanged
  when the magic doesn't match — *the upload still succeeds* with the
  wrong stored content-type.

  Practical impact:
  - JPEG-claimed but actually a polyglot PDF/HTML payload gets stored
    and served by the CDN with `Content-Type: image/jpeg`. Most
    browsers don't sniff in this case; risk is bounded but non-zero.
  - PNG bombs (decompression ratio attacks) are not rejected because
    we don't decode the image server-side. iOS pre-encodes so a
    benign client never triggers this; a malicious client can.

  Vercel Blob's CDN serves with the content-type we pass; an attacker
  controlling the upload could potentially serve script content if any
  consumer treats the asset as HTML.

- **Recommendation:**
  After EXIF stripping, check the resolved `format` matches the
  claimed `contentType` and reject mismatches with `415`. Optionally
  decode-and-re-encode with `sharp` (rejected for bundle size — but a
  smaller validator like `image-size` for dimensions + a header sniff
  is enough). Set max dimensions (e.g. 4096×4096) to bound
  decompression bombs.

---

### SEV-V17 — Default error handler exposes Zod `code` to consumer

- **Severity:** Low
- **Location:** `backend/src/lib/http-error.ts:62-74`
- **Description:**
  Every Zod issue is serialised with its raw internal `code` field
  (`invalid_type`, `too_small`, `custom`, etc.). This is a minor
  fingerprinting surface — it reveals which Zod version family is in
  use, which validators run server-side, and exposes any custom-error
  internal codes verbatim. Not exploitable on its own; standard
  guidance is to expose `path` + `message` only and keep `code` in
  internal logs.

- **Recommendation:**
  Drop `code` from the public `fields[]` shape; keep it in the
  server-side log entry only.

---

### SEV-V18 — Informational: invite-code suffix entropy is ~30 bits

- **Severity:** Informational
- **Location:** `backend/src/lib/invite-codes.ts:10-25`,
  `backend/src/routes/admin/invites.ts:82-108`
- **Description:**
  `generateInviteCodeSuffix(length = 6)` produces ~30 bits of entropy
  (log₂(31⁶)). The route handler retries on collision and the prefix
  is human-friendly cohort metadata, so collisions are practically
  unlikely at current scale — but at 100K issued codes the birthday
  bound starts to bite. Today the unique-constraint retry covers this,
  but the loop is hard-capped at 5 attempts (`invites.ts:104`) which
  could surface as a 500 with no detail on collision exhaustion.

- **Recommendation:**
  Bump default suffix length to 8 (~40 bits) and increase the retry
  cap, or surface a clean error code on exhaustion.

---

### SEV-V19 — Informational: Prisma `contains` search on admin user query

- **Severity:** Informational
- **Location:** `backend/src/services/admin/users.service.ts:23-26`
- **Description:**
  Admin user search uses `displayName: { contains: q, mode: "insensitive" }`
  with the raw user input. Prisma escapes the value for SQL, so this is
  *not* SQL injection. It is, however, an unanchored substring search on
  a non-indexed expression and is therefore a free Postgres seq-scan on
  the Profile table — admin-only, so the attack vector is limited, but
  a malicious admin (or compromised admin token) can perform a slow-loris
  DoS by issuing many "%a%"-style searches.

- **Recommendation:**
  Add `q.length >= 3` minimum, and consider a trigram index on
  `Profile.displayName` if the search is heavily used.

---

## Items explicitly verified as safe

- **Refresh tokens** — 32 bytes of `crypto.randomBytes` hex-encoded,
  stored only as SHA-256 hash; rotation revokes prior; reuse detection
  revokes the family. Good.
- **Apple identity-token verification** — uses `jose.jwtVerify` with
  the live Apple JWKS, `issuer` + `audience` both pinned. Good.
- **TOTP recovery-code generation** — `randomBytes` + rejection
  sampling. PR-49 fix held. The bias note in the comment is correct
  (256 % 32 == 0 so bias would be zero, but rejection sampling makes
  it explicit). Good.
- **Raw SQL** — every `$queryRawUnsafe` / `$executeRawUnsafe`
  callsite uses positional `$1`-style parameters; no user input is
  interpolated as string. The `${trunc}` interpolation in
  `admin/analytics.ts:271,284,295` and `admin/metrics.ts:203` comes from
  a Zod-validated `z.enum(["hour", "day"])` so the value is bounded.
  Good.
- **EXIF stripping** — covers JPEG / PNG / WebP with magic-byte sniff;
  HEIC explicitly rejected at the upload layer. Good (but see SEV-V16
  for the MIME-vs-actual mismatch gap).
- **Vercel Blob upload** — `randomUUID()` storage key, no path
  traversal possible (key is server-generated). Good.
- **Internal worker bearer** — constant-time compare,
  `INTERNAL_WORKER_TOKEN` env value (modulo SEV-V7 default).
- **Pino redaction** — `req.headers.authorization`, `req.body.token`,
  `req.body.refreshToken`, `*.email`, `*.emailHash` all redacted.
  Good.

---

## Recommended remediation order

1. **SEV-V7** (default admin secret) — change is one-line, blast radius is
   total admin compromise if missed.
2. **SEV-V3** (JWT aud/iss) — known-deferred item; cheap to ship.
3. **SEV-V4** (Apple email-verified gate) — one-line check, closes a
   real signup-spoofing path.
4. **SEV-V2** (constant-time TOTP/recovery compare) — small, principled
   fix.
5. **SEV-V1 / SEV-V11** (mass-assignment) — bigger refactor; landable
   per-route.
6. **SEV-V8** (TOTP secret at rest) — needs a KMS / KEK story; size as
   a workstream.
7. Remaining items: opportunistic, batchable into a single hardening PR.
