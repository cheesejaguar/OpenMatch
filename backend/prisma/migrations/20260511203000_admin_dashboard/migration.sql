-- CreateEnum
CREATE TYPE "AdminUserStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "BanType" AS ENUM ('temporary', 'permanent', 'safety_hold');

-- CreateEnum
CREATE TYPE "BanStatus" AS ENUM ('active', 'expired', 'lifted');

-- CreateEnum
CREATE TYPE "AdminEventType" AS ENUM ('user_viewed', 'profile_viewed', 'photo_viewed', 'message_viewed', 'conversation_viewed', 'report_opened', 'report_resolved', 'report_assigned', 'report_escalated', 'report_dismissed', 'user_banned', 'user_unbanned', 'user_suspended', 'user_restored', 'photo_approved', 'photo_rejected', 'photo_removed', 'note_added', 'role_changed', 'admin_login', 'admin_logout', 'sensitive_access_granted', 'export_performed', 'access_denied');

-- CreateEnum
CREATE TYPE "SensitiveEntityType" AS ENUM ('user', 'profile', 'conversation', 'photo', 'message');

-- CreateEnum
CREATE TYPE "ReasonCode" AS ENUM ('harassment', 'hate_or_discrimination', 'threats_or_violence', 'sexual_content', 'scam_or_spam', 'fake_profile', 'underage', 'impersonation', 'offensive_profile', 'off_platform_solicitation', 'ban_evasion', 'other');

-- CreateEnum
CREATE TYPE "AccessReasonCode" AS ENUM ('active_report_investigation', 'user_appeal', 'scam_investigation', 'impersonation_investigation', 'safety_escalation', 'legal_compliance', 'quality_review', 'other');

-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('open', 'reviewing', 'upheld', 'reduced', 'reversed', 'dismissed');

