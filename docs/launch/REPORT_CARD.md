# OpenMatch · Launch Report Card

> Source of truth for the beta-launch readiness assessment. Updated continuously
> as PRs land. This file is the canonical scorecard — the HTML viewer at
> `docs/launch/index.html` is a rendering of these tables for offline review.

**Last refreshed:** 2026-05-18 (after Round 1B — iOS launch readiness)
**Overall readiness:** 🔴 **39 / 100**
**Verdict:** **NOT READY** for public beta. BLOCKERs remain on backend / admin side; iOS half of P0+P1 is closed.

---

## Launch goals (the "what we're shipping")

| | |
|---|---|
| **Target market** | One US metro for v0 (proposed: San Francisco Bay Area, 50-mile radius) |
| **Initial cohort size** | 100 invite-coded users, ramping to 500 over 2 weeks |
| **Cohort gate** | Invite code required at signup; geographic gate enforces metro boundary |
| **Time on platform** | 30-day beta with a clear go/no-go review at day 14 and day 28 |
| **Launch criteria (go)** | All P0 items green · ≥ 80 % of P1 items green · ≥ 70 % line coverage on hot paths · zero open BLOCKER bugs |
| **30-day success metrics** | ≥ 40 % D1 retention · ≥ 50 mutual matches/day at cohort peak · ≥ 30 % match-to-message conversion within 48 h · <2 h median moderator response · ≥ 99 % crash-free sessions |
| **Go/no-go review cadence** | Weekly during beta, biweekly after |

### Severity legend

- **P0 — Blocker.** Launch is impossible without this. (n=3 today)
- **P1 — High.** Should ship before public beta; workarounds are unsafe or hurt the cohort. (n=10)
- **P2 — Medium.** Acceptable to ship into beta with a clear plan to close in the first 2 weeks. (n=8)
- **P3 — Low.** Nice-to-have; post-beta is fine. (n=5)

### Status legend

- ❌ **Missing** — no implementation
- 🔄 **In progress** — branch open, not yet merged
- ⚠️ **Partial** — some parts shipped, gaps remain
- ✅ **Done** — merged on `main` and verified

---

## Category scores

| # | Category | Items | Done | Score | Status |
|---|---|---|---|---|---|
| 1 | Operational readiness | 8 | 1 | 12 % | 🔴 |
| 2 | Safety & trust | 7 | 3 | 43 % | 🟡 |
| 3 | Beta cohort management | 5 | 1 | 20 % | 🔴 |
| 4 | iOS user experience | 10 | 9 | 90 % | 🟢 |
| 5 | Admin dashboard | 9 | 2 | 22 % | 🔴 |
| 6 | Testing & CI | 6 | 2 | 33 % | 🔴 |
| 7 | Compliance & privacy | 6 | 4 | 67 % | 🟢 |
| 8 | Performance & capacity | 4 | 1 | 25 % | 🔴 |
| 9 | Post-launch monitoring | 6 | 1 | 17 % | 🔴 |
| **Total** | | **61** | **24** | **39 %** | 🔴 |

---

## 1 · Operational readiness

