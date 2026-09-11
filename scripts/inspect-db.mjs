import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

// Minimal .env.local loader (dotenv isn't installed)
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*"?([^"\r]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const sql = neon(process.env.adore_DATABASE_URL);

const cols = await sql`
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'products'
  ORDER BY ordinal_position`;
console.log("products columns:", cols.map((c) => c.column_name).join(", "));

const slug = "floral-meadow";
const related = await sql`
  SELECT p.slug, p.name
  FROM products p
  WHERE p.status = 'ACTIVE'
    AND p.slug != ${slug}
    AND EXISTS (
      SELECT 1
      FROM product_categories pc
      WHERE pc.product_id = p.id
        AND pc.category_id IN (
          SELECT pc2.category_id
          FROM product_categories pc2
          JOIN products p2 ON p2.id = pc2.product_id
          WHERE p2.slug = ${slug}
        )
    )
  ORDER BY p.is_featured DESC, p.created_at DESC
  LIMIT 4`;

console.log("related (category match):", JSON.stringify(related));

const all = await sql`
  SELECT slug FROM products WHERE status = 'ACTIVE' AND slug != ${slug} LIMIT 4`;
console.log("all active products (fallback):", JSON.stringify(all));

const cats = await sql`
  SELECT p.slug, c.slug AS category
  FROM product_categories pc
  JOIN products p ON p.id = pc.product_id
  JOIN categories c ON c.id = pc.category_id
  LIMIT 10`;
console.log("product->category rows:", JSON.stringify(cats));

