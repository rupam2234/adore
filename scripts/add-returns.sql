-- add-returns.sql
-- Adds the schema the returns / exchanges flow needs.
--
-- Mirrored in utils/schema.ts (the declarative Drizzle schema). No drizzle-kit
-- migration pipeline exists in this repo, so this file is the runnable record —
-- same convention as add-product-weight.sql and add-product-indexes.sql.
--
-- Safety: every statement is additive and idempotent (IF NOT EXISTS / guarded
-- DO block). Nothing drops, truncates or rewrites existing data, so it is safe
-- to run more than once and safe to run against a live database.
--
-- Verified against production on 2026-10-02: orders had 4 rows (all PENDING),
-- so ALTER TABLE holds its lock for a negligible instant. Re-check that count
-- before running against a large dataset.

-- 1. Delivery timestamp.
--    Without this there is no way to enforce a return window: the policy is
--    "N days from the date of delivery", and orders only ever recorded
--    created_at. Populated from the Shiprocket webhook on the DELIVERED event.
--    Nullable on purpose — existing orders have no trustworthy delivery date.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

-- 2. Returned quantity per order line.
--    The unit of return is the order LINE, not the order: a customer may keep
--    one dress and return the kurti. Tracking returns here (rather than
--    mutating order_items.quantity) is what allows partial returns, and it
--    closes the "open three requests for one physical item" exploit — the
--    application enforces returned_qty + returned <= quantity.
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS returned_qty integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_items_returned_qty_nonneg'
  ) THEN
    ALTER TABLE order_items
      ADD CONSTRAINT order_items_returned_qty_nonneg CHECK (returned_qty >= 0);
  END IF;
END $$;

-- 3. The return_requests table.
--    status is an explicit enum with a terminal REJECTED so abuse handling is
--    a state we can see, not merely an absent row.
CREATE TABLE IF NOT EXISTS return_requests (
  id                    text PRIMARY KEY,
  order_id              uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id         uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  customer_id           uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  type                  text NOT NULL CHECK (type IN ('RETURN','EXCHANGE')),
  reason                text NOT NULL,
  status                text NOT NULL DEFAULT 'REQUESTED'
                          CHECK (status IN ('REQUESTED','APPROVED','PICKUP_SCHEDULED',
                                            'IN_TRANSIT','RECEIVED','QC_PASSED',
                                            'QC_FAILED','REFUNDED','REJECTED',
                                            'CANCELLED')),

  qty                   integer NOT NULL DEFAULT 1 CHECK (qty > 0),
  -- Set when type = 'EXCHANGE': the variant being sent instead.
  exchange_variant_id   uuid REFERENCES product_variants(id) ON DELETE SET NULL,

  -- Fee the customer owes. Computed server-side from utils/returns.ts, never
  -- trusted from the client.
  fee                   numeric(10,2) NOT NULL DEFAULT 0 CHECK (fee >= 0),
  -- Snapshot of what we refund, so later price/cart edits cannot change it.
  refund_amount         numeric(10,2) NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),

  -- Reverse logistics. The original AWB raises the return with Shiprocket.
  shiprocket_awb        text,
  shiprocket_return_awb text,
  pickup_attempts       integer NOT NULL DEFAULT 0,
  self_ship             boolean NOT NULL DEFAULT false,

  -- Damage/wrong-item evidence. The application REQUIRES photos for these
  -- reasons; they are what makes a 48-hour damage claim verifiable.
  photos                jsonb,

  -- Populated when status = REJECTED. Shown to the customer verbatim.
  rejection_reason      text,

  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  resolved_at           timestamptz
);

-- Customer-facing list: newest first, scoped per account.
CREATE INDEX IF NOT EXISTS idx_return_requests_customer
  ON return_requests (customer_id, created_at DESC);

-- Admin queue: oldest open requests first, filtered by state.
CREATE INDEX IF NOT EXISTS idx_return_requests_status
  ON return_requests (status, created_at);

-- One order line may have several requests over time (a re-exchange after a QC
-- failure) but never two OPEN ones — that stops double-claiming a line.
CREATE UNIQUE INDEX IF NOT EXISTS idx_return_requests_open_unique
  ON return_requests (order_item_id)
  WHERE status NOT IN ('REJECTED','CANCELLED','REFUNDED');