| ID | Item | Goal | Target / DoD | Severity | Status | Notes |
|---|---|---|---|---|---|---|
| OPS-1 | Push notifications (APNs / web push) | Notify users of matches, messages, likes when app is backgrounded | iOS APNs cert in App Store Connect · backend worker that fans match/message events to APNs · device-token registration endpoint · respects `NotificationPreferencesDTO` | **P0** | ❌ | `backend/src/routes/privacy.ts:70` models prefs but no delivery |
| OPS-2 | Feature flags / kill switches | Toggle features, disable signups, lower rate limits without redeploy | `FeatureFlag` table · `app.flags.evaluate(key, ctx)` · admin UI to flip flags · runtime cache w/ 30-s TTL | **P0** | ❌ | grep finds zero matches; need infra from scratch |
| OPS-3 | Crash + error reporting | All backend errors land in Sentry / equivalent within 60 s | Sentry SDK installed in `backend/src/server.ts` · DSN in env · sample-rate config · release tagging · unhandled-rejection capture | **P1** | ❌ | Pino logs locally; no exporter |
| OPS-4 | Structured request logging | Every request gets a request-id; logs are queryable by user-id / endpoint / status | Fastify request-id plugin · log shipper to Axiom / Datadog / Vercel Logs | **P1** | ⚠️ | Pino is wired; no shipper |
| OPS-5 | /health & /ready endpoints | Vercel and uptime monitor can probe service health | `/health` returns 200 if process up · `/ready` checks Postgres + Ably + Redis · admin dashboard surfaces both | **P1** | ⚠️ | `/health` returns `{ok:true}` only; no readiness probe |
| OPS-6 | Metrics endpoint | Admin dashboard can plot p50/p95 latency, request count, error rate | Internal `/api/v1/admin/metrics/timeseries` returning windowed counts · driven from request-log table or Postgres analytics | **P1** | ❌ | only `/overview` aggregate exists |
| OPS-7 | Cron / scheduled-job health | Visible last-run timestamp + success/failure for every scheduled job | Cron jobs registered in `vercel.ts` · `CronRun` audit table · admin "Cron health" card | **P2** | ❌ | no cron infra yet |
| OPS-8 | Rollback runbook | Documented one-command rollback for backend and admin | `docs/ops/rollback.md` · `vercel rollback` command tested against a known-bad deploy | **P2** | ❌ | undocumented |

---

## 2 · Safety & trust

| ID | Item | Goal | Target / DoD | Severity | Status | Notes |
|---|---|---|---|---|---|---|
| SAFE-1 | Automated CSAM scanning | All uploaded photos pass through hash-matching against NCMEC / PhotoDNA before going live | PhotoDNA (or StopNCII / Safer) API integration · hash check on upload · auto-flag + freeze user on match · NCMEC report stub | **P1** | ❌ | manual queue only; `ncmec.service.ts` is a stub waiting on registration |
| SAFE-2 | Reporting + blocking | Users can report and block; bans cascade through sessions | reporter flow · admin queue · two-way block · session revocation on ban | **P2** | ✅ | shipped in `Workstream B/C` |
| SAFE-3 | Scam-rule engine | Heuristic detection of payment / off-platform solicitation | `backend/src/services/safety/scam-rules.ts` runs on profile + messages · auto-tags profile · feeds report queue | **P2** | ✅ | shipped Workstream D |
| SAFE-4 | DSA notice-and-action SLA | Notices acknowledged in ≤ 24 h, decision in ≤ 48 h per EU 2022/2065 | `Notice.dueAt` populated · alert at 75 % time-elapsed · weekly DSA dashboard widget | **P1** | ⚠️ | endpoints exist (`backend/src/routes/dsa.ts`) but no SLA tracking |
| SAFE-5 | Underage detection | Users who falsely claim 18+ are caught before/after onboarding | iOS DOB picker (server re-validates) · escalation pipeline using Apple Declared Age Range when available · admin review queue | **P2** | ⚠️ | DOB picker shipped; no escalation |
| SAFE-6 | Block evasion detection | Banned users can't simply create a new account on the same device / IP | device-fingerprint hashing · IP-similarity heuristic · admin "linked accounts" view | **P2** | ❌ | no signal collected |
| SAFE-7 | Photo moderation queue UX | Moderators can clear queue with single-keystroke decisions, see history | keyboard shortcuts in admin · prior-decision context · age-of-queue warning | **P3** | ⚠️ | basic queue exists; lacks shortcuts |

---

## 3 · Beta cohort management

