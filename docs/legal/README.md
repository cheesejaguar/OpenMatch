# OpenMatch Legal & Compliance Docs

> **Not legal advice.** These documents are engineering-oriented working notes that describe how OpenMatch intends to comply with applicable laws. They must be reviewed by qualified counsel before launch in any jurisdiction.

OpenMatch is, simultaneously: a consumer dating service, a hosting service for user-generated content, and a processor of sensitive personal data (sexual orientation, precise location, photographs). The combination drives most of the obligations captured here.

## Contents

| Document | Purpose |
|---|---|
| [`regulatory-landscape.md`](./regulatory-landscape.md) | Survey of every law, regulation, and platform rule that plausibly applies — privacy (GDPR, CCPA/CPRA, state laws, LGPD, PIPEDA, APPI, DPDPA, POPIA, …), child safety (COPPA, AADC, OSA, TAKE IT DOWN), content moderation (DSA, OSA, FOSTA-SESTA, DMCA, NCMEC reporting), accessibility (ADA, EAA, WCAG), non-discrimination, marketing (CAN-SPAM, CASL, TCPA), App Store rules, security/breach laws, algorithmic accountability (AI Act, ADMT), open-source/IP, and lawful-process handling. |
| [`compliance-roadmap.md`](./compliance-roadmap.md) | The plan: Phase 0 foundations, Phase 1 pre-launch baseline, Phase 2 first-12-months, Phase 3 expansion. Every item is a candidate issue. |

## Reading order

1. Start with the **regulatory landscape** to understand scope.
2. Move to the **compliance roadmap** to see how OpenMatch intends to satisfy that scope and which workstreams are blockers for launch.
3. Cross-check against the existing operational docs:
   - [`docs/privacy/principles.md`](../privacy/principles.md) — the privacy invariants the code already enforces.
   - [`docs/safety/community-guidelines.md`](../safety/community-guidelines.md) — the user-facing safety rules.
   - [`docs/algorithm/fairness.md`](../algorithm/fairness.md) — what the matching algorithm will and will not consider.

## Conventions

- Each obligation in the roadmap mirrors a GitHub issue tagged `legal/<area>`.
- Changes to anything in `docs/legal/` require CODEOWNERS sign-off (founder + counsel of record).
- Counsel checkpoints are explicit. Phase exits without counsel sign-off do not count.
