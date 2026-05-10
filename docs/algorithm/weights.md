# Default ranking weights

The current production weights are defined in [`matching/algorithm_config.json`](../../matching/algorithm_config.json). This document explains *why* each value is what it is.

## Default weights (v1.0.0)

| Component             | Weight | Rationale                                                                                  |
| --------------------- | ------ | ------------------------------------------------------------------------------------------ |
| `distance`            | 0.25   | The strongest predictor of whether two people can actually meet. Capped to avoid edge-of-range punishment via the 0.25 floor on `distance_score`. |
| `activity`            | 0.20   | A profile that has not opened the app in weeks is unlikely to respond. Bucketed so exact timestamps stay private. |
| `preferenceOverlap`   | 0.20   | Soft-preference alignment matters but should not dominate — overweighting this collapses diversity. |
| `relationshipGoal`    | 0.15   | Important for compatibility, but the binary cases are already filtered by eligibility, so the weight reflects the gradient between "same goal" and "open." |
| `profileCompleteness` | 0.10   | Slight nudge so users invest in their profile, capped low so it cannot create a two-class system. |
| `fairnessRotation`    | 0.05   | Enough to break impression concentration without inverting the ranking. |
| `randomization`       | 0.05   | Variety across days; reproducible per `(viewer, candidate, algoVersion, daySeed)`. |

Weights sum to 1.00. They are intentionally **bounded** — no single signal can move a candidate from invisible to top of deck on its own.

## Relationship-goal compatibility matrix

Rows = viewer goal, columns = candidate goal. Values are the raw `relationship_goal_score`.

|                    | LongTerm | LifePartner | ShortTerm | Casual | Friendship | Figuring | Marriage | NonMono | Open |
| ------------------ | -------- | ----------- | --------- | ------ | ---------- | -------- | -------- | ------- | ---- |
| **LongTerm**       | 1.0      | 0.7         | 0.0       | 0.0    | 0.0        | 0.5      | 0.7      | 0.5     | 0.7  |
| **LifePartner**    | 0.7      | 1.0         | 0.0       | 0.0    | 0.0        | 0.5      | 1.0      | 0.5     | 0.5  |
| **ShortTerm**      | 0.0      | 0.0         | 1.0       | 0.7    | 0.5        | 0.5      | 0.0      | 0.7     | 0.7  |
| **Casual**         | 0.0      | 0.0         | 0.7       | 1.0    | 0.5        | 0.5      | 0.0      | 0.7     | 0.7  |
| **Friendship**     | 0.0      | 0.0         | 0.5       | 0.5    | 1.0        | 0.5      | 0.0      | 0.5     | 0.5  |
| **Figuring**       | 0.5      | 0.5         | 0.5       | 0.5    | 0.5        | 1.0      | 0.5      | 0.5     | 0.7  |
| **Marriage**       | 0.7      | 1.0         | 0.0       | 0.0    | 0.0        | 0.5      | 1.0      | 0.0     | 0.5  |
| **NonMono**        | 0.5      | 0.5         | 0.7       | 0.7    | 0.5        | 0.5      | 0.0      | 1.0     | 0.7  |
| **Open**           | 0.7      | 0.5         | 0.7       | 0.7    | 0.5        | 0.7      | 0.5      | 0.7     | 1.0  |

A `0.0` here is **not** automatic ineligibility — the user can choose, in their preferences, to hide incompatible goals entirely (which moves the rule to eligibility instead of scoring).

## Recommended profile-completeness fields

Used as denominator for `profile_completeness_score`:

- ≥ 2 photos
- Display name
- Age
- Gender
- Bio (≥ 30 characters)
- ≥ 1 prompt answered
- ≥ 3 interests
- Relationship goal
- Height (optional but counted if present)
- Education level
- City

A complete profile (10/10) hits 1.0; the cap means a perfect score can never exceed 1.0 even if more fields are added later.

## Changing the weights

Any change here is an **algorithm change**. See [`versioning.md`](versioning.md). At minimum, a weight change requires a bumped `rankingConfigVersion`, a `CHANGELOG.md` entry, and re-run of the synthetic-fixture tests in `matching/test/`.
