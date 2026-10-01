ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

ALTER TABLE "Order"
  ADD COLUMN "customerType" TEXT NOT NULL DEFAULT 'REGISTERED',
  ADD COLUMN "guestAccessNonce" TEXT,
  ADD COLUMN "guestAccessExpiresAt" TIMESTAMP(3),
  ADD COLUMN "guestLinkedAt" TIMESTAMP(3),
  ALTER COLUMN "userId" DROP NOT NULL;

CREATE UNIQUE INDEX "Order_guestAccessNonce_key" ON "Order"("guestAccessNonce");
CREATE INDEX "Order_email_customerType_createdAt_idx" ON "Order"("email", "customerType", "createdAt");
CREATE INDEX "Order_guestAccessExpiresAt_idx" ON "Order"("guestAccessExpiresAt");

DROP INDEX "NotificationDelivery_userId_orderId_eventType_channel_key";
ALTER TABLE "NotificationDelivery" ALTER COLUMN "userId" DROP NOT NULL;
CREATE UNIQUE INDEX "NotificationDelivery_orderId_eventType_channel_key" ON "NotificationDelivery"("orderId", "eventType", "channel");
