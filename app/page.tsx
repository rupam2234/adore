import Link from 'next/link';
import {
  SiteHeader,
  Footer,
  ProductCard,
  SearchBar,
  HeroCarousel,
} from '@/components';
import { getProductsForSection } from '@/utils';

export const revalidate = 300;

const LATEST_LIMIT = 8;
const FAVOURITES_LIMIT = 4;

/**
 * - "Latest arrivals" — newest products across all categories, one mixed grid.
 * - "Most loved" — featured products not already shown above, falling back to
 *   newest so the section is never empty on a stocked shop.
 */
async function getHomeProducts(): Promise<{
  latest: Awaited<ReturnType<typeof getProductsForSection>>;
  favourites: Awaited<ReturnType<typeof getProductsForSection>>;
}> {
  const [latest, featured] = await Promise.all([
    getProductsForSection({ sort: 'newest', limit: LATEST_LIMIT }),
    getProductsForSection({ featuredOnly: true, limit: 8 }),
  ]);

  const latestIds = new Set(latest.map(p => p.id));

  let favourites = featured
    .filter(p => !latestIds.has(p.id))
    .slice(0, FAVOURITES_LIMIT);

  // Fallback: nothing featured (or all of it already in the latest row) →
  // fill with the next-newest products instead.
  if (favourites.length === 0) {
    const filler = await getProductsForSection({
      sort: 'newest',
      limit: LATEST_LIMIT + FAVOURITES_LIMIT,
    });
    const shown = new Set(latestIds);
    favourites = filler
      .filter(p => !shown.has(p.id) && shown.add(p.id))
      .slice(0, FAVOURITES_LIMIT);
  }

  return { latest, favourites };
}

export default async function Home() {
  const { latest, favourites } = await getHomeProducts();

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
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {latest.map(product => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
              <div className="mt-10 text-center">
                <Link
                  href="/shop"
                  className="inline-block rounded-full border border-[#2B2620]/30 px-6 py-3 text-sm transition-colors hover:border-[#2B2620]"
                >
                  View all pieces
                </Link>
              </div>
            </>
          ) : (
            <p className="text-center text-sm text-[#2B2620]/60">
              No pieces yet. Check back soon.
            </p>
          )}
        </div>
      </section>

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
          {/* Placeholder subscribe form. There is no newsletter endpoint yet, so
              it renders inert rather than POSTing and reloading the page. Wire
              `action` up when the API route exists. */}
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
