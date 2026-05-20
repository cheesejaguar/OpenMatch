# OpenMatch · A+ FAANG Scorecard

> Quality dimensions audited and hardened in the post-launch FAANG pass (2026-05-19, Rounds A/B/C/D).
> Companion to `docs/launch/REPORT_CARD.md` which tracks beta-launch readiness.

**Verdict:** 🟢 **A− across the board**, with three structural gaps acknowledged as multi-PR investments (mutation testing, load testing, public OpenAPI consumption). Every "one-PR-from-A+" item identified by the audits is closed.

## Pre-pass baseline (2026-05-18)

The three parallel audits scored the repo at:

| Dimension | Score | Headline gap |
|---|---|---|
| Testing rigor | B+ (74 %) | Coverage floor at 50 % lines · zero contract tests · zero property/fuzz · iOS coverage unmeasured · no fast-feedback CI · no npm audit |
| Observability | 69 % | No log shipper · no request-id on every log line · no async context · no Sentry filtering · no custom spans · no SLOs |
| Error codes / validation | 6.5/10 | 41 ad-hoc inline strings · no central registry · iOS `.http(Int,String?)` for everything · admin swallows JSON parse errors · no `response:` schemas · no OpenAPI |
| Verification (boundary) | 8/10 | Body validation 100 % · query validation 40 % · response validation 0 % · JWT audience/issuer not explicit |

## Post-pass state (this scorecard)

### Round A — Backend error contract · PR #49

| Item | Before | After |
|---|---|---|
| Error code registry | 41 inline strings | 91 codes in `backend/src/lib/error-codes.ts` with `ERROR_CODE_META` (status + description) |
| Error helper | hand-rolled per route | `httpError(code, opts)` + `HttpError` class + `sendHttpError(reply, err)` |
| Zod parse errors | leak as `{statusCode:400, validation:[...]}` | mapped uniformly to `{ error: "validation_failed", fields: [{path, message, code}] }` |
| Inline error strings | every route file | all replaced with `ErrorCodes.X` |
| Response schemas | 0 | conservative coverage on auth, swipes, undo with `fastify-type-provider-zod` global registration |
| Query/param validation | ~40 % Zod | `/discovery/deck` querystring Zod-validated (was `Number.parseInt`); pattern documented for remaining routes |
| Error docs | none | auto-generated `docs/api/ERRORS.md` + CI drift gate via `scripts/generate-error-docs.mjs` |
| Test enforcement | ~4 specs asserted error codes | every spec asserts `expect(body.error).toBe(ErrorCodes.X)`; new `error-contract.spec.ts` with 19 cases |

### Round B — Client error consumption · PR #50

| Item | Before | After |
|---|---|---|
| iOS `APIError` enum | 4 cases (`http(Int,String?)`, `decoding`, `transport`, `notAuthenticated`) | ~60 typed cases covering every backend code + `validation(fields:)` + payload-bearing variants (`outsideMetro(nearestKm:)`, `countryNotSupported(reason:note:)`) |
| iOS error decoding | `body.contains("invite_required")` string match | `APIError.from(status:code:body:)` switch on every code + payload extraction |
| iOS localized strings | none | `Resources/en.lproj/ErrorMessages.strings` with one entry per case; `errorDescription` looks up via `NSLocalizedString` |
| Call-site string-match | `WelcomeView` substring contains | typed `if case .inviteRequired = error` |
| Admin client return type | `Promise<{status, data}>` swallowing JSON parse errors | `AdminApiResult<T>` discriminated union with `AdminApiError { code, message?, fields?, payload? }` |
| Admin error codes | duplicated by hand | mirrored from backend via `scripts/sync-error-codes.mjs` with CI drift gate |
| iOS tests | 14 unit | 80 unit (26 error-mapping cases asserting every code group) |
| Admin tests | 10 component | 28 (11 new admin-client tests covering ok/validation/RBAC/payload-bearing/non-JSON-5xx/unknown) |

### Round C — Testing rigor · PR #51

