# Contributing to OpenMatch

Thanks for your interest. OpenMatch's value rests on the trust users place in the code — every contribution helps that or hurts it. Please read this carefully before submitting changes.

## Ground rules

OpenMatch will never accept changes that:

- Add paid mechanics to the dating experience (paid likes, paid boosts, super likes, paid undo, paid filter unlocks, paid visibility, paid messaging).
- Introduce a hidden ranking factor not documented in `docs/algorithm/`.
- Add third-party advertising or cross-app tracking SDKs.
- Surface exact user location to other users.
- Weaken the report / block / unmatch flows.

These are not stylistic preferences — they are the product. PRs that change them will be closed.

## Development setup

```bash
docker compose up -d                          # Postgres+PostGIS, Redis, MailHog
npm install                                    # workspaces
npm test -w @openmatch/matching                # matching tests, no DB needed
npm run prisma:migrate -w @openmatch/backend
npm run seed -w @openmatch/backend
npm run dev -w @openmatch/backend              # API on :8080
```

For the iOS app: `cd ios && make generate && make test`.

## Workflow

1. Open an issue first for anything bigger than a bugfix. Algorithm and policy changes **require** an issue.
2. Branch from `main` using `feature/<short-name>` or `fix/<short-name>`.
3. Keep PRs focused. One logical change per PR.
4. Run `npm test` in every workspace you touched, plus `npm run lint` and `npm run typecheck`.
5. For algorithm changes, see "Changing the algorithm" below.

## Commit and PR messages

- Imperative present tense ("add fairness rotation", not "added").
- Reference the issue number.
- Explain *why*, not *what* (the diff shows the what).

## Changing the matching algorithm

Algorithm changes follow `docs/algorithm/versioning.md`. Every PR that touches `/matching/src/` or `/matching/algorithm_config.json` must include:

- A summary of the change and its motivation.
- Expected user impact (qualitative and, where possible, quantitative on synthetic data).
- Updated synthetic-fixture test results.
- A fairness analysis: which user populations gain or lose visibility?
- An abuse analysis: can the change be exploited?
- A new entry in `docs/algorithm/CHANGELOG.md`.
- A version bump in `algorithm_config.json`.

Algorithm changes require approval from two maintainers, one of whom is on the trust-and-safety side.

## Privacy and safety review

Any PR that touches profile fields, location handling, message storage, moderation, or authentication needs a privacy/safety reviewer. Tag `@openmatch/trust-safety` (or open an issue if no team is configured yet).

## Code style

- TypeScript: strict mode, `prettier`, `eslint`. No `any` without an explicit comment.
- Swift: `swift-format` defaults. SwiftUI-first, async/await, no Combine for new code unless there's a clear reason.
- Tests are not optional. New logic ships with tests. New endpoints ship with route tests.

## Reporting security issues

**Do not** open a public issue for security problems. See [`SECURITY.md`](SECURITY.md).
