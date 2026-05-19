-- Round 2A backend ops: account-deletion purge worker + DSA Art. 16 SLA
-- tracking + admin audit event types.
--
-- Closes COMP-3 (purge worker), SAFE-4 (SLA tracking), and the schema
-- pieces of ADMIN-1/2/3 (the admin audit needs the new event types for
-- the purge worker and SLA-breach signals).
--
-- All changes are additive — no existing column is dropped or retyped,
-- so this migration can roll forward against the existing R1A database
-- without data loss.

-- AlterEnum: AdminEventType — new event types
ALTER TYPE "AdminEventType" ADD VALUE IF NOT EXISTS 'account_purged';
ALTER TYPE "AdminEventType" ADD VALUE IF NOT EXISTS 'dsa_notice_acknowledged';
ALTER TYPE "AdminEventType" ADD VALUE IF NOT EXISTS 'dsa_notice_decided';
ALTER TYPE "AdminEventType" ADD VALUE IF NOT EXISTS 'dsa_sla_breach';

-- AlterEnum: AccountDeletionStatus — new terminal status from the worker
ALTER TYPE "AccountDeletionStatus" ADD VALUE IF NOT EXISTS 'purged';

-- AlterTable: AccountDeletionRequest — irreversibly-purged timestamp
ALTER TABLE "AccountDeletionRequest"
  ADD COLUMN IF NOT EXISTS "purgedAt" TIMESTAMP(3);

-- AlterTable: NoticeAndActionReport — DSA SLA tracking columns
ALTER TABLE "NoticeAndActionReport"
  ADD COLUMN IF NOT EXISTS "acknowledgedByAdminUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "respondedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "decidedByAdminUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "slaAckDueAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "slaDecisionDueAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "slaAckBreachedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "slaDecisionBreachedAt" TIMESTAMP(3);

-- Backfill SLA deadlines for any existing notice rows so the breach
-- worker has a sensible baseline. ACK = receivedAt + 24h, decision
-- = receivedAt + 48h. Notices already resolved are unaffected.
UPDATE "NoticeAndActionReport"
SET
  "slaAckDueAt" = COALESCE("slaAckDueAt", "receivedAt" + INTERVAL '24 hours'),
  "slaDecisionDueAt" = COALESCE("slaDecisionDueAt", "receivedAt" + INTERVAL '48 hours')
WHERE "slaAckDueAt" IS NULL OR "slaDecisionDueAt" IS NULL;

-- CreateIndex: SLA query support
CREATE INDEX IF NOT EXISTS "NoticeAndActionReport_slaAckDueAt_acknowledgedAt_idx"
  ON "NoticeAndActionReport"("slaAckDueAt", "acknowledgedAt");
CREATE INDEX IF NOT EXISTS "NoticeAndActionReport_slaDecisionDueAt_respondedAt_idx"
  ON "NoticeAndActionReport"("slaDecisionDueAt", "respondedAt");
