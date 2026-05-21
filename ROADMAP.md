# OpenMatch roadmap

A public-facing snapshot of where OpenMatch is, where it's going, and what it
intentionally will not become. Updated alongside major releases. Discussion
happens in [GitHub Discussions](https://github.com/cheesejaguar/openmatch/discussions);
binding decisions are tracked in issues labelled `roadmap`.

> **Stability disclaimer.** OpenMatch is pre-1.0. APIs, schemas, and
> on-disk formats may change between minor versions until the 1.0 tag.
> The matching algorithm follows its own [versioning policy](docs/algorithm/versioning.md)
> independent of app version.

## Shipped — 1.0 candidate

Everything in `main` today. These are the surfaces a fork can rely on.

- **iOS app.** SwiftUI, iOS 17+. Four-tab structure (Swipe / Likes / Chat / Profile). Animated swipe cards with free undo. Apple Sign-In + email magic link auth. Photo upload via short-lived Blob tokens. Live chat via Ably with capability-scoped tokens. Push notifications via APNs. Algorithm transparency screen wired to live API.
- **Backend.** Fastify + Prisma, deploys as a Vercel Node Function. Postgres + PostGIS via Neon. Upstash Redis for rate limits and ephemeral cache. Vercel Blob for photos. Per-route rate limits on auth, swipes, messaging, blocks, and reports. OpenAPI 3.1 served at `/openapi.json` + `/docs`.
- **Matching package.** TypeScript, no DB dependency. Eligibility filtering, weighted scoring, fairness rotation. Algorithm config served from the live API; same JSON backs the in-app "Why am I seeing this profile?" surface.
- **Admin dashboard.** Next.js App Router. Trust-and-safety queue, user inspector, algorithm config inspector, audit log. TOTP-enforced admin auth with envelope-encrypted secrets at rest.
- **Privacy and safety.** Free report, block, unmatch. Bucketed-distance display only. Data export and account deletion as first-class flows with a grace-period reactivation path on magic-link re-entry. Aggregated, first-party analytics only.
- **Platform.**
  - One-command Docker self-host (`make up`).
  - Apache 2.0 license, DCO sign-off, Contributor Covenant 2.1.
  - Auto-generated TypeScript SDK from `/openapi.json`.
  - Public quality, security, and performance scorecards.

## In flight

Work happening now or in the next release.

- **Trust & safety automation.** Move beyond manual queue review: heuristic photo flagging, repeat-reporter clustering, and faster-decay rate limits for newly-created accounts.
- **Identity verification (opt-in).** Selfie-pose verification as a free, opt-in badge — never a paywalled "advantage."
- **Monetization plumbing for forks.** A neutral payments seam (Stripe / RevenueCat adapters) that downstream forks can opt into for *cosmetics / themes only*. The upstream OpenMatch app will not enable it. Documented in `docs/forking.md`.
- **Internationalization.** String externalization in iOS + admin; first non-English locale shipped end-to-end.
- **Operator-grade observability.** Structured Pino logs with redaction, error-rate SLOs, and a self-host-friendly dashboard recipe (Grafana + Loki) for forks not on Vercel.

## Planned

Committed direction; not yet started.

- **Multi-region read replicas.** Backend currently runs single-region (`iad1`). Planned: cross-region Neon read replicas + geo-routed function regions so EU / APAC users see sub-200ms swipe latency.
- **Video calling between matches.** WebRTC-based 1:1 calls, opt-in per-conversation, no recording, ephemeral signalling.
- **Algorithm experimentation framework.** Synthetic-data harness for fairness counterfactuals + a tagged-experiment API so forks can A/B their own weights without forking the matching package.
- **Hardware-attested moderation.** Use Apple App Attest / Play Integrity to bind reports + appeals to a real device, reducing brigading without burdening legitimate users.
- **Federated trust signals (research).** Cross-instance shared blocklists for known abusers, with strong privacy guarantees (private set intersection or similar). Research-stage; will not ship without an external privacy review.

## Won't do

Hard product constraints. PRs that violate these will be closed.

- ❌ **No paid dating advantage.** No paid likes, paid boosts, super-likes-but-only-paid, paid undo, paid filter unlocks, paid messaging, paid "see who liked you," paid visibility, or paid algorithmic preference. This is the whole point of the project.
- ❌ **No hidden ranking factor.** Every weight and rule lives in `matching/` and is served back from `/api/v1/transparency/algorithm/current`.
- ❌ **No ad SDKs or cross-app tracking.** First-party aggregated analytics only.
- ❌ **No exact-location disclosure.** Bucketed distance only ("8 miles away"), no map pins, no last-seen-here.
- ❌ **No engagement-maximizing dark patterns.** No streaks, no manufactured scarcity, no casino-style reward bursts.
- ❌ **No weakening of report / block / unmatch.** These flows stay free, fast, and prominent.

## How to influence the roadmap

- For a new feature: open a Discussion first, then a feature-request issue once there's rough consensus.
- For a research-stage idea: open an issue tagged `research`. It can sit there indefinitely.
- For something on "Won't do": don't. See [`CONTRIBUTING.md`](CONTRIBUTING.md).
