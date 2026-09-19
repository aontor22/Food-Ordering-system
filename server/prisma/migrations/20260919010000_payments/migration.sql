-- CreateTable
CREATE TABLE "Payment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "transactionId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "gatewaySessionId" TEXT,
  "gatewayTransactionId" TEXT,
  "validationId" TEXT,
  "failureReason" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" DATETIME,
  "paidAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "orderId" TEXT NOT NULL,
  CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Payment_transactionId_key" ON "Payment"("transactionId");
CREATE UNIQUE INDEX "Payment_orderId_key" ON "Payment"("orderId");
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");
