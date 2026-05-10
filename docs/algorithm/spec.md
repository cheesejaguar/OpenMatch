# Matching Algorithm Specification

This is the canonical, version-controlled specification for OpenMatch's discovery and ranking algorithm. The same JSON config (`matching/algorithm_config.json`) drives the reference implementation in `matching/src/`, the production `/api/v1/transparency/algorithm/current` endpoint, and the in-app "Why am I seeing this profile?" feature.

There is exactly one algorithm. There are no hidden tiers, no paid boosts, no personal exceptions.

## 1. Eligibility

A candidate is eligible for the viewer's deck iff **all** of the following are true:

1. Candidate account is `active` (not `paused`, `banned`, or `deleted`).
2. Candidate profile `visibility_status = "visible"`.
3. Candidate has no open moderation restriction (`moderation_status ∈ {clean, reviewed_ok}`).
4. Neither user has blocked the other.
5. Viewer has not already acted on the candidate within the reset window. A `reject` action is sticky for 90 days by default; a `like` is sticky until withdrawn or matched.
6. Candidate satisfies viewer's **hard** filters (age range, distance, gender preferences, any hard lifestyle filters).
7. Viewer satisfies candidate's visibility preferences (mutual gender preference, viewer's age within candidate's range, etc.).
8. Both users are 18+ and pass jurisdictional eligibility.

Eligibility failures are recorded in the matching package so they can be reported in aggregate (never per-user) for transparency reports.

## 2. Scoring

Each eligible candidate gets a score in `[0, 1]`:

```
score =
  w.distance            * distance_score
+ w.activity            * activity_score
+ w.preferenceOverlap   * preference_overlap_score
+ w.relationshipGoal    * relationship_goal_score
+ w.profileCompleteness * profile_completeness_score
+ w.fairnessRotation    * fairness_rotation_score
+ w.randomization       * randomization_score
```

Weights live in `matching/algorithm_config.json` and are summarized in [`weights.md`](weights.md).

### 2.1 distance_score

```
distance_score = max(0.25, 1 - distance_km / max_distance_km)
```

A floor of 0.25 ensures users at the edge of the viewer's distance range are not punished into invisibility.

### 2.2 activity_score

| Last active           | Score |
| --------------------- | ----- |
| Within 24 hours       | 1.00  |
| Within 7 days         | 0.80  |
| Within 30 days        | 0.50  |
| Older / unknown       | 0.20  |

Activity buckets are exposed to the matching package as a single enum; exact "last active" timestamps never leave the backend.

### 2.3 preference_overlap_score

```
preference_overlap_score =
    matched_soft_preferences / total_soft_preferences   if total_soft_preferences > 0
    0.5                                                 otherwise
```

Only soft preferences contribute; hard filters are already enforced in eligibility.

### 2.4 relationship_goal_score

| Compatibility       | Score |
| ------------------- | ----- |
| Same goal           | 1.0   |
| Compatible goal     | 0.7   |
| Unclear / open      | 0.5   |
| Incompatible        | 0.0 (or ineligible, per user setting) |

The compatibility matrix is published in [`weights.md`](weights.md).

### 2.5 profile_completeness_score

```
profile_completeness_score = completed_public_fields / recommended_public_fields
```

Capped at 1.0. The recommended field set is fixed and listed in the matching package's `scoring.ts`.

### 2.6 fairness_rotation_score

A small boost for candidates with fewer recent impressions:

```
fairness_rotation_score = 1 - min(1, recent_impressions / impression_cap)
```

`impression_cap` defaults to 200 in the past 24 hours. This prevents a handful of profiles from absorbing the entire impression budget. It is **not** a hidden desirability rank — it boosts under-shown users, not "popular" ones.

### 2.7 randomization_score

Deterministic per `(viewer_id, candidate_id, algorithm_version, day_seed)`. Same inputs always produce the same output, which makes the algorithm reproducibly testable while still giving users variety across days.

## 3. Diversification

After ranking, the deck is post-processed to avoid runs of very similar candidates (same age bucket, same neighborhood). The diversification pass never re-orders by score — it only limits *consecutive* near-duplicates by sliding the next dissimilar candidate forward.

## 4. Explainability

For every shown profile, the API can return a plain-language explanation. Examples:

- "Within your 25-mile distance range."
- "Matches your selected gender preference."
- "Both of you are open to a long-term relationship."
- "You share 3 interests."
- "This profile is active recently."

The explanation **never**:

- Quotes the raw score.
- Reveals private fields the candidate did not choose to display.
- Mentions fairness rotation or randomization (those are not actionable to the viewer).

## 5. Versioning

See [`versioning.md`](versioning.md).

## 6. What is intentionally absent

The following inputs are **forbidden** by policy:

- Paid status, subscription tier, payment history.
- Inferred income, device price, carrier.
- "Attractiveness" scores from any source.
- Inferred psychological state, vulnerability, loneliness markers.
- Engagement-prediction models that maximize session length.

If you find any of these influencing the deck, that is a bug and a policy violation. File a security report (see [`/SECURITY.md`](../../SECURITY.md)).
