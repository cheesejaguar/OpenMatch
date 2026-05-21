# Performance Audit — Backend + Database

> Read-only audit conducted 2026-05-21 against branch `audit/perf-backend-readonly`
> (worktree from `main`).
> Scope: hot-route latency, Prisma query patterns, database physical
> layer (indexes, PostGIS, JSONB, pooling), JSON serialization, caching
> opportunities, worker batching, logging overhead, dependency bloat.

## Summary

- **23 findings**: 3 large (>50% latency / payload reduction), 11 medium (10–50%), 8 small (<10%), 1 informational.
- **Top 3 wins**
  1. **`PERF-B1` — `GET /api/v1/discovery/deck` issues 7+ sequential round-trips and over-fetches profiles twice.** Easily the highest-leverage hot-path target — deck build for a viewer with 500 in-radius candidates currently runs viewer-lookup → raw-SQL viewer-loc → all-active-metros scan → 500-row raw candidate join → blocks (no index hit on OR/blocker) → all priorSwipes (unbounded) → standing likes → DOB join → then in the route a second `profile.findMany(include:photos)` + viewer-loc-again + candidate-loc-again. Collapsing to two queries (one materialised view / CTE for the candidate row including photos, one viewer fetch) plus a bounded prior-swipes window should cut latency materially.
  2. **`PERF-B2` — `priorSwipes` is fetched with no `WHERE createdAt > N days ago` and no `select`.** A power user with thousands of historical swipes pulls thousands of full SwipeAction rows on every `/deck` request just to populate a Set of (targetUserId) for deduplication. Add a `createdAt: { gt: now - 30d }` window and `select: { targetUserId: true, decision: true, createdAt: true, undoneAt: true }`. Likely 30–60% reduction in deck p95 once a user has any history.
  3. **`PERF-B3` — `GET /api/v1/conversations/:id/messages` returns the entire `Message` row history with no pagination + no `select`.** Chat is the chattiest read path (no pun) and currently re-sends all moderation columns, deletedAt, deliveredAt, readAt for every message ever sent in the conversation. Most clients only want the last ~50; the endpoint has no `take` / no cursor.

The Wave 1 + Wave 2 + FAANG hardening pass tightened response schemas on
auth/swipes/undo, added the explicit `MATCH_PEER_SELECT` /
`CONVERSATION_PEER_SELECT` allow-lists (which incidentally are also a
*performance* improvement — they removed many over-fetched columns).
That is not re-reported here; the findings below are the perf-only gaps
that survived.

## Findings

