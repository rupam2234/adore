import { SiteHeader, Footer, ProductCard } from "@/components";
import { getProductsForSection } from "@/utils";

export const revalidate = 300;

const LATEST_LIMIT = 8;
const FAVOURITES_LIMIT = 4;

/**
 * Homepage product data:
 * - "Latest arrivals" — newest products across all categories, one mixed grid.
 * - "Most loved" — featured products (excluding anything already shown above),
 *   with a newest-products fallback so the section is never empty on a
 *   stocked shop.
 */
async function getHomeProducts(): Promise<{
  latest: Awaited<ReturnType<typeof getProductsForSection>>;
  favourites: Awaited<ReturnType<typeof getProductsForSection>>;
}> {
  const [latest, featured] = await Promise.all([
    getProductsForSection({ sort: "newest", limit: LATEST_LIMIT }),
    getProductsForSection({ featuredOnly: true, limit: 8 }),
  ]);

  const latestIds = new Set(latest.map((p) => p.id));

  let favourites = featured
    .filter((p) => !latestIds.has(p.id))
    .slice(0, FAVOURITES_LIMIT);

  // Fallback: nothing featured (or all of it already in the latest row) →
  // fill with the next-newest products instead.
  if (favourites.length === 0) {
    const filler = await getProductsForSection({
      sort: "newest",
      limit: LATEST_LIMIT + FAVOURITES_LIMIT,
    });
    const shown = new Set(latestIds);
    favourites = filler
      .filter((p) => !shown.has(p.id) && shown.add(p.id))
      .slice(0, FAVOURITES_LIMIT);
  }

  return { latest, favourites };
}

export default async function Home() {
  const { latest, favourites } = await getHomeProducts();

  return (
    <div className="flex min-h-screen flex-col bg-[#FAF8F3] font-sans text-[#2B2620]">
      <SiteHeader />

      <HeroSection />

      <section id="shop" className="w-full px-6 py-20 sm:px-12">
        <div className="text-center">
          <h2 className="font-serif text-4xl">Latest arrivals</h2>
          <p className="mx-auto mt-3 max-w-md text-sm italic leading-relaxed text-[#2B2620]/60">
            Every piece tells a story of the hands that shaped it and the
            moments it will witness with you.
          </p>
        </div>

        <div className="mt-14">
          {latest.length > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {latest.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
              <div className="mt-10 text-center">
                <a
                  href="/shop"
                  className="inline-block rounded-full border border-[#2B2620]/30 px-6 py-3 text-sm transition-colors hover:border-[#2B2620]"
                >
                  View all pieces
                </a>
              </div>
            </>
          ) : (
            <p className="text-center text-sm text-[#2B2620]/60">
              No pieces yet — check back soon.
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
            <a href="/shop" className="text-sm underline underline-offset-4">
              View all
            </a>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {favourites.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      )}

      <section className="w-full border-t border-[#2B2620]/10 bg-[#2B2620] px-6 py-16 text-[#FAF8F3] sm:px-12">
        <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-serif text-2xl">Join the field notes</h2>
            <p className="mt-2 max-w-sm text-sm text-[#FAF8F3]/70">
              Stories from the farms and dye studios we work with, plus early
              access to new drops.
            </p>
          </div>
          <form className="flex w-full max-w-sm gap-2 sm:w-auto">
            <input
              type="email"
              placeholder="Your email"
              className="w-full rounded-full border border-[#FAF8F3]/30 bg-transparent px-5 py-3 text-sm placeholder:text-[#FAF8F3]/50 focus:border-[#FAF8F3] focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-full bg-[#FAF8F3] px-6 py-3 text-sm text-[#2B2620] transition-colors hover:bg-[#DDBBA4]"
            >
              Sign up
            </button>
          </form>
        </div>
      </section>

      <Footer />
    </div>
  );
}

function HeroSection() {
  return (
    <section className="grid w-full flex-1 grid-cols-1 sm:grid-cols-5">
      <div className="order-2 flex flex-col justify-center gap-6 px-6 py-6 sm:order-1 sm:col-span-2 sm:px-12 sm:py-24">
        <p className="text-sm text-[#5C6B4B]">The beauty of keeping</p>
        <h1 className="font-serif text-4xl leading-tight sm:text-5xl">
          Clothes that become more yours with every wear
        </h1>
        <p className="max-w-sm text-[#2B2620]/70">
          Thoughtfully made in small batches, Meadowloom dresses are designed to
          move with you through seasons, memories, and all the little moments in
          between.
        </p>
        <div className="flex gap-4 pt-2">
          <a
            href="#shop"
            className="rounded-full bg-[#2B2620] px-6 py-3 text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B]"
          >
            Shop new arrivals
          </a>
          <a
            href="#story"
            className="rounded-full border border-[#2B2620]/30 px-6 py-3 text-sm transition-colors hover:border-[#2B2620]"
          >
            Read our story
          </a>
        </div>
      </div>
      <img
        src={"/images/banner-1.jpg"}
        alt="banner-1"
        loading="eager"
        className="order-1 h-72 w-full sm:order-2 sm:col-span-3 sm:h-auto"
      />
      {/* <div className="order-1 h-72 w-full bg-[linear-gradient(160deg,#C98F82_0%,#DDBBA4_45%,#E7DFCB_100%)] sm:order-2 sm:col-span-3 sm:h-auto" /> */}
    </section>
  );
}
