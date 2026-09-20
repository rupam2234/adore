-- add-product-weight.sql
--
-- Adds the per-product packed weight used for Shiprocket rate quotes and
-- order payloads. Applied to the live database (the schema in utils/schema.ts
-- declares this too, but no drizzle-kit migration pipeline exists in this
-- repo — this file is the runnable record for other environments).
--
-- Nullable: existing products fall back to the 400g/unit estimate until an
-- admin sets a real weight on the product form.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS weight_grams integer;