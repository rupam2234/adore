-- Newsletter subscribers table (footer signup form).
--
-- Run manually / via your migration step:
--   psql "$adore_DATABASE_URL" -f scripts/add-newsletter.sql
--
-- SAFE TO RE-RUN: uses IF NOT EXISTS. Mirrors utils/schema.ts
-- (newsletterSubscribers) — keep the two in sync.
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id               text PRIMARY KEY,
  email            text NOT NULL UNIQUE,
  source           text NOT NULL DEFAULT 'footer',
  unsubscribed_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Cheap admin lookup: "who signed up recently?"
CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_created
  ON newsletter_subscribers (created_at DESC);