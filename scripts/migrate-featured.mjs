import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local manually
try {
  const envPath = join(__dirname, "..", ".env.local");
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([\w.-]+)\s*=\s*"?([^"]*)"?$/);
    if (match) process.env[match[1]] = match[2].trim();
  }
} catch {
  // env vars may already be set
}

const sql = neon(process.env.adore_DATABASE_URL || process.env.DATABASE_URL);

async function migrate() {
  console.log("Adding is_featured column to products...");

  await sql`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_products_is_featured
    ON products (is_featured, created_at DESC)
    WHERE is_featured = TRUE
  `;

  console.log("Done. is_featured column and index added.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
