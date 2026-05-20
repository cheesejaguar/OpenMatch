-- Wave 2 auth hardening — SEV-A14 per-challenge attempt counter.
--
-- `/auth/verify` is per-IP rate-limited to 20/min, and the magic-link
-- token is 256 bits so brute-forcing the token directly is infeasible.
-- The threat being closed here is the case where the `challengeId`
-- itself has leaked (referer header, server log, MITM) — without a
-- per-challenge counter an attacker can issue arbitrary token guesses
-- against that specific id from a rotating proxy pool for the full
-- 15-minute TTL. Adding a 5-attempt cap mark the challenge consumed
-- so further guesses return `challenge_used`.

ALTER TABLE "AuthChallenge"
  ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0;
