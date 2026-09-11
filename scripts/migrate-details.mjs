import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

// Minimal .env.local loader (dotenv isn't installed)
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*"?([^"\r]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const sql = neon(process.env.adore_DATABASE_URL);

/**
 * Rename products.description -> products.details and convert it to a JSONB
 * array of detail lines (one bullet per line). Existing prose without newlines
 * becomes a single-element list so nothing is lost.
 */
await sql`
  ALTER TABLE products RENAME COLUMN description TO details`;
await sql`
  ALTER TABLE products
  ALTER COLUMN details TYPE jsonb
  USING to_jsonb(regexp_split_to_array(details::text, '\\n'))`;

console.log("products.description -> products.details (jsonb list) ✔");

// Show the result
const rows = await sql`SELECT slug, details FROM products LIMIT 5`;
console.log(JSON.stringify(rows, null, 2));
