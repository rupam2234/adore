// Find exported symbols that nothing imports — dead code, or exports that were
// left behind after a refactor.
//
// Not a linter: it exists because the returns work was written across many
// files in one pass, and a couple of helpers ended up duplicated or orphaned in a
// way neither TypeScript nor ESLint flags. An unused EXPORT is invisible to
// `no-unused-vars`; only the import graph reveals it.
//
// Read-only. Run: node scripts/find-dead-exports.mjs

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['app', 'components', 'utils'];
const EXT = new Set(['.ts', '.tsx', '.mjs']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '.git') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXT.has(extname(name))) out.push(full);
  }
  return out;
}

const files = ROOTS.flatMap(r => walk(r));
const sources = new Map(files.map(f => [f, readFileSync(f, 'utf8')]));

/** Collect every `export ... name` / `export { a, b }` binding. */
const exported = new Map(); // name -> [files]

const NAMED = /^export\s+(?:async\s+)?(?:function|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
const LIST = /^export\s*\{([^}]+)\}/gm;

for (const [file, src] of sources) {
  for (const m of src.matchAll(NAMED)) {
    const name = m[1];
    if (!exported.has(name)) exported.set(name, []);
    exported.get(name).push(file);
  }
  for (const m of src.matchAll(LIST)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (!name || name === 'type') continue;
      if (!exported.has(name)) exported.set(name, []);
      exported.get(name).push(file);
    }
  }
}

/** Count references outside the defining line. */
const dead = [];
for (const name of exported.keys()) {
  let used = 0;
  for (const src of sources.values()) {
    // Strip the export statement itself so a declaration never counts as a use.
    const stripped = src
      .replace(
        new RegExp(
          `^export\\s+(?:async\\s+)?(?:function|const|let|class|type|interface|enum)\\s+${name}\\b.*$`,
          'gm'
        ),
        ''
      )
      .replace(new RegExp(`^export\\s*\\{[^}]*\\b${name}\\b[^}]*\\};?`, 'gm'), '');
    used += stripped.match(new RegExp(`\\b${name}\\b`, 'g'))?.length ?? 0;
  }
  if (used === 0) dead.push({ name, files: exported.get(name) });
}

console.log(`\nScanned ${files.length} files, ${exported.size} exports.\n`);
if (!dead.length) {
  console.log('No dead exports found.');
} else {
  console.log(`Potentially dead exports (${dead.length}):\n`);
  for (const d of dead.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${d.name.padEnd(38)} ${d.files.join(', ')}`);
  }
  console.log(
    '\nNote: re-exported or dynamically-referenced symbols can appear here\n' +
      '      falsely. Check before deleting.'
  );
}