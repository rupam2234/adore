// drop-tags.mjs — DESTRUCTIVE. Drops the unused `product_tags` and `tags`
// tables, after backing up their contents to JSON and SQL.
//
// Why this is safe (verified against the live DB before writing this file):
//   - Neither table is referenced anywhere in the codebase: not in utils/schema.ts,
//     not in app/, components/, utils/ or scripts/. `tags` is not even declared
//     in schema.ts, so it is invisible to Drizzle.
//   - No table has a foreign key pointing AT product_tags or tags, so nothing
//     depends on them and nothing cascades.
//   - No views, matviews, triggers or rules reference them.
//   - The 3 product_tags rows all point at one product (Floral Meadow). The
//     category it already belongs to ("Dress") is unaffected.
//
// What is NOT recoverable from the database afterwards: the label list
// (Floral / Summer / Casual) and the link to Floral Meadow. The backup file
// holds both, and the generated .sql can be replayed to recreate the tables.
//
// Usage: node scripts/drop-tags.mjs            (dry run: prints the plan)
//        node scripts/drop-tags.mjs --confirm  (backs up, then drops)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const apply = process.argv.includes('--confirm');
const TABLES = ['product_tags', 'tags'];

/**
 * `sql.unsafe()` does NOT execute in this driver version (it returns { sql }),
 * and `sql.query()` executes and returns the rows array directly. Both quirks
 * were hit and confirmed by probing. Everything below uses sql.query().
 */
