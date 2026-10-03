-- Performance readiness: planner statistics + FK indexes.
--
-- Idempotent — safe to run more than once.
--
-- PART A is the original product-read-path work, unchanged. PART B onwards is
-- the readiness pass added after an index audit.
--
-- WHY PART B EXISTS
-- -----------------
-- An audit of the live database found two things that are cheap to fix now and
-- expensive to fix after launch:
--
--   1. `ANALYZE` had NEVER been run. `pg_stat_user_tables.last_analyze` was NULL
--      on every table, so the planner had no row-count statistics and was
--      choosing plans from default heuristics. Dead-tuple ratios confirmed it:
--      products was 90% dead (2 live rows, 18 dead), users 87%, carts 80%.
--
--   2. Nine foreign-key columns had no index. Postgres does NOT create these
--      automatically. They matter for the lookup/join paths that use them, and
--      because an unindexed FK column forces a sequential scan of the CHILD
--      table whenever the parent row is updated or deleted.
--
-- NONE of this was slow today (every query ran in <2ms) because the database is
-- tiny. That is the point: these are for the day the catalogue and order history
-- grow, and they are far cheaper to apply now than after launch.
--
-- For production, build the indexes with CONCURRENTLY to avoid holding an
-- ACCESS EXCLUSIVE lock. CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block, so run those statements individually rather than in one
-- BEGIN/COMMIT. ANALYZE is non-blocking and safe as-is.


-- ===========================================================================
-- PART A — Product read paths (original content, unchanged)
-- ===========================================================================

-- Applied to the live database (the schema in utils/schema.ts declares these
-- too, but no drizzle-kit migration pipeline exists in this repo — this file
-- is the runnable record for other environments, e.g. production).

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


-- ===========================================================================
-- PART B — Planner statistics
-- ===========================================================================

-- Refreshes row counts, value distributions and correlations for every table.
-- Non-blocking. Run this FIRST: index decisions below only make sense once the
-- planner has real statistics, and ANALYZE is cheap enough to repeat.
ANALYZE;

-- Targeted ANALYZE on the hottest read paths. Redundant after the ANALYZE
-- above, but harmless and useful if you ever comment that one out.
ANALYZE products;
ANALYZE product_variants;
ANALYZE product_images;
ANALYZE orders;
ANALYZE sessions;


-- ===========================================================================
-- PART C — Foreign-key indexes on the lookup paths
-- ===========================================================================

-- orders.customer_id
-- Read by the account pages (/account, /account/orders, /account/orders/[id]),
-- which call listOrders(customerId) and getOrderDetail(id, customerId). This is
-- the most-used query in the account area and it currently sequential-scans.
-- Without it, a customer with a long order history pays a full table scan to
-- render their own orders.
CREATE INDEX IF NOT EXISTS idx_orders_customer_created
  ON orders (customer_id, created_at DESC);

-- orders.status
-- The admin ledger's "prep day" view selects paid/confirmed orders by status
-- and date range.
CREATE INDEX IF NOT EXISTS idx_orders_status_created
  ON orders (status, created_at DESC);

-- sessions.user_id
-- purgeExpiredSessions(userId) deletes a user's expired sessions on login, and
-- the same code caps concurrent devices. Sessions are small but this is on the
-- auth path, paid by every logged-in user.
CREATE INDEX IF NOT EXISTS idx_sessions_user_id
  ON sessions (user_id);

-- return_requests.order_id
-- The returns UI and admin queue list requests for a given order. Together with
-- the existing (customer_id, created_at) and (status, created_at) indexes this
-- covers all three access patterns on the table.
CREATE INDEX IF NOT EXISTS idx_return_requests_order
  ON return_requests (order_id);

-- promo_redemptions.user_id
-- Validated on every checkout that applies a promo (isRedeemed joins on both
-- promo_code_id and user_id). The existing unique index leads with
-- promo_code_id, so a lookup by user_id alone cannot use it.
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_user
  ON promo_redemptions (user_id);

-- payment_disputes.order_id
-- evaluateHardBlocks refuses an approval while a dispute is OPEN on the order,
-- so this is consulted during return approval, not only in the disputes view.
CREATE INDEX IF NOT EXISTS idx_disputes_order
  ON payment_disputes (order_id);

-- refunds.order_id
-- Refund reconciliation looks refunds up by order as well as by return request.
CREATE INDEX IF NOT EXISTS idx_refunds_order
  ON refunds (order_id);

-- Deliberately NOT indexed:
--   orders.promo_code_id, orders.shipping_address_id,
--   product_images.variant_id, return_requests.exchange_variant_id
-- All are written once and never used as a filter, so an index would be pure
-- write overhead.


-- ===========================================================================
-- PART D — Remove a redundant index
-- ===========================================================================

-- carts has BOTH `carts_user_id_key` (UNIQUE) and `idx_carts_user_id` on the
-- same column, added together by scripts/add-cart-user-id.sql. A unique index
-- already serves every lookup this column needs, so the second one costs a write
-- on every cart update and buys nothing.
--
-- Wrapped in a DO block so re-running this file cannot error once the index is
-- already gone. A bare DROP would fail the second run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_carts_user_id'
  ) THEN
    DROP INDEX idx_carts_user_id;
    RAISE NOTICE 'dropped redundant index idx_carts_user_id';
  END IF;
END $$;


-- ===========================================================================
-- PART E — Refresh statistics after the index work
-- ===========================================================================

ANALYZE;

-- ===========================================================================
-- VERIFICATION
-- ===========================================================================
--
-- 1. Statistics are populated (last_analyze no longer NULL):
--      SELECT relname, last_analyze FROM pg_stat_user_tables ORDER BY relname;
--
-- 2. No unindexed foreign keys remain:
--      SELECT c.conrelid::regclass AS tbl, a.attname AS col
--      FROM pg_constraint c
--      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
--      WHERE c.contype = 'f'
--        AND NOT EXISTS (SELECT 1 FROM pg_index i
--                        WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]);
--
-- Note that on a table this small the planner may still prefer a sequential
-- scan — that is CORRECT behaviour, not a missing index. The point of these
-- indexes is to remove the cliff later, when the table outgrows one page.
