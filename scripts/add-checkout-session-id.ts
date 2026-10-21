// scripts/add-checkout-session-id.ts
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import { sql } from 'drizzle-orm';

async function main() {
  const { db } = await import('../utils/db');
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS checkout_session_id TEXT;`);
  console.log('checkout_session_id column added');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});