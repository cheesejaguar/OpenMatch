-- Wave 2 auth hardening — SEV-A11 identity-hash HMAC cutover.
--
-- Background. `hashIdentity(value) = sha256(value.trim().toLowerCase())`
-- is unsalted, so any leaked `emailHash` value (via PII spill, log
-- aggregation, SQL export, etc.) can be compared against a candidate
-- email in O(1). We switch new writes to HMAC-SHA256 keyed by
-- IDENTITY_HASH_SECRET so an attacker who learns the hash must ALSO
-- learn the server-side secret before they can confirm membership.
--
-- Rollout semantics. We cannot reverse-rehash existing rows in pure SQL
-- because the only thing persisted is the SHA-256 itself — the plain
-- email was discarded at write time. Instead:
--
--   1. New writes use the HMAC form when IDENTITY_HASH_SECRET is set
--      (see backend/src/lib/hash.ts).
--   2. Read paths look up under BOTH algorithms via
--      `hashIdentityCandidates(email)` so returning users keep
--      matching their legacy row.
--   3. On the next successful authentication for a legacy-keyed user
--      the application opportunistically rewrites `User.emailHash` /
--      `WaitlistEntry.emailHash` to the HMAC form (handled in a
--      follow-up service-layer change keyed off a feature flag).
--
-- This migration only adds an audit marker so operators can confirm
-- the cutover started and so the read-fallback can eventually be
-- retired once the table is fully migrated. The marker is a row in
-- the existing `AlertFired` table (the lightest-weight audit surface
-- we already use for ops events) — no new table is required.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'AlertFired'
  ) THEN
    INSERT INTO "AlertFired" ("id", "alertKey", "firedAt", "details")
    VALUES (
      gen_random_uuid()::text,
      'identity_hash_hmac_cutover_started',
      NOW(),
      jsonb_build_object(
        'finding', 'SEV-A11',
        'note',    'IDENTITY_HASH_SECRET-keyed HMAC is now the default write path; read fallback active until backfill worker completes.'
      )
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- This is a marker-only insert. If the AlertFired column shape ever
  -- drifts, fall through rather than blocking the migration.
  NULL;
END $$;