-- 4. Refund ledger.
--    Partial refunds need rows, not a status flip: an order with one returned
--    item is still partly paid. razorpay_refund_id is UNIQUE so a retried
--    webhook can never double-refund — Razorpay would treat the second call as
--    a brand new refund and the money would leave the account twice.
CREATE TABLE IF NOT EXISTS refunds (
  id                   text PRIMARY KEY,
  return_request_id    text NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
  order_id             uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,

  razorpay_refund_id   text UNIQUE,
  amount               numeric(10,2) NOT NULL CHECK (amount > 0),
  currency             text NOT NULL DEFAULT 'INR',
  reason               text,
  status               text NOT NULL DEFAULT 'PENDING'
                         CHECK (status IN ('PENDING','PROCESSED','FAILED')),

  created_at           timestamptz NOT NULL DEFAULT now(),
  processed_at         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_refunds_return_request
  ON refunds (return_request_id);

-- ===========================================================================
-- PHASE 2 — the operational half of the returns flow.
--
-- Phase 1 (above) models the REQUEST. This file adds everything needed to
-- actually service it: an append-only event log, the money-settlement guard,
-- fraud signals, and the states the courier integration needs.
--
-- Same safety contract as phase 1: additive and idempotent, safe to re-run.
-- ===========================================================================

-- 1. return_events — the audit log.
--    Every state change lands here, append-only. Three jobs:
--      a) forensics after a disputed refund ("who approved this, when");
--      b) the customer-facing timeline without a second table;
--      c) a reliable source for "has this already been settled?" — the row
--         count, not a status column, is the idempotency proof.
--    `actor` records WHO (admin email, 'system:shiprocket-webhook', 'customer'),
--    so an action taken by our own automation is never mistaken for a human.
CREATE TABLE IF NOT EXISTS return_events (
  id                  text PRIMARY KEY,
  return_request_id   text NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
  event               text NOT NULL,
  from_status         text,
  to_status           text,
  actor               text NOT NULL DEFAULT 'system',
  -- Free-form, machine-readable payload. Never rendered raw to customers.
  data                jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_return_events_request
  ON return_events (return_request_id, created_at DESC);

-- 2. Net money columns.
--    `refund_amount` is the gross snapshot taken at request time. The amount we
--    actually send back is net of the fee, and must never go below zero — a
--    refund that pays the customer money on a small order is a pure loss.
--    Storing the net figure separately means a later fee change can never
--    retroactively alter what we already agreed to pay.
ALTER TABLE return_requests
  ADD COLUMN IF NOT EXISTS net_refund        numeric(10,2),
  ADD COLUMN IF NOT EXISTS payout_amount     numeric(10,2),
  ADD COLUMN IF NOT EXISTS settled_at        timestamptz,
  -- Exchange fulfilment: the Shiprocket order that ships the replacement.
  ADD COLUMN IF NOT EXISTS exchange_shiprocket_order_id text;

-- The states the courier + settlement integration needs. Phase 1's CHECK did
-- not include them, so the constraint has to be replaced (DROP + re-ADD is the
-- only way to alter a CHECK in Postgres).
--
-- New states:
--   PICKUP_FAILED     rider could not collect; attempt budget may be exhausted
--   SELF_SHIP_PENDING customer was told to self-ship; we are waiting on them
--   REFUND_PENDING    money claimed, Razorpay call in flight (crash-safe)
--   REFUND_FAILED     Razorpay rejected/failed; retryable, not terminal
--   EXCHANGE_SHIPPED  replacement dispatched to the customer
--   EXCHANGE_FAILED   we could not fulfil the replacement (out of stock)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'return_requests_status_check'
  ) THEN
    ALTER TABLE return_requests DROP CONSTRAINT return_requests_status_check;
  END IF;

  ALTER TABLE return_requests ADD CONSTRAINT return_requests_status_check
    CHECK (status IN (
      'REQUESTED','APPROVED','PICKUP_SCHEDULED','PICKUP_FAILED',
      'SELF_SHIP_PENDING','IN_TRANSIT','RECEIVED','QC_PASSED','QC_FAILED',
      'EXCHANGE_SHIPPED','EXCHANGE_FAILED',
      'REFUND_PENDING','REFUNDED','REFUND_FAILED','REJECTED','CANCELLED'
    ));
END $$;

-- 3. Fraud signals, persisted.
--    `risk_score` is advisory (it reorders the admin queue). `is_blocked` is
--    the hard stop, and it is deliberately a separate column so that raising
--    the score threshold can never start blocking customers by accident.
ALTER TABLE return_requests
  ADD COLUMN IF NOT EXISTS risk_score  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS risk_reasons jsonb,
  ADD COLUMN IF NOT EXISTS is_blocked  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocked_reason text,
  -- Set once the reverse pickup has consumed its attempt budget.
  ADD COLUMN IF NOT EXISTS pickup_exhausted boolean NOT NULL DEFAULT false;