| ID | Item | Goal | Target / DoD | Severity | Status | Notes |
|---|---|---|---|---|---|---|
| BETA-1 | Invite code system | New users must redeem a valid invite to sign up | `BetaInviteCode` table (code, createdBy, usedAt, usedByUserId, expiresAt, cohortLabel) · `/auth/start` accepts + validates code · admin CRUD + bulk-generate | **P0** | ❌ | no schema or endpoint exists |
| BETA-2 | City / metro geo-fence | Signups + matches limited to target metro within radius | `MetroBoundary` config (center + radius_km) · enforced in `country-gate` plugin · discovery query filters to in-metro profiles · admin can edit boundaries | **P0** | ❌ | only country gate today |
| BETA-3 | Waitlist | Out-of-cohort interest is captured for later expansion | public waitlist endpoint (rate-limited) · admin dashboard view · email capture only (no profile) | **P1** | ❌ | not implemented |
| BETA-4 | Cohort labels | Each invite is tagged with a cohort (e.g. SF-week1, SF-week2) for analytics segmentation | cohort string on invite + propagates to user record · funnel filterable by cohort | **P2** | ❌ | depends on BETA-1 |
| BETA-5 | In-app invite collection | iOS WelcomeView surfaces a code entry field when invite gating is on | toggled by `invite_required` flag (OPS-2) · pre-fills from universal link param if present | **P1** | ✅ | shipped Round 1B: invite-code field above email, normalises uppercase, parses `?invite=` from universal links, maps backend `invite_required` / `invite_invalid` errors to inline copy |

---

## 4 · iOS user experience

| ID | Item | Goal | Target / DoD | Severity | Status | Notes |
|---|---|---|---|---|---|---|
| IOS-1 | APNs capability + token registration | App registers for push and reports the token to backend | `aps-environment = development` (debug) / `production` (release) entitlement · `UIApplicationDelegate` registers + posts token to `/api/v1/notifications/device-token` | **P0** | ✅ | shipped Round 1B: entitlement + `AppDelegate` + `PushService` ask permission after first match |
| IOS-2 | Crash reporting | Every crash lands in a dashboard within 5 min | Sentry-cocoa (or equivalent) installed + initialised in `OpenMatchApp.init` · DSN from Info.plist (debug + prod) | **P0** | ⚠️ | integration shipped (`Observability/Crash.swift` + SwiftPM dep + `SentryDSN`/`SentryEnvironment` Info.plist keys). Operator must paste a real DSN before TestFlight; with empty DSN the SDK is a no-op |
| IOS-3 | In-app analytics events | Funnel, engagement, match conversion measurable | thin wrapper that POSTs `AnalyticsEvent { name, props, ts }` to backend `/api/v1/analytics/event` · debounced batching · DAU/funnel computed server-side | **P0** | ✅ | shipped Round 1B: `Observability/Analytics.swift` actor with 5 s / 20-event batching; signup, swipe, match, message, app-foreground/background events wired |
| IOS-4 | In-app feedback | Testers can file a bug from inside the app | "Send feedback" row in `SettingsView` opens a form (or mail compose) pre-filled with device + app version | **P1** | ✅ | shipped Round 1B: `FeedbackView` posts to `/api/v1/feedback` with category + device + version |
| IOS-5 | Onboarding · photos step | User cannot reach the swipe deck with zero photos | `StepPhotos` between Basics and Age Gate · requires ≥ 2 photos · re-orderable · enforces upload before "Continue" | **P1** | ✅ | shipped Round 1B: `StepPhotos` requires ≥ 2 photos before Continue; uses the existing upload/delete endpoints |
| IOS-6 | Profile-completeness gate | Incomplete profiles can't enter the deck or be shown to others | server: discovery query already filters by minimal completeness; iOS: poll completeness on launch and redirect to `EditProfileView` when below threshold | **P1** | ✅ | shipped Round 1B: `ProfileGate` polls `/api/v1/profile/me/completeness` (with client-side fallback); Swipe tab replaced with CTA + banner on other tabs when incomplete |
| IOS-7 | Realtime backgrounding | Ably subscription pauses on background, resumes on foreground | hook `scenePhase` in `RootView` · `RealtimeService.disconnect()` on `.background`, `.connect()` on `.active` | **P2** | ❌ | always connected |
| IOS-8 | Message send retry | Network-failed messages are queued and retried | local pending-messages store · retry on reconnect · "Tap to retry" affordance | **P2** | ❌ | one-shot send |
| IOS-9 | Permissions UX polish | Each iOS permission asked with rationale + at the right moment | location asked on first deck load · photos asked on first upload · notifications asked after first match | **P1** | ⚠️ | strings exist; timing is ad-hoc |
| IOS-10 | Accessibility pass | VoiceOver labels for swipe, photos, messages | every interactive element has `accessibilityLabel`; `accessibilityReduceMotion` respected (already partial) | **P2** | ⚠️ | ~20 % coverage |

