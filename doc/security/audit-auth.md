# Security Audit — Auth / Sessions / RBAC / Admin

> Read-only audit conducted 2026-05-20 against commit `32b26462`.
> Scope: consumer auth (email magic link + Apple SIWA), JWT issuance and
> verification, admin auth + TOTP, RBAC across `/api/v1/*` and admin
> surfaces, session security (rotation / revocation), account-takeover
> paths, CSRF / cross-origin.

## Summary

- **17 findings**: 2 critical, 5 high, 5 medium, 4 low, 1 informational
- **Top 3 risks**
  1. **`SEV-A1` — Admin TOTP can be reset by a magic-link-only attacker**, completely defeating the 2FA gate for the admin dashboard.
  2. **`SEV-A2` — Admin refresh tokens have no reuse detection**, so a stolen admin refresh token persists silently after the victim's next legitimate rotation.
  3. **`SEV-A3` — Match / conversation / discovery endpoints leak counter-party PII** (`emailHash`, `phoneHash`, `authProvider`, `authSubject`, raw `dateOfBirth`, `isBanned`, plus full `Profile.location` geography) to any matched user.

The hardening pass (PRs #48–#52) covered structured errors, Pino redaction, Sentry PII scrub, request-id correlation, response schemas on auth/swipes/undo, and a central error helper. The findings below are gaps that survived that pass — most stem from Prisma queries that return all model columns by default (no `select`), missing serializers between Prisma rows and HTTP DTOs, and an admin auth surface that diverged from the (better-hardened) consumer surface.

## Findings

### [SEV-A1] Admin TOTP can be wiped + re-enrolled by a magic-link-only attacker (auth-factor downgrade)
- **Severity**: critical
- **Location**: `backend/src/routes/admin/totp.ts:25-48` and `backend/src/services/admin/totp.service.ts:156-182`
- **Description**: `POST /api/v1/admin/auth/totp/enroll` is guarded only by `app.authenticateAdmin` — it does **not** require `app.requireAdminTwoFactor`. The handler unconditionally writes a fresh `totpSecret` + `recoveryCodes`, overwriting whatever the legitimate admin had previously enrolled. The accompanying inline comment ("We deliberately allow re-enrolment") confirms this is intentional. Combined with the fact that the magic-link `verify` flow issues a session token *before* 2FA elevation, an attacker who has compromised an admin's email inbox (or who can intercept the magic-link URL in transit / in a URL preview) can:
  1. POST `/admin/auth/start` and receive the magic link to the email they control.
  2. GET the magic link → backend issues `accessToken` + `refreshToken` (2FA not yet elevated).
  3. POST `/admin/auth/totp/enroll` → backend overwrites the legitimate admin's TOTP secret and returns a fresh secret + recovery codes to the attacker.
  4. POST `/admin/auth/totp/verify` with a code from the attacker's authenticator → backend marks the session 2FA-elevated.
  5. Attacker now has full admin access; the legitimate admin's authenticator no longer produces valid codes and their recovery codes have been invalidated.
  This is a complete bypass of the 2FA control for the admin dashboard. The control becomes single-factor against an email compromise — exactly the failure mode 2FA exists to prevent.
- **Repro**: see steps 1–5 above. Requires only that the attacker can read one admin magic-link email.
- **Recommendation**: Require an additional factor for `enroll` once a secret already exists. Concretely:
  ```ts
  // backend/src/services/admin/totp.service.ts
  export async function enrollTotp(prisma, adminUserId, options) {
    const admin = await prisma.adminUser.findUnique({ where: { id: adminUserId } });
    if (!admin) throw ...;
    if (admin.totpSecret) {
      // Re-enrolment must require either a current TOTP code or a
      // recovery code, OR be initiated from a session that is already
      // 2FA-elevated. Throw 409 otherwise.
      throw Object.assign(new Error("totp_already_enrolled"), { statusCode: 409 });
    }
    ...
  }
  ```
  Then add a separate `POST /admin/auth/totp/reset` route that is gated by `requireAdminTwoFactor` (or by an explicit one-time-recovery-code body) for the legitimate "I lost my phone" path. Also consider sending a "your admin 2FA was reset" notification email to the admin's address on every re-enrolment so a takeover at least leaves an out-of-band trail.

### [SEV-A2] Admin refresh-token rotation lacks reuse detection
- **Severity**: critical
- **Location**: `backend/src/services/admin/auth.service.ts:193-218`
- **Description**: `rotateAdminSession` mirrors the consumer `rotateRefreshToken` API but omits the OWASP-recommended reuse-detection branch. When a refresh token whose `revokedAt` is non-null is presented, the function just returns `null`; it does not revoke the rest of the user's session family or log a security event. By contrast, the consumer `rotateRefreshToken` (`backend/src/services/auth.service.ts:301-350`) does both. Net effect: a stolen admin refresh token used once gives the attacker a fresh pair, and when the legitimate admin's client next tries to rotate, the attacker's session is **not** invalidated. The attacker silently retains admin access until the next time the legitimate admin's session happens to be rotated AGAIN with a token that the attacker has already burned — and even then, only that single old token fails; the attacker's chain continues. The admin surface is far more sensitive than the consumer one and should have, at minimum, the same protections.
- **Repro**: static analysis only — diff `auth.service.ts:301-326` (consumer, has reuse detection + family revocation) against `admin/auth.service.ts:193-218` (admin, does not).
- **Recommendation**: Port the consumer pattern verbatim. After `findUnique`:
  ```ts
  if (session.revokedAt) {
    app.log.warn({ event: "admin.refresh_token_reuse", adminUserId: session.adminUserId },
                 "admin_refresh_token_reuse_detected");
    await prisma.adminSession.updateMany({
      where: { adminUserId: session.adminUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return null;
  }
  ```
  Also write an `AdminAuditLog` row with `eventType: "admin_refresh_reuse"` so reuse signals show up in the audit pane.

### [SEV-A3] Match / conversation / discovery responses leak counter-party PII to every matched user
- **Severity**: high
- **Location**:
  - `backend/src/services/match.service.ts:3-23` (`listMatches`) and `backend/src/routes/matches.ts:11-25` (`GET /matches/:matchId`)
  - `backend/src/services/chat.service.ts:5-24` (`listConversations`)
  - `backend/src/routes/profile.ts:272-282` (`GET /profile/:profileId`) — returns the full `Profile` row including the PostGIS `location` geography column.
- **Description**: None of these queries use a `select`/typed serializer, so Prisma returns every column on the included `User` and `Profile` rows. For the match / conversation surfaces that means every matched peer can read the other party's `emailHash`, `phoneHash`, `authProvider`, `authSubject` (Apple `sub`), `dateOfBirth`, `isBanned`, `isAgeVerified`, and `status`. `emailHash` is an **unsalted** SHA-256 of the lowercase email (see `backend/src/lib/hash.ts:16-18`), so given a candidate email an attacker can confirm it belongs to the matched user in O(1). The Apple `sub` (`authSubject`) is unique-per-app but is the canonical Apple identifier — a leak that should not happen. For `GET /profile/:profileId` the raw `Profile.location` geography column is serialised back; depending on the Prisma driver this is either the WKB bytes or a `{type:"Point",coordinates:[lng,lat]}` object — either way it discloses exact lat/lng coordinates for an arbitrary visible profile to any authenticated user, bypassing the deliberate `formatDistance`/rounded-city display logic the rest of the app uses.
- **Repro**:
  1. Authenticate as user U1, match with user U2 (any consenting test user).
  2. `GET /api/v1/matches/` → response includes `userB.emailHash`, `userB.phoneHash`, `userB.authSubject`, `userB.dateOfBirth`.
  3. Locally compute `sha256(candidate_email.toLowerCase().trim()) === userB.emailHash` to enumerate U2's email from any guess list.
  4. Separately, as U1, call `GET /api/v1/profile/<any-visible-profileId>` → response body contains the raw `location` field with lat/lng.
- **Recommendation**: Replace every Prisma read that crosses a trust boundary with an explicit `select` (or a `serializeUser(row)` helper). Minimum allowed fields for a peer view: `id`, `profile { id, displayName, photos, … }`, `lastActiveAt`. Forbidden in peer-visible responses: `emailHash`, `phoneHash`, `authProvider`, `authSubject`, `dateOfBirth` (expose only computed `age`), `isBanned`, raw `Profile.location`. Update at minimum:
  - `match.service.ts:listMatches` and `matches.ts:/:matchId` — `select` only the peer-safe fields.
  - `chat.service.ts:listConversations` — same.
  - `profile.ts:GET /:profileId` — return a `PublicProfileDTO` that excludes `location`, `region`, and any other unintentionally-exported column.
  Consider adding a `// peer-visible — keep in sync with PublicProfileDTO` invariant on the schema columns to prevent regressions.

### [SEV-A4] Magic-link tokens are sent over GET; URL prefetchers / antivirus scanners can consume them
- **Severity**: high
- **Location**: `backend/src/routes/auth.ts:269-293` (consumer `GET /auth/verify`) and `admin/app/(auth)/login/callback/route.ts:18-31` (admin callback), token built at `backend/src/services/auth.service.ts:77`
- **Description**: The magic link the user receives is `…/api/v1/auth/verify?challengeId=…&token=…`. Any URL-prefetching agent in the recipient's pipeline (corporate mail-scanner appending `?safe=1` style URL inspection, Outlook safe-link rewriting, Apple Mail's link previews on iOS 17+, Slack URL unfurling if forwarded, browser bookmark sync, network-AV proxies) will issue a `GET` that consumes the one-time challenge, marking `consumedAt` and (for the admin flow) handing the attacker an `accessToken` + `refreshToken` via the SSR callback. The legitimate user then sees `challenge_used` and is locked out until they retry. The window is `MAGIC_LINK_TTL_SECONDS` (15 min consumer / 10 min admin).
- **Repro**: Send yourself a magic link from a deployed instance, then `curl <link>` from a *different* host before clicking it on the device. The subsequent device GET returns `challenge_used`.
- **Recommendation**: Two complementary mitigations:
  1. Move consumption to `POST` only. Keep the `GET` link in the email — but have it land on a tiny HTML page that says "Confirm sign-in" and does a `POST /auth/verify` on click. This defeats every silent prefetcher / scanner that ever existed. (The admin `/login/callback` route handler should do the same: render a page that requires an explicit "Continue" click before issuing the verify request.)
  2. Bind the challenge to either the requesting User-Agent or to a `device_fingerprint` cookie set on `/auth/start`, so a hand-off from the scanner host to the user's device fails closed.

