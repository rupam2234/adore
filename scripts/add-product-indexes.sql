-- Performance indexes for the product read paths.
--
-- Applied to the live database (the schema in utils/schema.ts declares these
-- too, but no drizzle-kit migration pipeline exists in this repo — this file
-- is the runnable record for other environments, e.g. production).
--
-- Note for large tables: run these with CONCURRENTLY on a live/replicated
-- database to avoid holding an ACCESS EXCLUSIVE lock during the build.
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

-- product_images had NO index on product_id, so every product page and every
-- listing card resolved its images aggregate via a sequential scan. This is
-- the largest of the product tables, so it degrades fastest with catalog size.
CREATE INDEX IF NOT EXISTS idx_product_images_product_id
  ON product_images (product_id);

-- All product-page/listing subqueries filter `WHERE product_id = ? AND
-- is_active` (colors, sizes, variants, total_stock, and the min-price LATERAL).
-- `price` as the third column lets the LATERAL's `ORDER BY price ASC LIMIT 1`
-- be satisfied by the index order, removing both the Sort and the is_active
-- Filter node from the plan.
CREATE INDEX IF NOT EXISTS idx_product_variants_product_active
  ON product_variants (product_id, is_active, price);
