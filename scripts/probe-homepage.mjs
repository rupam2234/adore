// probe-homepage.mjs â€” READ-ONLY. Checks what the homepage "Latest arrivals"
// row actually rendered.
//
// A passing typecheck is not proof here: the row could silently collapse to
// fewer than four cards, or render the same product twice, and neither shows up
// anywhere except the served HTML. This reads that HTML and reports the
// distinct products in the section.
//
// Usage: node scripts/probe-homepage.mjs [runs]
const BASE = process.env.PROBE_BASE ?? 'http://localhost:3000';
const RUNS = Number(process.argv[2] ?? 3);

/**
 * Isolate the Latest arrivals section.
 *
 * Slicing between `id="shop"` and the next `<section` is more robust than
 * trying to balance nested divs, and it isolates exactly the row under test â€”
 * counting product links across the whole page would pick up the category rows
 * and the favourites row too.
 */
function latestSection(html) {
  const start = html.indexOf('id="shop"');
  if (start === -1) return '';
  const end = html.indexOf('<section', start + 10);
  return html.slice(start, end === -1 ? html.length : end);
}

async function fetchSection() {
  const res = await fetch(BASE);
  if (!res.ok) throw new Error(`GET / -> HTTP ${res.status}`);
  const html = await res.text();
  const slugs = [
    ...latestSection(html).matchAll(/href="\/products\/([a-z0-9-]+)"/g),
  ].map(m => m[1]);
  // Deduped because one card legitimately renders several product links (image,
  // title, quick-view); we care about distinct PRODUCTS, not link count.
  return [...new Set(slugs)];
}

const results = [];
for (let i = 0; i < RUNS; i++) {
  results.push(await fetchSection());
}

console.log(`\nLatest arrivals â€” ${RUNS} request(s) to ${BASE}\n`);
results.forEach((slugs, i) => {
  console.log(`  ${i + 1}. ${slugs.length} distinct: ${slugs.join(', ') || '(none)'}`);
});

const counts = [...new Set(results.map(r => r.length))].sort();
console.log(`\n  distinct-product counts seen: ${counts.join(', ') || 'none'}`);

if (counts.length === 1 && counts[0] < 4) {
  console.log(
    '  WARNING: fewer than 4 shown. Expected only if the catalogue holds fewer' +
      '\n           than 4 ACTIVE products â€” check the pool size, not the sampler.'
  );
}

console.log(
  '\n  Note: the homepage is ISR revalidate=300, so repeated requests can serve' +
    '\n  one cached render. To see variation, wait for a regeneration or build.'
);
