-- DISC-Q1 — anti-staleness in the deck.
--
-- The previous deck-builder filtered out users the viewer had swiped on
-- (via `priorSwipes`) but not users the viewer had *seen* but not acted
-- on. Long-tail viewers with many candidates and few decisions could
-- replay the same 25 cards every session.
--
-- `DeckImpression` records each (viewer, target, deckSession) tuple we
-- showed in a deck. Discovery filters out candidates with an impression
-- in the trailing 7 days *unless* the candidate pool would otherwise be
-- empty, in which case stale-but-unswiped candidates are allowed back
-- in (with the demotion happening at the ranking layer via
-- recentImpressions). A daily cron prunes rows older than 30 days.
--
-- Indexed by (viewerUserId, shownAt) so the hot-path "shown in the last
-- 7 days for this viewer" lookup is index-supported and orderable.
CREATE TABLE "DeckImpression" (
  "id"            TEXT PRIMARY KEY,
  "viewerUserId"  TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "targetUserId"  TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "deckSessionId" TEXT NOT NULL,
  "shownAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "DeckImpression_viewerUserId_shownAt_idx"
  ON "DeckImpression" ("viewerUserId", "shownAt" DESC);

-- Prune support: the daily worker deletes rows older than 30 days. A
-- single-column index on shownAt lets the worker DELETE without a full
-- scan when there are millions of impressions.
CREATE INDEX "DeckImpression_shownAt_idx"
  ON "DeckImpression" ("shownAt");
