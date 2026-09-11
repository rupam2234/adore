import { SiteHeader, Footer, ProductCard } from "@/components";
import { getProductsForSection } from "@/utils";

// Re-fetch products from the DB at most every 5 minutes (ISR)
export const revalidate = 300;

export default async function Home() {
  const newArrivals = await getProductsForSection({
    limit: 8,
    categorySlug: "dress",
  });

  return (
    <div className="flex min-h-screen flex-col bg-[#FAF8F3] font-sans text-[#2B2620]">
      <SiteHeader />

      <HeroSection />

      <section id="shop" className="w-full px-6 py-20 sm:px-12">
        <div className="flex items-baseline justify-between">
          <h2 className="font-serif text-3xl">New arrivals</h2>
          <a href="#" className="text-sm underline underline-offset-4">
            View all
          </a>
        </div>
        <div className="mt-5 md:mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {newArrivals.length > 0 ? (
            newArrivals.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))
          ) : (
            <p className="col-span-2 text-sm text-[#2B2620]/60 sm:col-span-4">
              No products yet — check back soon.
            </p>
          )}
        </div>
      </section>

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