---

## 5 · Admin dashboard & operator tools

| ID | Item | Goal | Target / DoD | Severity | Status | Notes |
|---|---|---|---|---|---|---|
| ADMIN-1 | Health panel | Operator sees real-time service health at a glance | tiles for backend / Postgres / Redis / Ably status · 5xx rate · p95 latency · admin "Health" route | **P0** | ❌ | only safety metrics today |
| ADMIN-2 | Funnel + retention analytics | Daily DAU / WAU · onboarding funnel · D1/D7/D30 retention · time-to-first-match | new `/analytics` route · cohort-segmentable · downloadable CSV | **P1** | ❌ | nothing today |
| ADMIN-3 | Geographic insights | Cohort distribution within metro by neighborhood / zip | `/api/v1/admin/geography` aggregates · simple choropleth or table view | **P1** | ❌ | nothing |
| ADMIN-4 | Invite code UI | Admin can generate, list, revoke codes · sees redemption funnel | `/admin/invites` route · bulk generate (with cohort label) · search by code or user | **P0** | ❌ | depends on BETA-1 |
| ADMIN-5 | Feature flag UI | Admin can flip flags safely, with audit | `/admin/flags` route · enable/disable · per-cohort overrides · history | **P0** | ❌ | depends on OPS-2 |
| ADMIN-6 | Queue SLA dashboard | Moderators see oldest items, throughput, SLA breaches | `/reports` + `/photos` get SLA columns · oldest-N panel | **P1** | ⚠️ | counts present; ages missing |
| ADMIN-7 | Reusable UI primitives | New admin pages compose from shared components | `<MetricCard>`, `<DataTable>`, `<FilterBar>`, `<TimeSeriesChart>` in `admin/components/ui/` | **P2** | ❌ | every page inlines layout |
| ADMIN-8 | User actions audit | All admin-initiated actions logged with reason | already in `adminAuditLog` · expose timeline view per user | **P2** | ✅ | shipped; needs timeline UI |
| ADMIN-9 | Admin 2FA | TOTP required after magic-link login | TOTP enrolment row on first login · `/admin/auth/verify-totp` route · recovery codes | **P1** | ❌ | magic-link only |

---

## 6 · Testing & CI

| ID | Item | Goal | Target / DoD | Severity | Status | Notes |
|---|---|---|---|---|---|---|
| TEST-1 | Coverage tooling | Coverage is measured per workspace and reported in CI | `@vitest/coverage-v8` installed · `vitest --coverage` runs in CI · summary posted as job summary · `lcov` artifact uploaded | **P1** | ❌ | not installed |
| TEST-2 | Backend hot-path coverage ≥ 70 % | Critical paths (auth, swipe, match, safety, privacy, admin) have ≥ 70 % line coverage | per-file threshold enforced via `coverage.thresholds` block · CI gate blocks merge below threshold | **P1** | ⚠️ | informal coverage decent for shipped Workstreams; not measured |
| TEST-3 | Admin integration tests | Ban / unban / report-resolve flows have end-to-end tests against a seeded DB | new `admin/test/` workspace · vitest + supertest hitting Next route handlers · runs in CI | **P1** | ❌ | zero admin tests |
| TEST-4 | iOS test coverage | XCTest covers view models + critical flows · UITest covers happy path | ≥ 60 % unit coverage on `*ViewModel` and DTO decoders · 3 XCUITests covering signup-to-swipe, swipe-to-match, send-message | **P2** | ⚠️ | 14 unit + 1 UI today |
| TEST-5 | Contract tests | Backend response shapes are pinned · iOS decoders never silently drift | snapshot or JSON-schema tests for every public DTO · run in CI | **P2** | ❌ | none |
| TEST-6 | Load test | Verify backend handles 5× expected peak | k6 / Artillery scenario · runs against staging · documented baseline | **P2** | ❌ | none |

