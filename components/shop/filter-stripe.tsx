import Link from "next/link";
import type { ProductSort } from "@/utils/products";

export type FilterStripeProps = {
  /** Category pills to render ("All" is added automatically). */
  categories: { slug: string; name: string }[];
  /** Slug of the currently active category, or null/undefined for "All". */
  activeSlug?: string | null;
  /** Base path the pills link to (e.g. "/shop" or "/shop/dress"). */
  basePath: string;
  /** Current sort param — kept across pill navigation. */
  sort?: ProductSort;
  /** Current search query — preserved across pill/sort navigation. */
  searchQuery?: string;
  /** Show the "All" pill (hide it on category pages where it would mislabel). */
  showAllPill?: boolean;
};

const SORTS: { value: ProductSort; label: string }[] = [
  { value: "featured", label: "Featured" },
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price ↑" },
  { value: "price-desc", label: "Price ↓" },
];

/** Builds an href preserving the current ?q / ?sort context. */
function buildHref(
  basePath: string,
  { sort, searchQuery, sortOverride }: { sort?: string; searchQuery?: string; sortOverride?: string },
) {
  const params = new URLSearchParams();
  if (searchQuery) params.set("q", searchQuery);
  if (sortOverride ?? (sort && sort !== "featured")) {
    params.set("sort", sortOverride ?? sort!);
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/**
 * Full-width filter stripe: category pills on the left, sort controls on the
 * right. Pure <Link> navigation — no client JS, works with SSR/ISR.
 */
export default function FilterStripe({
  categories,
  activeSlug,
  basePath,
  sort = "featured",
  searchQuery,
  showAllPill = true,
}: FilterStripeProps) {
  const pill = (active: boolean) =>
    `rounded-full border px-4 py-1.5 text-xs transition-colors ${
      active
        ? "border-[#2B2620] bg-[#2B2620] text-[#FAF8F3]"
        : "border-[#2B2620]/20 text-[#2B2620] hover:border-[#2B2620]"
    }`;

  return (
    <div className="flex w-full flex-col gap-4 border-y border-[#2B2620]/10 bg-[#FAF8F3] px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-12">
      <nav aria-label="Filter by category" className="flex flex-wrap gap-2">
        {showAllPill && (
          <Link
            href={buildHref("/shop", { sort, searchQuery })}
            className={pill(!activeSlug)}
            aria-current={!activeSlug ? "page" : undefined}
          >
            All
          </Link>
        )}
        {categories.map(({ slug, name }) => (
          <Link
            key={slug}
            href={`/shop/${slug}`}
            className={pill(activeSlug === slug)}
            aria-current={activeSlug === slug ? "page" : undefined}
          >
            {name}
          </Link>
        ))}
      </nav>

      <nav aria-label="Sort products" className="flex items-center gap-2">
        <span className="mr-1 text-[11px] uppercase tracking-wide text-[#2B2620]/40">
          Sort
        </span>
        {SORTS.map(({ value, label }) => (
          <Link
            key={value}
            href={buildHref(basePath, { sort, searchQuery, sortOverride: value })}
            className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
              sort === value
                ? "bg-[#2B2620]/10 text-[#2B2620]"
                : "text-[#2B2620]/50 hover:text-[#2B2620]"
            }`}
            aria-current={sort === value ? "true" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
