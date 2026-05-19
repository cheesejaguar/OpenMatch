-- Round 4A backend gap-fill:
--   - PushDeliveryLog    (OPS-1)
--   - AlertFired         (MON-2)
--   - WaitlistEntry      (BETA-3)
--
-- All additive. No existing column dropped or retyped.

-- CreateTable: PushDeliveryLog
CREATE TABLE "PushDeliveryLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT,
    "category" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "failureReason" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushDeliveryLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PushDeliveryLog_userId_sentAt_idx" ON "PushDeliveryLog"("userId", "sentAt");
CREATE INDEX "PushDeliveryLog_category_sentAt_idx" ON "PushDeliveryLog"("category", "sentAt");
CREATE INDEX "PushDeliveryLog_success_sentAt_idx" ON "PushDeliveryLog"("success", "sentAt");

ALTER TABLE "PushDeliveryLog"
  ADD CONSTRAINT "PushDeliveryLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: AlertFired
CREATE TABLE "AlertFired" (
    "id" TEXT NOT NULL,
    "alertKey" TEXT NOT NULL,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "details" JSONB,

    CONSTRAINT "AlertFired_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AlertFired_alertKey_firedAt_idx" ON "AlertFired"("alertKey", "firedAt");
CREATE INDEX "AlertFired_alertKey_resolvedAt_idx" ON "AlertFired"("alertKey", "resolvedAt");

-- CreateTable: WaitlistEntry
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "country" TEXT,
    "city" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WaitlistEntry_emailHash_key" ON "WaitlistEntry"("emailHash");
CREATE INDEX "WaitlistEntry_country_idx" ON "WaitlistEntry"("country");
CREATE INDEX "WaitlistEntry_createdAt_idx" ON "WaitlistEntry"("createdAt");
