# OpenMatch — Mobile / Photo / Privacy Security Audit

Branch: `audit/security-mobile-readonly`
Scope: iOS app (`ios/OpenMatch/**`), photo pipeline, server-side PII / privacy
surface (Fastify + Prisma). Read-only.
Excludes: items already addressed in PRs #48–#52 (Pino PII redaction, Sentry
`beforeSend` scrub).

Finding IDs are `SEV-M<n>` (mobile / privacy). Severity scale:
- **Critical** — exploitable today, leaks PII or breaks auth.
- **High** — privacy or security regression with a realistic path to harm.
- **Medium** — defence-in-depth gap; requires a second weakness to be harmful.
- **Low / Informational** — hardening / policy hygiene.

---

## SEV-M1 — iOS Keychain items use the default accessibility class (iCloud-syncable and backed-up); no `kSecAttrAccessible` set

**Severity:** High
**Location:** `ios/OpenMatch/Persistence/Keychain.swift` (entire file).

**Description.** Every `SecItemAdd` query is missing `kSecAttrAccessible`. The
Security framework default is `kSecAttrAccessibleWhenUnlocked`, which means:
1. The access token, refresh token, and user id are restored to a new device
   from iCloud Keychain / encrypted backup, defeating the "lost phone =
   session lost" invariant the rest of the auth design (refresh-token reuse
   detection in `backend/src/services/auth.service.ts:319-326`) is built on.
2. There is no `ThisDeviceOnly` constraint — items survive device transfers
   and unencrypted iTunes backups (legacy).
3. There is no "after first unlock" hardening for the refresh token, which
   would prevent extraction with the device locked.

Also missing:
- No `kSecAttrSynchronizable = false` to opt out of iCloud Keychain sync.
- No access control object (`SecAccessControlCreateWithFlags`) for biometric
  gating on the refresh token.

**Repro.** Sign in on device A, enable encrypted iTunes/Finder backup, restore
backup onto device B. The refresh token replays. The backend's reuse detector
only fires after the *original* device next refreshes — until then both
devices have a usable session.

**Recommendation.** Add `kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`
to both `write` and `read` queries, and `kSecAttrSynchronizable: false`. The
read query should also include the accessibility attr so an item written under
a different class isn't silently returned. Consider biometric-gated retrieval
for the refresh token via `kSecAttrAccessControl`.

---

## SEV-M2 — No certificate pinning for backend, Sentry, or Ably; relies entirely on system trust

**Severity:** Medium
**Location:** `ios/OpenMatch/Networking/APIClient.swift:340-360`; `ios/project.yml`
(no `NSAppTransportSecurity` overrides — good — but no pinning either).

**Description.** `URLSession(configuration: .default)` is used with no
`URLSessionDelegate.urlSession(_:didReceive:completionHandler:)` implementation
and no `NSPinnedDomains` ATS entry. The same is true for Ably (`ARTClientOptions`
defaults, `RealtimeService.swift:29-53`) and Sentry. A trusted-but-malicious
root CA, a mis-issued cert, or an MDM-installed profile would silently MITM
auth tokens, chat messages, and photos.

For a dating app the chat content + identity tokens are the highest-value
targets. The backend is also on a Vercel preview-style hostname
(`openmatch-backend-cheesejaguar-…vercel.app`, `Info.plist:32`) where the cert
authority chain is reissued frequently — making naive pinning brittle. Public-key
pinning of the leaf SPKI (with backup pins) is the pragmatic option.

**Repro.** Install a Charles/mitmproxy root on a test device, observe full
plaintext of `/auth/start`, `/auth/refresh`, `/conversations/:id/messages`,
and Ably token requests.

**Recommendation.** Implement SPKI pinning via `URLSessionDelegate` (or
`NSPinnedDomains` ATS dictionary). Pin the public key, not the cert, so
Vercel cert renewals don't brick the app. Ship at least two backup pins.
Ably exposes `httpClient` injection if you need to share the pinning logic.

---

## SEV-M3 — No privacy-veil overlay; chat content and profile photos are exposed in the iOS app switcher

**Severity:** High
**Location:** `ios/OpenMatch/OpenMatchApp.swift:19-30`; `ios/OpenMatch/State/AppLifecycle.swift`
(scenePhase handler does not blur, mask, or swap content for `.inactive` /
`.background`).

