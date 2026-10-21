// scripts/cleanup-cron.ts
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import { sql } from 'drizzle-orm';

async function main() {
  const { db } = await import('../utils/db');

  console.log('🧹  Starting nightly cron cleanup…');

  // 1️⃣  Delete idempotency keys older than 24 h
  const idem = await db.execute(sql`
    DELETE FROM cron_idempotency_keys
    WHERE created_at < now() - interval '24 hours'
  `);
  console.log(`✔︎  Deleted ${idem.rowCount ?? '?'} rows from cron_idempotency_keys`);

  // 2️⃣  Delete audit‑log rows older than 90 days
  const audit = await db.execute(sql`
    DELETE FROM cron_audit_log
    WHERE created_at < now() - interval '90 days'
  `);
  console.log(`✔︎  Deleted ${audit.rowCount ?? '?'} rows from cron_audit_log`);

  console.log('🧹  Cleanup finished');
  process.exit(0);
}

main().catch((e) => {
  console.error('Cleanup failed:', e);
  process.exit(1);
});