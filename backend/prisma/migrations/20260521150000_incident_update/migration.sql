-- Status-page incident timeline. Append-only stream of updates; the
-- most recent row per `incidentKey` is the authoritative current
-- state, older rows form the human-readable timeline.

CREATE TYPE "IncidentStatus" AS ENUM ('investigating', 'identified', 'monitoring', 'resolved');
CREATE TYPE "IncidentSeverity" AS ENUM ('none', 'minor', 'major', 'critical');

-- Audit log enum extension — `incident_update_posted` is written every
-- time an admin posts a status update from the admin dashboard.
ALTER TYPE "AdminEventType" ADD VALUE IF NOT EXISTS 'incident_update_posted';

CREATE TABLE "IncidentUpdate" (
    "id"          TEXT NOT NULL,
    "incidentKey" TEXT NOT NULL,
    "title"       TEXT NOT NULL,
    "body"        TEXT NOT NULL,
    "status"      "IncidentStatus" NOT NULL,
    "severity"    "IncidentSeverity" NOT NULL DEFAULT 'minor',
    "service"     TEXT NOT NULL DEFAULT 'backend',
    "postedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedBy"    TEXT,

    CONSTRAINT "IncidentUpdate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IncidentUpdate_incidentKey_postedAt_idx" ON "IncidentUpdate"("incidentKey", "postedAt");
CREATE INDEX "IncidentUpdate_postedAt_idx" ON "IncidentUpdate"("postedAt");
CREATE INDEX "IncidentUpdate_status_postedAt_idx" ON "IncidentUpdate"("status", "postedAt");
