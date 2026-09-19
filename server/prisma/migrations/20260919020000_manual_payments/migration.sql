ALTER TABLE "Payment" ADD COLUMN "manualDestination" TEXT;
CREATE TABLE "ManualPaymentChannel" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "account" TEXT NOT NULL,
  "instructions" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE TABLE "ManualPaymentSubmission" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "reference" TEXT NOT NULL,
  "referenceKey" TEXT NOT NULL,
  "sender" TEXT NOT NULL,
  "note" TEXT,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
  "reviewNote" TEXT,
  "reviewedBy" TEXT,
  "reviewedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paymentId" TEXT NOT NULL,
  CONSTRAINT "ManualPaymentSubmission_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ManualPaymentSubmission_referenceKey_key" ON "ManualPaymentSubmission"("referenceKey");
CREATE INDEX "ManualPaymentSubmission_paymentId_createdAt_idx" ON "ManualPaymentSubmission"("paymentId", "createdAt");
