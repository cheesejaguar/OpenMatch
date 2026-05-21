-- PERF-B14 / PERF-B15 — daily-digest + alerter run window-only counts on
-- tables whose existing composite indices required a leading-column predicate
-- the queries don't supply. Adds narrow time-column indices for those scans.

CREATE INDEX "Match_createdAt_idx" ON "Match" ("createdAt");
CREATE INDEX "Report_createdAt_idx" ON "Report" ("createdAt");
CREATE INDEX "ProfilePhoto_createdAt_idx" ON "ProfilePhoto" ("createdAt");
CREATE INDEX "AccountDeletionRequest_requestedAt_idx" ON "AccountDeletionRequest" ("requestedAt");
CREATE INDEX "User_createdAt_idx" ON "User" ("createdAt");

-- Alerter counts total AnalyticsEvent in a window without eventName / userId
-- prefix; existing (eventName, serverTs) + (userId, serverTs) composites don't
-- serve a serverTs-only filter. One narrow btree closes the gap.
CREATE INDEX "AnalyticsEvent_serverTs_idx" ON "AnalyticsEvent" ("serverTs");
