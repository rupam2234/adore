-- Admin notifications: widen the email_jobs.flow CHECK to include the two
-- internal notification flows. Idempotent — safe to run more than once.
--
-- The flow CHECK is enum-like, so widening it requires DROP + ADD; no rows are
-- touched. Without this migration the enqueue of 'admin_new_order' /
-- 'admin_new_signup' violates the CHECK and is silently swallowed by the
-- outbox's error handling: the code ships, the email never exists.
--
-- Run: node scripts/apply-sql.mjs add-admin-notifications.sql --confirm
-- Pairs with EmailFlow in utils/schema.ts; keep the two in sync.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'email_jobs'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%flow%'
      AND pg_get_constraintdef(oid) NOT LIKE '%admin_new_order%'
  ) THEN
    ALTER TABLE email_jobs DROP CONSTRAINT email_jobs_flow_check;
    ALTER TABLE email_jobs
      ADD CONSTRAINT email_jobs_flow_check
      CHECK (flow IN ('order_confirmed','order_shipped','return_rejected',
                      'refund_processed','refund_failed','welcome_email',
                      'admin_new_order','admin_new_signup'));
    RAISE NOTICE 'widened email_jobs.flow to include admin notifications';
  END IF;
END $$;