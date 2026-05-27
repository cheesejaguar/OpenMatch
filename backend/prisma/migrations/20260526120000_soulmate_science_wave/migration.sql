-- Evidence-based "soulmate science" wave.
-- Adds: Profile.values (#6), Preferences.verifiedOnly/focusMode/dealbreakers
-- (#8/#10/#5), Conversation.lastMessage* for responsiveness (#7), and the
-- DateFeedback table for the post-match outcome + two-sided feedback loop
-- (#1/#11).

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN "values" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Preferences"
  ADD COLUMN "verifiedOnly" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "focusMode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "dealbreakers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Conversation"
  ADD COLUMN "lastMessageAt" TIMESTAMP(3),
  ADD COLUMN "lastMessageSenderUserId" TEXT;

-- CreateTable
CREATE TABLE "DateFeedback" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "aboutUserId" TEXT NOT NULL,
    "met" BOOLEAN NOT NULL DEFAULT false,
    "wantToContinue" BOOLEAN,
    "respectful" BOOLEAN,
    "matchedProfile" BOOLEAN,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DateFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DateFeedback_matchId_fromUserId_key" ON "DateFeedback"("matchId", "fromUserId");

-- CreateIndex
CREATE INDEX "DateFeedback_aboutUserId_idx" ON "DateFeedback"("aboutUserId");

-- CreateIndex
CREATE INDEX "DateFeedback_createdAt_idx" ON "DateFeedback"("createdAt");

-- AddForeignKey
ALTER TABLE "DateFeedback" ADD CONSTRAINT "DateFeedback_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DateFeedback" ADD CONSTRAINT "DateFeedback_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DateFeedback" ADD CONSTRAINT "DateFeedback_aboutUserId_fkey" FOREIGN KEY ("aboutUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
