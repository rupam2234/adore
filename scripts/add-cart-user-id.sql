-- Account-based carts: let a cart belong to a logged-in user.
-- idempotent — safe to run more than once.

ALTER TABLE carts ADD COLUMN IF NOT EXISTS user_id uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_carts_user_id ON carts (user_id);