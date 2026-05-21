-- Trust & safety automation scaffolding.
--
-- Adds:
--   * VerificationRequest         — selfie-pose + (stub) phone/id requests
--   * ModerationFlag              — heuristic moderator output queue
--   * Profile.isPhotoVerified     — admin-set verification badge
--   * ProfilePhoto.clientFlaggedAt — iOS on-device pre-check hint
--   * ProfilePhoto.scanReasons    — per-photo moderation explanations

-- ---------- enums ----------
CREATE TYPE "VerificationRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired');
CREATE TYPE "VerificationRequestKind" AS ENUM ('selfie_pose', 'phone', 'id_document');
CREATE TYPE "ModerationSurface" AS ENUM ('bio', 'message', 'display_name', 'photo_caption');
CREATE TYPE "ModerationDecisionKind" AS ENUM ('allow', 'flag', 'block');

-- ---------- Profile column ----------
ALTER TABLE "Profile"
  ADD COLUMN "isPhotoVerified" BOOLEAN NOT NULL DEFAULT false;

-- ---------- ProfilePhoto columns ----------
ALTER TABLE "ProfilePhoto"
  ADD COLUMN "clientFlaggedAt" TIMESTAMP(3),
  ADD COLUMN "scanReasons"     JSONB;

-- ---------- VerificationRequest ----------
CREATE TABLE "VerificationRequest" (
    "id"                  TEXT NOT NULL,
    "userId"              TEXT NOT NULL,
    "kind"                "VerificationRequestKind" NOT NULL DEFAULT 'selfie_pose',
    "status"              "VerificationRequestStatus" NOT NULL DEFAULT 'pending',
    "challengePrompt"     TEXT NOT NULL,
    "challengeNonce"      TEXT NOT NULL,
    "imageStorageKey"     TEXT,
    "imageContentType"    TEXT,
    "imageBytes"          INTEGER,
    "reviewerAdminUserId" TEXT,
    "reviewedAt"          TIMESTAMP(3),
    "decisionNote"        TEXT,
    "provider"            TEXT,
    "providerExternalRef" TEXT,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VerificationRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VerificationRequest_challengeNonce_key"
  ON "VerificationRequest"("challengeNonce");
CREATE INDEX "VerificationRequest_userId_status_idx"
  ON "VerificationRequest"("userId", "status");
CREATE INDEX "VerificationRequest_status_createdAt_idx"
  ON "VerificationRequest"("status", "createdAt");
CREATE INDEX "VerificationRequest_kind_status_idx"
  ON "VerificationRequest"("kind", "status");
ALTER TABLE "VerificationRequest"
  ADD CONSTRAINT "VerificationRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- ModerationFlag ----------
CREATE TABLE "ModerationFlag" (
    "id"                    TEXT NOT NULL,
    "targetUserId"          TEXT NOT NULL,
    "surface"               "ModerationSurface" NOT NULL,
    "decision"              "ModerationDecisionKind" NOT NULL,
    "reasonCode"            TEXT NOT NULL,
    "excerpt"               TEXT,
    "provider"              TEXT NOT NULL DEFAULT 'heuristic',
    "details"               JSONB,
    "targetMessageId"       TEXT,
    "targetProfileId"       TEXT,
    "resolvedAt"            TIMESTAMP(3),
    "resolvedByAdminUserId" TEXT,
    "resolution"            TEXT,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModerationFlag_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ModerationFlag_targetUserId_createdAt_idx"
  ON "ModerationFlag"("targetUserId", "createdAt");
CREATE INDEX "ModerationFlag_surface_decision_createdAt_idx"
  ON "ModerationFlag"("surface", "decision", "createdAt");
CREATE INDEX "ModerationFlag_resolvedAt_idx"
  ON "ModerationFlag"("resolvedAt");
ALTER TABLE "ModerationFlag"
  ADD CONSTRAINT "ModerationFlag_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
