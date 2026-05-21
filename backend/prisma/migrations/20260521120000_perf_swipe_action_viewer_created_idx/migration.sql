-- PERF-B2 — bounded priorSwipes lookup in discovery.buildDeck filters
-- on viewerUserId, optionally undoneAt IS NULL + createdAt > window,
-- and orders by createdAt DESC with a take cap. Without a leading
-- (viewerUserId, createdAt DESC) composite the planner did a full
-- per-row sort over every viewer's history before applying the limit,
-- materializing tens of thousands of rows for power users with months
-- of swipe history.
--
-- The narrow (viewerUserId, targetUserId) composite is retained — it
-- still serves the dedupe-by-(viewer,target) lookups in the swipe
-- service. The new triplet covers the discovery hot path's ordered
-- scan, letting PG stream the take=10000 rows in index order.

CREATE INDEX "SwipeAction_viewerUserId_createdAt_idx"
  ON "SwipeAction" ("viewerUserId", "createdAt" DESC);
