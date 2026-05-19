-- Round 3 (ADMIN-9): TOTP-based 2FA for admins. Adds the persistent
-- enrolment fields on AdminUser and a per-session elevation marker on
-- AdminSession. Defaults are chosen so existing admins remain in a
-- "must enrol on next login" state but their sessions are unaffected
-- until the next login.

ALTER TABLE "AdminUser"
  ADD COLUMN "totpSecret" TEXT,
  ADD COLUMN "totpEnrolledAt" TIMESTAMP(3),
  ADD COLUMN "recoveryCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "twoFactorRequired" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "AdminSession"
  ADD COLUMN "twoFactorAt" TIMESTAMP(3);

ALTER TYPE "AdminEventType" ADD VALUE 'admin_totp_enrolled';
ALTER TYPE "AdminEventType" ADD VALUE 'admin_totp_verified';
ALTER TYPE "AdminEventType" ADD VALUE 'admin_totp_disabled';
ALTER TYPE "AdminEventType" ADD VALUE 'admin_recovery_code_used';
