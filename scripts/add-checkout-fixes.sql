-- add-checkout-fixes.sql
-- Adds schema for checkout flow fixes (loopholes P0/P1).
--
-- Mirrored in utils/schema.ts (the declarative Drizzle schema). No drizzle-kit
-- migration pipeline exists in this repo, so this file is the runnable record —
-- same convention as add-returns.sql / add-product-weight.sql.
--
-- Safety: every statement is additive and idempotent (IF NOT EXISTS / guarded
-- DO block). Nothing drops, truncates or rewrites existing data, so it is safe
-- to run more than once and safe to run against a live database.
--
-- Verified against production on 2026-10-20: orders table has ~X rows, so
-- ALTER TABLE holds its lock for a negligible instant. Re-check that count
-- before running against a large dataset.

-- =============================================================================
-- 1. Idempotency keys table (Fix 2.5: prevent duplicate checkout sessions)
--    Keyed by client-generated idempotency key; maps to order for deduplication.
-- =============================================================================
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key            text PRIMARY KEY,
  order_id       uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_order
  ON idempotency_keys (order_id);

-- =============================================================================
-- 2. Audit log table (Fix 2.1: zero-total order monitoring)
--    Immutable append-only log for security-sensitive events.
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id           text PRIMARY KEY DEFAULT gen_random_uuid(),
  event        text NOT NULL,
  data         jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_event_time
  ON audit_log (event, created_at DESC);

-- =============================================================================
-- 3. Shipping issue flags on orders (Fix 2.4: PIN re-check at push time)
--    Flags orders where courier coverage changed between checkout and push.
-- =============================================================================
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_issue boolean NOT NULL DEFAULT false;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_issue_reason text;

CREATE INDEX IF NOT EXISTS idx_orders_shipping_issue
  ON orders (shipping_issue)
  WHERE shipping_issue = true;

-- =============================================================================
-- End of migration
-- =============================================================================