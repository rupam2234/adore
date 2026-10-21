// scripts/add-idempotency-key.ts
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import { sql } from 'drizzle-orm';

async function main() {
  const { db } = await import('../utils/db');
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;`);
  console.log('idempotency_key column added');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});