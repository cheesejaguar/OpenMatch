# OpenMatch — Performance Optimization Scorecard

> Outcome of the extensive performance optimization pass (2026-05-21).
> Companion to the four audit docs in this directory.

**Verdict:** **🟢 Saturation reached.** 80 findings → 0 critical remaining, ~50 closed across 16 PRs. Remaining ~30 are operator decisions, intentional deferrals, or informational notes.

## Pre-pass posture (2026-05-21)

Four parallel audits produced 80 findings across backend, iOS, admin, and cross-cutting concerns:

| Audit | Findings | Highlights |
|---|---|---|
| `perf-audit-backend.md` | 23 | PERF-B1 deck consolidation (11→3 RTT), B2 unbounded priorSwipes, B3 no message cursor |
| `perf-audit-ios.md` | 22 | PERF-I4 AsyncImage everywhere (no cache, main-thread decode), I3 LikesView own APIClient |
| `perf-audit-admin-vercel.md` | 17 | PERF-A1 every page `force-dynamic` + no Suspense, A7 no-store on `/_next/static`, A5 raw `<img>` for blob URLs |
| `perf-audit-cross-cutting.md` | 18 | PERF-X1 no compression, X2 photo proxy buffers 4MB, X4 only 2 routes have response schemas |

Severity profile: **3 large gains** (B1, I4, A1), **~20 medium**, **~30 small**, **~27 informational/healthy**.

## Per-PR resolution table

| PR | Wave | Findings closed | Notes |
|---|---|---|---|
| #75 | direct | DB hot-path composite indices covering ORDER BY | New indices on Match + Like + Report |
| #79 | direct | PERF-B7 blockUser double-query | Single `UPDATE...RETURNING` with LEFT JOIN |
| #80 | quick-wins agent | PERF-X1 compress · X10 Cache-Control · I9/I10 URLSession+JSON · I2-prep Crash.bootstrap defer · X13 vitest threads pool | `/openapi.json` 9 KB → 1.3 KB (-86%) |
| #81 | direct | PERF-B5 refresh-token single query + off-critical cleanup | Session include user.status; `setImmediate` cleanup |
| #83 | W1-ops agent | PERF-X9 synthetic prune · X12 npm cache in CI | Cron `0 4 * * *` retention; cache shaves ~60s/job |
| #84 | direct | PERF-B17 + B18 photo sortOrder batch | `UPDATE ... FROM UNNEST(...)` collapses N→1 RTT |
| #85 | W1-admin agent | PERF-A1 Suspense streaming · A2-A4 Promise.all · A5 next/image · A7 static-asset cache · A8 unused fonts · A12 next build in CI | 8 admin findings |
| #86 | W1-iOS agent | PERF-I3 single APIClient · I4 OMImage cache+thumbnail decoder · I2 async keychain · I6 back-card hoist · I7 device-class particle gating · I12 unused fonts · I13 file write off main · I18 photo decode off main | 8 iOS findings |
| #87 | W1-backend agent | PERF-B1 deck consolidation · B2 priorSwipes bound · B3 messages cursor · B16/X4 response schemas rollout · X2 photo stream · X3 ETag/Range | 6 backend findings, biggest single PR |
| #88 | direct | PERF-X8 parallel multi-device APNs sends | `Promise.all` with per-device retry |
| #89 | direct | PERF-B12 in-process LRU for active metros | 30s TTL keyed by country; invalidates on admin write |
| #90 | direct | PERF-B14 + B15 time-column indices | `(createdAt)` / `(requestedAt)` / `(serverTs)` for digest+alerter |
| #91 | direct | PERF-A6 strip prod `console.*` + tree-shake barrel imports | `compiler.removeConsole` + `experimental.optimizePackageImports` |
| #92 | direct | PERF-X15 share SwiftPM+DerivedData cache with iOS test job | Test job no longer re-resolves+rebuilds |
| #93 | direct | PERF-B9 parallel block-existence findUnique | Hits composite unique index directly, O(log n) × 2 |
| #94 | direct | PERF-A11 stagger `*/5` crons across different minutes | push-retry/alert/synthetic no longer overlap |

## Headline metrics

