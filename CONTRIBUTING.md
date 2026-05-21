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

## Quality bars

OpenMatch maintains a set of public scorecards. New contributions are expected to not regress them, and ideally to improve them:

- [`CLAUDE.md`](CLAUDE.md) — the agent-facing contract that documents non-negotiable invariants (no paid mechanics, no hidden ranking factors, no ad SDKs). Read this first if you use an AI assistant.
- [`docs/launch/REPORT_CARD.md`](docs/launch/REPORT_CARD.md) — the 1.0 launch report card. Targets the project must clear before it ships.
- [`docs/quality/A_PLUS_SCORECARD.md`](docs/quality/A_PLUS_SCORECARD.md) — the rolling code/architecture quality bar.
- [`doc/security/security-scorecard.md`](doc/security/security-scorecard.md) — security posture across the auth, validation, network, and mobile-privacy audits.
- [`doc/performance/performance-scorecard.md`](doc/performance/performance-scorecard.md) — the iOS, backend, admin, and cross-cutting performance audits.

If your PR touches surfaces these scorecards measure (security, performance, algorithm fairness), call out in the PR description how the change affects the corresponding scorecard.

## Sign your commits

We require [DCO](https://developercertificate.org/) sign-off on every commit. Use `git commit -s` (which adds `Signed-off-by: Your Name <you@example.com>` automatically). Squash-merges preserve the sign-off from the final commit, so make sure that one is signed even if intermediate commits aren't.

GPG/SSH signing is optional but encouraged for maintainers — set `commit.gpgsign = true` locally.

## Self-hosting and forking

OpenMatch is designed to be forked and rebranded. If you're standing up your own deployment or building a derivative product, start with:

- [`docs/self-hosting.md`](docs/self-hosting.md) — one-command Docker self-host.
- [`docs/forking.md`](docs/forking.md) — fork and rebrand walkthrough.

## Governance

See [`GOVERNANCE.md`](GOVERNANCE.md) for how decisions get made and how to become a maintainer.

## Reporting security issues

**Do not** open a public issue for security problems. See [`SECURITY.md`](SECURITY.md).
