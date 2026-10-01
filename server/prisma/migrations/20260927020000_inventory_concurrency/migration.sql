-- Step 11: stronger inventory controls, option-level stock, audit ledger and checkout idempotency.
-- Additive migration: existing product stock and order data are preserved.

ALTER TABLE "Product"
  ADD COLUMN "lowStockThreshold" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "maxPerOrder" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN "inventoryVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ProductOptionGroup"
  ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ProductOption"
  ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "trackStock" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "stock" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "inventoryVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Order"
  ADD COLUMN "checkoutRequestId" TEXT;

CREATE TABLE "InventoryAdjustment" (
  "id" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "quantityDelta" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "note" TEXT,
  "sourceType" TEXT NOT NULL DEFAULT 'ADMIN',
  "sourceId" TEXT,
  "actorId" TEXT,
  "actorLabel" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "productId" TEXT NOT NULL,
  "optionId" TEXT,
  CONSTRAINT "InventoryAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Order_checkoutRequestId_key" ON "Order"("checkoutRequestId");
DROP INDEX IF EXISTS "ProductOptionGroup_productId_isAvailable_sortOrder_idx";
DROP INDEX IF EXISTS "ProductOption_groupId_isAvailable_sortOrder_idx";
CREATE INDEX "Product_isAvailable_stock_idx" ON "Product"("isAvailable", "stock");
CREATE INDEX "ProductOptionGroup_productId_isArchived_isAvailable_sortOrder_idx" ON "ProductOptionGroup"("productId", "isArchived", "isAvailable", "sortOrder");
CREATE INDEX "ProductOption_groupId_isArchived_isAvailable_sortOrder_idx" ON "ProductOption"("groupId", "isArchived", "isAvailable", "sortOrder");
CREATE INDEX "ProductOption_trackStock_stock_idx" ON "ProductOption"("trackStock", "stock");
CREATE INDEX "InventoryAdjustment_productId_createdAt_idx" ON "InventoryAdjustment"("productId", "createdAt");
CREATE INDEX "InventoryAdjustment_optionId_createdAt_idx" ON "InventoryAdjustment"("optionId", "createdAt");
CREATE INDEX "InventoryAdjustment_sourceType_sourceId_idx" ON "InventoryAdjustment"("sourceType", "sourceId");
CREATE INDEX "InventoryAdjustment_createdAt_idx" ON "InventoryAdjustment"("createdAt");

ALTER TABLE "InventoryAdjustment"
  ADD CONSTRAINT "InventoryAdjustment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryAdjustment_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "ProductOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_stock_nonnegative" CHECK ("stock" >= 0),
  ADD CONSTRAINT "Product_lowStockThreshold_nonnegative" CHECK ("lowStockThreshold" >= 0),
  ADD CONSTRAINT "Product_maxPerOrder_positive" CHECK ("maxPerOrder" >= 1),
  ADD CONSTRAINT "Product_inventoryVersion_nonnegative" CHECK ("inventoryVersion" >= 0);

ALTER TABLE "ProductOption"
  ADD CONSTRAINT "ProductOption_stock_nonnegative" CHECK ("stock" >= 0),
  ADD CONSTRAINT "ProductOption_lowStockThreshold_nonnegative" CHECK ("lowStockThreshold" >= 0),
  ADD CONSTRAINT "ProductOption_inventoryVersion_nonnegative" CHECK ("inventoryVersion" >= 0);

ALTER TABLE "InventoryAdjustment"
  ADD CONSTRAINT "InventoryAdjustment_balanceAfter_nonnegative" CHECK ("balanceAfter" >= 0),
  ADD CONSTRAINT "InventoryAdjustment_targetType_valid" CHECK ("targetType" IN ('PRODUCT', 'OPTION')),
  ADD CONSTRAINT "InventoryAdjustment_sourceType_valid" CHECK ("sourceType" IN ('ADMIN', 'ORDER', 'CANCELLATION', 'SYSTEM'));
