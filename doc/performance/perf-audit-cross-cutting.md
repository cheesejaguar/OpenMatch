# OpenMatch — Cross-Cutting Performance Audit

**Scope:** HTTP transport, caching, realtime (Ably), observability overhead, CI/build performance, workers/cron, JSON serialization, photo proxy. Read-only.

**Method:** Static review of `backend/`, `api/`, `ios/OpenMatch/Networking/`, `.github/workflows/`, `vercel.json`, `backend/vitest.config.ts`.

**Date:** 2026-05-21

---

## Summary

OpenMatch's cross-cutting surface is healthy in several places — the Pino mixin is O(1), Sentry filters expected 4xx noise, the integration suite is correctly serial, and the iOS APIClient reuses a single `URLSession` with `waitsForConnectivity` (good for connection reuse). The largest gains available without architectural change are:

1. **No HTTP response compression** anywhere — every JSON response (deck, matches, profile, photos serve) ships uncompressed (~3-10x larger than necessary on the wire). One plugin registration captures most of the win.
2. **Photo proxy buffers the whole blob in memory** before sending, lacks `ETag`/conditional GET, and has no `Range` request support — high cost on the hottest read path (6-9 photo loads per deck refresh × many users).
3. **Fastify response schemas are used on only ~2 routes** (`auth.ts`, `swipes.ts`). Every other JSON response goes through `JSON.stringify`. The fast-json-stringify path is 5–10× faster on stable shapes and the schemas already exist as Zod types.
4. **`SyntheticCheckRun` rows accrue unbounded** at 12 rows/hour (288/day, ~105k/year) with no retention prune.
5. **No HTTP cache headers on read endpoints** that are easily cacheable (`/transparency/algorithm/current`, `/admin/metros`, `/preferences/me`, `/profile/:id` for matched peers). ETag/304 would save a measurable share of traffic from the iOS client poll cadence.
6. **CI runs `npm ci` 5 times per push across jobs** without `actions/setup-node` cache key (no `cache: 'npm'` input set). On a typical PR this is ~5× ~45 s redundant install time.
7. **Single Vercel region `iad1`** — confirm Neon Postgres lives in the same region (likely AWS us-east-1) so first-byte stays sub-10 ms intra-region.

Findings are numbered `PERF-X1`…`PERF-X18` so they can be referenced individually in follow-up PRs.

---

## Findings

### PERF-X1 — No HTTP response compression
- **Severity / expected gain:** High. 2–5× wire-size reduction on every JSON response and the photo proxy (when content is already JPEG, brotli is a no-op, but JSON payloads dominate request count).
- **Location:** `backend/src/server.ts` register block (lines 178–248). No `@fastify/compress` import; `package.json` does not list it as a dependency.
- **Description:** Every route returns JSON via `reply.send(...)` with no `content-encoding`. The `discovery/deck` response carries ~10 hydrated profile cards including photos arrays, interests arrays, and prompts — easily 8–30 KB uncompressed. Vercel does not auto-compress responses from Functions; the function's own headers pass through verbatim.
- **Measurement basis:** Direct read of `server.ts` — no register call for compress. `grep` across `backend/` confirms no compress references.
- **Recommendation:** `await app.register(compress, { global: true, threshold: 1024, encodings: ['br','gzip'] });` Register **after** helmet but **before** routes. Skip `/serve` (binary, already compressed JPEG) by setting `config.compress = false` per-route or letting the threshold + content-type detection handle it (br/gzip on image/jpeg yields ~0 % and costs CPU; `@fastify/compress` skips already-compressed content-types by default).
- **Risk:** Low. Common Fastify plugin, well-tested. Slight CPU cost on Active CPU pricing — outweighed by smaller payloads and lower egress.

