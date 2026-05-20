-- Wave 1 auth hardening — closes SEV-A1, SEV-A2, SEV-A7 audit findings.
--
-- Adds the AdminEventType enum values used by the new audit rows:
--   - admin_totp_reset   : explicit device-replacement path that
--                          requires an elevated session (replaces the
--                          old silent-overwrite re-enrol primitive).
--   - admin_refresh_reuse: emitted by rotateAdminSession when a
--                          revoked refresh token is presented; the
--                          entire session family is revoked on the
--                          same code path.
--
-- The values must be added in their own statement (Postgres won't
-- allow ALTER TYPE … ADD VALUE inside a transaction with usage of the
-- new value, but we don't reference them in this migration).

ALTER TYPE "AdminEventType" ADD VALUE 'admin_totp_reset';
ALTER TYPE "AdminEventType" ADD VALUE 'admin_refresh_reuse';
