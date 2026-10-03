-- Email outbox: the durable record that an email still needs sending.
--
-- Idempotent â€” safe to run more than once.
--
-- WHY A TABLE AND NOT JUST A QUEUE
-- ---------------------------------
-- Two failure modes lose mail when email is sent inline from a request:
--
--   1. The process dies after the order commits but before the send finishes.
--      Nothing retries and nothing remembers, so the email is gone.
--   2. Resend accepts the request and then the response times out. A naive
--      retry sends the customer TWO order confirmations.
--
-- So the job is written here FIRST and sent later by a worker. This row is the
-- ledger; the queue (Vercel Queues) is only the courier that says "go look". If
-- a queue message is lost, the daily backstop cron still finds the row.
--
-- `dedupe_key` is the second half of the guard. It is UNIQUE, so the same
-- logical email can only ever be enqueued once, and it is also sent to Resend
-- as the `Idempotency-Key` header so that at-least-once delivery cannot produce
-- a duplicate either.
--
-- This is the outbound twin of `webhook_events`, which solves the same problem
-- for INBOUND provider events.
--
-- Pairs with emailJobs in utils/schema.ts; keep the two in sync.

CREATE TABLE IF NOT EXISTS email_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Closed set of templates. Kept as literals so a typo cannot enqueue a job
  -- that can never be dispatched.
  flow         text NOT NULL
                 CHECK (flow IN ('order_confirmed','order_shipped',
                                 'return_rejected','refund_processed',
                                 'refund_failed')),

  -- `to` is a reserved word in Postgres (GRANT ... TO), so it is quoted
  -- everywhere it appears as a column name.
  "to"         text NOT NULL,

  -- Everything the template needs, so a retry never has to re-derive it.
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- '<flow>/<entity-id>', e.g. 'order_confirmed/AD-1001'. UNIQUE, and also used
  -- as Resend's idempotency key.
  dedupe_key   text NOT NULL UNIQUE,

  status       text NOT NULL DEFAULT 'PENDING'
                 -- SENDING = claimed by a worker and in flight. The claim query
                 -- only selects PENDING, so a second worker cannot pick up a row
                 -- the first is already sending. A SENDING row older than a few
                 -- minutes means the worker died, and the drain requeues it.
                 CHECK (status IN ('PENDING','SENDING','SENT','FAILED','DEAD')),

  -- Incremented on CLAIM, not on failure, so a worker that dies mid-send still
  -- burns an attempt and the job eventually reaches DEAD instead of retrying
  -- forever.
  attempts     integer NOT NULL DEFAULT 0,

  -- Backoff target: a failed job is not due again until this passes.
  next_attempt_at timestamptz NOT NULL DEFAULT now(),

  -- Resend's message id, so a later delivery/bounce webhook can find the job.
  provider_id  text,

  last_error   text,

  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz
);

-- The claim query's exact predicate. Partial, so it stays small even after the
-- table fills up with SENT history â€” the common case by far.
CREATE INDEX IF NOT EXISTS idx_email_jobs_due
  ON email_jobs (next_attempt_at)
  WHERE status = 'PENDING';

-- Lets the Resend bounce webhook resolve provider_id -> job.
CREATE INDEX IF NOT EXISTS idx_email_jobs_provider
  ON email_jobs (provider_id)
  WHERE provider_id IS NOT NULL;

-- The daily backstop cron reports the oldest unsent job to catch a stall.
CREATE INDEX IF NOT EXISTS idx_email_jobs_created
  ON email_jobs (created_at)
  WHERE status = 'PENDING';

-- ---------------------------------------------------------------------------
-- MIGRATION: add the SENDING status
-- ---------------------------------------------------------------------------
-- SENDING was added AFTER the table first shipped. `CREATE TABLE IF NOT
-- EXISTS` is a no-op on an existing table, so a database that already has
-- email_jobs would otherwise keep the old CHECK and every claim would fail with
-- a constraint violation (verified: this exact error occurred).
--
-- Dropping and re-adding the CHECK is the only way to widen an enum-like CHECK,
-- and it is cheap: no rows are touched.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'email_jobs_status_check'
      AND pg_get_constraintdef(oid) NOT LIKE '%SENDING%'
  ) THEN
    ALTER TABLE email_jobs DROP CONSTRAINT email_jobs_status_check;
    ALTER TABLE email_jobs
      ADD CONSTRAINT email_jobs_status_check
      CHECK (status IN ('PENDING','SENDING','SENT','FAILED','DEAD'));
    RAISE NOTICE 'widened email_jobs.status to include SENDING';
  END IF;
END $$;

-- Statistics, because this table will be written on every order and read by the
-- claim query. Run once after creating it.
ANALYZE email_jobs;

