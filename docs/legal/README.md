# OpenMatch Legal & Compliance Docs

> **Not legal advice.** These documents are engineering-oriented working notes that describe how OpenMatch intends to comply with applicable laws. They must be reviewed by qualified counsel before launch in any jurisdiction.

OpenMatch is, simultaneously: a consumer dating service, a hosting service for user-generated content, and a processor of sensitive personal data (sexual orientation, precise location, photographs). The combination drives most of the obligations captured here.

## Contents

### Survey & roadmap

| Document | Purpose |
|---|---|
| [`regulatory-landscape.md`](./regulatory-landscape.md) | Survey of every law, regulation, and platform rule that plausibly applies. |
| [`compliance-roadmap.md`](./compliance-roadmap.md) | The phased plan (P0 foundations → P3 expansion). Every item is a candidate issue. |

### Foundational artifacts

| Document | Purpose |
|---|---|
| [`ropa.yaml`](./ropa.yaml) | Machine-readable Record of Processing Activities (GDPR Art. 30). Every data class, purpose, lawful basis, retention, recipient, transfer. |
| [`vendor-register.md`](./vendor-register.md) | Sub-processor list + diligence checklist + change log. |
| [`threat-model.md`](./threat-model.md) | STRIDE + LINDDUN passes; dating-app-specific patterns. |

### User-facing legal artifacts

| Document | Purpose |
|---|---|
| [`terms-of-service.md`](./terms-of-service.md) | ToS template — UGC indemnity, Apple EULA addendum, dispute resolution per jurisdiction. |
| [`privacy-notice.md`](./privacy-notice.md) | Layered notice with US-state, EU/UK, CA/QC, BR, AU supplements. |
| [`children-policy.md`](./children-policy.md) | 18+ floor enforcement, actual-knowledge handling, NCMEC pipeline. |
| [`dmca-policy.md`](./dmca-policy.md) | DMCA §512 notice / counter-notice / repeat infringer. |
| [`law-enforcement-guidelines.md`](./law-enforcement-guidelines.md) | What process we require and what we will produce. |
| [`accessibility-statement.md`](./accessibility-statement.md) | WCAG 2.2 AA / EN 301 549 conformance target. |
| [`transparency-report-template.md`](./transparency-report-template.md) | DSA-shaped reporting template. |

### Operational

| Document | Purpose |
|---|---|
| [`breach-response-runbook.md`](./breach-response-runbook.md) | T+0 → T+72h playbook; state-by-state matrix. |

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
