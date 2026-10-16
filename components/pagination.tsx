import Link from 'next/link';
import { pageWindow } from '@/utils/pagination';

/**
 * Shared pager for every URL-paginated list. Server-component safe: the page
 * supplies makeHref, so each list keeps its own query params (search, sort,
 * filters) intact across page changes.
 */
export default function Pagination({
  page,
  totalPages,
  makeHref,
}: {
  page: number;
  totalPages: number;
  /** Builds the URL for a page number, preserving this list's other params. */
  makeHref: (page: number) => string;
}) {
  if (totalPages <= 1) return null;

  const base =
    'inline-flex h-9 min-w-9 items-center justify-center rounded-full border px-3 text-sm transition-colors';
  const enabled = `${base} border-[#2B2620]/20 hover:border-[#2B2620]`;
  const disabled = `${base} border-transparent text-[#2B2620]/30`;

  return (
    <nav
      aria-label="Pagination"
      className="mt-8 flex flex-wrap items-center justify-center gap-1.5"
    >
      {page > 1 ? (
        <Link href={makeHref(page - 1)} className={enabled} rel="prev">
          Previous
        </Link>
      ) : (
        <span className={disabled}>Previous</span>
      )}

      {pageWindow(page, totalPages).map((item, i) =>
        item === 'gap' ? (
          <span key={`gap-${i}`} className="px-1 text-sm text-[#2B2620]/40">
            …
          </span>
        ) : item === page ? (
          <span
            key={item}
            aria-current="page"
            className={`${base} border-[#2B2620] bg-[#2B2620] text-[#FAF8F3]`}
          >
            {item}
          </span>
        ) : (
          <Link key={item} href={makeHref(item)} className={enabled}>
            {item}
          </Link>
        )
      )}

      {page < totalPages ? (
        <Link href={makeHref(page + 1)} className={enabled} rel="next">
          Next
        </Link>
      ) : (
        <span className={disabled}>Next</span>
      )}
    </nav>
  );
}
