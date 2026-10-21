// scripts/verify-schema.ts — verify hardening migration landed
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import { sql } from 'drizzle-orm';

async function main() {
  const { db } = await import('../utils/db');

  console.log('--- orders table columns ---');
  const cols = await db.execute(sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'orders'
      AND column_name IN ('zero_total','payment_verified','idempotency_key','checkout_session_id','retry_count','next_retry_at')
    ORDER BY column_name
  `);
  for (const r of cols.rows as any[]) console.log(`  ${r.column_name} (${r.data_type})`);

  console.log('\n--- tables ---');
  const tables = await db.execute(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('idempotency_keys','cron_idempotency_keys','cron_audit_log')
    ORDER BY tablename
  `);
  for (const r of tables.rows as any[]) console.log(`  ${r.tablename}`);

  console.log('\n--- indexes ---');
  const idx = await db.execute(sql`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname LIKE 'idx_cron%' OR indexname LIKE 'idx_orders_zero%' OR indexname LIKE 'idx_orders_pay%' OR indexname LIKE 'idx_orders_check%'
    ORDER BY indexname
  `);
  for (const r of idx.rows as any[]) console.log(`  ${r.indexname}`);

  console.log('\n--- cleanup function ---');
  const fn = await db.execute(sql`
    SELECT proname FROM pg_proc WHERE proname = 'cleanup_old_cron_records'
  `);
  console.log(fn.rows.length ? '  cleanup_old_cron_records() ✓' : '  ✗ NOT FOUND');

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });