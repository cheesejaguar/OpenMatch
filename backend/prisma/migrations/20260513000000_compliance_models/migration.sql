-- Compliance models: consent, DSAR, deletion, notification prefs,
-- DSA notice-and-action, statement of reasons, out-of-court dispute,
-- hash matching, NCMEC reports, scam signals, scammer notifications,
-- law-enforcement requests, sanctions screening.
--
-- See docs/legal/compliance-roadmap.md (Workstream B).

-- CreateEnum
CREATE TYPE "ConsentScope" AS ENUM ('terms_of_service', 'privacy_notice', 'art9_processing', 'precise_location', 'marketing_email', 'marketing_push', 'marketing_sms', 'analytics', 'recommender_personalised', 'limit_use_spi');

-- CreateEnum
CREATE TYPE "DsarRequestType" AS ENUM ('access', 'deletion', 'correction', 'portability', 'restriction', 'objection', 'limit_use_spi', 'withdraw_consent');

-- CreateEnum
CREATE TYPE "DsarStatus" AS ENUM ('received', 'verifying_identity', 'in_progress', 'fulfilled', 'partially_fulfilled', 'refused', 'withdrawn');

-- CreateEnum
CREATE TYPE "DsarChannel" AS ENUM ('in_app', 'email', 'web_form', 'authorised_agent', 'regulator');

-- CreateEnum
CREATE TYPE "AccountDeletionStatus" AS ENUM ('scheduled', 'cancelled', 'in_progress', 'completed');

-- CreateEnum
CREATE TYPE "NoticeAndActionCategory" AS ENUM ('illegal_content', 'csam', 'ncii', 'copyright_dmca', 'terrorism_violent', 'hate_speech', 'privacy_violation', 'defamation', 'scam_fraud', 'underage', 'other');

-- CreateEnum
CREATE TYPE "NoticeAndActionStatus" AS ENUM ('received', 'acknowledged', 'in_review', 'actioned', 'rejected', 'withdrawn');

-- CreateEnum
CREATE TYPE "HashList" AS ENUM ('photodna', 'stopncii', 'ncmec_industry', 'internal');

-- CreateEnum
CREATE TYPE "HashAction" AS ENUM ('auto_removed', 'queued_for_review', 'dismissed');

-- CreateEnum
CREATE TYPE "NcmecReportStatus" AS ENUM ('pending', 'submitted', 'acknowledged', 'failed');

-- CreateEnum
CREATE TYPE "ScamSignalKind" AS ENUM ('rapid_offplatform_push', 'geo_mismatch', 'reverse_image_match', 'llm_generated_bio_suspected', 'payment_solicitation', 'romance_scam_pattern', 'other');

-- CreateEnum
CREATE TYPE "LERequestType" AS ENUM ('subpoena', 'court_order_2703d', 'search_warrant', 'emergency_disclosure', 'preservation_only', 'mlat', 'national_security', 'other');

-- CreateEnum
CREATE TYPE "LEStatus" AS ENUM ('received', 'under_review', 'produced', 'produced_with_objection', 'rejected', 'withdrawn');

-- CreateEnum
CREATE TYPE "SanctionsScreeningResult" AS ENUM ('cleared', 'blocked_country', 'blocked_party', 'needs_review');

