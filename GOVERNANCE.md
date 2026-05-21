# Governance

OpenMatch is a small open-source project. This document describes how
decisions are made, who can make them, and how someone becomes a
maintainer. It is intentionally lightweight — formalism scales with
the project, and we are not yet at the scale that warrants more.

## Model

OpenMatch follows a **BDFL + maintainer council** model:

- A **Benevolent Dictator For Now** (BDFN) holds final tie-breaking authority on direction, scope, and the "Won't do" list in [`ROADMAP.md`](ROADMAP.md). Currently: [@cheesejaguar](https://github.com/cheesejaguar).
- A **maintainer council** (initially 1–3 people, growing as the project does) handles day-to-day code review, release management, and trust-and-safety policy.
- The BDFN can be overridden only by unanimous council vote on a documented policy disagreement. The BDFN can step down by appointing a successor with majority council approval.

This is deliberately closer to "early Python" than to "modern Apache." If the project outgrows it, we'll formalize.

## Decision-making

Most decisions never reach this document. They happen by:

1. A pull request, with consensus among reviewers.
2. An issue discussion that resolves to "yes, do this" or "no, here's why not."

When consensus isn't reached, decisions escalate through this ladder:

| Layer | Quorum | Used for |
|---|---|---|
| **Lazy consensus** | Default. No objection within 72h = approved. | Routine PRs, small features, dependency bumps, docs. |
| **Maintainer review** | At least one maintainer approval. | Anything user-facing, algorithm-adjacent, or touching auth / privacy / safety. |
| **Council vote** | Majority of active council members. | Roadmap changes, new maintainer onboarding, sensitive policy. |
| **BDFN override** | BDFN decision, council can unanimously override. | Existential scope questions ("should we accept a payments PR?"). |

## What requires more than one approval

Some changes are too consequential for single-maintainer approval:

- **Algorithm changes** (`matching/src/`, `matching/algorithm_config.json`): two maintainer approvals, one of whom is on the trust-and-safety side. See [`docs/algorithm/versioning.md`](docs/algorithm/versioning.md).
- **Auth, encryption, or session handling**: two maintainer approvals, one of whom is on the security side.
- **Privacy / data-export / deletion flows**: two maintainer approvals.
- **Anything on the "Won't do" list in [`ROADMAP.md`](ROADMAP.md)**: requires a council vote *before* any code is written. PRs without that vote will be closed unread.

## Becoming a maintainer

We grow the council by invitation, not application. The criteria:

1. **Sustained contribution.** At least 6 months of consistent, high-quality PRs and reviews. "Consistent" doesn't mean every week — it means showing up over time.
2. **Domain coverage.** New maintainers should fill a gap (e.g. iOS, trust-and-safety, infra, algorithm).
3. **Aligned with the constraints.** You have demonstrably internalized the "Won't do" list and the privacy-first defaults. A maintainer who pushes back on a paid-mechanic PR with the right argument is more valuable than one who silently approves.
4. **Council consensus.** Existing maintainers must reach majority agreement, with no strong objections.

Invitations come from the BDFN after council discussion. There is no public application process; if you're a sustained contributor and you'd like to take on more responsibility, say so in a [Discussion](https://github.com/cheesejaguar/openmatch/discussions).

## Stepping down

Maintainers can step down at any time by opening a PR removing themselves from the maintainer list and (if applicable) transferring any open-PR-owner assignments. We honor "alumni" status — past maintainers retain the trust accumulated, and we welcome them back if they want to return.

The BDFN may remove a maintainer who has been inactive for more than 12 months *and* unresponsive to a check-in. This is a courtesy demotion, not a punishment — alumni status applies.

## Conflicts of interest

Maintainers must disclose:

- Employment by a competing dating product.
- Investment or advisory roles in dating or matching technology companies.
- Any financial relationship with a service OpenMatch depends on (Vercel, Neon, Upstash, Ably, Apple developer-relations, etc.) that goes beyond standard customer/user terms.

Disclosure goes in a comment on the council's pinned governance issue. The council decides on a case-by-case basis whether the conflict requires recusal from specific decisions.

## Code of conduct enforcement

The council is responsible for enforcing the [Code of Conduct](CODE_OF_CONDUCT.md). Enforcement decisions require a majority vote of council members not involved in the incident. The BDFN cannot unilaterally override a council enforcement decision in either direction.

## Changing this document

Changes to `GOVERNANCE.md` require a council vote and a 7-day comment window on a Discussion or issue before merging. The BDFN cannot change governance unilaterally.