**Description.** When the user double-taps Home / swipes up to the app
switcher, iOS captures a screenshot of the current scene which is stored
unencrypted in `~/Library/Caches/Snapshots/<bundle-id>/`. OpenMatch's
`scenePhase` handler in `AppLifecycle.handleScenePhase` only closes the
Ably socket; it does not put a veil over the window. The result is that
the system snapshot file contains the user's last visible screen — likely a
`ConversationView` (chat content), `SwipeDeckView` (other users' photos +
distance + bio), or the `Likes` tab (who liked them, which is sensitive
under the project's "likes visibility" model).

For a dating app this is a real exposure surface: a shoulder-surfer (or a
forensic image of an unlocked device) sees identifying chat + match content
in the app switcher.

**Repro.** Open a conversation → switch to app switcher. The chat is visible.

**Recommendation.** In the `.inactive` branch (note: `.inactive` is invoked
*before* the OS snapshots, `.background` is too late), overlay a full-screen
opaque view (e.g. the launch screen mark on a `OMColor.paper` background).
Remove it on `.active`. Tracking issue should include the Likes, Chat list,
Conversation, Profile/EditProfile, and SwipeDeck surfaces.

---

## SEV-M4 — Debug "auto-login / force-match / suppress-push / initial-tab" hooks read `ProcessInfo.environment` and are `#if DEBUG`-gated correctly, but the gating is the *only* defence

**Severity:** Low (informational; current builds OK, but fragile)
**Location:**
- `ios/OpenMatch/State/AppState.swift:49-65` (`OPENMATCH_AUTO_LOGIN`)
- `ios/OpenMatch/State/MainTabView.swift:8-29` (`OPENMATCH_INITIAL_TAB`)
- `ios/OpenMatch/Networking/PushService.swift:20-27` (`OPENMATCH_SUPPRESS_PUSH_PROMPT`)
- `ios/OpenMatch/Features/Swipe/SwipeDeckViewModel.swift:37-45` (`OPENMATCH_FORCE_MATCH`)

**Description.** All four hooks are wrapped in `#if DEBUG` so they don't
compile into Release. Confirmed correct today. However:
- The Release configuration relies entirely on the Xcode build configuration
  not defining `DEBUG`. There's no second-line check (e.g. asserting
  `Bundle.main.appStoreReceiptURL?.lastPathComponent != "sandboxReceipt"` to
  also block TestFlight, or refusing to dev-login when `APIConfig.defaultBaseURL`
  is production).
- `OPENMATCH_AUTO_LOGIN` performs a *real* `devLogin` against the server —
  it doesn't fake a session. If `ALLOW_DEV_LOGIN` is ever enabled in
  production by mistake, *any* TestFlight build is a credential-less login
  oracle for any known user id.
- The dev-login UI in `WelcomeView.swift:98-110` is *not* `#if DEBUG`-gated.
  It calls `api.devLogin`, which the backend rejects when `ALLOW_DEV_LOGIN`
  is off. The UI is therefore harmless today but acts as an attractive
  nuisance — a misconfigured prod env exposes it.

**Repro.** Set `ALLOW_DEV_LOGIN=true` on prod → any user (TestFlight or App
Store) can sign in as `u001`, `u002`, … via the visible Developer login
disclosure.

**Recommendation.**
1. Wrap the `DisclosureGroup("Developer login…")` block in `WelcomeView.swift`
   with `#if DEBUG`.
2. Add a runtime assertion in `APIClient.devLogin` that refuses to call the
   endpoint when `APIConfig.defaultBaseURL` host matches the production
   pattern, even in DEBUG.
3. Add a build-phase check that `OPENMATCH_*` env reads are absent from the
   Release binary's strings (`strings $APP | grep OPENMATCH_AUTO_LOGIN`
   should be empty).

---

## SEV-M5 — Sign-in-with-Apple flow never sets a nonce; identity token replay is not bound to the device's request

**Severity:** High
**Location:**
- `ios/OpenMatch/Networking/AppleSignInCoordinator.swift:25-36` (no
  `request.nonce = sha256(rawNonce)`; raw nonce is not generated, not stored
  in Keychain, not forwarded to backend)
- `backend/src/services/apple-auth.service.ts:24-39` (`jwtVerify` does **not**
  pass a `nonce` option; `payload.nonce` is never compared to a server-side
  expected value)
- `backend/src/routes/auth.ts:174-209` (Apple verify path)

