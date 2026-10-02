-- add-product-text-limits.sql
--
-- Widens products.fit from varchar(50) to text.
--
-- Why: `fit` is rendered as free-form prose on the product page (utils/products.ts
-- maps it straight through), but the column was declared varchar(50). Real copy
-- overflows it — "Relaxed fit. Three-quarter bell sleeves. Side slits at the
-- hem." is 63 chars — and Postgres aborts the INSERT with SQLSTATE 22001
-- ("value too long for type character varying(50)").
--
-- The failure surfaced as a bare "Failed to create product" 500 because the
-- length limit was enforced by the database and mirrored nowhere in
-- validateProductPayload(). The only existing product happened to store "Relaxed"
-- (7 chars), so the limit was never exercised until real copy was entered.
--
-- `fit` now matches short_description / story / care_instructions, which are all
-- already unlimited `text`. Idempotent: re-running is a no-op.

ALTER TABLE products
  ALTER COLUMN fit TYPE text;

-- Guard: report the resulting limit so a run can be verified. NULL = unlimited.
SELECT character_maximum_length AS fit_max_length
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'products'
   AND column_name = 'fit';

-- Note: ALTER COLUMN ... TYPE rewrites the table and takes an ACCESS EXCLUSIVE
-- lock for the duration. On a large `products` table, or on a live/replicated
-- database, prefer adding a new column + backfill + swap instead.