### [SEV-A5] iOS Apple SIWA flow omits a nonce; backend does not enforce one
- **Severity**: high
- **Location**: `ios/OpenMatch/Networking/AppleSignInCoordinator.swift:25-36` (no `request.nonce`) and `backend/src/services/apple-auth.service.ts:24-39` (does not require / verify `payload.nonce`)
- **Description**: Apple's SIWA spec recommends that the relying party generate a per-request nonce, hash it into `request.nonce` (which Apple includes in the signed identity token as `nonce`), and verify the hashed nonce server-side. OpenMatch does neither. Consequence: an attacker who captures a victim's identity token (via a malicious app sharing the keychain, a leaked debug log, or a misconfigured TLS-pinning bypass on a jailbroken device) can replay it against `POST /auth/start` (method=apple) until Apple's token TTL (10 minutes for `c_hash`, but the JWS itself can be valid longer) and obtain a full session bound to the victim's `authSubject`. The current verifier checks signature, issuer, and audience but not nonce, expiry-binding to the client, or replay state — the only thing standing between the attacker and a free login is the network's ability to deliver Apple's signed token to the attacker.
- **Repro**: static analysis only without a paired exploit environment, but the missing `request.nonce` + missing `audience.nonce` check are unambiguously visible in the linked files.
- **Recommendation**:
  - **iOS**: generate `let nonce = sha256(randomBase64(32))`, pass the unhashed form to `request.nonce = nonce`, send the unhashed nonce up with the identity token (e.g. a `appleAuthNonce` field on the start request).
  - **Backend**: extend `verifyAppleIdentityToken` to require `payload.nonce`, and have the caller pass the expected `sha256(unhashedNonce)`; reject if mismatched. Additionally, store consumed `payload.jti` (or `payload.nonce`) in a short-TTL Redis set so a single token cannot be redeemed twice.