-- 4. Customer-level abuse ledger.
--    The per-request score is a snapshot; this is the durable record that
--    survives and lets us refuse a NEW order from a serial-returner.
--    Deliberately a separate table so the blast radius of a bug here is one
--    extra table rather than the customers table.
CREATE TABLE IF NOT EXISTS customer_risk (
  customer_id      uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  -- Lifetime approved return count.
  total_returns    integer NOT NULL DEFAULT 0,
  -- Lifetime rupees refunded to this customer.
  total_refunded   numeric(12,2) NOT NULL DEFAULT 0,
  -- Rolling-90-day window, recomputed on each touch.
  recent_returns   integer NOT NULL DEFAULT 0,
  recent_value     numeric(12,2) NOT NULL DEFAULT 0,
  -- Orders declined for abuse signals. One decline is noise; three is a
  -- pattern worth refusing service over.
  declined_orders  integer NOT NULL DEFAULT 0,
  chargeback_count integer NOT NULL DEFAULT 0,
  is_blocked       boolean NOT NULL DEFAULT false,
  blocked_reason   text,
  notes            text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- 5. Settlement idempotency.
--    The single most expensive bug in a returns system is refunding twice.
--    Two independent guards, deliberately redundant:
--      a) `refunds.razorpay_refund_id UNIQUE` (phase 1) — blocks a duplicate
--         gateway id, but NOT a duplicate request, because two calls can
--         produce two distinct valid ids.
--      b) This partial unique index — at most ONE non-failed refund row per
--         return request. The second concurrent claim collides here and loses,
--         *before* any money moves. This is the real guard.
CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_one_per_return
  ON refunds (return_request_id)
  WHERE status <> 'FAILED';

-- 6. Chargeback / dispute register.
--    A customer who refunds an item AND raises a chargeback has taken the money
--    twice. Razorpay's dispute webhook writes here; the returns gate reads it
--    and refuses. This is the single highest-value fraud signal in the system.
CREATE TABLE IF NOT EXISTS payment_disputes (
  id             text PRIMARY KEY,
  razorpay_payment_id text NOT NULL,
  order_id       uuid REFERENCES orders(id) ON DELETE CASCADE,
  amount         numeric(10,2) NOT NULL DEFAULT 0,
  reason         text,
  status         text NOT NULL DEFAULT 'OPEN'
                   CHECK (status IN ('OPEN','LOST','WON','WITHDRAWN')),
  -- Whether we won the dispute. A LOST dispute means the customer got the money
  -- back via the bank while also keeping/returning the goods.
  won            boolean,
  created_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_disputes_payment
  ON payment_disputes (razorpay_payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_disputes_payment_open
  ON payment_disputes (razorpay_payment_id)
  WHERE status = 'OPEN';

-- 7. Webhook replay guard.
--    Shiprocket retries. A retried DELIVERED event must not restart the return
--    window, and a retried refund event must not re-trigger settlement. Every
--    inbound event id is recorded; a duplicate is acknowledged and dropped.
CREATE TABLE IF NOT EXISTS webhook_events (
  id              text PRIMARY KEY,
  provider        text NOT NULL,
  event_type      text NOT NULL,
  -- True once a handler has committed its side effects.
  processed       boolean NOT NULL DEFAULT false,
  payload         jsonb,
  error           text,
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_pending
  ON webhook_events (provider, received_at)
  WHERE NOT processed;

-- ===========================================================================
-- PHASE 3 — defence in depth: enforce terminality in the DATABASE.
-- ===========================================================================

-- 8. Terminal states are terminal, enforced by Postgres.
--
-- FINDING from the returns-flow verification (script since removed): before this
-- trigger, a plain
-- `UPDATE return_requests SET status = 'REFUND_PENDING' WHERE status = 'REFUNDED'`
-- SUCCEEDED. The status CHECK constrains which VALUES are legal, not which
-- TRANSITIONS are — so the "REFUNDED has no exits" rule lived only in
-- utils/returns-state.ts. That is one layer, and a single layer guarding the
-- business's bank balance is not enough: a bad migration, a future code path
-- that writes raw SQL, or a direct psql session would all bypass it.
--
-- This trigger makes the rule a database invariant. The application state
-- machine is still the first line (it produces good error messages); this is the
-- line that holds when everything above it fails.
--
-- Deliberately NOT a full transition validator. Re-implementing the entire
-- graph in PL/pgSQL would duplicate a security-critical rule in two languages
-- that could silently drift. The single highest-value rule — "money does not
-- come back" — is worth encoding; the rest is enforced by compare-and-set.

-- SECURITY DEFINER is NOT used: this function must never be able to do more
-- than the calling statement already could. It only raises.
CREATE OR REPLACE FUNCTION block_terminal_return_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Terminal return request cannot change status: % -> % (id %)',
    OLD.status, NEW.status, OLD.id
    USING ERRCODE = '23514';
  -- Unreachable, but explicit: the row must not be modified.
  RETURN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'return_requests_terminal_guard'
  ) THEN
    CREATE TRIGGER return_requests_terminal_guard
      BEFORE UPDATE OF status ON return_requests
      FOR EACH ROW
      WHEN (
        OLD.status IN ('REFUNDED','REJECTED','CANCELLED')
        AND NEW.status IS DISTINCT FROM OLD.status
      )
      EXECUTE FUNCTION block_terminal_return_transition();
  END IF;
END $$;