let url = process.env.adore_DATABASE_URL;
if (!url) {
  const env = readFileSync('.env.local', 'utf8');
  const line = env
    .split('\n')
    .find(l => l.trim().startsWith('adore_DATABASE_URL='));
  url = line?.split('=')[1]?.trim().replace(/^["']|["']$/g, '');
}
if (!url) throw new Error('adore_DATABASE_URL not found');

const { neon } = await import('@neondatabase/serverless');
const sql = neon(url);

// --- Re-verify the preconditions immediately before touching anything. ------
// Checking at run time rather than trusting the earlier audit, because the
// whole safety argument rests on these being true right now.
//
// Two subtleties this query had to get right, both found by watching it return
// a FALSE POSITIVE and investigating rather than overriding it:
//
//  1. pg_constraint.conrelid/ confrelid are the AUTHORITATIVE source. Joining
//     information_schema.constraint_column_usage is unreliable here because it is
//     not schema-qualified: `users.id` and `tags.id` share a constraint name, so
//     the join pulls in unrelated rows and reports a dependency that is not
//     there.
//  2. Only a table whose confrelid IS product_tags/tags blocks a drop. An
//     outgoing FK (product_tags -> tags) travels with its own table and is not a
//     dependent. Dropping product_tags first removes that edge, so tags is free
//     by the time we reach it.
const dependents = await sql.query(`
  SELECT src.relname AS dependent_table, tgt.relname AS references
  FROM pg_constraint con
  JOIN pg_class src ON src.oid = con.conrelid
  JOIN pg_class tgt ON tgt.oid = con.confrelid
  JOIN pg_namespace n ON n.oid = src.relnamespace
  WHERE con.contype = 'f'
    AND n.nspname = 'public'
    AND tgt.relname IN ('product_tags', 'tags')
    AND src.relname NOT IN ('product_tags', 'tags')`);

const views = await sql.query(`
  SELECT table_name FROM information_schema.views
  WHERE table_schema = 'public'
    AND (view_definition ILIKE '%product_tags%' OR view_definition ILIKE '%tags%')`);

const triggers = await sql.query(`
  SELECT event_object_table, trigger_name FROM information_schema.triggers
  WHERE event_object_table IN ('product_tags', 'tags')`);

console.log('=== preconditions ===');
console.log(`  tables referencing them : ${dependents.length}`);
console.log(`  views using them       : ${views.length}`);
console.log(`  triggers on them       : ${triggers.length}`);

if (dependents.length > 0 || views.length > 0 || triggers.length > 0) {
  console.error(
    '\nREFUSING TO DROP: something now depends on these tables.\n' +
      '  tables:  ' + JSON.stringify(dependents) +
      '\n  views:   ' + JSON.stringify(views) +
      '\n  triggers:' + JSON.stringify(triggers)
  );
  process.exit(1);
}
console.log('  -> nothing depends on them, dropping is safe.');

// --- Read the data out before removing it. ---------------------------------
const productTagRows = await sql.query(
  `SELECT * FROM product_tags ORDER BY product_id, tag_id`
);
const tagRows = await sql.query(`SELECT * FROM tags ORDER BY slug`);

// Which products lose their tag labels, so the console says it plainly.
const affected = await sql.query(`
  SELECT DISTINCT p.name, p.slug
  FROM product_tags pt
  JOIN products p ON p.id = pt.product_id
  ORDER BY p.slug`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');

if (!apply) {
  console.log('\n=== data that would be dropped ===');
  console.log(`  tags:          ${tagRows.length} row(s)`);
  for (const t of tagRows) console.log(`    ${t.name} (${t.slug})`);
  console.log(`  product_tags:  ${productTagRows.length} row(s)`);
  for (const pt of productTagRows) {
    const tag = tagRows.find(t => t.id === pt.tag_id);
    console.log(`    ${pt.product_id} -> ${tag?.slug ?? pt.tag_id}`);
  }
  console.log(`\n  products affected: ${affected.map(a => a.slug).join(', ') || 'none'}`);
  console.log('\nDRY RUN. Re-run with --confirm to back up and drop.');
  process.exit(0);
}

// --- Backup: JSON (readable) + SQL (replayable). ---------------------------
const jsonPath = join('scripts', `tags-backup-${stamp}.json`);
writeFileSync(
  jsonPath,
  JSON.stringify(
    {
      droppedAt: new Date().toISOString(),
      tables: { tags: tagRows, product_tags: productTagRows },
    },
    null,
    2
  ),
  'utf8'
);

// Emitting the original CREATE TABLEs is not possible (the dump is data-only),
// so the replay script recreates the shape from the schema as it was.
const sqlPath = join('scripts', `tags-restore-${stamp}.sql`);
writeFileSync(
  sqlPath,
  `-- Restores the tags tables dropped on ${new Date().toISOString()}.
-- Replay with: psql "$DATABASE_URL" -f ${sqlPath.replace(/\\/g, '/')}
--
-- Recreated from the pre-drop definition in utils/schema.ts / production.

CREATE TABLE tags (
  id   text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE
);

CREATE TABLE product_tags (
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tag_id     text NOT NULL REFERENCES tags(id)     ON DELETE CASCADE
);

INSERT INTO tags (id, name, slug) VALUES
${tagRows.map(t => `  ('${t.id}', '${t.name}', '${t.slug}')`).join(',\n') || '  -- (was empty)'};

INSERT INTO product_tags (product_id, tag_id) VALUES
${productTagRows.map(p => `  ('${p.product_id}', '${p.tag_id}')`).join(',\n') || '  -- (was empty)'};
`,
  'utf8'
);

console.log(`\n=== backed up ===`);
console.log(`  ${jsonPath}`);
console.log(`  ${sqlPath}`);

// --- Drop. product_tags first, since tags is referenced by it. --------------
// No CASCADE: with the dependents check above passing, a CASCADE here would
// only be able to destroy something we failed to detect.
for (const t of TABLES) {
  await sql.query(`DROP TABLE "${t}"`);
  console.log(`  dropped ${t}`);
}

// --- Verify. ----------------------------------------------------------------
const remaining = await sql.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name IN ('product_tags', 'tags')`);

console.log('\n=== after ===');
console.log(`  product_tags / tags still present: ${remaining.length}`);
console.log(
  `  restore with: psql "$DATABASE_URL" -f ${sqlPath.replace(/\\/g, '/')}`
);