// scripts/check-cron-audit.ts — verify cron_audit_log has recent entries
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import { sql } from 'drizzle-orm';

async function main() {
  const { db } = await import('../utils/db');

  console.log('--- Recent cron_audit_log entries ---');
  const rows = await db.execute(sql`
    SELECT endpoint, status, duration_ms, created_at
    FROM cron_audit_log
    ORDER BY created_at DESC
    LIMIT 10
  `);
  if (!rows.rows.length) {
    console.log('  (empty — no cron runs recorded yet)');
  }
  for (const r of rows.rows as any[]) {
    console.log(
      `  ${new Date(r.created_at).toISOString()}  ${r.endpoint.padEnd(20)} ${String(r.status).padEnd(8)} ${r.duration_ms}ms`
    );
  }

  console.log('\n--- Counts by endpoint ---');
  const counts = await db.execute(sql`
    SELECT endpoint, COUNT(*)::int AS runs, SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::int AS success
    FROM cron_audit_log
    GROUP BY endpoint
  `);
  for (const r of counts.rows as any[]) {
    console.log(`  ${r.endpoint.padEnd(20)} runs=${r.runs}  success=${r.success}`);
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });