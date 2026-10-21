// scripts/run-migration.ts — applies migrations/001_hardening_items.sql
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import { readFileSync } from 'fs';
import { sql } from 'drizzle-orm';
import { parseStatements } from './lib/parse-sql';

async function main() {
  const { db } = await import('../utils/db');
  const migrationSQL = readFileSync('migrations/001_hardening_items.sql', 'utf-8');
  const statements = parseStatements(migrationSQL);

  console.log(`Running ${statements.length} SQL statements...`);
  let ok = 0, skipped = 0, failed = 0;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.replace(/\s+/g, ' ').substring(0, 70);
    try {
      await db.execute(sql.raw(stmt));
      ok++;
      console.log(`  ✓ [${i + 1}/${statements.length}] ${preview}`);
    } catch (e: any) {
      const msg: string = e.message || '';
      if (msg.includes('already exists') || msg.includes('duplicate')) {
        skipped++;
        console.log(`  ⚠ [${i + 1}/${statements.length}] skipped (already exists): ${preview}`);
      } else {
        failed++;
        console.error(`  ✗ [${i + 1}/${statements.length}] FAILED: ${preview}`);
        console.error(`    ${msg.split('\n')[0]}`);
      }
    }
  }

  console.log(`\nDone: ${ok} executed, ${skipped} skipped, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});