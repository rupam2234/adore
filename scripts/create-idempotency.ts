import 'dotenv/config';
import { db } from '@/utils/db';
import { sql } from 'drizzle-orm';

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS cron_idempotency_keys (
      request_id uuid PRIMARY KEY,
      endpoint text NOT NULL,
      created_at timestamptz DEFAULT now()
    )
  `);
  console.log('cron_idempotency_keys table created');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});