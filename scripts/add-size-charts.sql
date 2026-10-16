-- add-size-charts.sql
-- Adds per-category size-chart images.
--
-- Mirrored in utils/schema.ts (the declarative Drizzle schema). No drizzle-kit
-- migration pipeline exists in this repo, so this file is the runnable record —
-- same convention as add-returns.sql / add-email-jobs.sql.
--
-- A size chart is ONE image per category (sundress, kurti, kurti set, …),
-- uploaded from the admin "Size charts" page to Cloudinary and linked here.
-- The storefront resolves a product's chart from its most specific category
-- and falls back to the parent category when the child has none — which is why
-- the columns live on `categories` and not on `products`.
--
-- The URL is stored alongside the public id (like product_images.secure_url):
-- the public id is what replace/delete act on, the URL is what <img> tags read
-- without building a delivery URL at render time.
--
-- Safety: every statement is additive and idempotent. Nothing drops, truncates
-- or rewrites existing data, so it is safe to run more than once and safe to
-- run against a live database.

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS size_chart_public_id text;

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS size_chart_url text;
