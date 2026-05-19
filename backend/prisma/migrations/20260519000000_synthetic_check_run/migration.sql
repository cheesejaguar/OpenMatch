-- CreateTable
CREATE TABLE "SyntheticCheckRun" (
    "id" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "steps" JSONB NOT NULL,

    CONSTRAINT "SyntheticCheckRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyntheticCheckRun_ranAt_idx" ON "SyntheticCheckRun"("ranAt");
