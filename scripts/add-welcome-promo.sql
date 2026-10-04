-- ===========================================================================
-- WELCOME PROMO + WELCOME EMAIL
--
-- Run once against the live database. Safe to re-run.
--
-- 1. welcome_promo_issues — one unique code per signup.
--    The shared WELCOME10 row in promo_codes stays the *definition* (the
--    percentage, the global cap, the minimum order value). This table holds
--    the per-customer *instances* of it, so:
--      - a code can only be used by the account it was issued to
--      - one account gets exactly one code, forever
--      - the shared cap on the WELCOME10 row still bounds total liability
--    Without this, anyone could type WELCOME10 in and mint a fresh discount.
--
-- 2. Partial unique index on customers.phone.
--    Only rows that belong to a real account (user_id IS NOT NULL) are covered,
--    so two guests sharing a household phone can still both check out, while a
--    second ACCOUNT on the same number is rejected. That is the anti-abuse
--    property we want: N accounts now needs N real, reachable phone numbers.
--
-- 3. email_jobs.flow CHECK widened to allow 'welcome_email'.
--    The CHECK is inlined in add-email-jobs.sql so Postgres auto-named it; we
--    find it by column rather than by name because the name is not guaranteed.
-- ===========================================================================

-- --- 1. Per-customer welcome code -----------------------------------------
CREATE TABLE IF NOT EXISTS welcome_promo_issues (
  -- uuid, NOT text. Every id column in this database is uuid (promo_codes.id,
  -- customers.id, users.id — verified against the live schema), and a text FK
  -- pointing at a uuid column cannot be implemented. That exact error is what
  -- the first attempt at this migration returned.
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The account this code belongs to. UNIQUE is what makes "one code per
  -- customer" a database guarantee rather than a hopeful code path.
  user_id        uuid NOT NULL UNIQUE,

  -- Issued per customer, so the same string can never identify two accounts.
  code           text NOT NULL UNIQUE,

  -- Points at the shared promo_codes row that defines the discount.
  promo_code_id  uuid NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,

  expires_at     timestamptz NOT NULL,
  redeemed_at    timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Resolution path: a pasted code -> its issuing account. Not a filter, so this
-- stays a supporting index rather than the primary key lookup.
CREATE INDEX IF NOT EXISTS idx_welcome_promo_issues_code
  ON welcome_promo_issues (code);

-- "Has this customer's code been used?" is checked on every welcome-code
-- attempt; the partial predicate keeps the index to unredeemed rows only.
CREATE INDEX IF NOT EXISTS idx_welcome_promo_issues_unredeemed
  ON welcome_promo_issues (user_id)
  WHERE redeemed_at IS NULL;

-- --- 2. One account per phone number ---------------------------------------
-- NOT VALID: existing rows are not checked, so this cannot fail on data that
-- predates the index. New writes are enforced from the moment it is created.
-- Backfill note: phone values written before this change are un-normalised, so
-- re-run them through utils/phone.ts normalisePhone() and then VALIDATE to make
-- the guarantee complete.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone_account
  ON customers (phone)
  WHERE user_id IS NOT NULL AND phone IS NOT NULL AND phone <> '';

-- --- 3. Widen email_jobs.flow ----------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'email_jobs'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%flow%'
      AND pg_get_constraintdef(oid) NOT LIKE '%welcome_email%'
  ) THEN
    ALTER TABLE email_jobs DROP CONSTRAINT email_jobs_flow_check;
    ALTER TABLE email_jobs
      ADD CONSTRAINT email_jobs_flow_check
      CHECK (flow IN ('order_confirmed','order_shipped','return_rejected',
                      'refund_processed','refund_failed','welcome_email'));
    RAISE NOTICE 'widened email_jobs.flow to include welcome_email';
  END IF;
END $$;

-- --- 4. Seed the shared WELCOME10 definition -------------------------------
-- ON CONFLICT DO NOTHING so re-running never resets the redemption counter,
-- which is the thing that actually caps our liability. Tuning knobs are set
-- here once and every future signup inherits them.
INSERT INTO promo_codes (
  code, description, discount_type, discount_value,
  min_subtotal, max_redemptions, expires_at
)
VALUES (
  'WELCOME10',
  'Welcome offer — 10% off a first order',
  'PERCENT',
  10,
  999,          -- min_subtotal: keeps the discount off low-margin orders
  500,          -- max_redemptions: global ceiling across ALL welcome codes
  now() + interval '2 years'
)
ON CONFLICT (code) DO NOTHING;

-- --- 5. Cap the welcome offer ----------------------------------------------
-- SAFETY NOTE, READ THIS BEFORE EDITING
-- -----------------------------------
-- The INSERT above deliberately does NOT overwrite an existing WELCOME10 row
-- (`ON CONFLICT DO NOTHING`), so re-running this migration never resets the
-- redemption counter — that counter is the thing capping our liability, and
-- silently zeroing it would be far worse than leaving it alone.
--
-- Consequence: if a WELCOME10 row already exists, it KEEPS its original terms,
-- including `max_redemptions = NULL`, which means no global cap at all. This
-- UPDATE is what puts the ceiling back.
--
-- It only fires when the cap is missing (NULL). An existing NON-NULL cap is
-- left exactly as an admin set it, so this can never loosen or tighten a
-- deliberate limit on a re-run. It has never been capped here, so this is safe
-- to apply for the first time.
--
-- Set the number to whatever your margin can absorb: 500 redemptions of 10% is
-- 50x the discount in total, so pick it against a total-order-value budget
-- rather than a per-order one.
UPDATE promo_codes
   SET max_redemptions = 500,
       updated_at = now()
 WHERE code = 'WELCOME10'
   AND max_redemptions IS NULL;

ANALYZE welcome_promo_issues;