### PERF-X2 — Photo proxy buffers entire blob in memory before `reply.send()`
- **Severity / expected gain:** High. Removes a per-request memcpy of up to 4 MB and reduces tail latency for slow blob fetches.
- **Location:** `backend/src/lib/media.ts:222–250` (`fetchPhotoBytes`) and `backend/src/routes/photos.ts:116–143`.
- **Description:** `fetchPhotoBytes` calls `await res.arrayBuffer()` and returns a `Buffer`, which the route then passes to `reply.send(buf)`. For a 4 MB photo, this allocates the full payload in the function's heap before the first byte leaves. Comment at line 215 of `media.ts` justifies this as "streams deliberately bypassed" — the comment cites a runtime-config concern that no longer applies on Vercel Fluid Compute (Node.js streams work fine on Functions; the previous Edge constraint is gone).
- **Measurement basis:** `media.ts` line 231: `const buf = Buffer.from(await res.arrayBuffer());`. Route passes `bytes.bytes` (a `Buffer`) to `reply.send(...)`.
- **Recommendation:** Pipe `res.body` (a `ReadableStream`) directly to the Fastify reply: `reply.type(contentType).send(Readable.fromWeb(res.body))`. This drops a full-payload Buffer allocation and lets the first byte ship as soon as the upstream Blob CDN starts streaming.
- **Risk:** Low–Medium. Needs verification that `@fastify/compress` is configured to skip image/* (it is by default). One-time test pass to confirm the auth/EXIF re-read isn't broken.

### PERF-X3 — `/photos/:id/serve` has no ETag / conditional GET / Range support
- **Severity / expected gain:** Medium. Saves repeated full transfers when the iOS image cache holds a stale entry past `max-age=300` but the bytes haven't changed (photos are immutable after upload). Range support enables resumability on flaky connections.
- **Location:** `backend/src/routes/photos.ts:116–143`.
- **Description:** Only `cache-control: private, max-age=300` and `content-type` are set. No `ETag`, no `Last-Modified`, no `Accept-Ranges`. Because photos are content-addressed (their `cdnUrl` is a UUID path), an `ETag` derived from `storageKey` (or its first 16 bytes) would be stable forever and produce a cheap 304 path that doesn't re-fetch from Blob.
- **Measurement basis:** Direct read of route file lines 122–143. No `ETag`/`Last-Modified`/`Range` handling.
- **Recommendation:** Set `ETag: "${storageKey-hash}"` and `Last-Modified` from the photo row's `createdAt`. Honour `If-None-Match` to emit 304. For Range support, prefer the streaming approach in PERF-X2 + forward `Range` to the upstream Blob `fetch` and proxy `206 Partial Content` back.
- **Risk:** Low. Standard HTTP semantics; iOS `URLSession` will pick them up automatically. ETag must be private/non-guessable-correlation since URLs are scoped to a requester — using `hash(storageKey + audienceUserId)` keeps the ETag scoped.

### PERF-X4 — Fastify response schemas missing from ~95 % of routes
- **Severity / expected gain:** Medium–High. fast-json-stringify is 5–10× faster than `JSON.stringify` and trims unknown keys (defense in depth against accidental field leaks).
- **Location:** All files in `backend/src/routes/` except `auth.ts` (1 `response:`) and `swipes.ts` (2 `response:`). The Zod type provider is wired globally in `server.ts:175-176` and ready to use.
- **Description:** Only `swipes.ts` opts into `.withTypeProvider<ZodTypeProvider>()` with a `response:` schema for the swipe result and undo. `discovery.ts`, `matches.ts`, `chat.ts`, `likes.ts`, `profile.ts`, `notifications.ts`, `preferences.ts`, etc. all return raw Prisma rows. Serialization of a 10-card deck through `JSON.stringify` on a Function under load is non-trivial — fast-json-stringify pre-compiles a shape-specific serializer.
- **Measurement basis:** `grep -c "response:"` across all `backend/src/routes/*.ts`: only `auth.ts` (1) and `swipes.ts` (2) hit.
- **Recommendation:** Incrementally migrate the hot read paths (deck, matches list, messages list) to `r.withTypeProvider<ZodTypeProvider>()` with a `schema: { response: { 200: zodSchema } }`. The DTOs exist already; the work is wiring, not design.
- **Risk:** Medium. The serializer trims unknown keys, so a missing schema field becomes a silent omission in the response. Roll out per-route with integration tests asserting full payload shape.

### PERF-X5 — Pino transport runs in-process for production (no async writer)
- **Severity / expected gain:** Low–Medium on Vercel. Removes per-log JSON-stringify + stdout `write()` from the request hot path.
- **Location:** `backend/src/server.ts:121-142` (`buildLogger`).
- **Description:** `transport` is set only for development (pino-pretty); production logs are written synchronously via Pino's default `stdout` sink. On Vercel Fluid Compute this is fine — stdout is grabbed by the platform — but the writes block the event loop briefly on every log line. Pino's worker-thread transport (`pino.transport({ target: 'pino/file', options: { destination: 1 } })`) moves the JSON-stringify + write off the request thread.
- **Measurement basis:** `server.ts:137-141` — transport only set in dev. Default behavior is synchronous stdout.
- **Recommendation:** Benchmark first. On Vercel Functions the marginal cost is typically <1 ms per log line and the worker-thread transport adds boot cost; this may be a net negative under cold-start-sensitive workloads. **Recommend: measure before changing.** If logs/request stay below 5, leave alone.
- **Risk:** Worker-thread transports add cold-start overhead that may exceed savings on Functions.

### PERF-X6 — Pino mixin's request-context lookup is O(1) (no finding, confirmed healthy)
- **Severity:** None — informational.
- **Location:** `backend/src/server.ts:128-136` and `backend/src/lib/request-context.ts`.
- **Description:** The mixin calls `requestContext.get()` which uses `AsyncLocalStorage` — O(1) lookup. No per-log DB or service call. This is correctly designed; no change recommended.

### PERF-X7 — Sentry `tracesSampleRate: 0.1` but `withSpan` runs on every request
- **Severity / expected gain:** Low. Sentry's SDK does sampling-decision early so unsampled spans are mostly no-ops, but the wrapper still executes the function and creates SDK objects.
- **Location:** `backend/src/lib/spans.ts` and call sites (`realtime.publishMessage`, `chat.postMessage`).
- **Description:** `withSpan` wraps every call via `Sentry.startSpan({ op, name }, ...)`. The Sentry SDK applies the sampling decision inside `startSpan` and short-circuits unsampled spans (no network, no breadcrumb persistence), but it still allocates a SpanContext object and walks the active hub. At 0.1 sample rate this is a 90 % wasted-allocation rate on hot paths.
- **Measurement basis:** `spans.ts` is unconditional — no `if (Sentry.isInitialized())` short-circuit.
- **Recommendation:** Wrap in a fast-path guard: `if (!env.SENTRY_DSN) return fn(undefined);` before calling `startSpan`. The Sentry SDK already no-ops gracefully but bypassing it entirely when no DSN is configured (dev, CI) keeps the chat hot path allocation-free.
- **Risk:** Low.

### PERF-X8 — Push delivery is sequential per device
- **Severity / expected gain:** Medium for users with multiple devices (e.g. iPhone + iPad). Cuts per-notification latency from O(n × RTT) to O(RTT).
- **Location:** `backend/src/services/push.service.ts:265-310`.
- **Description:** The `for (const d of devices)` loop sends to each APNs device sequentially, with up to one retry per device that includes a `sleep(RETRY_BACKOFF_MS)`. For a user with 3 devices and one transient failure, worst case is `3 × send + 1 × backoff`. APNs HTTP/2 multiplexes 100s of concurrent streams on one connection — sequential is leaving throughput on the table.
- **Measurement basis:** `push.service.ts:265-310`, all awaits inside a `for-of` loop.
- **Recommendation:** `await Promise.all(devices.map(d => sendToDevice(d, ...)))` with per-device retry. The HTTP/2 connection to APNs is shared; concurrency is bounded by the network, not the application.
- **Risk:** Low. APNs is built for it.

### PERF-X9 — `SyntheticCheckRun` grows unbounded
- **Severity / expected gain:** Medium over time. ~105k rows/year per environment; eventual index bloat on the admin "Health" panel's `findFirst orderBy ranAt desc` query.
- **Location:** `backend/src/routes/internal/synthetic.ts:182-189` (write) and `backend/src/routes/admin/metrics.ts:117` (read). Cron in `vercel.json:21` runs every 5 min.
- **Description:** Every cron tick writes a row; nothing prunes. The admin reads "last 50" and "most recent", both indexed reads — but `count()` queries elsewhere and PG vacuum overhead grow linearly with row count.
- **Measurement basis:** No `prisma.syntheticCheckRun.deleteMany` anywhere in `backend/src/` (verified via `grep -r syntheticCheckRun.deleteMany`).
- **Recommendation:** Add a daily prune step (or piggyback on `daily-digest`): `DELETE FROM "SyntheticCheckRun" WHERE "ranAt" < NOW() - INTERVAL '30 days'`. Alternatively, rotate via a TTL-style partial index.
- **Risk:** Low.

### PERF-X10 — No HTTP cache headers on stable read endpoints
- **Severity / expected gain:** Medium. iOS clients re-fetch `/transparency/algorithm/current`, `/preferences/me`, `/admin/metros`, `/profile/me/completeness` on every screen entry; a sensible `Cache-Control: private, max-age=N` + `ETag` would cut a meaningful fraction.
- **Location:** All `routes/*.ts` except `photos.ts` set no cache headers.
- **Measurement basis:** `grep -n "cache-control\|ETag" backend/src/routes/*.ts` returns only the two photo serve lines.
- **Recommendation:** Per-route minimums:
  - `/transparency/algorithm/current`: `public, max-age=3600` (changes on deploy; pair with ETag from `algorithmVersion`).
  - `/admin/metros`, `/admin/geography`: `private, max-age=300, must-revalidate`.
  - `/preferences/me`: `private, max-age=0, must-revalidate` with `ETag` on the row's `updatedAt`.
- **Risk:** Low. Mutation endpoints must bust via `Cache-Control: no-store` (already implicit since they don't set headers; with this change, ensure write paths explicitly set `no-store`).

### PERF-X11 — No process-local LRU cache for hot lookups
- **Severity / expected gain:** Medium on Fluid Compute (instances reuse across requests).
- **Location:** None. `backend/src/plugins/redis.ts` exposes Upstash but it's only used opportunistically (see `services/admin/*`).
- **Description:** Things like the country gate, metro boundary lookups, feature flags evaluation, blocked-user lookups — all hit Postgres on every request. Fluid Compute reuses instances across concurrent requests, so a tiny in-process LRU (`lru-cache` package, 5-30 s TTL) on stable read paths is a substantial win without any infra change. The country-gate logic in `auth.ts:36-72` does a fresh `app.checkCountry()` per request.
- **Measurement basis:** `grep -rn "lru-cache\|LRUCache" backend/src/` returns no results.
- **Recommendation:** Introduce a thin `lib/cache.ts` wrapper around `lru-cache` and cache: (a) feature-flag rows for 30 s, (b) metro polygons for 5 min, (c) per-user blocked-user set for 60 s (invalidated on `Block` mutation via a global `version` counter).
- **Risk:** Medium. Cache invalidation is the hard part — write paths must bump the version counter. Start with read-only data (metros, country lists) where this is trivial.

### PERF-X12 — No `cache: 'npm'` on `actions/setup-node`
- **Severity / expected gain:** Medium. Reclaims ~30-45 s × 5 jobs per PR.
- **Location:** `.github/workflows/ci.yml` — every `actions/setup-node` invocation lacks the `cache: 'npm'` input.
- **Description:** Each of the 5 jobs (fast-feedback, lint-and-build, admin-dashboard, test-matching, test-backend) runs `npm ci` from scratch. `setup-node` has built-in npm cache support keyed on `package-lock.json` that uses the GitHub Actions cache backend — zero-effort.
- **Measurement basis:** `ci.yml` lines 24-25, 54-55, 158-160, 215-216, 304-305. None set `cache: 'npm'`.
- **Recommendation:** Add `cache: 'npm'` to every `actions/setup-node` step. Optionally add `cache-dependency-path: package-lock.json`.
- **Risk:** Very low. Standard pattern.

### PERF-X13 — `vitest` config forced single-fork for backend integration suite (correct)
- **Severity:** None — informational.
- **Location:** `backend/vitest.config.ts:8-17`.
- **Description:** `fileParallelism: false, pool: 'forks', singleFork: true`. Comment explains the integration suite shares one Postgres and `TRUNCATE CASCADE` between files would deadlock. This is the correct call. The wall-clock cost is the price of integration-test correctness.
- **Recommendation:** None — but note: a future split between "unit (parallel)" and "integration (serial)" vitest projects (vitest workspaces) would let pure-unit specs run in parallel forks while keeping the DB suite serial. Speedup roughly proportional to the fraction of pure-unit specs.

### PERF-X14 — CodeQL `autobuild` step likely re-runs `npm ci`
- **Severity / expected gain:** Low (weekly cron + per-PR).
- **Location:** `.github/workflows/codeql.yml:38-39`.
- **Description:** `github/codeql-action/autobuild` for `javascript-typescript` typically does its own install. No `cache:` on the `actions/setup-node` (there isn't one — autobuild manages its own toolchain). Worth confirming.
- **Recommendation:** Manual build step with a cached `npm ci` instead of `autobuild` if scan time is hurting.
- **Risk:** Low.

### PERF-X15 — `iOS` workflow caches DerivedData but `test` job re-derives
- **Severity / expected gain:** Medium. The `build` job caches DerivedData; the `test` job uses a different `-derivedDataPath build/DerivedData-ui` for UI tests and the unit-test job runs in a separate job from build.
- **Location:** `.github/workflows/ios.yml:41-48` (cache) vs `test` job (lines 106+) which doesn't have a `Cache SwiftPM and DerivedData` step.
- **Description:** The `test` job re-resolves SwiftPM packages and rebuilds the project from scratch because the cache step lives only in the `build` job.
- **Recommendation:** Hoist the cache step to the `test` job too (or merge build+test into one job with two `xcodebuild` invocations sharing DerivedData).
- **Risk:** Low.

### PERF-X16 — Backend deploy region pinned to `iad1`; verify Neon region match
- **Severity / expected gain:** Very high if mismatched. Cross-region DB round-trip can add 60–100 ms per query, compounded by Prisma's chatty N+1 patterns in some routes.
- **Location:** `vercel.json:14` — `"regions": ["iad1"]`.
- **Description:** Backend is forced into AWS us-east-1 (IAD). Neon's recommended region for AWS us-east customers is `us-east-1` or `us-east-2`. Cannot verify from repo alone — needs operator check of the Neon project region.
- **Recommendation:** Confirm `DATABASE_URL` host resolves to `us-east-1.aws.neon.tech` (or `us-east-2`). If `us-west-2`, expect 60-80 ms baseline latency per query. Each discovery deck handler does 3+ queries; mismatch = 180-240 ms additional latency.
- **Risk:** None to investigate.

### PERF-X17 — `discovery/deck` issues 3 sequential Postgres queries
- **Severity / expected gain:** Medium. Each is on the hot path of every deck refresh.
- **Location:** `backend/src/routes/discovery.ts:36-51`.
- **Description:** After `buildDeck`, the handler issues: (1) `profile.findMany` with photos include, (2) raw SQL for viewer location, (3) raw SQL for candidate locations. Queries 2 and 3 are independent and could run concurrently. Query 1 returns photos for the same profiles whose locations we then fetch separately — could be one query that selects `Profile`, photos, and `ST_X/ST_Y(location)` in a single round trip via `$queryRaw`.
- **Measurement basis:** Lines 36-51 — 3 sequential `await`s.
- **Recommendation:** `Promise.all` the location queries; ideally collapse into one `$queryRaw` returning profiles + photos JSON-aggregated + location columns. Saves 2 round trips per deck (× ~2-3 ms intra-region = 4-6 ms; cross-region would be 120-200 ms).
- **Risk:** Low for `Promise.all`, medium for the SQL merge (needs careful PostGIS + JSON aggregation testing).

### PERF-X18 — Ably channel fan-out is conservative (no finding, confirmed healthy)
- **Severity:** None — informational.
- **Location:** `backend/src/lib/realtime.ts` and `backend/src/routes/chat.ts:44`.
- **Description:** Each `publishMessage` publishes to exactly one channel (`conversation:{id}`); the conversations list is NOT a channel — clients re-fetch via REST. This is the right trade-off (small payload + small fan-out). The realtime token capability map (`backend/src/routes/realtime.ts:33-37`) grants `subscribe + presence` per conversation; presence is granted but the iOS RealtimeService never enters presence (only `subscribe`). **Sub-finding:** Granting `presence` capability when it's unused is harmless but the iOS side could drop the dependency and the token request could omit `"presence"` to reduce capability surface. Not worth blocking on.
- **Recommendation:** None mandatory. Optionally drop the `"presence"` capability since iOS doesn't use it.

---

## Out of scope but noted

- **No `Vary: Accept-Encoding` will be set** until compression is enabled. `@fastify/compress` emits it automatically.
- **iOS `URLSession` config** — `waitsForConnectivity = true` is set (good); no `httpMaximumConnectionsPerHost` override (defaults to 6 — fine for a JSON API; could be raised for high-concurrency photo loads, but the deck only fires 6-9 photo URL requests serially through SwiftUI AsyncImage anyway). HTTP/2 keep-alive is implicit through `URLSession` connection pool — no action needed.
- **TLS / OCSP** — Vercel terminates TLS; certificates are managed. OCSP stapling is on by default. No action.
- **`@fastify/multipart`** size limits in `server.ts:233-247` are correctly tight (1 KB field size, 5 MB file size). Healthy.
- **CORS** — `parseCorsAllowlist` is correctly validating; no wildcard. Healthy.