### [SEV-A6] Account deletion does not revoke active sessions or refresh tokens
- **Severity**: high
- **Location**: `backend/src/services/privacy.service.ts:449-499` (`scheduleAccountDeletion`) and `backend/src/plugins/auth.ts:35-42` (`authenticate` doesn't check `user.status`)
- **Description**: `scheduleAccountDeletion` flips `user.status` to `paused`, hides the profile, and pauses discovery — but it does **not** call `revokeAllUserSessions` and the JWT `authenticate` hook does not look up the User row to check status. During the grace window an attacker who has compromised an access token (or even a refresh token) continues to be able to read the user's `/me`, send messages from established matches, post to `/feedback`, and most importantly **cancel the deletion** via `DELETE /privacy/account/deletion`. Because the consumer JWT TTL is 15 minutes but the refresh flow doesn't check status either, the access can be rotated forward indefinitely until `performAccountErasure` runs and deletes `Session` rows. Even after erasure, a still-valid access JWT (max 15 min) continues to authenticate against the route gate because the `authenticate` decorator only verifies the JWT signature/exp.
- **Repro**:
  1. As user U1, issue `POST /privacy/account/deletion`.
  2. Continue using the existing access + refresh token. Confirm `GET /profile/me/profile` still 200s and `POST /privacy/account/deletion` (the cancel) silently un-pauses the account.
- **Recommendation**:
  - In `scheduleAccountDeletion`, after the status flip, call `revokeAllUserSessions(prisma, args.userId)`.
  - In `plugins/auth.ts:authenticate`, after `jwtVerify`, look up `user.status` and reject any token whose user is `paused | deleted | banned`. Cache the lookup in Redis with a 30s TTL to keep the hot path cheap.
  - In `performAccountErasure` (which already deletes sessions), additionally bump a `tokenVersion` column on the User row and include it in JWT claims so any still-in-flight access token from the prior version is rejected.

### [SEV-A7] Admin re-enrol of TOTP does not require old code AND emits no out-of-band notification
- **Severity**: high
- **Location**: `backend/src/routes/admin/totp.ts:25-48`
- **Description**: Companion to `SEV-A1`. Even setting aside the bypass primitive, the audit row written by re-enrolment (`admin_totp_enrolled`) is the *only* signal that an admin's authenticator was replaced. There is no email-to-the-admin, no Slack alert (the `SLACK_WEBHOOK_URL` plumbing exists already for the alerter worker but isn't wired here), and the legitimate admin first notices the takeover when their codes stop validating. For an account-level recovery surface this is a high-impact defence-in-depth gap.
- **Repro**: static analysis only.
- **Recommendation**: On every `enroll` / `disable`, send an email to the AdminUser's `email` (using the existing `getMailer()` helper), and post a Slack alert via the alerter pathway when `SLACK_WEBHOOK_URL` is configured. The notification must use a stable copy-paste resistant phrasing ("If you did not change your 2FA device, contact security@…").

