-- SSLCOMMERZ production reconciliation and refund metadata.
ALTER TABLE "Payment"
  ADD COLUMN "gatewayRiskLevel" INTEGER,
  ADD COLUMN "gatewayRiskTitle" TEXT,
  ADD COLUMN "gatewayCardType" TEXT,
  ADD COLUMN "gatewayCardIssuer" TEXT,
  ADD COLUMN "lastGatewayCheckAt" TIMESTAMP(3),
  ADD COLUMN "refundStatus" TEXT,
  ADD COLUMN "refundReferenceId" TEXT,
  ADD COLUMN "refundTransactionId" TEXT,
  ADD COLUMN "refundAmountCents" INTEGER,
  ADD COLUMN "refundReason" TEXT,
  ADD COLUMN "refundRequestedAt" TIMESTAMP(3),
  ADD COLUMN "refundedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Payment_refundReferenceId_key" ON "Payment"("refundReferenceId");
CREATE UNIQUE INDEX "Payment_refundTransactionId_key" ON "Payment"("refundTransactionId");
