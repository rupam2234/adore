import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import { sql } from 'drizzle-orm';

// Dynamically import db after env is loaded
async function main() {
  const { db } = await import('../utils/db');
  console.log('Applying zero-total migration...');
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS zero_total BOOLEAN NOT NULL DEFAULT FALSE;`);
  console.log('✓ zero_total column ensured');
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_verified BOOLEAN NOT NULL DEFAULT FALSE;`);
  console.log('✓ payment_verified column ensured');
  console.log('Migration complete');
  process.exit(0);
}

main().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});