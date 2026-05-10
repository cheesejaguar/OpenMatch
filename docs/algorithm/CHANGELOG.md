# Algorithm Changelog

All notable changes to the OpenMatch matching algorithm are documented here. See [`versioning.md`](versioning.md) for the policy.

## discovery-v1.0.0 / config 2026-05-01 — initial release

### Scoring

Introduced the seven-component weighted score described in [`spec.md`](spec.md):

- distance (0.25)
- activity (0.20)
- preferenceOverlap (0.20)
- relationshipGoal (0.15)
- profileCompleteness (0.10)
- fairnessRotation (0.05)
- randomization (0.05)

### Eligibility

Mandatory rules: active account, visible profile, no open moderation restriction, no mutual block, no prior swipe within reset window, viewer hard filters, candidate visibility, age and legal compliance.

### Fairness

`fairness_rotation_score` boosts under-shown candidates with a hard cap so it cannot dominate.

### Determinism

`randomization_score` is seeded by `(viewer_id, candidate_id, algorithm_version, day_seed)` so synthetic tests are reproducible.

### Explanations

Plain-language sentences for the five user-facing signals (distance, gender preference, relationship goal, shared interests, recent activity). Raw scores are never exposed in the consumer UI.
