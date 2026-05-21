-- Hot-path index coverage for read endpoints that filter+sort.
-- Pre-pass: listMatches / listIncomingLikes both fetch by (userId, status)
-- via existing composite indices but then re-sort all matching rows by
-- createdAt DESC because the composite did not include the sort column.
-- These three-column composites let Postgres skip the post-fetch sort
-- and stream rows in index order for paginated reads.
--
-- The narrow (toUserId, status) and (userAId/userBId, status) composites
-- are intentionally retained — the new triplet indices subsume them for
-- the order-by case, but the older two-column indices are still narrower
-- for non-sorted counts (e.g. badge count queries).

-- Like: incoming likes ORDER BY createdAt DESC; outgoing/DSAR filter (fromUserId, status)
CREATE INDEX "Like_toUserId_status_createdAt_idx"
  ON "Like" ("toUserId", "status", "createdAt" DESC);
CREATE INDEX "Like_fromUserId_status_idx"
  ON "Like" ("fromUserId", "status");

-- Match: listMatches WHERE (userAId = $1 OR userBId = $1) AND status='active' ORDER BY createdAt DESC
CREATE INDEX "Match_userAId_status_createdAt_idx"
  ON "Match" ("userAId", "status", "createdAt" DESC);
CREATE INDEX "Match_userBId_status_createdAt_idx"
  ON "Match" ("userBId", "status", "createdAt" DESC);

-- Report: admin investigation lookups
CREATE INDEX "Report_reportedUserId_idx" ON "Report" ("reportedUserId");
CREATE INDEX "Report_reporterUserId_idx" ON "Report" ("reporterUserId");
