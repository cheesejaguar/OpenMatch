-- CreateEnum
CREATE TYPE "Handedness" AS ENUM ('right', 'left', 'center');

-- AlterTable
ALTER TABLE "Preferences" ADD COLUMN "handedness" "Handedness" NOT NULL DEFAULT 'right';
