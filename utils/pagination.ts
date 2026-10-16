/**
 * Shared pagination maths for every list view.
 *
 * One page size and one set of helpers, so no list can render a page that
 * does not exist and every pager stays visually and behaviourally identical.
 */

/** Max rows per page across all paginated lists. */
export const PAGE_SIZE = 5;

/** Parse a ?page= value; anything invalid or absent falls back to page 1. */
export function parsePage(value: string | string[] | undefined): number {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** Total pages for a row count; at least 1 so an empty list still renders. */
export function totalPagesFor(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

/** Pull a page number back into the valid range (URLs are user-editable). */
export function clampPage(page: number, totalPages: number): number {
  return Math.min(Math.max(1, page), totalPages);
}

/** SQL OFFSET for a 1-based page. */
export function offsetFor(page: number): number {
  return (page - 1) * PAGE_SIZE;
}

/**
 * Page buttons around the current one: [1, 'gap', 4, 5, 6, 'gap', 12].
 * First and last are always shown so both ends of the list stay reachable.
 */
export function pageWindow(
  page: number,
  totalPages: number
): Array<number | 'gap'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const wanted = new Set<number>([1, totalPages]);
  for (const p of [page - 1, page, page + 1]) {
    if (p >= 1 && p <= totalPages) wanted.add(p);
  }
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push('gap');
    out.push(p);
    prev = p;
  }
  return out;
}

/**
 * URL for one page of a list: preserves the other query params and sets
 * ?page only when it is not 1, so page 1 links keep canonical URLs.
 */
export function pageHref(
  basePath: string,
  params: Record<string, string | undefined>,
  page: number
): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) qs.set(key, value);
  }
  if (page > 1) qs.set('page', String(page));
  const query = qs.toString();
  return query ? `${basePath}?${query}` : basePath;
}