### [PERF-B1] `GET /api/v1/discovery/deck` does 7+ sequential round-trips
- **Severity / expected gain**: large (>50%)
- **Location**: `backend/src/services/discovery.service.ts:102-326`, `backend/src/routes/discovery.ts:25-101`
- **Description**: Per deck request the service issues, in order:
  1. `prisma.user.findUnique` with `include: { profile, preferences }`
  2. `$queryRawUnsafe` for viewer's lat/lng (Profile is already in step 1, but lat/lng is `Unsupported(geography)` so it's re-read)
  3. `prisma.metroBoundary.findMany({ where: { active: true } })` — *every active metro globally*, not just the viewer's country
  4. `$queryRawUnsafe` candidate join (500-row LIMIT) including PostGIS ST_DWithin + a correlated subquery `EXISTS(SELECT 1 FROM ProfilePhoto … GROUP BY profileId HAVING COUNT(*) >= 2)` per row
  5. `prisma.block.findMany` (OR'd both directions)
  6. `prisma.swipeAction.findMany` — *all* prior swipes (see PERF-B2)
  7. `prisma.like.findMany` for standing likes
  8. `prisma.user.findMany` to hydrate DOBs (because DOB isn't joined in step 4)
  
  Then the route handler at `routes/discovery.ts:36-51` issues three more queries:
  9. `prisma.profile.findMany({ where: { id: { in: deck.cards … } }, include: { photos } })` — re-fetches each profile by id even though step 4 already had displayName/bio/etc.
  10. `$queryRawUnsafe` for viewer lat/lng *again* (already pulled in step 2)
  11. `$queryRawUnsafe` for each card's lat/lng *again* (already in `RawProfileRow.lat/lng` from step 4)
  
  That is ~11 sequential Postgres round-trips on the most-trafficked read endpoint. The data for step 9 was already returned in step 4; the route only adds photo array hydration. Steps 10-11 are pure duplication of step 2 and step 4.
- **Measurement basis**: static reasoning from reading the source. A 50-100ms-per-RTT Neon WebSocket connection makes 11 RTTs the dominant cost when there are no application bottlenecks.
- **Recommendation**: (a) Project photo rows into step 4 as a `jsonb_agg(...)`, eliminating step 9. (b) Cache viewer lat/lng in the existing `viewerUser` result (Profile.location can be SELECT'd through a single raw query at the same time as profile/preferences). (c) Eliminate steps 10-11 — the lat/lng for every candidate is already in `RawProfileRow`. (d) Filter `metroBoundary.findMany` by the inferred country (the gate plugin already calls `inferCountry`). (e) Combine block + standing-like lookups into a CTE that materialises `excludedUserIds`.
- **Risk**: Restructuring requires re-deriving the candidate `RawProfileRow` to carry photos, but `jsonb_agg` over the existing `ProfilePhoto_profileId_sortOrder_idx` is well-trodden territory. The two-cards-only photo case has to be preserved.

### [PERF-B2] `priorSwipes` is fetched in full with no time window and no `select`
- **Severity / expected gain**: large (>50% for any user with swipe history)
- **Location**: `backend/src/services/discovery.service.ts:214-216`
- **Description**:
  ```ts
  const priorSwipes = await input.prisma.swipeAction.findMany({
    where: { viewerUserId: input.viewerUserId },
  });
  ```
  No `where: { createdAt: { gt: ... } }`, no `select`, no `take`. After a power user has been on the platform for 90 days the SwipeAction row count for that user can be in the tens of thousands; we're hydrating every column on every row (decision enum, algorithmVersion, rankingConfigVersion, deckSessionId, ...) just to feed the matching package's dedupe loop, which only needs `(targetUserId, decision, createdAt, undoneAt)`. The matching package's purpose for these rows is to short-circuit re-showing recently-swiped candidates; nothing past the dedupe window (typically 30 days) materially affects the deck.
- **Measurement basis**: static reasoning. Row size at the wire is ~150 bytes × N rows; for N=10k that's 1.5 MB of data over the Neon WebSocket for one deck request.
- **Recommendation**:
  ```ts
  const dedupeWindow = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const priorSwipes = await input.prisma.swipeAction.findMany({
    where: { viewerUserId, createdAt: { gt: dedupeWindow } },
    select: { targetUserId: true, decision: true, createdAt: true, undoneAt: true },
  });
  ```
  Verify with the matching package owner that the 30d window matches the deduplication rules in `@openmatch/matching`.
- **Risk**: If matching uses any data older than the window, candidates may re-surface earlier than intended. Low — the prior implementation never deduped past 90d anyway.

### [PERF-B3] `GET /api/v1/conversations/:id/messages` returns every message in full
- **Severity / expected gain**: large (>50% on active conversations)
- **Location**: `backend/src/services/chat.service.ts:37-45`
- **Description**:
  ```ts
  return prisma.message.findMany({
    where: { conversationId, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  ```
  No `take`, no cursor, no `select`. Returns full Message rows (including `moderationStatus`, `deliveredAt`, `readAt`, `deletedAt`) for every non-deleted message in the conversation, oldest-first. A long-running match with 1000 messages × ~300 bytes/row = 300KB+ JSON on each open. The route is hit on every conversation open.
- **Measurement basis**: static reasoning. The `Message.conversationId_createdAt_idx` exists, so pagination is index-supported but unused.
- **Recommendation**: Default `take: 50`, `orderBy: { createdAt: "desc" }`, accept a `cursor` query param for older history. Add an explicit `select` of just the fields iOS renders (`id, body, senderUserId, createdAt, readAt`). Also add `Cache-Control: private, no-cache` so intermediaries (Vercel edge cache) don't accidentally serve stale conversations.
- **Risk**: iOS clients will need to handle pagination; today they appear to assume a full snapshot. Coordinate with mobile.

### [PERF-B4] Discovery hydrates DOBs in a second `findMany` instead of joining
- **Severity / expected gain**: medium (10-50% on deck builds)
- **Location**: `backend/src/services/discovery.service.ts:297-306`
- **Description**: After building 500 candidates the service runs `prisma.user.findMany({ where: { id: { in: [...] } }, select: { id: true, dateOfBirth: true } })` then patches `c.profile.age` in a loop. The DOB is already on `User` and the candidate raw SQL in step 4 already joins `User u ON u.id = p.userId`. Pull `u."dateOfBirth"` in the same query.
- **Measurement basis**: static reasoning.
- **Recommendation**: Add `u."dateOfBirth"` to the `RawProfileRow` select and remove the follow-up `user.findMany`.
- **Risk**: None significant.

### [PERF-B5] Auth-refresh hot path makes a follow-up `user.findUnique` for status
- **Severity / expected gain**: medium (10-30%)
- **Location**: `backend/src/services/auth.service.ts:391-420`
- **Description**: `rotateRefreshTokenInner` first does `session = prisma.session.findUnique({ where: { refreshToken } })` then `prisma.user.findUnique({ where: { id: session.userId }, select: { status: true } })`. Two sequential RTTs for the single hottest endpoint after `/deck`. The Session→User relation could feed both lookups in one query:
  ```ts
  const session = await prisma.session.findUnique({
    where: { refreshToken: tokenHash },
    select: { id: true, userId: true, revokedAt: true, expiresAt: true,
              user: { select: { status: true } } },
  });
  ```
  Same data, one round-trip.
- **Measurement basis**: static reasoning.
- **Recommendation**: Use the include/select on the original `findUnique`. Also drop the post-rotation `session.deleteMany` (7-day cleanup) from the request critical path — move to a worker (`workers/session-cleanup.ts`) or a Postgres `pg_cron`. Each refresh currently pays for one bonus delete query that has nothing to do with serving the refresh.
- **Risk**: None. The cleanup is opportunistic.

### [PERF-B6] `listMatches` over-fetches: every match returns *both* user-A and user-B profile + photos
- **Severity / expected gain**: medium (10-30% payload)
- **Location**: `backend/src/services/match.service.ts:10-19`, `backend/src/lib/dto/peer-user.ts:74-127`
- **Description**: `MATCH_PEER_SELECT` returns both `userA` and `userB` with their full Profile + photos array. The caller only ever cares about the *peer* (whichever side isn't `req.userId`). Returning both sides doubles the JSON payload per match. For a user with 100 matches the wire is ~2× larger than necessary.
- **Measurement basis**: static reasoning.
- **Recommendation**: Either (a) pass `viewerUserId` into a service helper that picks the peer in JS and returns only one side, or (b) introduce a `MATCH_PEER_ONE_SIDE_SELECT` and split the route into two queries (one filtered to `userAId = viewerUserId` returning userB; one filtered to `userBId = viewerUserId` returning userA) and concat. Option (a) is simpler but leaves Prisma's typed select less tight; option (b) is faster on the wire.
- **Risk**: Mobile expects a stable shape — refactor needs an API version bump or a backward-compatible aliased field.

### [PERF-B7] `safety.service.blockUser` does `match.findMany` followed by `match.updateMany` over the same predicate
- **Severity / expected gain**: medium (10-30% on the block path)
- **Location**: `backend/src/services/safety.service.ts:80-94`
- **Description**: Inside the transaction the service queries `match.findMany({ where: { userAId, userBId, status: "active" }, select: { id, conversation: { id } } })` then `match.updateMany({ where: { userAId, userBId, status: "active" }, data: { ... } })`. Same predicate twice → two index scans where one `update returning` would do.
- **Measurement basis**: static reasoning.
- **Recommendation**: Use raw SQL `UPDATE "Match" SET ... WHERE ... RETURNING id` (Prisma's `updateManyAndReturn` from v5+, or a raw query). The conversation id is needed for Ably teardown; a single `RETURNING m.id, c.id FROM "Match" m LEFT JOIN "Conversation" c ON c."matchId" = m."id"` would do it in one round-trip.
- **Risk**: Need to keep within the existing transaction semantics.

### [PERF-B8] `safety.service.reportUser` does no preflight check at all, but routes ahead of it do
- **Severity / expected gain**: small
- **Location**: `backend/src/services/safety.service.ts:29-51`
- **Description**: `reportUser` does only the `if (reporter === reported)` guard before a single `report.create`. This is actually GOOD perf-wise. Noting it here to flag that `Report.status_createdAt_idx` is the index serving the admin queue queries, but `Report` is missing an index on `(reporterUserId)` which the user-side "my recent reports" lookup at `routes/privacy.ts:227` would benefit from if that query is added.
- **Measurement basis**: static reasoning / index inspection.
- **Recommendation**: Informational. Add `@@index([reporterUserId, createdAt])` to `Report` if/when a "my reports" surface ships.
- **Risk**: None.

### [PERF-B9] Block existence check uses `findFirst` with `OR` — index unused on the reverse direction
- **Severity / expected gain**: medium (10-30% on swipe path)
- **Location**: `backend/src/services/swipe.service.ts:47-54`
- **Description**:
  ```ts
  const isBlocked = await prisma.block.findFirst({
    where: { OR: [
      { blockerUserId: viewer, blockedUserId: target },
      { blockerUserId: target, blockedUserId: viewer },
    ]},
  });
  ```
  `Block` has `@@unique([blockerUserId, blockedUserId])` (forward direction) and `@@index([blockedUserId])` (so reverse can use the index on `blockedUserId` only). Postgres planner *should* turn this OR into two index lookups + union, but `findFirst` with an OR is notoriously inconsistent in Prisma's generated SQL — sometimes produces a `WHERE (a=$1 AND b=$2) OR (a=$3 AND b=$4)` that the planner can't decompose cleanly.
- **Measurement basis**: static reasoning. Would benefit from an `EXPLAIN ANALYZE` to confirm planner behaviour; not run as part of read-only audit.
- **Recommendation**: Issue the two `findUnique` calls in parallel via `Promise.all` so each one uses the composite unique index directly:
  ```ts
  const [a, b] = await Promise.all([
    prisma.block.findUnique({ where: { blockerUserId_blockedUserId: { blockerUserId: viewer, blockedUserId: target } } }),
    prisma.block.findUnique({ where: { blockerUserId_blockedUserId: { blockerUserId: target, blockedUserId: viewer } } }),
  ]);
  if (a || b) return { swipeId: null, matched: false };
  ```
  Single RTT (parallel), two index-only lookups.
- **Risk**: None significant.

### [PERF-B10] No `@fastify/compress`
- **Severity / expected gain**: large for payload size, medium for backend CPU
- **Location**: `backend/src/server.ts:144-260` (no `compress` registered); `backend/package.json` (no `@fastify/compress` dep)
- **Description**: There is no response compression registered. Large JSON payloads (`/matches`, `/conversations/:id/messages`, `/discovery/deck` after PERF-B1 is fixed) go uncompressed over the wire. Brotli/gzip routinely shrinks JSON 70-80%. iOS data plans pay for this.
- **Measurement basis**: package.json and server.ts grep — no compress dep, no plugin registered.
- **Recommendation**: Register `@fastify/compress` with `threshold: 1024` (don't bother for small bodies) and `encodings: ["br", "gzip"]`. Vercel's edge already adds gzip in some configs but only on certain routes — better to have it in Fastify so behaviour is platform-independent.
- **Risk**: Tiny CPU cost on responses < threshold is skipped. Brotli compress is single-threaded — heavy bursts could increase tail latency, but Fluid Compute's instance reuse should handle it.

### [PERF-B11] No `Cache-Control` / `ETag` on stable read endpoints
- **Severity / expected gain**: medium (eliminates round-trips on iOS prefetch/refresh)
- **Location**: across read routes — `routes/profile.ts:71-117` (`/me`), `routes/transparency.ts` (transparency records), `routes/matches.ts` (list), `routes/discovery.ts:104-238` (explanation)
- **Description**: No route sets `Cache-Control` or `ETag`. iOS refresh patterns (pull-to-refresh, foreground entry) re-fetch unconditionally. For `GET /matches` and `GET /me/profile` an ETag against `(userId, max(updatedAt))` would let the client send `If-None-Match` and skip the body when nothing changed.
- **Measurement basis**: static reasoning / grep.
- **Recommendation**: For `/me/profile`, `/matches`, `/transparency` add an `ETag` derived from `max(updatedAt)` for the relevant rows; honour `If-None-Match` and return 304. Set `Cache-Control: private, max-age=0, must-revalidate` so the cache is per-user but always validated.
- **Risk**: ETag derivation needs to be a one-shot `MAX(updatedAt)` query — careful to keep that single round-trip cheaper than the full fetch it replaces.

### [PERF-B12] No in-process LRU for static reference data (metros, flags partially cached)
- **Severity / expected gain**: medium (10-20% on routes that hit the cache miss path)
- **Location**: `backend/src/plugins/metro-gate.ts:60-67`, `backend/src/lib/flags.ts:36-49`
- **Description**: `MetroBoundary` is fetched on every `checkMetro` call (signup, profile edit) — and *also* on every `discovery/deck` request inside the service (`activeMetros = prisma.metroBoundary.findMany(...)`). Metro rows change once per quarter at most. Feature flags already use an in-process cache (good); metros do not.
- **Measurement basis**: static reasoning. Multiple hot paths touch this table.
- **Recommendation**: Add the same TTL pattern from `lib/flags.ts` (`__setFlagsCacheTtlMs(60_000)`) for metros. Even a 30-second cache eliminates the query for >95% of requests during steady state. Invalidate on admin metro-edit (already a low-frequency path).
- **Risk**: New metro takes up to TTL to propagate. Acceptable for a quarterly-edited resource.

### [PERF-B13] `runDsaSlaCheckOnce` updates rows one-by-one in a loop instead of `updateMany`
- **Severity / expected gain**: medium for worker throughput, no user-facing latency
- **Location**: `backend/src/workers/dsa-sla.ts:32-61`
- **Description**: After fetching `ackCandidates` and `decisionCandidates` the worker loops and runs `prisma.noticeAndActionReport.update({ where: { id: row.id }, ... })` per row. For a backlog of 100 breaches that's 100 sequential UPDATE round-trips. The same data could be a single `updateMany({ where: { id: { in: ids } }, data: { slaAckBreachedAt: scannedAt } })`.
- **Measurement basis**: static reasoning.
- **Recommendation**: Replace the loop with two `updateMany` calls (one per breach kind). Same semantics, one round-trip each.
- **Risk**: None; `slaAckBreachedAt` is set to the same `scannedAt` for every row in the batch.

### [PERF-B14] `runDailyDigest` runs 11 sequential-ish COUNT queries (only 10 in `Promise.all`)
- **Severity / expected gain**: small
- **Location**: `backend/src/workers/daily-digest.ts:48-85`
- **Description**: The digest builds 10 counts + 2 findFirst calls in a `Promise.all` — good. But the work is dominated by repeated full-table-or-partial-index scans on `User`, `Match`, `Message`, `Report`, `AccountDeletionRequest`, `AnalyticsEvent`, `ProfilePhoto`. Each `count({ where: { createdAt: { gte, lt } } })` requires a btree-only scan on `(createdAt)` — but several of those tables have no `createdAt` index (e.g. `Match.createdAt` is not indexed, only `userAId_status` is). The planner falls back to a sequential scan as the table grows.
- **Measurement basis**: schema inspection — only `Message.conversationId_createdAt` and a handful of others are time-indexed; `Match`, `User`, `Report`, `ProfilePhoto` have no `createdAt` index.
- **Recommendation**: Either add `@@index([createdAt])` to `Match`, `User`, `Report`, `AccountDeletionRequest` (cheap, well-known pattern), or aggregate the digest from a materialised view refreshed hourly. The former is the simpler fix.
- **Risk**: One additional btree per table; minor write amplification.

### [PERF-B15] `alerter.detectAlerts` does same-pattern unindexed COUNTs as the digest
- **Severity / expected gain**: small (runs every cron tick — frequency matters)
- **Location**: `backend/src/workers/alerter.ts:42-65`
- **Description**: Same indexing gap as PERF-B14. `analyticsEvent.count({ where: { serverTs: { gte: fiveMinAgo }, eventName: { startsWith: "error." } } })` benefits from the existing `AnalyticsEvent_eventName_serverTs_idx`, but the *total* count for that window (`count({ where: { serverTs: { gte: fiveMinAgo } } })` line 49) doesn't hit the `(eventName, serverTs)` btree because it lacks the eventName prefix.
- **Measurement basis**: schema inspection.
- **Recommendation**: Add `@@index([serverTs])` to `AnalyticsEvent` (yes, it adds redundancy with `(eventName, serverTs)` and `(userId, serverTs)`, but the leading-column constraint means neither composite serves a serverTs-only filter).
- **Risk**: One more index on a high-write table. Use `CREATE INDEX CONCURRENTLY` during deploy.

### [PERF-B16] No response-schema (fast JSON) on the highest-traffic routes
- **Severity / expected gain**: medium (Fastify's fast-json-stringify is 2-3× the native `JSON.stringify`)
- **Location**: `backend/src/routes/discovery.ts:21-101` (no schema), `backend/src/routes/matches.ts:10` (no schema on `/`), `backend/src/routes/chat.ts:17, 19-26` (no schema on `/messages`), `backend/src/routes/profile.ts:71-100` (no schema on `/me`)
- **Description**: The FAANG hardening pass added Zod response schemas on `/auth/refresh`, `/swipes`, and `/swipes/:id/undo`. The remaining high-traffic GET endpoints still rely on Fastify's slow-path `JSON.stringify`. With Zod / fast-json-stringify enabled per route, serialisation is faster *and* schema-validated.
- **Measurement basis**: file inspection — `withTypeProvider<ZodTypeProvider>()` and `schema: { response: ... }` only appear in `auth.ts:314-344`, `swipes.ts:41-101`.
- **Recommendation**: Roll out the same pattern to `/discovery/deck`, `/matches`, `/conversations/:id/messages`, `/profile/me`. The schemas are already partially derived (peer DTOs exist) — the work is largely mechanical.
- **Risk**: Any drift between Zod schema and actual returned object becomes a 500 at runtime. The schema needs to be tested against fixtures.

### [PERF-B17] Photo reordering uses a serial-update transaction array instead of a single SQL `UPDATE FROM`
- **Severity / expected gain**: small (route is low-traffic)
- **Location**: `backend/src/routes/profile.ts:398-407`
- **Description**:
  ```ts
  await app.prisma.$transaction(
    body.photoIds.map((id, idx) =>
      app.prisma.profilePhoto.update({ where: { id }, data: { sortOrder: idx } }),
    ),
  );
  ```
  For 9 photos this is 9 UPDATEs in a $transaction array. The single-statement equivalent is `UPDATE "ProfilePhoto" SET "sortOrder" = v.idx FROM (VALUES ...) AS v(id, idx) WHERE "ProfilePhoto"."id" = v.id`. One RTT, single index-driven UPDATE.
- **Measurement basis**: static reasoning. Low traffic so impact is small.
- **Recommendation**: Replace with `$executeRawUnsafe` (or `$queryRaw` with tagged template) building the VALUES list. Same transaction guarantee, one round-trip.
- **Risk**: SQL needs `${Prisma.join(...)}` to be safe. Test for ownership before crafting (already done at line 391).

### [PERF-B18] Same applies to `routes/profile.ts:366-376` — sortOrder compaction loop
- **Severity / expected gain**: small
- **Location**: `backend/src/routes/profile.ts:366-376`
- **Description**: After a photo delete, the route re-fetches remaining photos and then does `Promise.all(remaining.map(...))` of N individual `update` calls. Same fix as PERF-B17.
- **Measurement basis**: static reasoning.
- **Recommendation**: Single `UPDATE ... FROM (VALUES ...)`.
- **Risk**: None.

### [PERF-B19] APN provider load is already lazy — but `@parse/node-apn` is in `dependencies`
- **Severity / expected gain**: small (cold start)
- **Location**: `backend/package.json:34`, `backend/src/services/push.service.ts:91-101`
- **Description**: Good news: `await import("@parse/node-apn")` is dynamic so the dep isn't loaded until first push. Bad news: it's still in the production bundle (Vercel Fluid Compute), so the module tree is downloaded / decompressed on cold start regardless. If APNs is dev-disabled (no `APNS_TEAM_ID`) the dep is pure dead weight.
- **Measurement basis**: package inspection.
- **Recommendation**: Move `@parse/node-apn` to `optionalDependencies` or a peer/extras pattern so the dep can be omitted on environments where push is off. Marginal — only affects cold-start size.
- **Risk**: Tests that rely on the module to be present must still resolve it.

### [PERF-B20] `nodemailer` is loaded at module top in `auth.service.ts` and `daily-digest.ts`
- **Severity / expected gain**: small (cold start)
- **Location**: `backend/src/services/auth.service.ts:3`, `backend/src/workers/daily-digest.ts:2`
- **Description**: `import nodemailer from "nodemailer"` is a static import at the top of `auth.service.ts`. The auth service is imported by `routes/auth.ts` which is registered at server boot — so nodemailer (with its 30+ transitive deps including iconv-lite) is loaded for every request even though it's only used inside `getMailer()` (which is itself only invoked on `/auth/start`).
- **Measurement basis**: import-chain inspection.
- **Recommendation**: Dynamic import inside `getMailer()`. Same pattern as push.service's APN lazy load. Cuts ~50-100ms off cold start.
- **Risk**: First magic-link send is ~50ms slower (the dynamic import cost). Negligible vs the SMTP round-trip itself.

### [PERF-B21] Pino mixin runs `AsyncLocalStorage.getStore()` per log line — fine, but redaction list has wildcards
- **Severity / expected gain**: small (only at high log volume)
- **Location**: `backend/src/server.ts:94-119, 128-136`
- **Description**: The mixin is minimal (a single AsyncLocalStorage read + a couple of spread copies) — that's fine. However, the redact path list includes wildcard entries like `*.email`, `*.emailHash`, `*.refreshToken`, `*.accessToken`, `*.bio`, `*.displayName`. Pino's fast-redact compiles these once but each emitted log line walks the object tree to apply them. With info-level logs disabled in production this is unmeasured but adds up under load.
- **Measurement basis**: static reasoning; pino's docs note wildcard redactions are 5-10× slower than fixed paths.
- **Recommendation**: Audit whether `*.bio` / `*.displayName` are actually log surfaces today. If they only appeared in a since-removed handler, drop them. Wildcard paths come at a cost; only keep the ones whose surface is unbounded.
- **Risk**: Removing a wildcard that still matched some object → PII leak. Audit carefully.

### [PERF-B22] `Profile.location` GiST index is present and correct — informational
- **Severity / expected gain**: informational
- **Location**: `backend/prisma/migrations/20260501000000_init/migration.sql:87`
- **Description**: Confirms the GiST index `Profile_location_idx` is created via raw SQL in the init migration (Prisma can't express GIST on Unsupported(geography) natively). `ST_DWithin` in `discovery.service.ts:182` will use it. No action required — included to record the audit checked.
- **Measurement basis**: migration inspection.
- **Recommendation**: None.
- **Risk**: None.

### [PERF-B23] Prisma `PrismaPg` vs `PrismaNeon` selection looks correct; connection_limit=20 default
- **Severity / expected gain**: informational
- **Location**: `backend/src/plugins/prisma.ts:25-42`, `backend/src/lib/db-url.ts`
- **Description**: The plugin selects `@prisma/adapter-neon` in production / when the URL is `*.neon.tech`, otherwise `@prisma/adapter-pg`. `ensureConnectionLimit` appends `connection_limit=20` if absent. Under Vercel Fluid Compute, the instance is reused across concurrent requests — a per-instance pool of 20 connections is sane: at ~50 concurrent warm instances that's 1000 connections, which exceeds Neon free tier's 100. Worth keeping an eye on production via the existing `/health/internal/pool` endpoint. Setting `connection_limit=10` would be safer at higher fan-out, with the trade-off of more request queueing inside Prisma when the instance is hot.
- **Measurement basis**: source inspection.
- **Recommendation**: Document the chosen value in the runbook; consider lowering to 10 if production pool-exhaustion alerts fire. Add a follow-up to confirm Neon's prepared-statement behaviour — `@prisma/adapter-neon` over WebSockets historically had issues with prepared statements that the new Prisma 7 adapter is supposed to have fixed, but worth verifying with `EXPLAIN (ANALYZE, VERBOSE)` against a typical hot query.
- **Risk**: None — informational.

## Notes on method

All findings derived from static reading of the source tree at branch
`audit/perf-backend-readonly`. No `EXPLAIN ANALYZE`, no profiling
session, no load test was run as part of this audit. Recommendations
preserve existing security gates (SEV-A3 peer-DTO allow-lists,
SEV-A6 status-gated refresh, SEV-A14 challenge attempt cap, etc.).

For each "medium" or "large" gain estimate, the actual measurement
would require a benchmark harness against a populated Neon database
with representative data shapes (10k swipes per user, 500 candidates
in radius, 50-message conversations). Building that harness is out of
scope for this read-only audit.
