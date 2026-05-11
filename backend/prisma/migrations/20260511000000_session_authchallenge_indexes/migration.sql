-- Indexes that support the opportunistic-cleanup paths in
-- services/auth.service.ts (delete-by-userId, expiresAt sweeps) and
-- the userId lookup that backs session listings.

CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId");
CREATE INDEX IF NOT EXISTS "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX IF NOT EXISTS "AuthChallenge_userId_idx" ON "AuthChallenge"("userId");
CREATE INDEX IF NOT EXISTS "AuthChallenge_expiresAt_idx" ON "AuthChallenge"("expiresAt");
