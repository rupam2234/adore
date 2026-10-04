import Link from 'next/link';
import {
  SiteHeader,
  Footer,
  ProductCard,
  SearchBar,
  HeroCarousel,
} from '@/components';
import {
  CATEGORY_TREE,
  getProductsForSection,
  type ProductCardData,
} from '@/utils';
import { sampleWithoutReplacement } from '@/utils/random';

export const revalidate = 300;

/**
 * How many of the newest products Latest arrivals picks from…
 */
const LATEST_POOL_SIZE = 8;
/**
 * …and how many it shows. Four fills one `sm:grid-cols-4` row exactly.
 *
 * These are separate constants because they answer different questions: the
 * pool decides how much variety the row has, the display count decides its
 * layout. Changing the grid means touching only the second.
 */
const LATEST_DISPLAY_COUNT = 4;

const FAVOURITES_LIMIT = 4;
/** Cards per category row (dress, kurti, …). */
const CATEGORY_ROW_LIMIT = 8;

/** A homepage row: one main category plus its sub-category "tags". */
type CategoryRow = {
  slug: string;
  name: string;
  description: string;
  tags: { slug: string; name: string }[];
  products: ProductCardData[];
};

async function getHomeProducts(): Promise<{
  latest: ProductCardData[];
  favourites: ProductCardData[];
  categories: CategoryRow[];
}> {
  // Every row is one independent query — run them together rather than in
  // sequence so the homepage costs a single round of DB latency, not N.
  //
  // `latestPool` fetches MORE than it displays on purpose: the row shows a
  // random subset of the newest pieces, so the query has to over-fetch first.
  // The shuffle itself happens in JS (see below), not in SQL, so this stays a
  // single indexed round trip.
  const [latestPool, featured, categoryProducts] = await Promise.all([
    getProductsForSection({ sort: 'newest', limit: LATEST_POOL_SIZE }),
    getProductsForSection({ featuredOnly: true, limit: 8 }),
    Promise.all(
      CATEGORY_TREE.map(node =>
        getProductsForSection({
          categorySlug: node.slug,
          // Parent slugs include their children (dress → mini/midi/maxi).
          includeChildren: true,
          sort: 'newest',
          limit: CATEGORY_ROW_LIMIT,
        })
      )
    ),
  ]);

  // Four distinct pieces from the newest eight.
  //
  // Shuffling here rather than `ORDER BY random()` in SQL is the performance
  // choice: random() cannot use an index, so Postgres would sort the whole
  // active catalogue. The DB does the indexed `created_at DESC LIMIT 8` it is
  // already good at, and the shuffle is a handful of operations on an array
  // that is already in memory.
  //
  // Sampling is without replacement, so the four cards are always four
  // DIFFERENT products — the property a naive `pick()` would not guarantee.
  //
  // NOTE: this page is ISR'd (`revalidate = 300`), so the four shown are stable
  // for every visitor within a regeneration window and reshuffle at most every
  // five minutes. That is per-regeneration randomness, not per-visitor.
  const latest = sampleWithoutReplacement(
    latestPool,
    LATEST_DISPLAY_COUNT
  );

  const latestIds = new Set(latest.map(p => p.id));

  let favourites = featured
    .filter(p => !latestIds.has(p.id))
    .slice(0, FAVOURITES_LIMIT);

  // Fallback: nothing featured (or all of it already in the latest row) →
  // fill with the next-newest products instead.
  if (favourites.length === 0) {
    // Needs enough rows to cover everything already shown PLUS the favourites
    // it is replacing. The latest row is drawn from a pool of 8, so it is
    // `LATEST_POOL_SIZE` distinct products that must be skipped — using the
    // display count here would over-fetch and under-fill whenever the random
    // draw happens to omit some of the pool.
    const filler = await getProductsForSection({
      sort: 'newest',
      limit: LATEST_POOL_SIZE + FAVOURITES_LIMIT,
    });
    const shown = new Set(latestIds);
    favourites = filler
      .filter(p => !shown.has(p.id) && shown.add(p.id))
      .slice(0, FAVOURITES_LIMIT);
  }

  // Empty rows are dropped entirely rather than rendering an empty heading.
  const categories: CategoryRow[] = CATEGORY_TREE.flatMap((node, i) =>
    categoryProducts[i].length > 0
      ? [
          {
            slug: node.slug,
            name: node.name,
            description: node.description,
            tags: (node.children ?? []).map(c => ({
              slug: c.slug,
              name: c.name,
            })),
            products: categoryProducts[i],
          },
        ]
      : []
  );

  return { latest, favourites, categories };
}