### [SEV-A8] Admin allow-list bypass in non-production environments (`isEmailAdminAllowed`)
- **Severity**: medium
- **Location**: `backend/src/services/admin/auth.service.ts:36-45, 70-75`
- **Description**: When `ADMIN_ALLOWED_EMAILS` is empty the function returns `true` for any email in non-production (`NODE_ENV !== "production"`). It then auto-creates an `AdminUser` row for that email and grants the magic link. In a misconfigured staging or preview environment (Vercel preview deploys often have a non-`production` env), any attacker who can guess the admin BFF origin can mint an admin session for themselves. Preview deployments often have access to the same Postgres as production — if `DATABASE_URL` is shared, that means any preview deployment of the repo becomes an admin-account-creation endpoint. The `env.ts` default for `ADMIN_JWT_SECRET` is `"dev-admin-secret-please-change"` — if a preview env neither overrides this nor sets `ADMIN_ALLOWED_EMAILS`, that secret is what's actually used.
- **Repro**: deploy a Vercel preview with `NODE_ENV=development` (or `test`) and no `ADMIN_ALLOWED_EMAILS` env var. POST any email to `/admin/auth/start`; receive a magic link.
- **Recommendation**: Refuse to start the server when `NODE_ENV !== "production"` AND `ADMIN_ALLOWED_EMAILS` is empty AND a database URL points at anything other than `localhost`/`127.0.0.1`. Or simpler: always require `ADMIN_ALLOWED_EMAILS` to be non-empty for any deployment that's reachable from outside `127.0.0.1`. Also reject the `ADMIN_JWT_SECRET` default value at boot when `NODE_ENV !== "test"`.

