ALTER TABLE "RestaurantSetting" ADD COLUMN "customerCancelWindowMinutes" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "RestaurantSetting" ADD COLUMN "scheduledCancelLeadMinutes" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "Order" ADD COLUMN "cancellationReason" TEXT;
ALTER TABLE "Order" ADD COLUMN "cancelledBy" TEXT;
ALTER TABLE "RestaurantSetting" ADD CONSTRAINT "RestaurantSetting_customerCancelWindowMinutes_check" CHECK ("customerCancelWindowMinutes" >= 0 AND "customerCancelWindowMinutes" <= 120);
ALTER TABLE "RestaurantSetting" ADD CONSTRAINT "RestaurantSetting_scheduledCancelLeadMinutes_check" CHECK ("scheduledCancelLeadMinutes" >= 0 AND "scheduledCancelLeadMinutes" <= 10080);
ALTER TABLE "Order" ADD COLUMN "cancellationRequestedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "cancellationRequestReason" TEXT;
CREATE INDEX "Order_cancellationRequestedAt_idx" ON "Order"("cancellationRequestedAt");
