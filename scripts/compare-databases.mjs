// Compare the LOCAL database with the PRODUCTION database, without printing a
// single credential.
//
// Why this exists: the migration was applied using the URL in .env.local. If
// Vercel points `adore_DATABASE_URL` at a different Neon database, then the
// tables are missing in production — and every webhook route still returns the
// right status code, so nothing looks broken until the first admin page load.
//
// Prints only the host part of each URL. That is enough to tell the two apart
// and is safe to paste into a chat or a bug report.
import { readFileSync, rmSync, existsSync } from 'node:fs';

function readUrl(file, key) {
  if (!existsSync(file)) return null;
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find(l => l.trim().startsWith(`${key}=`));
  const raw = line?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
  return raw && !raw.includes('[SENSITIVE]') ? raw : null;
}

/** Host + database path, credentials dropped. */
function describe(url) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return '(unparseable)';
  }
}

const local = readUrl('.env.local', 'adore_DATABASE_URL');
const prod = readUrl('.env.production.local', 'adore_DATABASE_URL');

console.log('\nDatabase comparison\n' + '-'.repeat(52));
console.log(`local  .env.local            ${local ? describe(local) : '(not found)'}`);
console.log(`prod   .env.production.local ${prod ? describe(prod) : '(not found — secrets are not pullable)'}`);
console.log('-'.repeat(52));

if (!prod) {
  console.log(
    '\nCannot compare: Vercel masks Secret values when pulling.\n' +
      'Check by hand — Settings → Environment Variables → hover\n' +
      'adore_DATABASE_URL → the Neon host should match the local one above.'
  );
} else if (local && describe(local) === describe(prod)) {
  console.log('\nMATCH — production and local use the same database.');
} else {
  console.log(
    '\nMISMATCH — production points at a DIFFERENT database.\n' +
      'The migration must be applied there:\n' +
      '  DATABASE_URL=<prod-url> node scripts/apply-returns.mjs --apply'
  );
}

// The pulled file contains real credentials. Remove it whether or not we needed
// it, so it cannot linger on disk or be committed by accident.
if (existsSync('.env.production.local')) {
  rmSync('.env.production.local', { force: true });
  console.log('\nRemoved .env.production.local (contained live credentials).');
}