export default async function Home() {
  const { latest, favourites, categories } = await getHomeProducts();

  return (
    <div className="flex min-h-screen flex-col bg-[#FAF8F3] font-sans text-[#2B2620]">
      <SiteHeader />

      {/* Mobile-only search, sitting just above the hero (borderless) */}
      <div className="px-6 pt-4 pb-2 sm:hidden">
        <SearchBar borderless />
      </div>

      <HeroCarousel />

      <section id="shop" className="w-full px-6 py-5 sm:py-15 sm:px-12">
        <div className="text-center">
          <h2 className="font-serif text-xl sm:text-4xl">Latest arrivals</h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[#2B2620]/60 sm:italic">
            Every piece tells a story of the hands that shaped it and the
            moments it will witness with you.
          </p>
        </div>

        <div className="mt-5 sm:mt-10">
          {latest.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {latest.map(product => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          ) : (
            <p className="text-center text-sm text-[#2B2620]/60">
              No pieces yet. Check back soon.
            </p>
          )}
        </div>
      </section>

      {categories.map(row => (
        <section
          key={row.slug}
          id={`row-${row.slug}`}
          className="w-full border-t border-[#2B2620]/10 px-6 py-16 sm:px-12 sm:py-20"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-[#2B2620]/10 pb-4">
            <div>
              <h2 className="font-serif text-3xl sm:text-4xl">{row.name}</h2>
              <p className="mt-2 max-w-md text-sm text-[#2B2620]/60">
                {row.description}
              </p>
            </div>
            <Link
              href={`/shop/${row.slug}`}
              className="text-sm underline underline-offset-4"
            >
              Shop all {row.name.toLowerCase()}
            </Link>
          </div>

          {row.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={`/shop/${row.slug}`}
                className="rounded-full bg-[#2B2620] px-4 py-1.5 text-xs text-[#FAF8F3] transition-opacity hover:opacity-80"
              >
                All {row.name}
              </Link>
              {row.tags.map(tag => (
                <Link
                  key={tag.slug}
                  href={`/shop/${tag.slug}`}
                  className="rounded-full border border-[#2B2620]/20 px-4 py-1.5 text-xs transition-colors hover:border-[#2B2620] hover:bg-[#2B2620] hover:text-[#FAF8F3]"
                >
                  {tag.name}
                </Link>
              ))}
            </div>
          )}

          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {row.products.map(product => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      ))}

      {favourites.length > 0 && (
        <section
          id="favourites"
          className="w-full border-t border-[#2B2620]/10 bg-[#F3EFE6] px-6 py-20 sm:px-12"
        >
          <div className="flex items-baseline justify-between border-b border-[#2B2620]/10 pb-3">
            <div>
              <h2 className="font-serif text-3xl">Most loved</h2>
              <p className="mt-2 text-sm text-[#2B2620]/60">
                The pieces our customers keep coming back to.
              </p>
            </div>
            <Link href="/shop" className="text-sm underline underline-offset-4">
              View all
            </Link>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {favourites.map(product => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      )}

      <section className="w-full border-t border-[#2B2620]/10 bg-[#2B2620] px-6 py-16 text-[#FAF8F3] sm:px-12">
        <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-serif font-semibold text-2xl">
              Wear what you adore
            </h2>
            <p className="mt-2 max-w-sm text-sm text-[#FAF8F3]/70">
              At Adore, each dress is made to be cherished, worn beautifully,
              and loved effortlessly. We believe clothing shold be personal,
              something you adore the moment you see it, feel beautiful wearning
              and feels like you.
            </p>
          </div>

          <div className="flex w-full max-w-sm gap-2 sm:w-auto">
            <input
              type="email"
              aria-label="Email address"
              placeholder="Your email"
              className="w-full rounded-full border border-[#FAF8F3]/30 bg-transparent px-5 py-3 text-sm placeholder:text-[#FAF8F3]/50 focus:border-[#FAF8F3] focus:outline-none"
            />
            <button
              type="button"
              className="rounded-full bg-[#FAF8F3] px-6 py-3 text-sm text-[#2B2620] transition-colors hover:bg-[#DDBBA4]"
            >
              Sign up
            </button>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
