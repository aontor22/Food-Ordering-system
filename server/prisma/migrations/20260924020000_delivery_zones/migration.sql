CREATE TABLE "DeliveryZone" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "postalCodes" TEXT,
  "feeCents" INTEGER NOT NULL DEFAULT 0,
  "minimumOrderCents" INTEGER NOT NULL DEFAULT 0,
  "freeDeliveryThresholdCents" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "DeliveryZone_name_key" ON "DeliveryZone"("name");
CREATE INDEX "DeliveryZone_active_sortOrder_idx" ON "DeliveryZone"("active", "sortOrder");

ALTER TABLE "Order"
  ADD COLUMN "deliveryZoneId" TEXT,
  ADD COLUMN "deliveryZoneName" TEXT;
