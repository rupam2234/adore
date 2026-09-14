import { SiteHeader, Footer, ProductCard } from "@/components";
import { getProductsForSection, getCategories } from "@/utils";
import { CATEGORY_TREE } from "@/utils/categories";

export const revalidate = 300;

type GroupedProducts = {
  category: { slug: string; name: string };
  products: Awaited<ReturnType<typeof getProductsForSection>>;
};

/** Child category slug → its top-level parent slug (parents map to themselves). */
const topLevelOf: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const cat of CATEGORY_TREE) {
    map.set(cat.slug, cat.slug);
    for (const child of cat.children ?? []) map.set(child.slug, cat.slug);
  }
  return map;
})();

/** Section order mirrors CATEGORY_TREE, so rows always appear in nav order. */
const topLevelOrder: Map<string, number> = (() => {
  const map = new Map<string, number>();
  CATEGORY_TREE.forEach((cat, i) => map.set(cat.slug, i));
  return map;
})();

const MAX_PER_GROUP = 4;

/**
 * Homepage "New arrivals": group featured products by their *top-level*
 * category (Dress / Kurti) rather than whichever category comes first on
 * the product — subcategories would otherwise fragment into tiny rows.
 */
async function getFeaturedByCategory(): Promise<GroupedProducts[]> {
  const [featured, categories] = await Promise.all([
    getProductsForSection({ limit: 50, featuredOnly: true }),
    getCategories(),
  ]);

  // Fallback: nothing flagged as featured → show the newest products instead,
  // so the section never renders empty on a stocked shop.
  const products =
    featured.length > 0
      ? featured
      : await getProductsForSection({ limit: 12 });

  if (products.length === 0) return [];

  const bySlug = new Map<string, GroupedProducts>();

  for (const product of products) {
    const primarySlug = topLevelOf.get(product.categories?.[0]?.slug ?? "") ?? "uncategorized";

    if (!bySlug.has(primarySlug)) {
      const cat = categories.find((c) => c.slug === primarySlug);
      bySlug.set(primarySlug, {
        category: cat
          ? { slug: cat.slug, name: cat.name }
          : { slug: "all", name: "Everything else" },
        products: [],
      });
    }
    bySlug.get(primarySlug)!.products.push(product);
  }

  return [...bySlug.values()].sort(
    (a, b) =>
      (topLevelOrder.get(a.category.slug) ?? Number.MAX_SAFE_INTEGER) -
      (topLevelOrder.get(b.category.slug) ?? Number.MAX_SAFE_INTEGER),
  );
}

export default async function Home() {
  const featuredGroups = await getFeaturedByCategory();

  return (
    <div className="flex min-h-screen flex-col bg-[#FAF8F3] font-sans text-[#2B2620]">
      <SiteHeader />

      <HeroSection />

      <section id="shop" className="w-full px-6 py-20 sm:px-12">
        <div className="text-center">
          <h2 className="font-serif text-4xl">New arrivals</h2>
          <p className="mx-auto mt-3 max-w-md text-sm italic leading-relaxed text-[#2B2620]/60">
            Every piece tells a story of the hands that shaped it and the
            moments it will witness with you.
          </p>
        </div>

        <div className="mt-14 space-y-16">
          {featuredGroups.length > 0 ? (
            featuredGroups.map((group) => (
              <div key={group.category.slug}>
                <div className="mb-6 flex items-baseline justify-between border-b border-[#2B2620]/10 pb-3">
                  <h3 className="font-serif text-2xl">{group.category.name}</h3>
                  <a
                    href={`/shop/${group.category.slug}`}
                    className="text-sm underline underline-offset-4"
                  >
                    View all
                  </a>
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {group.products.slice(0, MAX_PER_GROUP).map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <p className="text-center text-sm text-[#2B2620]/60">
              No featured pieces yet — check back soon.
            </p>
          )}
        </div>
      </section>

      {/* <section
        id="how-we-make-it"
        className="w-full scroll-mt-24 border-t border-[#2B2620]/10 px-6 py-16 sm:px-12"
      >
        <p className="text-sm text-[#5C6B4B]">How we make it</p>
        <h2 className="mt-2 max-w-xl font-serif text-3xl">
          Small batches, honest fabrics, made to keep
        </h2>
        <div className="mt-8 grid gap-8 text-sm leading-relaxed text-[#2B2620]/70 sm:grid-cols-3">
          <div>
            <p className="font-medium text-[#2B2620]">1. Thoughtful fabrics</p>
            <p className="mt-2">
              Breathable, natural-feeling materials chosen for comfort and
              everyday wear.
            </p>
          </div>
          <div>
            <p className="font-medium text-[#2B2620]">
              2. Small-batch stitching
            </p>
            <p className="mt-2">
              Cut and sewn in limited runs so every piece gets proper attention
              to fit and finish.
            </p>
          </div>
          <div>
            <p className="font-medium text-[#2B2620]">3. Made to be reworn</p>
            <p className="mt-2">
              Timeless silhouettes and cloth-care guidance, designed to move
              with you season after season.
            </p>
          </div>
        </div>
      </section> */}

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
