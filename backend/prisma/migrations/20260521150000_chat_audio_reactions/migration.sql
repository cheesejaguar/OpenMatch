-- Communication-features depth: voice-note columns on Message and a
-- MessageReaction table for emoji reactions. See backend/prisma/schema.prisma
-- for the model definitions.

ALTER TABLE "Message" ADD COLUMN "audioPath" TEXT;
ALTER TABLE "Message" ADD COLUMN "audioCdnUrl" TEXT;
ALTER TABLE "Message" ADD COLUMN "audioDurationMs" INTEGER;

CREATE TABLE "MessageReaction" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageReaction_messageId_userId_emoji_key"
    ON "MessageReaction"("messageId", "userId", "emoji");

CREATE INDEX "MessageReaction_messageId_idx"
    ON "MessageReaction"("messageId");

ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "Message"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
