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

await sql`DROP TABLE IF EXISTS cart_items`;
await sql`DROP TABLE IF EXISTS carts`;

await sql`
  CREATE TABLE carts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )
`;

await sql`
  CREATE TABLE cart_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
    created_at timestamptz NOT NULL DEFAULT now()
  )
`;

await sql`
  CREATE UNIQUE INDEX cart_items_cart_variant_key
  ON cart_items (cart_id, variant_id)
`;

console.log("cart tables ready");