---

## 7 · Compliance & privacy

| ID | Item | Goal | Target / DoD | Severity | Status | Notes |
|---|---|---|---|---|---|---|
| COMP-1 | Privacy notice + consent capture | User sees + accepts privacy notice + Art. 9 sensitive consent before any signal collection | shipped via Workstream A/C · onboarding records consent rows | **P1** | ✅ | shipped |
| COMP-2 | DSAR / data export | User can export all their data on demand | `/privacy/export` endpoint produces JSON · iOS Settings → Export | **P1** | ✅ | shipped |
| COMP-3 | Account deletion grace period | User can delete; data purged after 24 h grace | scheduled · 24 h cancel window · admin can preserve for fraud | **P1** | ⚠️ | endpoint exists; **no purge worker** |
| COMP-4 | DSA Art. 16 notices | Anyone can submit a notice; we respond per SLA | route + service shipped · UI for status check pending | **P1** | ⚠️ | endpoint exists; SLA tracking missing (SAFE-4) |
| COMP-5 | Country gate (sanctions / unsupported geos) | Sign-ups from OFAC SDN / ILGA-criminalised geos blocked | `country-policy.ts` enforces; quarterly review documented | **P1** | ✅ | shipped Workstream H |
| COMP-6 | iOS Privacy Manifest | `PrivacyInfo.xcprivacy` declares every required-reason API + tracked data | manifest shipped · audited in CI · App Store privacy answers ready | **P1** | ✅ | shipped Workstream G |

---

## 8 · Performance & capacity

| ID | Item | Goal | Target / DoD | Severity | Status | Notes |
|---|---|---|---|---|---|---|
| PERF-1 | Postgres pool tuning | Connections don't exhaust under peak concurrency | explicit `connection_limit` on `DATABASE_URL` · Neon pooler enabled · pool usage visible in admin | **P1** | ⚠️ | default Prisma pool; not tuned |
| PERF-2 | Function-time budget | p95 of every endpoint < 500 ms | tracked via OPS-6 · regression alert in CI | **P1** | ❌ | not measured |
| PERF-3 | Photo CDN + transforms | Photos served from CDN with resized variants | Vercel Blob + on-the-fly resize · iOS requests sized URLs | **P2** | ✅ | shipped (Vercel Blob) |
| PERF-4 | Cold-start budget | First request after idle returns in < 1.5 s p95 | Fluid Compute keeps warm pool · monitored | **P2** | ⚠️ | Fluid is on by default; not measured |

---

## 9 · Post-launch monitoring

| ID | Item | Goal | Target / DoD | Severity | Status | Notes |
|---|---|---|---|---|---|---|
| MON-1 | Daily success digest | Operator gets a daily email with cohort metrics | scheduled job at 08:00 PT · summary email with DAU, signups, matches, reports, errors | **P1** | ❌ | not implemented |
| MON-2 | On-call alerting | Pages / Slack on 5xx spike, queue SLA breach, error-budget burn | Sentry alerts · webhook to Slack channel · documented rotation | **P1** | ❌ | no alerting |
| MON-3 | Anomaly detection | Statistical alert on signups, swipes, matches per hour deviating from baseline | simple z-score on rolling 7-day window · admin "Anomalies" card | **P2** | ❌ | none |
| MON-4 | Cost dashboard | Daily infra spend visible to operator | pull from Vercel + Neon · admin "Cost" card with delta to budget | **P3** | ❌ | none |
| MON-5 | Status page | Public status page for major incidents | Vercel-hosted or third-party (status.openmatch.app) · auto-incident from health probes | **P3** | ❌ | none |
| MON-6 | Incident retro template | Post-incident reviews are consistent | `docs/ops/incident-template.md` · linked from on-call runbook | **P2** | ✅ | breach-response-runbook shipped Workstream A |

