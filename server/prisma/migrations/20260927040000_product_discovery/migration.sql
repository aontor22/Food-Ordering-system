-- Step 13: explicit dietary attributes for customer discovery filters.
-- All fields default to false so existing products remain visible and unchanged
-- until an administrator classifies them.
ALTER TABLE "Product"
  ADD COLUMN "isVegetarian" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isVegan" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isHalal" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isGlutenFree" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Product_isVegetarian_isAvailable_idx" ON "Product"("isVegetarian", "isAvailable");
CREATE INDEX "Product_isVegan_isAvailable_idx" ON "Product"("isVegan", "isAvailable");
CREATE INDEX "Product_isHalal_isAvailable_idx" ON "Product"("isHalal", "isAvailable");
CREATE INDEX "Product_isGlutenFree_isAvailable_idx" ON "Product"("isGlutenFree", "isAvailable");
