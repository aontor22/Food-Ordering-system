ALTER TABLE "Order"
  ADD COLUMN "statusUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "preparingAt" TIMESTAMP(3),
  ADD COLUMN "readyAt" TIMESTAMP(3),
  ADD COLUMN "outForDeliveryAt" TIMESTAMP(3),
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "estimatedReadyAt" TIMESTAMP(3),
  ADD COLUMN "estimatedDeliveryAt" TIMESTAMP(3);

CREATE INDEX "Order_statusUpdatedAt_idx" ON "Order"("statusUpdatedAt");

CREATE TABLE "OrderTrackingEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL DEFAULT 'STATUS',
  "status" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "note" TEXT,
  "actorType" TEXT NOT NULL DEFAULT 'SYSTEM',
  "actorLabel" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "orderId" TEXT NOT NULL,
  CONSTRAINT "OrderTrackingEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "OrderTrackingEvent_orderId_createdAt_idx" ON "OrderTrackingEvent"("orderId", "createdAt");

-- Give existing orders one truthful starting point instead of inventing a full historical path.
INSERT INTO "OrderTrackingEvent" ("id", "kind", "status", "title", "note", "actorType", "createdAt", "orderId")
SELECT
  'legacy_' || "id",
  'STATUS',
  "status",
  CASE "status"
    WHEN 'PENDING' THEN 'Order placed'
    WHEN 'CONFIRMED' THEN 'Order confirmed'
    WHEN 'PREPARING' THEN 'Food is being prepared'
    WHEN 'READY_FOR_PICKUP' THEN 'Ready for pickup'
    WHEN 'OUT_FOR_DELIVERY' THEN 'Out for delivery'
    WHEN 'DELIVERED' THEN 'Order completed'
    WHEN 'CANCELLED' THEN 'Order cancelled'
    ELSE 'Order status updated'
  END,
  'Imported from the existing order record during live-tracking upgrade.',
  'SYSTEM',
  "updatedAt",
  "id"
FROM "Order";

UPDATE "Order" SET
  "statusUpdatedAt" = "updatedAt",
  "confirmedAt" = CASE WHEN "status" IN ('CONFIRMED','PREPARING','READY_FOR_PICKUP','OUT_FOR_DELIVERY','DELIVERED') THEN "updatedAt" ELSE NULL END,
  "preparingAt" = CASE WHEN "status" IN ('PREPARING','READY_FOR_PICKUP','OUT_FOR_DELIVERY','DELIVERED') THEN "updatedAt" ELSE NULL END,
  "readyAt" = CASE WHEN "status" IN ('READY_FOR_PICKUP','OUT_FOR_DELIVERY','DELIVERED') THEN "updatedAt" ELSE NULL END,
  "outForDeliveryAt" = CASE WHEN "status" IN ('OUT_FOR_DELIVERY','DELIVERED') THEN "updatedAt" ELSE NULL END,
  "deliveredAt" = CASE WHEN "status" = 'DELIVERED' THEN "updatedAt" ELSE NULL END,
  "cancelledAt" = CASE WHEN "status" = 'CANCELLED' THEN "updatedAt" ELSE NULL END;