-- CreateTable
CREATE TABLE "PolicyDocument" (
    "id" TEXT NOT NULL,
    "scope" "ConsentScope" NOT NULL,
    "version" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "PolicyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PolicyDocument_scope_version_key" ON "PolicyDocument"("scope", "version");

-- CreateIndex
CREATE INDEX "PolicyDocument_scope_effectiveAt_idx" ON "PolicyDocument"("scope", "effectiveAt");

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" "ConsentScope" NOT NULL,
    "policyDocumentId" TEXT,
    "granted" BOOLEAN NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "ipHash" TEXT,
    "userAgent" TEXT,
    "surface" TEXT NOT NULL,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsentRecord_userId_scope_idx" ON "ConsentRecord"("userId", "scope");

-- CreateIndex
CREATE INDEX "ConsentRecord_scope_collectedAt_idx" ON "ConsentRecord"("scope", "collectedAt");

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_policyDocumentId_fkey" FOREIGN KEY ("policyDocumentId") REFERENCES "PolicyDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "DataSubjectRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "requestType" "DsarRequestType" NOT NULL,
    "status" "DsarStatus" NOT NULL DEFAULT 'received',
    "channel" "DsarChannel" NOT NULL,
    "jurisdiction" TEXT,
    "contactEmail" TEXT,
    "identityVerifiedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "refusalReason" TEXT,
    "exportStorageKey" TEXT,
    "exportBytes" INTEGER,
    "exportFormat" TEXT,
    "handledByAdminUserId" TEXT,
    "notes" TEXT,
    "metadata" JSONB,

    CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataSubjectRequest_userId_requestType_idx" ON "DataSubjectRequest"("userId", "requestType");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_status_dueAt_idx" ON "DataSubjectRequest"("status", "dueAt");

-- AddForeignKey
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "AccountDeletionRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gracePeriodEndsAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" "AccountDeletionStatus" NOT NULL DEFAULT 'scheduled',
    "reason" TEXT,
    "contactEmailHash" TEXT,
    "retainedDataNote" TEXT,

    CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountDeletionRequest_userId_status_key" ON "AccountDeletionRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "AccountDeletionRequest_status_gracePeriodEndsAt_idx" ON "AccountDeletionRequest"("status", "gracePeriodEndsAt");

-- AddForeignKey
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productNewsEmail" BOOLEAN NOT NULL DEFAULT false,
    "productNewsPush" BOOLEAN NOT NULL DEFAULT false,
    "productNewsSms" BOOLEAN NOT NULL DEFAULT false,
    "newMatchPush" BOOLEAN NOT NULL DEFAULT true,
    "newMessagePush" BOOLEAN NOT NULL DEFAULT true,
    "newLikePush" BOOLEAN NOT NULL DEFAULT true,
    "safetyPush" BOOLEAN NOT NULL DEFAULT true,
    "pushPreviewMode" TEXT NOT NULL DEFAULT 'sender_only',
    "marketingOptInAt" TIMESTAMP(3),
    "marketingOptOutAt" TIMESTAMP(3),
    "marketingOptInSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "TrustedFlagger" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "awardedBy" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "TrustedFlagger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrustedFlagger_revokedAt_idx" ON "TrustedFlagger"("revokedAt");

-- CreateTable
CREATE TABLE "DsaStatementOfReasons" (
    "id" TEXT NOT NULL,
    "affectedUserId" TEXT,
    "affectedContentReference" TEXT NOT NULL,
    "restrictionType" TEXT NOT NULL,
    "facts" TEXT NOT NULL,
    "legalGround" TEXT,
    "legalGroundReference" TEXT,
    "contractualGround" TEXT,
    "contentType" TEXT,
    "contentLanguage" TEXT,
    "decisionSource" TEXT NOT NULL,
    "automatedDecision" BOOLEAN NOT NULL DEFAULT false,
    "redressInternal" BOOLEAN NOT NULL DEFAULT true,
    "redressOutOfCourt" BOOLEAN NOT NULL DEFAULT true,
    "redressJudicial" BOOLEAN NOT NULL DEFAULT true,
    "sentToUserAt" TIMESTAMP(3),
    "submittedToTransparencyDbAt" TIMESTAMP(3),
    "transparencyDbId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DsaStatementOfReasons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DsaStatementOfReasons_affectedUserId_idx" ON "DsaStatementOfReasons"("affectedUserId");

-- CreateIndex
CREATE INDEX "DsaStatementOfReasons_submittedToTransparencyDbAt_idx" ON "DsaStatementOfReasons"("submittedToTransparencyDbAt");

-- CreateTable
CREATE TABLE "NoticeAndActionReport" (
    "id" TEXT NOT NULL,
    "category" "NoticeAndActionCategory" NOT NULL,
    "status" "NoticeAndActionStatus" NOT NULL DEFAULT 'received',
    "reporterIsUser" BOOLEAN NOT NULL DEFAULT false,
    "reporterUserId" TEXT,
    "reporterName" TEXT,
    "reporterEmail" TEXT,
    "reporterCountry" TEXT,
    "reporterIsTrustedFlagger" BOOLEAN NOT NULL DEFAULT false,
    "trustedFlaggerId" TEXT,
    "affectedUserId" TEXT,
    "contentReference" TEXT NOT NULL,
    "contentSnapshot" JSONB,
    "description" TEXT NOT NULL,
    "isInGoodFaith" BOOLEAN NOT NULL DEFAULT true,
    "jurisdictionClaim" TEXT,
    "legalBasisClaim" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "slaDueAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "decisionId" TEXT,
    "statementOfReasonsId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "NoticeAndActionReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NoticeAndActionReport_status_slaDueAt_idx" ON "NoticeAndActionReport"("status", "slaDueAt");

-- CreateIndex
CREATE INDEX "NoticeAndActionReport_category_status_idx" ON "NoticeAndActionReport"("category", "status");

-- CreateIndex
CREATE INDEX "NoticeAndActionReport_reporterUserId_idx" ON "NoticeAndActionReport"("reporterUserId");

-- CreateIndex
CREATE INDEX "NoticeAndActionReport_affectedUserId_idx" ON "NoticeAndActionReport"("affectedUserId");

-- AddForeignKey
ALTER TABLE "NoticeAndActionReport" ADD CONSTRAINT "NoticeAndActionReport_trustedFlaggerId_fkey" FOREIGN KEY ("trustedFlaggerId") REFERENCES "TrustedFlagger"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeAndActionReport" ADD CONSTRAINT "NoticeAndActionReport_affectedUserId_fkey" FOREIGN KEY ("affectedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeAndActionReport" ADD CONSTRAINT "NoticeAndActionReport_statementOfReasonsId_fkey" FOREIGN KEY ("statementOfReasonsId") REFERENCES "DsaStatementOfReasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "OutOfCourtDispute" (
    "id" TEXT NOT NULL,
    "affectedUserId" TEXT NOT NULL,
    "relatedDecisionId" TEXT,
    "relatedAppealId" TEXT,
    "body" TEXT NOT NULL,
    "filedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ourPositionFiledAt" TIMESTAMP(3),
    "outcome" TEXT,
    "outcomeAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "OutOfCourtDispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutOfCourtDispute_affectedUserId_idx" ON "OutOfCourtDispute"("affectedUserId");

-- CreateIndex
CREATE INDEX "OutOfCourtDispute_outcome_idx" ON "OutOfCourtDispute"("outcome");

-- CreateTable
CREATE TABLE "HashSignal" (
    "id" TEXT NOT NULL,
    "targetPhotoId" TEXT,
    "targetUserId" TEXT,
    "hashAlgorithm" TEXT NOT NULL,
    "hashHex" TEXT NOT NULL,
    "matchedList" "HashList" NOT NULL,
    "matchedListEntry" TEXT,
    "action" "HashAction" NOT NULL,
    "reviewedByAdminUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HashSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HashSignal_targetPhotoId_idx" ON "HashSignal"("targetPhotoId");

-- CreateIndex
CREATE INDEX "HashSignal_targetUserId_idx" ON "HashSignal"("targetUserId");

-- CreateIndex
CREATE INDEX "HashSignal_matchedList_action_idx" ON "HashSignal"("matchedList", "action");

-- CreateIndex
CREATE INDEX "HashSignal_hashAlgorithm_hashHex_idx" ON "HashSignal"("hashAlgorithm", "hashHex");

-- CreateTable
CREATE TABLE "NcmecReport" (
    "id" TEXT NOT NULL,
    "triggerHashSignalId" TEXT,
    "affectedUserId" TEXT,
    "contentReference" TEXT NOT NULL,
    "status" "NcmecReportStatus" NOT NULL DEFAULT 'pending',
    "submittedAt" TIMESTAMP(3),
    "cybertiplineId" TEXT,
    "preservationEndsAt" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NcmecReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NcmecReport_status_submittedAt_idx" ON "NcmecReport"("status", "submittedAt");

-- CreateTable
CREATE TABLE "ScamSignal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ScamSignalKind" NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,

    CONSTRAINT "ScamSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScamSignal_userId_kind_idx" ON "ScamSignal"("userId", "kind");

-- CreateIndex
CREATE INDEX "ScamSignal_kind_createdAt_idx" ON "ScamSignal"("kind", "createdAt");

-- AddForeignKey
ALTER TABLE "ScamSignal" ADD CONSTRAINT "ScamSignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ScammerNotification" (
    "id" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "bannedUserHash" TEXT NOT NULL,
    "reasonCode" "ReasonCode" NOT NULL,
    "channel" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "ScammerNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScammerNotification_recipientUserId_sentAt_idx" ON "ScammerNotification"("recipientUserId", "sentAt");

-- AddForeignKey
ALTER TABLE "ScammerNotification" ADD CONSTRAINT "ScammerNotification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "LawEnforcementRequest" (
    "id" TEXT NOT NULL,
    "requesterAgency" TEXT NOT NULL,
    "requesterCountry" TEXT NOT NULL,
    "requestType" "LERequestType" NOT NULL,
    "externalRef" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "status" "LEStatus" NOT NULL DEFAULT 'received',
    "affectedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notesPublic" TEXT,
    "notesInternal" TEXT,
    "notifiedUserAt" TIMESTAMP(3),
    "notifiedUserSuppressed" BOOLEAN NOT NULL DEFAULT false,
    "suppressedReason" TEXT,
    "producedContent" BOOLEAN NOT NULL DEFAULT false,
    "producedScope" TEXT,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "LawEnforcementRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LawEnforcementRequest_status_dueAt_idx" ON "LawEnforcementRequest"("status", "dueAt");

-- CreateIndex
CREATE INDEX "LawEnforcementRequest_requesterCountry_idx" ON "LawEnforcementRequest"("requesterCountry");

-- CreateTable
CREATE TABLE "SanctionsScreening" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "countryCode" TEXT,
    "result" "SanctionsScreeningResult" NOT NULL,
    "listsChecked" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "matchDetails" JSONB,
    "screenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SanctionsScreening_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SanctionsScreening_userId_screenedAt_idx" ON "SanctionsScreening"("userId", "screenedAt");

-- CreateIndex
CREATE INDEX "SanctionsScreening_result_screenedAt_idx" ON "SanctionsScreening"("result", "screenedAt");

-- AddForeignKey
ALTER TABLE "SanctionsScreening" ADD CONSTRAINT "SanctionsScreening_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
