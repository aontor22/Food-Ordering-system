-- Step 20: stable public product URLs for SEO/social sharing.
ALTER TABLE "Product" ADD COLUMN "slug" TEXT;

-- Existing rows receive deterministic, readable and guaranteed-unique slugs.
-- New products use the application slug allocator after this migration.
WITH normalized AS (
  SELECT
    "id",
    COALESCE(
      NULLIF(
        regexp_replace(
          regexp_replace(lower(trim("name")), '[^a-z0-9]+', '-', 'g'),
          '(^-+|-+$)', '', 'g'
        ),
        ''
      ),
      'product'
    ) AS base_slug,
    row_number() OVER (ORDER BY "id") AS sequence_number
  FROM "Product"
)
UPDATE "Product" AS product
SET "slug" = normalized.base_slug || '-p-' || normalized.sequence_number
FROM normalized
WHERE normalized."id" = product."id";

ALTER TABLE "Product" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");