**Description.** Apple's SIWA recommends a per-request nonce: client
generates `rawNonce`, sets `request.nonce = sha256(rawNonce)`, posts both
the identity token *and* `rawNonce` to the backend, which verifies that
`hashedNonceInToken == sha256(rawNonce)`. This binds the token to the
specific authentication ceremony.

OpenMatch omits this entirely. Consequences:
1. An attacker who captures or harvests an Apple identity token (e.g. via
   logging, a leaked APM trace, an MITM if SEV-M2 is exploited, or a
   compromised on-device extension) can replay it to `/api/v1/auth/start`
   within Apple's token validity window (≤10 minutes per `iat`) and assume
   the victim's account.
2. The backend's `verifyAppleIdentityToken` validates issuer and audience
   but not nonce — Apple's signature check passes for any token issued for
   `APPLE_CLIENT_ID`.
3. The iOS coordinator also only requests `[.email]` — `requestedScopes`
   has no `.fullName`, which is fine privacy-wise but means there's no
   per-ceremony binding from name either.

**Repro.** Have user A sign in via Apple. Intercept the iOS → backend
POST body (e.g. via SEV-M2 or local proxy on a jailbroken simulator).
Replay the identical body from attacker's curl within 10 minutes. Backend
issues a session for user A.

**Recommendation.**
1. iOS: generate a cryptographically random `rawNonce`, set
   `request.nonce = sha256Hex(rawNonce)`, store `rawNonce` in Keychain
   under a one-shot key tied to the in-flight challenge, and POST it with
   the identity token.
2. Backend: extend `verifyAppleIdentityToken` to accept `expectedHashedNonce`
   and pass `nonce: expectedHashedNonce` to `jose`'s `jwtVerify` (which
   compares the `nonce` claim).
3. Also verify `iat` is within the last 10 minutes (`jose` doesn't enforce
   freshness by default; only `exp` is checked).
4. Bind the nonce to a `challengeId` so a single nonce can't be reused
   across two SIWA POSTs.

---

## SEV-M6 — Outbound chat queue persists message bodies in clear plaintext to `Application Support/`, with no `NSFileProtection`

**Severity:** Medium
**Location:** `ios/OpenMatch/Features/Chat/MessageQueue.swift:223-269`
(`FileMessageQueueStorage.save`); `defaultURL()` returns
`Application Support/OpenMatch/message-queue.json`.

**Description.** The queue writes `[PendingMessage]` as JSON with `Data.write(to:
options: .atomic)`. The `.atomic` option does not set a `NSFileProtection`
attribute. The file inherits the app container default (`NSFileProtectionComplete`
on iOS 7+ for most apps, but only when the app is signed with the right
entitlement and the device has a passcode set; on iOS 17 the default is
"CompleteUntilFirstUserAuthentication", not "Complete").

Consequences:
- Undelivered chat messages survive force-quit *unencrypted* if the device has
  no passcode (older devices, kiosk profiles).
- Backups that include `Application Support/` (the default — only `Caches/`
  and `tmp/` are excluded by `NSURLIsExcludedFromBackupKey`) carry the queue.
  Local `Finder` backups encrypted only with the user's backup password are
  weaker than iOS data-protection.
- There's no excluded-from-backup attribute set on the directory.

The matching `MessageQueue.shared` is initialised at process start (line 26),
so the file is read on every cold launch.

**Repro.** Type a message, kill the app before delivery, plist-extract the
container, inspect `OpenMatch/message-queue.json` — the body field is
plaintext.

**Recommendation.**
1. Use `Data.write(to:options: [.atomic, .completeFileProtection])`.
2. Set `URLResourceKey.isExcludedFromBackupKey = true` on the queue
   directory.
3. Consider Keychain-wrapping the bodies (e.g. AES-GCM keyed with a
   Keychain-stored symmetric key) so the at-rest blob is opaque even if
   the file-protection class regresses.

---

## SEV-M7 — Profile photos are stored as `access: "public"` Vercel Blobs with guessable-once-leaked URLs; no signed-URL scoping to the requester

**Severity:** High
**Location:** `backend/src/lib/media.ts:72-79`. Photo CDN URL is stored in
`ProfilePhoto.cdnUrl` and returned to *any* authorised viewer in
`backend/src/routes/profile.ts:272-282` (`GET /:profileId`) — gated only by
`visibilityStatus`, not by whether the requester has a match.

