# OpenMatch

An open-source, swipe-based iOS dating app with an auditable matching algorithm and no paid dating advantage.

OpenMatch is built on a different social contract from most mainstream dating apps:

- **The matching algorithm is open source.** Every weight, every eligibility rule, every ranking factor is published in this repo and served back to users from the live API.
- **Core features are free.** Seeing who liked you, undoing a swipe, detailed filters, chatting with matches — never paywalled. There is no super like, no boost, no subscription, no paid visibility.
- **Privacy by default.** Exact location is never shown. Analytics are first-party and aggregated. Data export and account deletion are first-class.
- **Calm design.** No casino-style reward bursts, no manufactured urgency, no engagement-maximizing dark patterns.

The full product specification lives at [`docs/product/openmatch-design.md`](docs/product/openmatch-design.md).

## The four tabs

1. **Swipe** — animated profile cards. Drag or tap reject / like. Undo is free. Tap the left or right edge of a photo to cycle the gallery.
2. **Likes** — see who liked you. Always free. You can make this visible, count-only, or hidden — your choice.
3. **Chat** — conversations with mutual matches over a real-time WebSocket.
4. **Profile** — edit your profile, set "Looking for" filters, manage privacy and safety, and inspect the live matching algorithm.

## Repository layout

```
matching/    @openmatch/matching   Open-source matching algorithm (TypeScript)
backend/     @openmatch/backend    Fastify + Prisma API server
ios/                               SwiftUI iOS app (XcodeGen)
docs/                              Product, algorithm, privacy, safety, API docs
infra/gcp/                         Terraform for Cloud Run / Cloud SQL / GCS / Memorystore
synthetic-data/                    Fixtures shared across packages
```

## Running locally

Prerequisites: Node 20, Docker, (for iOS) macOS with Xcode 15+ and `brew install xcodegen`.

```bash
# 1. Bring up Postgres+PostGIS, Redis, and MailHog (dev SMTP UI)
docker compose up -d

# 2. Install JS workspaces
npm install

# 3. Run matching package tests (no DB required)
npm test -w @openmatch/matching

# 4. Migrate and seed the database
npm run prisma:migrate -w @openmatch/backend
npm run seed -w @openmatch/backend

# 5. Start the API (REST + WebSocket on :8080, OpenAPI at /docs)
npm run dev -w @openmatch/backend

# 6. iOS — generate the Xcode project and open it
cd ios && make generate && open OpenMatch.xcodeproj
```

The seed populates ~30 synthetic profiles around San Jose so the swipe deck is non-empty on first launch.

## Algorithm transparency

The live matching algorithm and its weights are served at `GET /api/v1/transparency/algorithm/current`. The same JSON file backs the package, the API, and the in-app "Why am I seeing this profile?" explanation — there is only one source of truth.

- Algorithm spec: [`docs/algorithm/spec.md`](docs/algorithm/spec.md)
- Weights and rationale: [`docs/algorithm/weights.md`](docs/algorithm/weights.md)
- Fairness rules: [`docs/algorithm/fairness.md`](docs/algorithm/fairness.md)
- Versioning policy: [`docs/algorithm/versioning.md`](docs/algorithm/versioning.md)
- Changelog: [`docs/algorithm/CHANGELOG.md`](docs/algorithm/CHANGELOG.md)

## What this project will not do

- No paid likes, boosts, super likes, paid undo, paid filter access, or paid visibility into incoming likes.
- No hidden attractiveness score used to suppress profiles.
- No ad-tracking SDKs, no cross-app tracking.
- No exact location shown to other users.

These constraints are enforced by code: there is no `StoreKit` import in the iOS app, no `super_like` value in the swipe enum, and no payment fields on any API. Pull requests adding any of them will be rejected.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Security issues: [`SECURITY.md`](SECURITY.md). Algorithm changes follow the process in [`docs/algorithm/versioning.md`](docs/algorithm/versioning.md).

## License

Apache License 2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
