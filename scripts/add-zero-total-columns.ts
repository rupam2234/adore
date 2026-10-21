import 'dotenv/config';
import { db } from '@/utils/db';
import { sql } from 'drizzle-orm';

async function main() {
  await db.execute(sql`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS zero_total BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS payment_verified BOOLEAN DEFAULT FALSE
  `);
  console.log('zero_total and payment_verified columns ensured');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});