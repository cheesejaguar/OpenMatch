-- Modular matching algorithm: admin-curated preset catalog + per-user selection.
-- Adds the MatchingPreset catalog, a Preferences.discoveryPresetKey selection
-- column, and two audit event types. Seeds the four built-in presets that the
-- @openmatch/matching package ships (balanced is the default).

-- CreateTable
CREATE TABLE "MatchingPreset" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "weights" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByAdminUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchingPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MatchingPreset_key_key" ON "MatchingPreset"("key");

-- CreateIndex
CREATE INDEX "MatchingPreset_enabled_idx" ON "MatchingPreset"("enabled");

-- AlterTable
ALTER TABLE "Preferences" ADD COLUMN "discoveryPresetKey" TEXT;

-- AlterEnum
ALTER TYPE "AdminEventType" ADD VALUE 'matching_preset_created';
ALTER TYPE "AdminEventType" ADD VALUE 'matching_preset_updated';

-- Seed built-in presets (mirror of BUILTIN_PRESETS in matching/src/presets.ts).
INSERT INTO "MatchingPreset"
  ("id", "key", "label", "description", "strategyId", "weights", "enabled", "isDefault", "sortOrder", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'balanced', 'Balanced',
   'Our default blend — a little of everything.',
   'weighted-sum', '{}'::jsonb, true, true, 0, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'nearby-first', 'Nearby first',
   'Prioritizes people close to you.',
   'weighted-sum', '{"distance":0.45,"activity":0.1,"sharedInterests":0.08,"ageProximity":0.05}'::jsonb, true, false, 1, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'fresh-faces', 'Fresh faces',
   'Surfaces recently active profiles and people you haven''t seen.',
   'weighted-sum', '{"activity":0.32,"fairnessRotation":0.15,"randomization":0.08,"distance":0.1}'::jsonb, true, false, 2, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'serious-intent', 'Serious intent',
   'Emphasizes relationship-goal compatibility and mutual fit.',
   'reciprocal', '{"relationshipGoal":0.3,"reciprocity":0.22,"sharedInterests":0.18,"randomization":0}'::jsonb, true, false, 3, CURRENT_TIMESTAMP);