-- AlterTable
ALTER TABLE "Report" ADD COLUMN "assignedAdminUserId" TEXT;

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "identityProviderSubject" TEXT,
    "status" "AdminUserStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminRole" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUserRole" (
    "adminUserId" TEXT NOT NULL,
    "adminRoleId" TEXT NOT NULL,
    "assignedByAdminUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminUserRole_pkey" PRIMARY KEY ("adminUserId","adminRoleId")
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuthChallenge" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuthChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "banType" "BanType" NOT NULL,
    "status" "BanStatus" NOT NULL DEFAULT 'active',
    "reasonCode" "ReasonCode" NOT NULL,
    "internalNote" TEXT,
    "userFacingExplanation" TEXT,
    "bannedByAdminUserId" TEXT NOT NULL,
    "bannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "unbannedByAdminUserId" TEXT,
    "unbannedAt" TIMESTAMP(3),
    "unbanReason" TEXT,
    "requireVerificationOnUnban" BOOLEAN NOT NULL DEFAULT false,
    "requireProfileReviewOnUnban" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "UserBan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationAction" (
    "id" TEXT NOT NULL,
    "targetUserId" TEXT,
    "targetProfileId" TEXT,
    "targetPhotoId" TEXT,
    "targetMessageId" TEXT,
    "reportId" TEXT,
    "actionType" "ModerationDecision" NOT NULL,
    "reasonCode" "ReasonCode" NOT NULL,
    "internalNote" TEXT,
    "userFacingExplanation" TEXT,
    "createdByAdminUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminNote" (
    "id" TEXT NOT NULL,
    "targetUserId" TEXT,
    "targetReportId" TEXT,
    "body" TEXT NOT NULL,
    "createdByAdminUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "AdminNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SensitiveAccessGrant" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "targetEntityType" "SensitiveEntityType" NOT NULL,
    "targetEntityId" TEXT NOT NULL,
    "reason" "AccessReasonCode" NOT NULL,
    "note" TEXT,
    "reportId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SensitiveAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "adminRoleSnapshot" TEXT NOT NULL,
    "eventType" "AdminEventType" NOT NULL,
    "targetEntityType" TEXT,
    "targetEntityId" TEXT,
    "accessReason" "AccessReasonCode",
    "reportId" TEXT,
    "moderationActionId" TEXT,
    "sensitiveAccessGrantId" TEXT,
    "requestId" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appeal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userBanId" TEXT NOT NULL,
    "userExplanation" TEXT NOT NULL,
    "status" "AppealStatus" NOT NULL DEFAULT 'open',
    "decidedByAdminUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appeal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Report_assignedAdminUserId_idx" ON "Report"("assignedAdminUserId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_identityProviderSubject_key" ON "AdminUser"("identityProviderSubject");

-- CreateIndex
CREATE INDEX "AdminUser_status_idx" ON "AdminUser"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AdminRole_name_key" ON "AdminRole"("name");

-- CreateIndex
CREATE INDEX "AdminUserRole_adminRoleId_idx" ON "AdminUserRole"("adminRoleId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_refreshToken_key" ON "AdminSession"("refreshToken");

-- CreateIndex
CREATE INDEX "AdminSession_adminUserId_idx" ON "AdminSession"("adminUserId");

-- CreateIndex
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminAuthChallenge_tokenHash_key" ON "AdminAuthChallenge"("tokenHash");

-- CreateIndex
CREATE INDEX "AdminAuthChallenge_email_idx" ON "AdminAuthChallenge"("email");

-- CreateIndex
CREATE INDEX "AdminAuthChallenge_expiresAt_idx" ON "AdminAuthChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "UserBan_userId_status_idx" ON "UserBan"("userId", "status");

-- CreateIndex
CREATE INDEX "UserBan_status_expiresAt_idx" ON "UserBan"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ModerationAction_targetUserId_idx" ON "ModerationAction"("targetUserId");

-- CreateIndex
CREATE INDEX "ModerationAction_reportId_idx" ON "ModerationAction"("reportId");

-- CreateIndex
CREATE INDEX "ModerationAction_createdAt_idx" ON "ModerationAction"("createdAt");

-- CreateIndex
CREATE INDEX "AdminNote_targetUserId_idx" ON "AdminNote"("targetUserId");

-- CreateIndex
CREATE INDEX "AdminNote_targetReportId_idx" ON "AdminNote"("targetReportId");

-- CreateIndex
CREATE INDEX "SensitiveAccessGrant_adminUserId_expiresAt_idx" ON "SensitiveAccessGrant"("adminUserId", "expiresAt");

-- CreateIndex
CREATE INDEX "SensitiveAccessGrant_targetEntityType_targetEntityId_idx" ON "SensitiveAccessGrant"("targetEntityType", "targetEntityId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_adminUserId_createdAt_idx" ON "AdminAuditLog"("adminUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_eventType_createdAt_idx" ON "AdminAuditLog"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_targetEntityType_targetEntityId_createdAt_idx" ON "AdminAuditLog"("targetEntityType", "targetEntityId", "createdAt");

-- CreateIndex
CREATE INDEX "Appeal_userId_idx" ON "Appeal"("userId");

-- CreateIndex
CREATE INDEX "Appeal_status_createdAt_idx" ON "Appeal"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_assignedAdminUserId_fkey" FOREIGN KEY ("assignedAdminUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminUserRole" ADD CONSTRAINT "AdminUserRole_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminUserRole" ADD CONSTRAINT "AdminUserRole_adminRoleId_fkey" FOREIGN KEY ("adminRoleId") REFERENCES "AdminRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminUserRole" ADD CONSTRAINT "AdminUserRole_assignedByAdminUserId_fkey" FOREIGN KEY ("assignedByAdminUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuthChallenge" ADD CONSTRAINT "AdminAuthChallenge_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBan" ADD CONSTRAINT "UserBan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBan" ADD CONSTRAINT "UserBan_bannedByAdminUserId_fkey" FOREIGN KEY ("bannedByAdminUserId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBan" ADD CONSTRAINT "UserBan_unbannedByAdminUserId_fkey" FOREIGN KEY ("unbannedByAdminUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_createdByAdminUserId_fkey" FOREIGN KEY ("createdByAdminUserId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNote" ADD CONSTRAINT "AdminNote_targetReportId_fkey" FOREIGN KEY ("targetReportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNote" ADD CONSTRAINT "AdminNote_createdByAdminUserId_fkey" FOREIGN KEY ("createdByAdminUserId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SensitiveAccessGrant" ADD CONSTRAINT "SensitiveAccessGrant_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_userBanId_fkey" FOREIGN KEY ("userBanId") REFERENCES "UserBan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_decidedByAdminUserId_fkey" FOREIGN KEY ("decidedByAdminUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
