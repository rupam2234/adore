import { SiteHeader, Footer, ProductCard } from "@/components";
import { CATEGORY_TREE, getProductsForSection } from "@/utils";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shop all — dresses & kurtis",
  description:
    "Browse the full Adore collection — dresses and kurtis, thoughtfully made in small batches.",
  alternates: { canonical: "/shop" },
};

export default async function ShopAllPage() {
  const products = await getProductsForSection({ limit: 24 });

  return (
    <div className="flex min-h-screen flex-col bg-[#FAF8F3] font-sans text-[#2B2620]">
      <SiteHeader />
      <main className="w-full px-6 py-12 sm:px-12">
        <h1 className="font-serif text-3xl sm:text-4xl">Shop all</h1>
        <p className="mt-2 max-w-md text-sm text-[#2B2620]/60">
          Browse the full collection.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {CATEGORY_TREE.map((cat) => (
            <Link
              key={cat.slug}
              href={`/shop/${cat.slug}`}
              className="rounded-full border border-[#2B2620]/20 px-4 py-1.5 text-xs transition-colors hover:border-[#2B2620] hover:bg-[#2B2620] hover:text-[#FAF8F3]"
            >
              {cat.name}
            </Link>
          ))}
        </div>
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {products.length > 0 ? (
            products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))
          ) : (
            <p className="col-span-2 text-sm text-[#2B2620]/60 sm:col-span-4">
              No products yet — check back soon.
            </p>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
