-- Beta launch infrastructure: invite-code cohort gating, feature flags,
-- metro geo-fence, push device tokens, analytics events, beta feedback.
--
-- Closes BETA-1, BETA-2, OPS-2 from docs/launch/REPORT_CARD.md.
-- See also docs/launch/REPORT_CARD.md change log for the PR that ships this.

-- AlterEnum: AdminEventType — new event types for the admin surfaces
-- this migration introduces (beta invites, feature flags, metros,
-- feedback resolution).
ALTER TYPE "AdminEventType" ADD VALUE IF NOT EXISTS 'beta_invite_created';
ALTER TYPE "AdminEventType" ADD VALUE IF NOT EXISTS 'beta_invite_revoked';
ALTER TYPE "AdminEventType" ADD VALUE IF NOT EXISTS 'feature_flag_updated';
ALTER TYPE "AdminEventType" ADD VALUE IF NOT EXISTS 'feature_flag_created';
ALTER TYPE "AdminEventType" ADD VALUE IF NOT EXISTS 'metro_created';
ALTER TYPE "AdminEventType" ADD VALUE IF NOT EXISTS 'metro_updated';
ALTER TYPE "AdminEventType" ADD VALUE IF NOT EXISTS 'feedback_resolved';

-- CreateTable: BetaInviteCode
CREATE TABLE "BetaInviteCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "cohortLabel" TEXT NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdByAdminUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BetaInviteCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BetaInviteCode_code_key" ON "BetaInviteCode"("code");
CREATE INDEX "BetaInviteCode_cohortLabel_idx" ON "BetaInviteCode"("cohortLabel");
CREATE INDEX "BetaInviteCode_revokedAt_idx" ON "BetaInviteCode"("revokedAt");

-- CreateTable: BetaInviteRedemption
CREATE TABLE "BetaInviteRedemption" (
    "id" TEXT NOT NULL,
    "inviteCodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BetaInviteRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BetaInviteRedemption_userId_key" ON "BetaInviteRedemption"("userId");
CREATE INDEX "BetaInviteRedemption_inviteCodeId_idx" ON "BetaInviteRedemption"("inviteCodeId");

-- CreateTable: FeatureFlag
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT NOT NULL,
    "variants" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByAdminUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_key_key" ON "FeatureFlag"("key");
CREATE INDEX "FeatureFlag_key_idx" ON "FeatureFlag"("key");

-- CreateTable: MetroBoundary
CREATE TABLE "MetroBoundary" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "centerLat" DOUBLE PRECISION NOT NULL,
    "centerLng" DOUBLE PRECISION NOT NULL,
    "radiusKm" DOUBLE PRECISION NOT NULL,
    "countryCode" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetroBoundary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetroBoundary_slug_key" ON "MetroBoundary"("slug");
CREATE INDEX "MetroBoundary_active_idx" ON "MetroBoundary"("active");

-- CreateTable: NotificationDevice
CREATE TABLE "NotificationDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "appVersion" TEXT,
    "osVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDevice_userId_token_key" ON "NotificationDevice"("userId", "token");
CREATE INDEX "NotificationDevice_userId_idx" ON "NotificationDevice"("userId");

-- CreateTable: AnalyticsEvent
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "eventName" TEXT NOT NULL,
    "properties" JSONB,
    "clientTs" TIMESTAMP(3),
    "serverTs" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appVersion" TEXT,
    "osVersion" TEXT,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsEvent_eventName_serverTs_idx" ON "AnalyticsEvent"("eventName", "serverTs");
CREATE INDEX "AnalyticsEvent_userId_serverTs_idx" ON "AnalyticsEvent"("userId", "serverTs");

-- CreateTable: BetaFeedback
CREATE TABLE "BetaFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "category" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "appVersion" TEXT,
    "osVersion" TEXT,
    "deviceModel" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByAdminUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BetaFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BetaFeedback_resolvedAt_idx" ON "BetaFeedback"("resolvedAt");
CREATE INDEX "BetaFeedback_userId_idx" ON "BetaFeedback"("userId");

-- AddForeignKey
ALTER TABLE "BetaInviteCode" ADD CONSTRAINT "BetaInviteCode_createdByAdminUserId_fkey" FOREIGN KEY ("createdByAdminUserId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BetaInviteRedemption" ADD CONSTRAINT "BetaInviteRedemption_inviteCodeId_fkey" FOREIGN KEY ("inviteCodeId") REFERENCES "BetaInviteCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BetaInviteRedemption" ADD CONSTRAINT "BetaInviteRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationDevice" ADD CONSTRAINT "NotificationDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BetaFeedback" ADD CONSTRAINT "BetaFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