| Dimension | Pre-pass | Post-pass |
|---|---|---|
| Findings audited | 0 | 80 |
| Critical findings remaining | 0 | 0 |
| Large-gain findings closed | — | 3 of 3 (B1, I4, A1) |
| Medium-gain findings closed | — | ~17 of 20 |
| DB hot-path composite indices | 14 | 22 |
| Fastify response schemas | 2 routes (auth, swipes) | 10+ routes |
| HTTP compression | ❌ | ✅ brotli + gzip, 1KB threshold |
| `Cache-Control` on stable reads | ❌ | ✅ public/private/SWR per endpoint |
| ETag on `/photos/:id/serve` | ❌ | ✅ + Range |
| Photo proxy streaming (vs 4MB buffer) | ❌ | ✅ |
| iOS shared APIClient + URLCache | ❌ | ✅ 16MB mem / 128MB disk |
| iOS image cache (vs `AsyncImage`) | ❌ | ✅ `OMImage` w/ thumbnail decoder |
| iOS deferred startup (keychain, Crash) | ❌ | ✅ off-main `Task.detached` |
| Admin `<Suspense>` streaming | ❌ | ✅ 8 pages |
| Admin `next/image` for photos | ❌ | ✅ + WebP/AVIF |
| `/_next/static` aggressive cache | ❌ no-store applied to all | ✅ immutable |
| In-process LRU caches | flags only | flags + metros |
| CI cache: `npm ci` | ❌ | ✅ `cache: 'npm'` |
| CI cache: iOS DerivedData + SwiftPM | build job only | shared with test job |
| GH Actions pinned to SHA | ❌ floating tags | ✅ (via Wave 1 security) |
| Crons overlapping on same minute | 3 × `*/5` | staggered 0/1/2 mod 5 |
| Synthetic-check rows | unbounded | 30-day retention |

## Remaining gaps (deliberate)

| Finding | Why deferred |
|---|---|
| PERF-B6 listMatches over-fetch | API shape change (`MATCH_PEER_SELECT` returns both sides); needs iOS coordination + version bump |
| PERF-A9 region pin | Operator decision — confirm Neon Postgres region before changing Vercel `regions: ["iad1"]` |
| PERF-A10 function memory | Operator decision — 1024MB is overkill for most calls; right-size after a week of production data |
| PERF-A14 admin table virtualization | UI rework — defer to product priority |
| PERF-A15 DataTable client-side sort over full payload | Same as A14 |
| PERF-A16 TimeSeriesChart hover throttle | INP regression risk; needs UX touch |
| PERF-X5 Pino async transport | Audit's own recommendation: "Benchmark first" — net negative under cold-start-sensitive workloads |
| PERF-X7 Sentry per-request `withSpan` | 10% sample rate means wrap overhead is small; structural fix is to swap to lazy span init in Sentry SDK 8.x — upgrade-dependent |
| PERF-X11 LRU for blocked-user set | Cache invalidation across Fluid Compute instances would need a Redis pub/sub or version-counter mechanism. Existing block table query is already O(1) via unique index |
| PERF-X16 Neon region alignment | Operator decision |
| PERF-I1 `debugDumpAvailableFamilies` on launch | DEBUG-only; ~10-30 ms first launch in DEBUG builds |
| PERF-I5 PhotoCarouselView prefetch | Net win unclear after I4 lands (the image cache means scroll-back is free; prefetch ahead is bandwidth-spent) |
| PERF-I8 12 spring animations on match overlay | Each spring is cheap; bounded to one moment per swipe burst; risk is bounded |
| PERF-I11 request de-duplication | Concurrent identical fetches are rare in the actual UI graph; complexity > gain |
| PERF-I14-I22 (analytics flush, polling, JSON round-trip, etc.) | Informational / sub-millisecond; pursued lazily as opportunity arises |

## Sign-off

The OpenMatch repo is operating at the **performance saturation point** for static-analysis-driven optimization. Every finding categorized `large` is closed. Remaining items either:
1. Require a measurement-first approach we can only do post-production (operator decisions, cold-start sensitivity)
2. Are intentional UX trade-offs (admin table pagination semantics, animation richness)
3. Are sub-millisecond or DEBUG-only

For the planned beta launch this scorecard supports go-live. Future perf work should be data-driven from production telemetry (`tracesSampleRate: 0.1` Sentry spans + the synthetic-check histogram) rather than further static-analysis passes.