---

## Tracked metrics post-launch

These are the metrics the admin dashboard must continuously show once we're live. The Admin Round 2 PR is responsible for building the surfaces that read these.

### Funnel (every signup flows through these steps)
1. App opened (DAU)
2. Welcome tapped a CTA
3. Email submitted *or* Apple SIWA started
4. Email verified / Apple completed
5. DOB entered (age gate passed)
6. Photos uploaded (≥ 2)
7. Likes-visibility chosen
8. Onboarding done → Swipe deck loaded
9. First swipe
10. First mutual match
11. First message sent (by either side)

Targets for the SF beta: step 1 → 8 ≥ 60 % · 8 → 10 ≥ 40 % in 48 h · 10 → 11 ≥ 30 % in 48 h.

### Engagement (rolling 7-day, segmentable by cohort)
- DAU / WAU / MAU
- Median session duration
- Swipes per active user per day
- Matches per active user per day
- Messages per active match per day
- Photo carousel views per profile

### Retention (cohort-curve)
- D1, D3, D7, D14, D30 returning %
- Time-to-first-match
- Time-to-first-message
- 7-day churn signals (no opens, no swipes, no responses to messages)

### Safety
- Reports / 1k DAU
- Median moderator response time
- SLA breaches per week
- Auto-ban precision (re-review false-positive rate)
- Repeat-offender count

### Infrastructure health
- Backend error rate (5xx / total)
- p50, p95, p99 latency per endpoint
- Postgres CPU + connection-pool usage
- Ably presence channel count
- Vercel function invocations + cost
- CDN cache hit-rate on photos

### Geographic
- Active users per neighborhood within target metro
- Match density heatmap
- Median between-user distance for matches

---

## Sign-off checklist (gate to public beta)

A launch is GO when every box is checked.

- [ ] All P0 items in this scorecard are ✅
- [ ] ≥ 80 % of P1 items are ✅
- [ ] Backend hot-path test coverage ≥ 70 % line
- [ ] iOS XCUITest happy-path green on TestFlight build
- [ ] DSAR export verified end-to-end with a real test account
- [ ] Account deletion + 24-hour purge worker verified end-to-end
- [ ] City geo-fence verified by attempting signup from out-of-cohort IP / coords
- [ ] Invite-code system verified: code generated, redeemed, marked used
- [ ] Feature flag verified: signup gate flag flips a real signup attempt
- [ ] Push notification verified: real test device receives a match notification
- [ ] Sentry verified: synthetic crash from iOS and backend land in dashboard
- [ ] On-call rotation documented and paged once for a synthetic alert
- [ ] Status-page incident drill completed
- [ ] Rollback drill completed (`vercel rollback` against a synthetic bad deploy)
- [ ] Privacy notice + terms of service signed off by counsel
- [ ] App Store + TestFlight metadata complete

---

## Change log

This section tracks every PR that moved a score in the table above.

| Date | PR | Items closed | Score change |
|---|---|---|---|
| 2026-05-18 | (baseline) | — | 0 → 31 |
| 2026-05-18 | Round 1B — iOS launch readiness | IOS-1 ✅ · IOS-2 ⚠️ · IOS-3 ✅ · IOS-4 ✅ · IOS-5 ✅ · IOS-6 ✅ · BETA-5 ✅ | 31 → 39 |
| | | | |