**Description.** Photos are uploaded with `access: "public"` to Vercel Blob.
The URL contains a random pathname (`profiles/<profileId>/<uuid>.jpg`) so it
is not enumerable, but:
1. **The URL is forever-valid.** Once leaked (via screenshot, share sheet,
   accidental log, server-side analytics integration that captures URLs,
   browser referer header, third-party CDN logs), there is no revocation
   path short of deleting the blob.
2. **Anyone with the URL can fetch the photo, including non-users and
   ex-matches whose account is blocked.** A user who blocks another after
   exchanging photo URLs (e.g. via screen recording) cannot revoke the
   blocked user's access to those URLs.
3. **Account deletion does not necessarily delete the blob.** In
   `services/privacy.service.ts:586-588` and `workers/deletion.ts:155-157`
   the DB row is deleted inside a transaction, but the blob `del()` happens
   "out of band" — the worker comment says "CDN cleanup is out-of-band
   (blob tokens aren't available inside a transaction)" but I see no
   follow-up code that actually invokes `del()` for deletion-worker
   purges. The `deleteProfilePhoto` helper that does call `del()` only
   runs from the per-photo `DELETE` route. Orphan blobs may persist
   indefinitely.
4. **Photos are scoped only by `visibilityStatus`, not by relationship.**
   `GET /profile/:profileId` returns photos to any authenticated user as
   long as the profile is not "hidden". A user can fetch any other user's
   photo URLs by guessing or learning `profileId`s (cuid, ~25 chars,
   non-enumerable but enumerated through the discovery deck and via likes).

**Repro.**
1. User A blocks user B. B has a previously-cached photo URL. B fetches it
   directly from the Vercel Blob CDN — succeeds. Blocks at the application
   layer do not propagate to the CDN.
2. After A deletes their account, the deletion worker (`workers/deletion.ts`)
   purges the DB row but the blob persists.

**Recommendation.**
1. Switch photos to `access: "private"` Blob (or store keys without CDN
   pass-through) and serve them via a signed-URL endpoint
   (`GET /api/v1/profile/photos/:id/url`) that re-evaluates blocks, mutual
   visibility, and TTL on each request.
2. Make the deletion worker enqueue a blob-cleanup job that runs outside
   the DB transaction; track it in a `PhotoCleanupJob` table so failures
   are observable.
3. Drop photos from the unauthenticated/profile-by-id response unless the
   requester has a match or active like edge with the profile owner. The
   current open read of `/profile/:profileId` is the most exposed surface.

---

## SEV-M8 — `GET /api/v1/profile/me` returns the full `User` row, including raw `emailHash`, `phoneHash`, `authSubject`, and `dateOfBirth`

**Severity:** Medium
**Location:** `backend/src/routes/profile.ts:60-69`.

**Description.** The handler `app.prisma.user.findUnique({ where: { id }, include:
{ profile: { include: { photos } } } })` returns the entire User Prisma
object. That exposes:
- `emailHash` — though hashed, presence of a hash + the user's email lets an
  attacker confirm what the backend stores about their identity (sub-issue:
  the hash function is `hashIdentity` in `lib/hash.ts`; reading whether it
  is keyed/peppered is outside this audit's scope, but an *unkeyed* SHA-256
  hash is reversible for the consumer email-address universe).
- `phoneHash` — same concern.
- `authSubject` — Apple `sub` (stable per-team) which, combined with team id,
  identifies the user across any other Apple-team property.
- `dateOfBirth` — the user's actual DOB (raw, not just `isAgeVerified`).

This is the user's own data — Art. 15 allows them to see it — but exposing
hashes and `authSubject` to the iOS client widens the attack surface for
any compromise of the device (and any third-party SDK the iOS team adds
later that scrapes URLSession bodies). The principle of least exposure says
project to only the fields the client needs.

**Recommendation.** Replace the unfiltered `include` with an explicit
`select` that omits `emailHash`, `phoneHash`, `authSubject`, and returns
only the year-of-birth (or just `isAgeVerified` + `age`) rather than raw
`dateOfBirth`.

---

## SEV-M9 — Privacy export bundle includes precise lists of every swipe ever made; `messagesReceived` includes other users' message bodies wholesale

**Severity:** Medium
**Location:** `backend/src/services/privacy.service.ts:247-445` (`buildExportBundle`).

**Description.** Two concerns:

1. **Other users' private message text is exported to the requester.** Lines
   378-392 select `body` for every message addressed to the user. The author
   never consented to having their messages re-distributed as a downloadable
   JSON bundle. While the requester can already see these messages in chat,
   *re-purposing* them into an Art. 20 portability bundle that the user can
   take elsewhere (or post publicly) materially changes the data subject's
   exposure. Several DPAs (e.g. ICO, CNIL) have interpreted Art. 15 and
   Art. 20 to require redaction or summarisation of other-party content
   in chat exports.

2. **Swipe history is exported as the raw `(targetUserId, decision)` pairs
   (lines 346-357).** This lets a user (or anyone they share their bundle
   with) reconstruct every other user they have ever rejected or liked.
   Combined with discovery deck stability, a malicious recipient could
   correlate this against another data-export bundle (e.g. shared on a
   "rate my matches" forum) to deduce who is/isn't on the platform.

3. **The 24-hour DSAR dedup window** (`DSAR_EXPORT_DEDUP_WINDOW_MS`,
   `routes/privacy.ts:23`) does *not* rate-limit; it only suppresses
   ticket creation. The bundle is rebuilt on every call (limited only by
   the 3/hour route limit). Each rebuild re-reads all of the data
   above — observability/log surfaces should not capture the body, which
   should be reviewed in light of the log redactor (out of scope per
   prompt).

**Recommendation.**
- Redact other users' messages to `{ id, conversationId, createdAt }` only,
  or include a per-message hash; suggest the user use in-app screenshots
  if they need the body of a counterpart's message.
- For swipes, export only counts + aggregate stats (likes given/received,
  swipe rate, deletion timestamps) unless the user explicitly opts in to
  the raw history at export time.
- Document this in `docs/legal/privacy-notice.md` and the data-portability
  copy in the iOS Settings screen.

---

## SEV-M10 — Account deletion does not invalidate APNs push tokens registered through `/notifications/device-token`; pushes can still fan-out to the orphan device

**Severity:** Medium
**Location:** `backend/src/workers/deletion.ts:164-165` deletes `DeviceToken`
and `NotificationDevice` rows, but the push pipeline (`push.service.ts`) and
the cron alerter may have already enqueued sends, and *Ably token requests*
made just before deletion remain valid until their TTL expires.

**Description.** When a user schedules deletion, `scheduleAccountDeletion`
sets `discoveryPaused: true` and `visibilityStatus: hidden` but does **not**:
1. Delete the device tokens during the grace window — only on purge
   (`workers/deletion.ts:164-165`). A push targeted before the grace window
   ended (e.g. a stale "you have unread likes" digest in
   `workers/daily-digest.ts`) can still be delivered after the user clicks
   "delete".
2. Revoke active Ably TokenRequests. Each token's TTL is server-set
   (`routes/realtime` per the iOS DTO at `APIModels.swift:230`); until
   expiry, the device can still subscribe.
3. Revoke active iOS sessions. `Session` rows are deleted in `purgeOne`
   (`workers/deletion.ts:162-164`) but only *after* the grace window — so
   an attacker with the user's iOS device during the 24-hour grace period
   has continued access (they can also `DELETE /privacy/account/deletion`
   to cancel).

**Recommendation.**
1. On `scheduleAccountDeletion`, immediately revoke all sessions, all
   device tokens, and all Ably tokens (track them in a table or set a
   `revokedAt` on the auth subject).
2. Require fresh re-auth to *cancel* deletion.
3. Cron-purge has the same gap if multiple workers race — the
   `take: 100` batch (`workers/deletion.ts:51`) plus the explicit
   `unique([userId, status])` constraint should be sufficient, but log
   loudly if `errors > 0` in the report.

---

## SEV-M11 — Block enforcement is application-layer only; cached messages, photos, and Ably channel attachments outlive the block

**Severity:** Medium
**Location:** `backend/src/services/safety.service.ts:27-57` (`blockUser`).

**Description.** `blockUser` upserts a `Block` row and closes the active
match. It does not:
1. **Detach the blocked user's Ably channel attachment.** Both parties
   subscribed to `conversation:<id>`. The match is marked `unmatched`,
   but the realtime channel ACL is regenerated only on next
   `realtimeToken()` call (iOS-driven, lazy). The blocked user may
   continue receiving live publishes — including any farewell messages
   the unmatcher sends — until their token expires or they reconnect.
2. **Invalidate historical message visibility.** `chat.service.ts:42-49`
   gates `listMessages` on `authorizedForConversation`, which returns
   false when the match is `unmatched`. Good — confirmed. But the iOS
   client likely retains the conversation's last fetched page in memory
   and can re-display it; nothing scrubs the device.
3. **Suppress prior pushes.** APNs alerts already queued via
   `setImmediate` in `chat.service.ts:89-107` are not cancelled.
4. **Audit who-blocked-whom.** There is no `AdminAuditLog` entry on
   block/unblock. For admin reviewers investigating a "they blocked me
   unfairly" appeal, there's no who/when trail beyond `Block.createdAt`.

The block model also stores the *plaintext* `blockerUserId` and
`blockedUserId` indefinitely — which is appropriate for safety, but the
delete-account flow only removes blocks where the user is the blocker
(`privacy.service.ts:600-604`, `workers/deletion.ts:172-178`). Blocks
*against* a deleted user persist — also appropriate — but the
`blockedUserId` then points at a tombstone whose displayName is
`"[deleted]"`, which is fine.

**Recommendation.**
1. On block, force-disconnect both parties from
   `conversation:<id>` via Ably's REST `/channels/{name}/messages` revoke
   API, or rotate the Ably key namespace per match.
2. Cancel any `setImmediate`-scheduled push for the closed match.
3. Add audit logging (or at minimum a service-level structured log line)
   for block/unblock.
4. Consider an iOS-side "wipe conversation cache" on receipt of a block
   event over Ably.

---

## SEV-M12 — Report metadata exposes both parties' full identity to any admin with `report.read`; no separation between reporter-identifying and reported-content fields

**Severity:** Medium
**Location:** `backend/src/services/admin/reports.service.ts:36-60` (`listReports`,
`getReportDetail`).

**Description.** `serializeUserSummary(r.reporter, perms)` and
`serializeUserSummary(r.reported, perms)` are both returned in the same
DTO. The serializer is gated by a `PermissionSet`, which is good — but the
permission check is on the *whole user summary*, not on the
**reporter-vs-reported** distinction. An admin with `report.read` sees:
- Reporter's profile, photos, prior reports
- Reported user's profile, photos, prior reports
- The reported message body PLUS ±20 messages of context
  (lines 105-120) — this is gated only "at the route layer
  (message.read.report_context)" (line 97 comment) — which I can't verify
  from the service file alone.

For dating-app moderation, the reporter's identity should be visible to a
narrower role (e.g. only "safety lead" or "trust escalation") than the
reported-user content (which all triagers need to see). Today, anyone who
can list reports sees who reported whom. That creates a retaliation /
inside-attack risk if a malicious admin shares the reporter's identity
with the reported user.

Also note: `metadata` in the audit log (`adminAuditLog.metadata`) is a
free-form Json — there's no enforcement that report reads create an
`AdminAuditLog` entry referencing the specific reportId. The
`AdminEventType.report_opened` enum exists, so the write happens
somewhere, but the service file here doesn't itself write the audit log
on read.

**Recommendation.**
1. Split `report.read` into `report.read.reported_content` (default for
   triagers) and `report.read.reporter_identity` (narrower role).
2. Default the reporter to a stable hash + cohort label in the triage
   queue; require an explicit "reveal reporter" action that writes a
   `SensitiveAccessGrant` row.
3. Verify (and add a test for) that every `getReportDetail` call writes
   an `AdminAuditLog` row with `eventType=report_opened` referencing the
   report id.

---

## SEV-M13 — Privacy manifest declares `NSPrivacyCollectedDataTypeSensitiveInfo` is linked to identity but not declared as tracking; no entry for "Audio Data" / "Other Diagnostic Data" yet matches transient telemetry

**Severity:** Low
**Location:** `ios/OpenMatch/Resources/PrivacyInfo.xcprivacy`

**Description.** Manifest is overall well-constructed and matches Apple's
current vocabulary. Two minor gaps:
1. `Sentry` is linked as a Swift Package (`ios/project.yml:24`). Apple's
   "Commonly Used Third-Party SDKs" privacy-manifest requirement (May 2024)
   means Sentry's own manifest is consumed transitively — verify the
   Sentry version (8.40.0+) bundles a `PrivacyInfo.xcprivacy` and that
   its declared collection categories are a superset of what OpenMatch
   claims. If Sentry collects anything OpenMatch doesn't declare, App
   Store review may flag it.
2. `NSPrivacyAccessedAPICategorySystemBootTime` is **not** declared, but
   `URLSession`'s built-in retry / `URLSessionConfiguration.waitsForConnectivity`
   may transitively call it. Low risk — only relevant if a future
   dependency starts using `mach_absolute_time` or similar.
3. The "performance/crash data" declaration says `Linked = false`, but
   `Crash.setUser(id: …)` in `AppState.swift:31` *does* attach the
   `userId` to Sentry events. That arguably makes the diagnostic data
   linked. Either drop the `setUser` call or change the declaration to
   `Linked = true`.

**Recommendation.** Reconcile `Crash.setUser` with the privacy manifest
declaration; audit transitive SDK manifests; consider running Apple's
PrivacyReport on a TestFlight build.

---

## SEV-M14 — Apple Sign-In requests `[.email]` only, but the backend still stores `emailHash` for Apple-relay users; `hide-my-email` relay address ends up hashed

**Severity:** Informational
**Location:** `ios/OpenMatch/Networking/AppleSignInCoordinator.swift:30`;
`backend/src/services/auth.service.ts:242` (`emailHash = hashIdentity(identity.email)`).

**Description.** When the user picks "Hide My Email" during SIWA, Apple
returns a relay address (`<random>@privaterelay.appleid.com`). OpenMatch
hashes it like any other email. That's fine for de-duplication, but:
1. The relay address can change if the user revokes/recreates the relay
   in their Apple ID settings. The next sign-in would generate a new
   `authSubject` match but a different `emailHash`, leaving the previous
   `emailHash` orphaned on the User row.
2. Marketing email opt-ins (`NotificationPreference.productNewsEmail`)
   become un-deliverable if the relay is later disabled, but the user
   never sees an explicit "your relay was revoked" status.
3. Privacy export and DSAR contact email (`DataSubjectRequest.contactEmail`)
   may end up storing the relay address in plaintext (it's a `String?`
   field, not a hash).

**Recommendation.** Detect `@privaterelay.appleid.com` and treat it as
non-stable; prefer `authSubject` for identity lookup (already done), and
warn the user in `NotificationPreference` UI that email delivery depends
on Apple's relay being active.

---

## SEV-M15 — Welcome screen sends dev token back to the client in non-production and stores it in `@State var token` (the placeholder TextField), making it shoulder-surfable on the simulator and on any non-prod build

**Severity:** Low
**Location:** `ios/OpenMatch/Features/Onboarding/WelcomeView.swift:198-199`;
`backend/src/services/auth.service.ts:88-94`.

**Description.** When `NODE_ENV !== "production"`, the backend returns
`devToken` in the `/auth/start` response. iOS auto-fills the verification
TextField (`token = dev`). The TextField is a plain `TextField`, not a
`SecureField`, so the token is fully visible. In any non-prod TestFlight
build (e.g. a staging environment) this is observable to anyone watching
the screen. Lock this behind a stricter check (e.g. `NODE_ENV === "test"`)
or render through `SecureField`.

---

# Cross-cutting recommendations

- **Add an iOS UI test for the app-switcher snapshot** (SEV-M3) so the
  privacy veil cannot regress silently.
- **Add an integration test for the photo-deletion-cascades-to-blob path**
  (SEV-M7, SEV-M10) — currently a comment promises "out-of-band cleanup"
  but the code does not implement it for the deletion worker.
- **Pen-test the SIWA replay window** (SEV-M5) with a real Apple identity
  token in a staging environment.
- **Threat-model the block flow end-to-end** (SEV-M11) including Ably,
  push, and on-device caches.

# Out of scope (already addressed or covered elsewhere)

- Pino PII redaction (`*.email`, `*.bio`, `*.token`) — done in #48–#52.
- Sentry `beforeSend` PII scrub — done in #48–#52.
- Admin RBAC primitives (`PermissionSet`, `requireAdminTwoFactor`) — used
  but their own audit is a separate workstream.
- Backend rate-limiting policy — present and reasonable, not re-audited here.
- ATS configuration — confirmed default (no `NSAppTransportSecurity`
  overrides, no arbitrary-loads); see SEV-M2 for pinning gap.
