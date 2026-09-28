ALTER TABLE "AccountDeletionRequest" ADD COLUMN "leaseToken" TEXT;
DROP INDEX "AccountDeletionRequest_userId_status_key";
CREATE INDEX "AccountDeletionRequest_userId_status_idx" ON "AccountDeletionRequest"("userId", "status");
CREATE UNIQUE INDEX "AccountDeletionRequest_one_active_user" ON "AccountDeletionRequest"("userId") WHERE "status" IN ('scheduled', 'in_progress');
