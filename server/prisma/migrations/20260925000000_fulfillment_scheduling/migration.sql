ALTER TABLE "Order"
  ADD COLUMN "fulfillmentType" TEXT NOT NULL DEFAULT 'DELIVERY',
  ADD COLUMN "fulfillmentMode" TEXT NOT NULL DEFAULT 'ASAP',
  ADD COLUMN "scheduledForLocal" TEXT,
  ADD COLUMN "scheduledDateKey" TEXT,
  ADD COLUMN "scheduledTimeKey" TEXT,
  ADD COLUMN "schedulingTimezone" TEXT,
  ADD COLUMN "pickupAddressSnapshot" TEXT,
  ADD COLUMN "pickupInstructionsSnapshot" TEXT;

ALTER TABLE "Order"
  ALTER COLUMN "street" DROP NOT NULL,
  ALTER COLUMN "city" DROP NOT NULL,
  ALTER COLUMN "state" DROP NOT NULL,
  ALTER COLUMN "postalCode" DROP NOT NULL,
  ALTER COLUMN "country" DROP NOT NULL;

CREATE INDEX "Order_fulfillmentMode_scheduledDateKey_scheduledTimeKey_idx"
  ON "Order"("fulfillmentMode", "scheduledDateKey", "scheduledTimeKey");

CREATE TABLE "FulfillmentSetting" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "deliveryEnabled" BOOLEAN NOT NULL DEFAULT true,
  "pickupEnabled" BOOLEAN NOT NULL DEFAULT true,
  "asapEnabled" BOOLEAN NOT NULL DEFAULT true,
  "scheduledEnabled" BOOLEAN NOT NULL DEFAULT true,
  "deliveryLeadMinutes" INTEGER NOT NULL DEFAULT 30,
  "pickupLeadMinutes" INTEGER NOT NULL DEFAULT 15,
  "slotIntervalMinutes" INTEGER NOT NULL DEFAULT 30,
  "daysAhead" INTEGER NOT NULL DEFAULT 7,
  "defaultSlotCapacity" INTEGER NOT NULL DEFAULT 10,
  "pickupAddress" TEXT,
  "pickupInstructions" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "FulfillmentSlotOverride" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "dateKey" TEXT NOT NULL,
  "timeKey" TEXT NOT NULL,
  "fulfillmentType" TEXT NOT NULL,
  "capacity" INTEGER,
  "disabled" BOOLEAN NOT NULL DEFAULT false,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "FulfillmentSlotOverride_dateKey_timeKey_fulfillmentType_key"
  ON "FulfillmentSlotOverride"("dateKey", "timeKey", "fulfillmentType");
CREATE INDEX "FulfillmentSlotOverride_dateKey_fulfillmentType_idx"
  ON "FulfillmentSlotOverride"("dateKey", "fulfillmentType");
