# Algorithm versioning policy

The matching algorithm has two version identifiers:

- **`algorithmVersion`** — the *code* version. Bumps when the structure of the algorithm changes: new scoring components, new eligibility rules, changed formulas, changed deck-assembly logic. Format: `discovery-vMAJOR.MINOR.PATCH`. Example: `discovery-v1.2.0`.
- **`rankingConfigVersion`** — the *config* version. Bumps when the weights, thresholds, or compatibility matrices change but the code does not. Format: `YYYY-MM-DD`.

Both are stored in `matching/algorithm_config.json` and returned on every deck response.

## When you must bump

| Change                                                | `algorithmVersion`  | `rankingConfigVersion` |
| ----------------------------------------------------- | ------------------- | ---------------------- |
| New scoring component                                 | MAJOR or MINOR      | yes                    |
| Removed scoring component                             | MAJOR               | yes                    |
| Changed scoring formula                               | MINOR               | yes                    |
| Changed weight, threshold, or compat matrix           | no                  | yes                    |
| Changed eligibility rule                              | MINOR or MAJOR      | yes                    |
| New transparency explanation string                   | PATCH               | no                     |
| Bug fix without behavior change                       | PATCH               | no                     |
| Internal refactor with no behavior change             | none                | none                   |

## Required artifacts in any change PR

1. **Summary** — what changed and where.
2. **Motivation** — why; link to the issue.
3. **User impact** — qualitative and (where measurable on synthetic data) quantitative.
4. **Fairness analysis** — which user populations gain or lose visibility, using the synthetic fixtures in `matching/fixtures/`.
5. **Abuse analysis** — can this be exploited? How?
6. **Tests** — synthetic-fixture tests covering the change.
7. **Changelog entry** in [`CHANGELOG.md`](CHANGELOG.md).
8. **Version bumps** in `matching/algorithm_config.json`.

## Review requirements

- Two maintainer approvals.
- One approval must come from someone with trust-and-safety responsibility.
- Algorithm changes do not auto-merge; they require explicit human sign-off.

## Emergency changes

If a live abuse pattern requires an immediate change, a maintainer may merge with one approval and a brief justification. Within **7 days** the full retrospective (motivation, user impact, fairness, abuse, tests) must be added as a follow-up PR or the change rolled back.

## What never bumps the version

- Cosmetic changes to explanation copy *that preserve meaning*. (Material changes do bump `algorithmVersion` PATCH.)
- Adding new synthetic fixtures.
- Documentation-only changes.

## Audit table

Every config change also writes an `AlgorithmAuditRecord` row in the backend database (see Prisma schema). This is the canonical machine-readable history and is what the `/api/v1/transparency/algorithm/changelog` endpoint serves.