| Item | Before | After |
|---|---|---|
| Coverage workspace floor | `lines: 50, branches: 65` | `lines: 70, statements: 70, functions: 70, branches: 65` enforced |
| Per-file coverage thresholds | none | 11 hot-path service files pinned individually (auth.service ≥ 80/75, totp.service ≥ 80/75, swipe.service ≥ 75/70, dsa.service ≥ 75/70, deletion-worker ≥ 75/70, http-error ≥ 90/80, etc.) |
| Property-based tests | none | `fast-check` installed; auth-token, swipe-eligibility, photo-validation property suites |
| Contract tests | none | `backend/test/contracts/dto-snapshots.spec.ts` — `.toMatchInlineSnapshot()` for every public DTO |
| OpenAPI spec | none | `@fastify/swagger` + `@fastify/swagger-ui` registered before routes; `GET /openapi.json` (public) and `GET /api-docs` (Swagger UI gated) |
| Fast-feedback CI | none | new `fast-feedback` job: lint + format + typecheck across workspaces in < 60 s |
| Dependency vuln scanning | only CodeQL | `npm audit --audit-level=high --omit=dev` gate in lint-and-build |
| iOS coverage | unmeasured | `-enableCodeCoverage YES` on unit-test invocation; `xcrun xccov view --json` extracts and posts to job summary + uploads as artifact |
| iOS test invocations | one combined `xcodebuild test` | split: unit tests with coverage + UITests without (coverage instrumentation slowed UITest launch beyond 30 s) |
| Fake timers | none | `vi.useFakeTimers()` wrapping for time-sensitive specs (alerter, dsa-sla, daily-digest, push, admin-analytics-timeseries) |

### Round D — Observability hardening · PR #48

| Item | Before | After |
|---|---|---|
| Request context | Fastify `req.id` only; not threaded through workers | `AsyncLocalStorage<RequestContext>` in `backend/src/lib/request-context.ts` with `run` / `workerRun` / `set` |
| Log tagging | request handlers tagged ad-hoc | Pino `mixin` reads from store; every log line carries `requestId` + `userId` + `adminUserId` |
| PII redactions | none | Pino `redact` on `req.headers.authorization`, `req.headers.cookie`, `*.email`, `*.emailHash`, `*.refreshToken`, `*.accessToken`, `*.bio`, `*.displayName`, `*.token`, `*.password` |
| Sentry filtering | every 4xx / 5xx / abort polluted dashboard | `beforeSend` hook drops 4xx HttpErrors, 429 rate limits, and `AbortError`; tags survivors with `requestId` / `userId` |
| Custom spans | none on hot paths | `withSpan(op, name, fn)` wrapper used in `auth.service` (startEmailLogin, verifyEmailLogin, rotateRefreshToken, upsertAppleUser), `swipe.service` (recordSwipe), `discovery.service` (buildDeck), `chat.service` (postMessage), `lib/realtime` (publishMessage) |
| Worker tracing | workers untraced | every worker entry (`deletion`, `dsa-sla`, `daily-digest`, `alerter`) wraps body in `requestContext.workerRun()` so logs carry a synthetic worker request id |
| iOS network observability | transport errors silently shown to user | `APIClient` wraps HTTP verbs in `SentrySDK.startTransaction(name: path, operation: "http.client")`; transport + 5xx errors feed `Crash.capture(...)`; 4xx silent |
| SLO documentation | none | `docs/ops/slos.md` — availability 99.5 %, p95 < 500 ms, safety SLAs, push delivery 99 %, alert routing matrix |
| Synthetic monitoring | none | `POST /api/v1/internal/run-synthetic-check` bearer-gated probe (exercises `/ready` + auth-start gate + discovery gate + admin health); `SyntheticCheckRun` audit table; `*/5 * * * *` Vercel cron; admin visibility at `/api/v1/admin/synthetic` |

## Headline metrics

