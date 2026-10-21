-- Migration: Hardening Items Database Schema Changes
-- Run this against your production PostgreSQL database
-- Compatible with PostgreSQL 13+

-- 1. Orders table additions for zero-total flow and idempotency
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS zero_total BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS payment_verified BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS checkout_session_id TEXT,
    ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

-- 2. Idempotency keys table for checkout deduplication
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Cron idempotency keys table (for cron job deduplication)
CREATE TABLE IF NOT EXISTS cron_idempotency_keys (
    request_id UUID PRIMARY KEY,
    endpoint TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Cron audit log table (for monitoring and alerting)
CREATE TABLE IF NOT EXISTS cron_audit_log (
    run_id UUID PRIMARY KEY,
    endpoint TEXT NOT NULL,
    order_ids JSONB NOT NULL,
    status TEXT NOT NULL, -- 'success', 'none', 'failure'
    duration_ms INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Helpful indexes for performance
CREATE INDEX IF NOT EXISTS idx_orders_zero_total ON orders(zero_total) WHERE zero_total = true;
CREATE INDEX IF NOT EXISTS idx_orders_payment_verified ON orders(payment_verified) WHERE payment_verified = false;
CREATE INDEX IF NOT EXISTS idx_orders_checkout_session ON orders(checkout_session_id) WHERE checkout_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cron_audit_log_created ON cron_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_idempotency_created ON cron_idempotency_keys(created_at);

-- 6. Optional: Clean up function for old cron records (can be called by pg_cron or scheduled job)
-- Run manually or schedule via pg_cron: SELECT cleanup_old_cron_records();
CREATE OR REPLACE FUNCTION cleanup_old_cron_records()
RETURNS void AS $$
BEGIN
    -- Delete idempotency keys older than 24 hours
    DELETE FROM cron_idempotency_keys
    WHERE created_at < NOW() - INTERVAL '24 hours';

    -- Delete audit logs older than 90 days
    DELETE FROM cron_audit_log
    WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;

-- Verification queries (run after migration to verify)
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'orders' AND column_name IN ('zero_total', 'payment_verified', 'idempotency_key', 'checkout_session_id', 'retry_count', 'next_retry_at');

-- SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('idempotency_keys', 'cron_idempotency_keys', 'cron_audit_log');