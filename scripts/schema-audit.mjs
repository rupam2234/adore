// schema-audit.mjs — READ-ONLY. Reports the live shape of the database and
// cross-checks it against the tables the application actually uses.
//
// Three questions it answers:
//   1. Which tables exist in Postgres but are never referenced in code?
//   2. Which code tables do not exist in Postgres at all?
//   3. How do `users` and `customers` actually relate, row for row?
//
// Usage: node scripts/schema-audit.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

// --- 1. What is actually in the database? ---------------------------------
const dbTables = await sql`
  SELECT table_name, COUNT(*)::int AS column_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
  GROUP BY table_name
  ORDER BY table_name`;

// Counts rows per table, in ONE round-trip.
//
// Two driver quirks are worked around here, both verified by probing:
//   - `sql.unsafe(q)` does NOT execute. It returns `{ sql: q }`, so every count
//     read as 0 on the first run of this script.
//   - `escapeIdentifier` is declared in the package's .d.ts but is not actually
//     exported by its .mjs entrypoint.
// So the counts are built as a single UNION ALL and run as a tagged template,
// with each identifier double-quoted after strict validation. The names come
// from information_schema, never from user input.
const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

const countParts = dbTables.map(t => {
  if (!SAFE_IDENT.test(t.table_name)) {
    throw new Error(`refusing to count unexpected table name: ${t.table_name}`);
  }
  return `SELECT '${t.table_name}' AS t, COUNT(*)::int AS n FROM public."${t.table_name}"`;
});

const countSql = `SELECT t, n FROM (${countParts.join(' UNION ALL ')}) c ORDER BY t`;

// Two driver quirks, both confirmed by probing rather than assumed:
//   - `sql.unsafe(q)` does NOT execute; it returns `{ sql: q }`.
//   - `sql.query(q)` DOES execute and returns the rows array directly (NOT the
//     `{ rows }` shape the .d.ts advertises).
// The first run of this script reported 0 rows in every table because of the
// first quirk, which is exactly the kind of silently-wrong answer worth a note.
const executed = await sql.query(countSql);
const rows = Array.isArray(executed) ? executed : executed?.rows ?? [];

const rowCounts = Object.fromEntries(rows.map(r => [r.t, r.n]));

// --- 2. What does the application think exists? ---------------------------
const schemaSrc = readFileSync('utils/schema.ts', 'utf8');
const codeTables = [...schemaSrc.matchAll(/pgTable\(\s*'([^']+)'/g)].map(m => m[1]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|mjs|sql)$/.test(full)) out.push(full);
  }
  return out;
}
const sources = [...walk('app'), ...walk('components'), ...walk('utils'), ...walk('scripts')];

