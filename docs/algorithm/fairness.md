# Fairness in OpenMatch's ranking

## What we mean by "fair"

Two things, in priority order:

1. **No paid advantage.** Nobody is moved up or down because of money — direct or inferred.
2. **No impression concentration.** A small fraction of users should not absorb the vast majority of swipe-deck impressions, regardless of their attractiveness, popularity, or engagement.

Fairness here is about **opportunity**, not equal outcomes. Users still have the right to swipe based on their preferences. The system's job is to make sure they actually *see* a diverse, eligible set.

## Mechanism: fairness rotation

The `fairness_rotation_score` (see [`spec.md`](spec.md#26-fairness_rotation_score)) gives a small boost to candidates with fewer recent impressions:

```
fairness_rotation_score = 1 - min(1, recent_impressions / impression_cap)
```

With the default weight of 0.05, this can move a candidate by up to 5% of the score range — meaningful at the margin, never decisive.

Why not weight it higher? Because at high weights this signal *becomes* a desirability rank in reverse: profiles that get rare impressions get over-boosted, then under-boosted as soon as they trend up. Keeping it low avoids that oscillation.

## What this is NOT

`fairness_rotation_score` is not:

- An attractiveness score.
- A "popularity" metric inverted to look fair.
- A way to suppress users who report or block too often.
- A way to suppress users who don't pay (there is no payment).
- A signal personalized by viewer demographics.

## Concentration metrics we publish

Aggregate, privacy-preserving, in transparency reports:

- **Gini coefficient of impression distribution** across active eligible profiles in a region, per week.
- **Top-1% impression share** — fraction of all impressions absorbed by the top 1% of users by impression count.
- **Median impressions per active eligible user**, per week.

These metrics are derived from anonymized aggregates and never linked to individual users in any public report.

## What we do *not* publish

- The actual impression counts for any individual.
- Any signal that could be used to identify under-shown users by name.
- Internal abuse signatures.

## How to file a fairness concern

If you suspect the ranking is unfair in a way the spec doesn't cover, open an issue tagged `fairness`. Include the scenario, what you observed, and what you'd expect. We respond to fairness issues with the same priority as security issues (see [`/SECURITY.md`](../../SECURITY.md)).
