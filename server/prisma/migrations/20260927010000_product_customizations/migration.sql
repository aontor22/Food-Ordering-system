-- Step 10: product variants/sizes, add-ons and immutable order-item customization snapshots.
CREATE TABLE "ProductOptionGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ADDON',
    "minSelections" INTEGER NOT NULL DEFAULT 0,
    "maxSelections" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "productId" TEXT NOT NULL,
    CONSTRAINT "ProductOptionGroup_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductOptionGroup_kind_check" CHECK ("kind" IN ('VARIANT', 'ADDON')),
    CONSTRAINT "ProductOptionGroup_selection_bounds_check" CHECK ("minSelections" >= 0 AND "maxSelections" >= 1 AND "minSelections" <= "maxSelections"),
    CONSTRAINT "ProductOptionGroup_variant_max_check" CHECK ("kind" <> 'VARIANT' OR "maxSelections" = 1)
);

CREATE TABLE "ProductOption" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceDeltaCents" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "groupId" TEXT NOT NULL,
    CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductOption_price_delta_check" CHECK ("priceDeltaCents" >= 0)
);

ALTER TABLE "OrderItem" ADD COLUMN "baseUnitPriceCents" INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN "customizationsJson" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "specialInstructions" TEXT;
UPDATE "OrderItem" SET "baseUnitPriceCents" = "unitPriceCents" WHERE "baseUnitPriceCents" IS NULL;
ALTER TABLE "OrderItem" ALTER COLUMN "baseUnitPriceCents" SET NOT NULL;

CREATE INDEX "ProductOptionGroup_productId_isAvailable_sortOrder_idx" ON "ProductOptionGroup"("productId", "isAvailable", "sortOrder");
CREATE INDEX "ProductOption_groupId_isAvailable_sortOrder_idx" ON "ProductOption"("groupId", "isAvailable", "sortOrder");

ALTER TABLE "ProductOptionGroup" ADD CONSTRAINT "ProductOptionGroup_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProductOptionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