### [SEV-A9] Consumer `revokeAllUserSessions` does not refuse to revoke the caller's current session unless `keepSessionId` is supplied — and the route never supplies one
- **Severity**: medium
- **Location**: `backend/src/services/auth.service.ts:387-401` and `backend/src/routes/auth.ts:353-360`
- **Description**: `POST /auth/sessions/revoke-all` invokes the service without a `keepSessionId`, so the user's currently-active session is revoked along with the others. That means the immediate next request fails with 401 and the iOS client clears its tokens — UX-bad but not catastrophic. The real risk is the inverse: there is no way for the client to call "revoke all OTHER sessions" without ALSO revoking itself, which makes the safer self-service workflow ("I think I left a session at the cafe — kill them but keep me here") unimplementable. More importantly, a hostile party who has stolen a session can use the same primitive to lock out the legitimate user, then immediately re-pair via fresh magic link → effectively a denial of recovery. This is a low-severity issue today because the route is rarely called, but it's a defence-in-depth gap on a security-sensitive primitive.
- **Repro**: log in on two devices. From device A, POST `/auth/sessions/revoke-all` → both A and B 401 on the next call.
- **Recommendation**: Expose the existing `keepSessionId` option through the route by deriving the current session from a `sid` claim on the access token (mirror the admin token's `sid` claim) and passing it to `revokeAllUserSessions`. Make the route default to "preserve current".

### [SEV-A10] Admin magic-link "fake challenge id" for disallowed emails is not constant-time relative to the real path
- **Severity**: medium
- **Location**: `backend/src/services/admin/auth.service.ts:52-82`
- **Description**: The function's stated intent is constant-time-ish behaviour to defeat email enumeration. In practice the real path does (a) `prisma.adminUser.findUnique`, (b) in dev a possible `adminUser.create`, (c) `adminAuthChallenge.deleteMany`, (d) `adminAuthChallenge.create`, (e) `mailer.sendMail` (network round-trip to SMTP). The fake path does only `randomBytes`. The wall-clock delta is hundreds of milliseconds. An attacker with even a noisy timing channel can enumerate which addresses are on the allow-list, which is itself sensitive (admin emails are higher-value phishing targets).
- **Repro**: time `POST /admin/auth/start` with an allow-listed vs random email; the response-time histograms separate cleanly.
- **Recommendation**: For disallowed emails, schedule (and discard) the same DB writes against a junk row (or `setTimeout` to a sampled-median delay). Or — simpler — drop the false-equivalence and document publicly that the admin allow-list is administrative metadata; the production allow-list is rarely a secret anyway.

### [SEV-A11] Unsalted SHA-256 email hashing enables instant lookup from any leaked `emailHash`
- **Severity**: medium
- **Location**: `backend/src/lib/hash.ts:16-18`
- **Description**: `hashIdentity(value) = sha256(value.trim().toLowerCase())`. There is no per-tenant or global salt. Anywhere an `emailHash` value escapes (see `SEV-A3`, admin audit rows, log lines that bypass redaction, future SQL exports) the value can be compared against any candidate email in O(1). Adding a HMAC keyed by a server-side secret would force any attacker who learns the hash to also have the secret before they can confirm membership.
- **Repro**: static analysis — given any leaked `emailHash`, run `sha256` over a candidate list and check for matches.
- **Recommendation**: Switch to `hmac_sha256(env.IDENTITY_HASH_SECRET, value.trim().toLowerCase())`. Plan for a one-shot migration: store both old and new during a cutover window, look up by either, and stop writing the unsalted form once iOS / admin clients have all migrated.

### [SEV-A12] `verifyAppleIdentityToken` does not check `email_verified`
- **Severity**: medium
- **Location**: `backend/src/services/apple-auth.service.ts:35-38` and `backend/src/services/auth.service.ts:235-262` (`upsertAppleUser`)
- **Description**: The verifier surfaces `emailVerified` but no caller checks it. Apple's spec allows tokens where `email_verified == false` when the user is on a corporate / education flow that requires deferred verification. Combined with the absence of nonce (`SEV-A5`), an unverified email could attach itself to an OpenMatch account; if later the legitimate owner tries to sign up via email magic link with the same address, the `User.emailHash` unique constraint will block them.
- **Repro**: static analysis only.
- **Recommendation**: In `upsertAppleUser`, if `identity.emailVerified !== true` AND `identity.email` is set, refuse to persist the email (store `emailHash = null` and require an in-app verification step before treating the address as authoritative for account recovery). Alternatively, require `email_verified` to be true to associate any email at all.

### [SEV-A13] Consumer JWT plugin doesn't pin algorithm; relies on @fastify/jwt default
- **Severity**: low
- **Location**: `backend/src/plugins/auth.ts:29-43` and `backend/src/plugins/admin-auth.ts:41-50`
- **Description**: Neither plugin sets `sign.algorithm` or a verifier `algorithms` allow-list. `@fastify/jwt` defaults to `HS256` which matches the symmetric `secret`, so it's correct today; but if anyone ever introduces an asymmetric key (`publicKey/privateKey`), the verifier will accept whatever the header advertises — historically a vector for `alg:none` and key-confusion bugs in JWT libraries. Explicit pinning is cheap and turns this into a non-issue forever.
- **Repro**: static analysis only — current behaviour is correct, this is defence-in-depth.
- **Recommendation**: Set explicit options:
  ```ts
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { algorithm: "HS256", expiresIn: `${env.JWT_ACCESS_TTL_SECONDS}s` },
    verify: { algorithms: ["HS256"], allowedIss: "openmatch-api", allowedAud: "openmatch-ios" },
  });
  ```
  Then start emitting `iss` + `aud` in `signAccess`. Same change in `admin-auth.ts` with admin-specific `iss/aud` so a consumer JWT can never be forged into an admin one even if the secrets are accidentally aligned.

### [SEV-A14] No per-challenge attempt counter on `/auth/verify`
- **Severity**: low
- **Location**: `backend/src/routes/auth.ts:242-292` and `backend/src/services/auth.service.ts:149-212`
- **Description**: The verify route is per-IP rate-limited to 20/min. The token itself is 256 bits (un-brute-forceable) so a brute-force is not the concern. The concern is that a single `challengeId` can be probed up to TTL (15 min) × per-IP-rate × cross-IP-rotation times — with no `failedAttempts` counter on the `AuthChallenge` row, an attacker who learned `challengeId` from an MITM (URL-fragment in referer, server log, etc.) can attempt arbitrary token guesses from a rotating proxy pool until the TTL expires. Adding a per-challenge counter and invalidating after, say, 5 wrong tokens contains the impact even if the per-IP gate is bypassed.
- **Repro**: static analysis only.
- **Recommendation**: Add `failedAttempts Int @default(0)` to `AuthChallenge`. In `verifyEmailLoginInner`, on `tokenHash` mismatch increment and (when `> 5`) mark `consumedAt: new Date()` so further attempts return `challenge_used`.

### [SEV-A15] Admin session cookie is HMAC-signed but not encrypted, and the access token sits in plaintext inside it
- **Severity**: low
- **Location**: `admin/lib/auth/session.ts:25-48`
- **Description**: The session cookie body is base64url-encoded JSON containing `accessToken`, `refreshToken`, roles, and permissions, with an HMAC suffix. The cookie is `httpOnly` + (in production) `secure`, so a properly-configured browser will not surface it to JS or insecure origins. But any non-browser exfiltration (XSS-via-tokenized-image-name pattern, a leaked log of `set-cookie` headers, a Next.js dev-tools snapshot, a debugging proxy) yields the access + refresh tokens in plaintext. Encrypting (AES-GCM with `ADMIN_SESSION_SECRET`) reduces the impact of incidental leaks.
- **Repro**: static analysis only — the cookie payload at `admin/lib/auth/session.ts:29-32` is `JSON.stringify` → base64url, no encryption.
- **Recommendation**: Wrap the payload in `aesGcmEncrypt(JSON.stringify(payload), ADMIN_SESSION_SECRET)` before signing, decrypt after MAC verify in `decode`. Drop `accessToken` from the cookie entirely if you can — the BFF can call `/admin/auth/refresh` with `refreshToken` on each request and avoid persisting the short-lived access token in cookie at all.

### [SEV-A16] CORS allow-list silently allows empty string when env vars are misconfigured
- **Severity**: low
- **Location**: `backend/src/server.ts:147-153`
- **Description**: The `origin` array is built as `[...CORS_ORIGIN.split(",").map(trim), ...ADMIN_CORS_ORIGIN.split(",").map(trim)].filter(Boolean)`. The `.filter(Boolean)` strips empties, but if `CORS_ORIGIN=""` is unset (defaults to `http://localhost:5173`) and `ADMIN_CORS_ORIGIN` is misconfigured to e.g. `"*,https://admin.openmatch.app"`, the `*` entry is accepted by `@fastify/cors` as an array element and effectively means "allow this exact string as Origin" — but combined with `credentials: true` and a wildcard in some browsers, behaviour gets surprising. The lack of validation around env-var contents makes a single typo a potential CSRF amplifier.
- **Repro**: static analysis only.
- **Recommendation**: Validate each origin entry against `^https?://[a-z0-9.\-]+(:\d+)?$` at boot. Refuse to start on `*` when `credentials: true`.

### [SEV-A17] Informational: `Set-Cookie` SameSite for admin session is `lax`, which is appropriate, but `/api/auth/logout` in admin is a top-level POST with no Origin / CSRF check
- **Severity**: informational
- **Location**: `admin/app/api/auth/logout/route.ts:5-15` and `admin/lib/auth/session.ts:52-56`
- **Description**: SameSite=`lax` blocks the cookie from being sent on cross-site `<form method=POST>` submissions, so a CSRF that submits to `/api/auth/logout` from `evil.com` cannot trigger the logout. The risk window is small (logout is annoying-but-harmless), but for completeness and to match what an enterprise SOC2 reviewer expects, the route should still reject when `Origin` ∉ `ADMIN_CORS_ORIGIN`. Also document the SameSite choice in `docs/admin/runbook.md` so it doesn't get downgraded to `none` for a future cross-origin feature without security review.
- **Repro**: N/A — informational.
- **Recommendation**: Add a simple `if (req.headers.get('origin') !== expectedOrigin) return 403` at the top of the route, and a brief "we depend on SameSite=lax for CSRF; do not weaken without compensating control" note in the runbook.
