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
  ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL
`;

await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS customers_user_id_key ON customers (user_id)
`;

await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS customers_email_key ON customers (email)
`;

await sql`
  ALTER TABLE customer_addresses
  ADD COLUMN IF NOT EXISTS full_name varchar
`;

await sql`
  ALTER TABLE customer_addresses
  ADD COLUMN IF NOT EXISTS phone varchar
`;

await sql`
  ALTER TABLE customer_addresses
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false
`;

await sql`
  ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_address_id uuid REFERENCES customer_addresses(id) ON DELETE SET NULL
`;

await sql`
  ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_address_snapshot jsonb
`;

await sql`
  ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS promo_code_id uuid REFERENCES promo_codes(id) ON DELETE SET NULL
`;

const enums = await sql.query(
  `SELECT enum_range(NULL::order_status) AS statuses`,
  [],
);
console.log("account columns ready");
console.log("order_status values:", enums.rows?.[0]?.statuses ?? enums[0]?.statuses);
