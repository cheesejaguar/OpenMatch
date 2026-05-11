# 💞 OpenMatch

[![CI](https://github.com/cheesejaguar/openmatch/actions/workflows/ci.yml/badge.svg)](https://github.com/cheesejaguar/openmatch/actions/workflows/ci.yml)
[![iOS](https://github.com/cheesejaguar/openmatch/actions/workflows/ios.yml/badge.svg)](https://github.com/cheesejaguar/openmatch/actions/workflows/ios.yml)
[![CodeQL](https://github.com/cheesejaguar/openmatch/actions/workflows/codeql.yml/badge.svg)](https://github.com/cheesejaguar/openmatch/actions/workflows/codeql.yml)

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Code of Conduct](https://img.shields.io/badge/Contributor%20Covenant-2.1-purple.svg)](CODE_OF_CONDUCT.md)
[![Open Source Love](https://badges.frapsoft.com/os/v3/open-source.svg?v=103)](https://github.com/cheesejaguar/openmatch)
[![Linted with Biome](https://img.shields.io/badge/Linted_with-Biome-60A5FA.svg?logo=biome&logoColor=white)](https://biomejs.dev/)
[![Made with Swift](https://img.shields.io/badge/Swift-5.9-orange.svg?logo=swift&logoColor=white)](https://swift.org)
[![Made with TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-20.x-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Postgres + PostGIS](https://img.shields.io/badge/Postgres-16%20%2B%20PostGIS-336791.svg?logo=postgresql&logoColor=white)](https://postgis.net/)
[![Platform: iOS 17+](https://img.shields.io/badge/Platform-iOS%2017%2B-lightgrey.svg?logo=apple&logoColor=white)](https://developer.apple.com/ios/)
[![Deployed on Vercel](https://img.shields.io/badge/Deployed_on-Vercel-000000.svg?logo=vercel&logoColor=white)](https://vercel.com/)
[![No Paid Boosts](https://img.shields.io/badge/Paid%20Boosts-Never-ff4d6d.svg)](#-what-this-project-will-not-do)

> 🪟 An open-source, swipe-based iOS dating app with an auditable matching algorithm and **no paid dating advantage**.

OpenMatch is built on a different social contract from most mainstream dating apps:

- 🔍 **The matching algorithm is open source.** Every weight, every eligibility rule, every ranking factor is published in this repo and served back to users from the live API.
- 🆓 **Core features are free.** Seeing who liked you, undoing a swipe, detailed filters, chatting with matches — never paywalled. There is no super like, no boost, no subscription, no paid visibility.
- 🛡️ **Privacy by default.** Exact location is never shown. Analytics are first-party and aggregated. Data export and account deletion are first-class.
- 🌿 **Calm design.** No casino-style reward bursts, no manufactured urgency, no engagement-maximizing dark patterns.

📖 The full product specification lives at [`docs/product/openmatch-design.md`](docs/product/openmatch-design.md).

## 📱 The four tabs

| | Tab | What it does |
|---|---|---|
| 🃏 | **Swipe** | Animated profile cards. Drag or tap reject / like. Undo is free. Tap the left or right edge of a photo to cycle the gallery. |
| ❤️ | **Likes** | See who liked you. Always free. You can make this visible, count-only, or hidden — your choice. |
| 💬 | **Chat** | Conversations with mutual matches, with live message delivery via Ably realtime. |
| 👤 | **Profile** | Edit your profile, set "Looking for" filters, manage privacy and safety, and inspect the live matching algorithm. |

## 🗂️ Repository layout

```
📦 matching/         @openmatch/matching   Open-source matching algorithm (TypeScript)
🛠️ backend/          @openmatch/backend    Fastify + Prisma API server (deploys to Vercel)
   └── api/index.ts                        Vercel Node Function entry that wraps Fastify
📱 ios/                                    SwiftUI iOS app (XcodeGen)
📚 docs/                                   Product, algorithm, privacy, safety, API docs
🚀 vercel.json                             Vercel deployment configuration
🗄️ infra/legacy-gcp/                       Archived GCP Terraform (deprecated, kept for data migration)
🧪 synthetic-data/                         Fixtures shared across packages
```

## 🚀 Running locally

**Prerequisites:** Node 20, Docker, (for iOS) macOS with Xcode 15+ and `brew install xcodegen`.

```bash
# 1️⃣  Bring up Postgres+PostGIS and MailHog (dev SMTP UI)
docker compose up -d

# 2️⃣  Install JS workspaces
npm install

# 3️⃣  Run matching package tests (no DB required)
npm test -w @openmatch/matching

# 4️⃣  Migrate and seed the database
npm run prisma:migrate -w @openmatch/backend
npm run seed -w @openmatch/backend

# 5️⃣  Start the API locally (REST on :8080, OpenAPI at /docs)
npm run dev -w @openmatch/backend
# …or run it through Vercel's local emulator (matches production routing):
npx vercel dev

# 6️⃣  iOS — generate the Xcode project and open it
cd ios && make generate && open OpenMatch.xcodeproj
```

🌱 The seed populates ~30 synthetic profiles around San Jose so the swipe deck is non-empty on first launch.

🧪 In local dev `UPSTASH_REDIS_REST_URL`, `ABLY_API_KEY`, and `BLOB_READ_WRITE_TOKEN` can be left unset — rate limits fall back to in-memory, realtime publish becomes a no-op, and photo uploads use the local filesystem.

## ☁️ Deploying to Vercel

The backend deploys as a single Vercel Node Function that wraps the Fastify app (`backend/api/index.ts`). All managed dependencies are listed below.

| Concern | Service |
| --- | --- |
| Compute | Vercel Functions (Node 20, region `iad1`, 60s `maxDuration`) |
| Postgres + PostGIS | [Neon](https://neon.tech) (HTTP/WS driver via `@prisma/adapter-neon`) |
| Cache + rate-limit store | [Upstash Redis](https://upstash.com) (REST) |
| Photo storage | [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) |
| Realtime chat fan-out | [Ably](https://ably.com) (REST publish + capability tokens) |
| Email | SMTP (any provider — e.g. Resend, Postmark, Mailgun) |
| Secrets | Vercel Environment Variables (per Production / Preview / Development) |

### Required environment variables

```
DATABASE_URL                    # Neon pooled connection string
UPSTASH_REDIS_REST_URL          # Upstash REST endpoint
UPSTASH_REDIS_REST_TOKEN
BLOB_READ_WRITE_TOKEN           # Auto-injected by Vercel when a Blob store is attached
ABLY_API_KEY
JWT_SECRET
SMTP_HOST  SMTP_PORT  SMTP_FROM
CORS_ORIGIN
APPLE_TEAM_ID  APPLE_CLIENT_ID  APPLE_KEY_ID  APPLE_PRIVATE_KEY   # optional, Sign in with Apple
```

### One-time setup

1. Provision Neon, enable PostGIS: `CREATE EXTENSION postgis;`.
2. Run `npm run prisma:migrate -w @openmatch/backend` against `DATABASE_URL` pointing at Neon.
3. Provision Upstash Redis (global), an Ably app, and a Vercel Blob store.
4. Import the repo in Vercel; set the env vars above for each environment.
5. Push to `main` — Vercel builds and deploys automatically; PRs get preview URLs.

### Migrating data off GCP

The legacy GCP Terraform lives in [`infra/legacy-gcp/`](infra/legacy-gcp/). To migrate Cloud SQL → Neon:

```bash
pg_dump --no-owner --no-acl "$CLOUD_SQL_URL" > /tmp/openmatch.dump
psql "$NEON_DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql "$NEON_DATABASE_URL" < /tmp/openmatch.dump
```

After cutover (DNS swap of `api.openmatch.app` to `cname.vercel-dns.com`), decommission the GCP project and delete `infra/legacy-gcp/`.

## 🔬 Algorithm transparency

[![Algorithm Version](https://img.shields.io/badge/Algorithm-discovery--v1.0.0-blueviolet.svg)](docs/algorithm/CHANGELOG.md)
[![Config Version](https://img.shields.io/badge/Config-2026--05--01-blueviolet.svg)](matching/algorithm_config.json)
[![Auditable](https://img.shields.io/badge/Auditable-✅-success.svg)](docs/algorithm/spec.md)

The live matching algorithm and its weights are served at `GET /api/v1/transparency/algorithm/current`. The same JSON file backs the package, the API, and the in-app "Why am I seeing this profile?" explanation — there is only one source of truth.

- 📄 Algorithm spec: [`docs/algorithm/spec.md`](docs/algorithm/spec.md)
- ⚖️ Weights and rationale: [`docs/algorithm/weights.md`](docs/algorithm/weights.md)
- 🤝 Fairness rules: [`docs/algorithm/fairness.md`](docs/algorithm/fairness.md)
- 🔖 Versioning policy: [`docs/algorithm/versioning.md`](docs/algorithm/versioning.md)
- 📝 Changelog: [`docs/algorithm/CHANGELOG.md`](docs/algorithm/CHANGELOG.md)

## 🚫 What this project will not do

- ❌ No paid likes, boosts, super likes, paid undo, paid filter access, or paid visibility into incoming likes.
- ❌ No hidden attractiveness score used to suppress profiles.
- ❌ No ad-tracking SDKs, no cross-app tracking.
- ❌ No exact location shown to other users.

🔒 These constraints are enforced by code: there is no `StoreKit` import in the iOS app, no `super_like` value in the swipe enum, and no payment fields on any API. Pull requests adding any of them will be rejected.

## 🛠️ Continuous integration

Every PR runs:

- 🧹 **Lint + format** (`biome check`) against the whole repo.
- 🔍 **Typecheck** (`tsc --noEmit`) for both TypeScript workspaces.
- 🧪 **Tests** — `@openmatch/matching` (no DB) + `@openmatch/backend` (live Postgres + PostGIS service container).
- 📦 **Builds** — both TS workspaces.
- 📱 **iOS** — `xcodebuild build` + `xcodebuild test` on `macos-latest` (paths-filtered to `ios/**`).
- 🛡️ **CodeQL** — JavaScript/TypeScript security analysis on a weekly schedule.
- 🚀 **Vercel** — preview deployments per pull request via the Vercel GitHub integration.

🤖 Dependabot opens grouped PRs weekly for npm and GitHub Actions.

## 🤝 Contributing

[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-purple.svg)](CODE_OF_CONDUCT.md)
[![Security Policy](https://img.shields.io/badge/Security-Responsible%20Disclosure-red.svg)](SECURITY.md)

See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Security issues: [`SECURITY.md`](SECURITY.md). Algorithm changes follow the process in [`docs/algorithm/versioning.md`](docs/algorithm/versioning.md).

## 📜 License

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

Apache License 2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