/** snake_case table name -> the camelCase identifier Drizzle exports for it. */
function camel(name) {
  return name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Is a table actually wired up?
 *
 * This checks BOTH the snake_case table name and the camelCase Drizzle
 * identifier, because application code never writes `customer_addresses` — it
 * imports `customerAddresses` from utils/schema.ts and queries that. Matching
 * only the snake_case name produced false "unused" verdicts on the first run.
 *
 * schema.ts is special-cased: every table trivially appears in its own
 * pgTable() declaration, so raw mentions there would report "used" for
 * everything. Declarations are subtracted out.
 */
function usageCount(name) {
  const alternates = [...new Set([name, camel(name)])];
  let files = 0;
  for (const f of sources) {
    const src = readFileSync(f, 'utf8');
    if (f.endsWith(join('utils', 'schema.ts'))) {
      const decls = [...src.matchAll(new RegExp(`pgTable\\(\\s*'${name}'`, 'g'))].length;
      const mentions = alternates.reduce(
        (n, alt) => n + [...src.matchAll(new RegExp(`\\b${alt}\\b`, 'g'))].length,
        0
      );
      if (mentions > decls) files += 1;
      continue;
    }
    if (alternates.some(alt => new RegExp(`\\b${alt}\\b`).test(src))) files += 1;
  }
  return files;
}

console.log('=== tables in postgres (public schema) ===');
console.log('table'.padEnd(24), 'cols'.padStart(5), 'rows'.padStart(7), 'files'.padStart(7));

const unusedInCode = [];
for (const t of dbTables) {
  const uses = usageCount(t.table_name);
  if (uses === 0) unusedInCode.push(t.table_name);
  console.log(
    t.table_name.padEnd(24),
    String(t.column_count).padStart(5),
    String(rowCounts[t.table_name]).padStart(7),
    String(uses).padStart(7)
  );
}

const missingInDb = codeTables.filter(
  name => !dbTables.some(t => t.table_name === name)
);

console.log('\n=== verdict ===');
console.log(`declared in schema.ts : ${codeTables.length}`);
console.log(`present in postgres   : ${dbTables.length}`);
console.log(
  `\nIn postgres but NOT referenced in code (${unusedInCode.length}):` +
    (unusedInCode.length ? '\n  ' + unusedInCode.join('\n  ') : ' none')
);
console.log(
  `\nDeclared in code but MISSING from postgres (${missingInDb.length}):` +
    (missingInDb.length ? '\n  ' + missingInDb.join('\n  ') : ' none')
);

// --- 3. users <-> customers -----------------------------------------------
console.log('\n=== users vs customers ===');
const [uc] = await sql`
  SELECT
    (SELECT COUNT(*)::int FROM users) AS users,
    (SELECT COUNT(*)::int FROM customers) AS customers,
    (SELECT COUNT(*)::int FROM customers WHERE user_id IS NOT NULL) AS linked,
    (SELECT COUNT(*)::int FROM users u
       WHERE NOT EXISTS (SELECT 1 FROM customers c WHERE c.user_id = u.id))
      AS users_without_customer,
    (SELECT COUNT(*)::int FROM customers c
       WHERE c.user_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.user_id))
      AS orphan_fk`;

console.log(`  users                              : ${uc.users}`);
console.log(`  customers                          : ${uc.customers}`);
console.log(`  customers linked to a user        : ${uc.linked}`);
console.log(`  users with NO customer row         : ${uc.users_without_customer}`);
console.log(`  customers pointing at missing user : ${uc.orphan_fk}`);

// Do the two email columns agree? A mismatch means the link is unreliable.
const emailMismatch = await sql`
  SELECT c.email AS customer_email, u.email AS user_email
  FROM customers c
  JOIN users u ON u.id = c.user_id
  WHERE LOWER(c.email) <> LOWER(u.email)`;
console.log(`  linked rows whose emails DIFFER    : ${emailMismatch.length}`);
for (const m of emailMismatch.slice(0, 5)) {
  console.log(`      customers=${m.customer_email}  users=${m.user_email}`);
}

// Which columns key off which table? This is what a merge would have to unify.
console.log('\n  columns named user_id:');
for (const c of await sql`
  SELECT table_name FROM information_schema.columns
  WHERE table_schema='public' AND column_name='user_id' ORDER BY table_name`) {
  console.log(`    ${c.table_name}.user_id`);
}
console.log('\n  columns named customer_id:');
for (const c of await sql`
  SELECT table_name FROM information_schema.columns
  WHERE table_schema='public' AND column_name='customer_id' ORDER BY table_name`) {
  console.log(`    ${c.table_name}.customer_id`);
}

// Real FK constraints, if any. These decide what a merge would actually break.
console.log('\n  foreign keys:');
for (const fk of await sql`
  SELECT tc.table_name, kcu.column_name,
         ccu.table_name AS ref_table, ccu.column_name AS ref_column
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema='public'
  ORDER BY tc.table_name`) {
  console.log(`    ${fk.table_name}.${fk.column_name} -> ${fk.ref_table}.${fk.ref_column}`);
}

// Duplicate emails would block a merge.
const dupes = await sql`
  SELECT LOWER(email) AS email, COUNT(*)::int AS n
  FROM users GROUP BY LOWER(email) HAVING COUNT(*) > 1`;
console.log(`\n  duplicate emails within users      : ${dupes.length}`);