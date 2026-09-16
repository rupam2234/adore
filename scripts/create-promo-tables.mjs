import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  const envPath = join(__dirname, "..", ".env.local");
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {}

const sql = neon(process.env.adore_DATABASE_URL);

await sql`
  CREATE TABLE IF NOT EXISTS promo_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    description text,
    discount_type text NOT NULL CHECK (discount_type IN ('PERCENT', 'FIXED')),
    discount_value numeric(10, 2) NOT NULL CHECK (discount_value > 0),
    min_subtotal numeric(10, 2),
    max_redemptions integer,
    redemption_count integer NOT NULL DEFAULT 0,
    starts_at timestamptz,
    expires_at timestamptz,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )
`;

await sql`
  ALTER TABLE carts
  ADD COLUMN IF NOT EXISTS promo_code_id uuid REFERENCES promo_codes(id) ON DELETE SET NULL
`;

await sql`
  CREATE TABLE IF NOT EXISTS promo_redemptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    promo_code_id uuid NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
  )
`;

await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS promo_redemptions_code_user_key
  ON promo_redemptions (promo_code_id, user_id)
`;

console.log("promo tables ready");