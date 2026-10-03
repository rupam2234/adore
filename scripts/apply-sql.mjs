// apply-sql.mjs — runs a .sql file from scripts/ against the live database.
//
// Exists because Neon has no psql here and `sql.query()` only runs a SINGLE
// statement (the driver sends one HTTP request per call). This splits a file on
// statement boundaries and runs them in order, so scripts/*.sql stays the
// runnable record as those files' headers claim.
//
// Safety: prints the plan, requires --confirm, and reports per-statement
// failures rather than stopping silently. Statements are the file's own — this
// does not accept arbitrary SQL from the command line.
//
// Usage: node scripts/apply-sql.mjs add-product-indexes.sql [--confirm]
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const file = process.argv[2];
const apply = process.argv.includes('--confirm');

if (!file || !file.endsWith('.sql')) {
  console.error('Usage: node scripts/apply-sql.mjs <file.sql> [--confirm]');
  process.exit(1);
}

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

const path = join('scripts', basename(file));
const source = readFileSync(path, 'utf8');

/**
 * Split a SQL file into individual statements.
 *
 * Handles the two cases this file needs: `--` line comments and `$$ ... $$`
 * dollar-quoted blocks (the DO block in PART C). A naive split on `;` would cut
 * the DO block in half and produce a syntax error.
 */
function splitStatements(sqlText) {
  const out = [];
  let buf = '';
  let inLineComment = false;
  let dollarTag = null;

  for (let i = 0; i < sqlText.length; i++) {
    const ch = sqlText[i];
    const two = sqlText.slice(i, i + 2);

    if (inLineComment) {
      buf += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }

    // Entering a dollar-quoted block ($$ or $tag$).
    if (ch === '$') {
      const m = /^\$[A-Za-z_]*\$/.exec(sqlText.slice(i));
      if (m) {
        const tag = m[0];
        if (dollarTag === null) {
          dollarTag = tag;
          buf += tag;
          i += tag.length - 1;
          continue;
        }
        if (tag === dollarTag) {
          dollarTag = null;
          buf += tag;
          i += tag.length - 1;
          continue;
        }
      }
    }

    if (dollarTag !== null) {
      buf += ch;
      continue;
    }

    if (two === '--') {
      inLineComment = true;
      buf += two;
      i += 1;
      continue;
    }

    if (ch === ';') {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      continue;
    }

    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const statements = splitStatements(source);

console.log(`=== ${path} ===`);
console.log(`  ${statements.length} statement(s)\n`);
for (const [i, s] of statements.entries()) {
  // Collapse comments/whitespace to show the meaningful line only.
  const summary = s
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('--'))
    .join(' ')
    .slice(0, 78);
  console.log(`  ${String(i + 1).padStart(2)}. ${summary}`);
}

if (!apply) {
  console.log('\nDRY RUN. Re-run with --confirm to apply.');
  process.exit(0);
}

console.log('\n=== applying ===');
let failed = 0;
for (const [i, s] of statements.entries()) {
  const label = s.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('--'))[0] ?? '';
  try {
    await sql.query(s);
    console.log(`  ok   ${String(i + 1).padStart(2)}. ${label.slice(0, 70)}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${String(i + 1).padStart(2)}. ${label.slice(0, 70)}`);
    console.error(`       ${err.message}`);
  }
}

console.log(
  `\n${statements.length - failed}/${statements.length} statement(s) applied.` +
    (failed > 0 ? `\n${failed} FAILED — see above.` : '')
);
process.exitCode = failed > 0 ? 1 : 0;