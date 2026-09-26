ALTER TABLE "Product" ADD COLUMN "imagePublicId" TEXT;
CREATE INDEX "Product_imagePublicId_idx" ON "Product"("imagePublicId");