| Dimension | Pre-pass | Post-pass | Δ |
|---|---|---|---|
| Backend test files | 38 | 50+ (incl. contracts, properties, service specs) | +12 |
| Backend tests | 198 | 250+ | +52 |
| iOS unit tests | 14 | 80 | +66 |
| Admin tests | 10 | 28 | +18 |
| Distinct typed error codes | 41 (inline strings) | 91 (registry) | +50 |
| Fastify response schemas | 0 | 8 (conservative pilot) | +8 |
| Property-based suites | 0 | 3 (auth, swipe, photo) | +3 |
| DTO contract snapshots | 0 | ~20 | +20 |
| Custom Sentry spans | 0 | 8 (hot paths) | +8 |
| Pino PII redaction paths | 0 | 10 patterns | +10 |
| SLO docs | 0 | 1 (`docs/ops/slos.md`) | +1 |
| Synthetic checks | 0 | 1 (5-min cron) | +1 |
| CI jobs | 5 | 7 (added `fast-feedback`, split iOS coverage) | +2 |
| Dep vuln gate | CodeQL only | CodeQL + `npm audit --audit-level=high` | + |
| iOS coverage measurement | none | unit tests covered, posted to job summary | + |

## Remaining gaps (deliberate post-pass deferrals)

- **Mutation testing** (Stryker/JS, muter/Swift) — gap-N (multi-PR). Per the audit, branch kill rate on auth/safety/swipe is the right metric, but requires a separate CI lane and is post-beta.
- **Load testing** (k6/Artillery against staging) — gap-N. Post-beta. Will run scenarios once cohort exceeds 200 users.
- **Public OpenAPI consumption** — backend now exposes `/openapi.json` but iOS / admin do not auto-generate clients from it. Manual alignment remains; drift caught by the contract snapshot tests in the interim.
- **iOS UITest under coverage** — booted-simulator launch becomes too slow when `-enableCodeCoverage` instruments every Swift function. Resolved by running UITests in a separate non-coverage xcodebuild invocation; UI-layer coverage stays unmeasured for now.
- **Localised error strings to multiple languages** — structure is ready (English `ErrorMessages.strings`), but other locales are post-beta.
- **i18n for backend error messages** — backend still emits English in `message:` fields. iOS already maps via localised string table.
- **JWT audience / issuer claims** — `@fastify/jwt` verifies signature + exp; no explicit `aud`/`iss` check. Acceptable for v0 single-issuer setup; harden when multi-tenant.
- **Async retry budgets** — alerter dedupes via `AlertFired`, push retries once, but no token-bucket / circuit breakers around external integrations.
- **Cost dashboard** (MON-4) — still ❌. Operator pulls Vercel/Neon billing manually.
- **Status page** (MON-5) — still ❌. Email/Slack-only incident comms at v0 scale.

## How to read this card

- The launch report card (`docs/launch/REPORT_CARD.md`) is the canonical scorecard for "can we ship to public beta." That document continues to track 61 items across 9 categories and is updated as PRs land.
- This document is the **quality** scorecard, focused on the four FAANG axes the user named (testing, observability, error codes, verification). It is updated when the FAANG hardening lanes ship.
- The two documents share the change-log convention. PRs amend both where applicable.

## Sign-off

The OpenMatch repo is operating at **FAANG-grade engineering hygiene across the four audited axes**. Remaining gaps are scope-bound to scale (mutation/load testing, multi-locale, cost/status visibility). For a 100-user beta cohort and the 14/28-day go/no-go checkpoints, this scorecard supports the launch.

## Change log

- **2026-05-20** — Aesthetic V2 (Aurora Dawn) shipped across PRs #53–#58: plum/magenta/marigold/periwinkle palette + radius tokens (#53), expanded Fraunces+Geist weight scale + hero/microcaption tokens (#54), italic 'om' wordmark + asset regeneration (#57), dopamine match overlay with hero typography + 120-particle multi-color burst (#55), repo-wide RoundedRectangle + color-token sweep (#56), configurable right/left/center action-button thumb-reach (#58). FAANG score axes unchanged — this is an aesthetic refresh, not a quality-axis delta.
