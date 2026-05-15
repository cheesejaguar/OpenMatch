# OpenMatch Threat Model

> Not legal advice. STRIDE + LINDDUN passes over the OpenMatch surface, captured at the level useful to engineers reviewing changes. Maintained alongside the code; every PR that adds a new external surface should add a row.

## Scope

In scope:

- iOS app (SwiftUI), backend API (Fastify + Prisma), admin dashboard (Next.js BFF), photo storage (Vercel Blob), realtime fan-out (Ably), email (SMTP), Postgres (Neon), Redis (Upstash).

Out of scope (per [`docs/legal/regulatory-landscape.md`](./regulatory-landscape.md)):

- Payment processing (no payments).
- Third-party ad networks (none).
- Cross-app tracking (none).

## Trust boundaries

```
[User device]
   │  TLS 1.3
   ▼
[Vercel edge → Function (Fastify)] ── JWT ──> [Neon Postgres]
   │                                  ──> [Upstash Redis]
   │                                  ──> [Vercel Blob]
   │                                  ──> [Ably REST]
   ▼
[SMTP provider] [Apple SIWA] [APNs]

[Moderator browser]
   │  TLS
   ▼
[Admin Next.js BFF] ── ADMIN_JWT ──> [Fastify /api/v1/admin/*]
```

## STRIDE — primary risks

| ID | Threat | Surface | Mitigation | Status |
|---|---|---|---|---|
| S-1 | Account takeover via stolen magic-link | Auth | Short TTL on `AuthChallenge`; rate-limit `/auth/start`; one-shot consumption. | ✅ |
| S-2 | Replay of JWT after logout | Auth | Refresh-token rotation; revoke list in DB. | ⚠️ — rotation present, idempotent reuse detection planned in Workstream E |
| S-3 | Admin token leaks through console / logs | Admin | Distinct `ADMIN_JWT_SECRET`, short TTL, IP-hash log. | ✅ |
| T-1 | Tampering with location to triangulate others | API | `formatDistance` is the only sanctioned surface; CI invariant test (Workstream F). | 🆕 |
| T-2 | Profile field tampering to bypass moderation | API | Zod schema; `moderationStatus` is server-controlled. | ✅ |
| T-3 | Hash collisions in photo dedup | Storage | randomUUID-named keys, profile-scoped paths. | ✅ |
| R-1 | Repudiation by moderators | Admin | `AdminAuditLog` for every sensitive action; per-event reason code. | ✅ |
| R-2 | User claims they never consented to Art. 9 processing | Consent | Versioned `ConsentRecord` with text hash (Workstream B). | 🆕 |
| I-1 | Exact lat/long exposed in API response | API | `formatDistance` invariant; lint test rejects `lat`/`lng` in non-owner responses. | 🆕 (Workstream F) |
| I-2 | EXIF GPS leaked via uploaded photos | Photos | Strip EXIF on upload (Workstream D). | 🆕 |
| I-3 | Push notification preview leaks message content | Notifications | Per-user preview policy (full/sender-only/hidden). | ⚠️ — backend supports; iOS to surface |
| I-4 | Discovery API enumerates user IDs | API | Stable but high-entropy cuid; per-IP rate limits; deck composition is server-side only. | ✅ |
| I-5 | Photo URL guessable | Storage | randomUUID names; profile-scoped paths; CDN does not list directories. | ✅ |
| I-6 | Sensitive admin queries logged | Logs | Structured logger scrubs message bodies and DOB; redaction list in logger config (verify). | ⚠️ |
| D-1 | Auth abuse exhausts SMTP quota | Auth | Per-IP rate limit on `/auth/start`; consider SMTP-side quota alerts. | ✅ |
| D-2 | Photo upload abuse | Storage | 4MB body cap; 30/min rate limit; per-user max 9 photos. | ✅ |
| D-3 | Report-spam / mass-flagging | Safety | Rate limit reports; auto-deprioritise reports from accounts with high false-positive rate. | ⚠️ — basic only |
| D-4 | Realtime channel flood | Ably | Capability tokens scoped per match channel. | ✅ |
| E-1 | User escalates to admin via auth bug | Admin | Separate JWT secret + audience; admin routes mounted under a separate plugin and origin allow-list. | ✅ |
| E-2 | Admin escalates beyond their role | Admin | RBAC enforced in `admin-rbac` plugin; per-permission checks. | ✅ |
| E-3 | Ban-evaded re-signup | Auth | `emailHash` / `phoneHash` / Apple subject de-duplication. | ⚠️ — strengthen with device + IP-hash heuristics (Workstream D) |

## LINDDUN — primary privacy risks

| ID | Threat | Surface | Mitigation | Status |
|---|---|---|---|---|
| L-1 | Linkability across sessions to fingerprint a user | API | Refresh tokens are opaque, not user-derived; no IDFA. | ✅ |
| L-2 | Identifiability of orientation via correlated public fields | Profile | Lifestyle fields are user-controlled; orientation never inferred. | ✅ |
| L-3 | Non-repudiation: user cannot deny statements | Messages | We do not deploy non-repudiation tech; messages are between match parties; we retain only what is needed. | ✅ |
| L-4 | Detectability — observing whether a user is on the service | Discovery | Discovery-paused state hides both directions; visibility flags. | ✅ |
| L-5 | Disclosure of information beyond purpose | Multiple | RoPA enforces purpose limitation; sensitive-access grants log moderator access. | ✅ |
| L-6 | Unawareness — user doesn't know what we collect | UI | Layered privacy notice; in-app "What we collect" surface; per-card algorithm explanation. | ⚠️ — design exists, iOS pending |
| L-7 | Non-compliance — sub-processor processes without basis | Vendors | DPA + TIA per vendor; sub-processor list public. | ⚠️ — formalise per Workstream A |

## Specific high-stakes patterns

| Pattern | Lesson | OpenMatch posture |
|---|---|---|
| Grindr HIV-status leak / FTC settlement | Sensitive health-adjacent data must never reach analytics / ad SDKs. | We collect no health data; we have no third-party ad SDKs. |
| Grindr trilateration | Surfacing distance with too much precision = revealing location. | `formatDistance` quantises; CI invariant enforces. |
| Tinder exact-distance scraping | Even bucketed distances + signup interactions can deanonymise; rate-limit and require auth. | Discovery is authenticated, paginated, rate-limited. |
| Bumble photo enumeration | Sequential / guessable photo URLs leak photos. | randomUUID-named keys. |
| Match Group dark-pattern cancel flow | Subscription cancel flows can be deceptive and trigger regulator action. | No subscriptions; no auto-renewal. |
| Hinge "compatibility score" suit | Hidden ranking labelled "compatibility" can be challenged. | We publish the algorithm; no hidden score. |

## Process

- Threat-model review every major release.
- New external surface = new row in this doc + status field.
- Anything tagged 🆕 or ⚠️ must have an open issue.
