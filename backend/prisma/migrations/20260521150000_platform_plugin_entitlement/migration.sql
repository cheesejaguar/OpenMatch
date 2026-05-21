-- PLATFORM-PLUGIN — record entitlements granted via POST /api/v1/iap/validate.
-- The BillingProvider interface populates this table after a receipt is
-- accepted; downstream paywall checks read from it. Unique on
-- (source, transactionId) so a replayed receipt is idempotent at the DB
-- layer in addition to the provider's own dedupe.

CREATE TABLE "Entitlement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entitlement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Entitlement_userId_expiresAt_idx" ON "Entitlement"("userId", "expiresAt");

CREATE UNIQUE INDEX "Entitlement_source_transactionId_key" ON "Entitlement"("source", "transactionId");
