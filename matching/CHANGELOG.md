# Changelog — @openmatch/matching

This file is the package-level changelog. The user-facing algorithm changelog lives at [`/docs/algorithm/CHANGELOG.md`](../docs/algorithm/CHANGELOG.md).

## 1.0.0 — 2026-05-01

Initial release.

- Pure-function scoring with seven components (distance, activity, preference overlap, relationship goal, profile completeness, fairness rotation, randomization).
- Eligibility predicates per `/docs/algorithm/spec.md` §1.
- Plain-language explanations.
- Deterministic randomization via `(viewer_id, candidate_id, algorithm_version, day_seed)`.
- Synthetic-fixture test suite covering distance, age, gender mutuality, relationship-goal compatibility, missing optional fields, fairness rotation, and randomization determinism.
