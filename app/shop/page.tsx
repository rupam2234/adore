import {
  SiteHeader,
  Footer,
  ProductCard,
  FilterStripe,
  AdvancedFilters,
  ResultsBusy,
} from '@/components';
import {
  CATEGORY_TREE,
  getProductsForSection,
  getFilterFacets,
  parseShopFilters,
  preservedParams,
} from '@/utils';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Shop all — dresses & kurtis',
  description:
    'Browse the full Adore collection — dresses and kurtis, thoughtfully made in small batches.',
  alternates: { canonical: '/shop' },
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ShopAllPage({ searchParams }: PageProps) {
  const filters = parseShopFilters(await searchParams);
  const keep = preservedParams(filters);

  const [products, facets] = await Promise.all([
    getProductsForSection({
      search: filters.query || undefined,
      sort: filters.sort,
      colors: filters.colors,
      sizes: filters.sizes,
      inStockOnly: filters.inStockOnly,
      minPrice: filters.minPrice,
      maxPrice: filters.maxPrice,
      limit: 48,
    }),
    getFilterFacets(),
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-[#FAF8F3] font-sans text-[#2B2620]">
      <SiteHeader />
      <main className="w-full py-12">
        <div className="px-6 sm:px-12">
          <h1 className="font-normal font-serif text-primary/80 text-3xl sm:text-4xl">
            {filters.query ? `Results for “${filters.query}”` : 'Shop'}
          </h1>
          <p className="mt-2 max-w-md text-sm text-[#2B2620]/60">
            {filters.query
              ? `${products.length} ${products.length === 1 ? 'match' : 'matches'} in the full collection.`
              : 'Browse the full collection.'}
          </p>
        </div>
        <div className="mt-8">
          <FilterStripe
            categories={CATEGORY_TREE}
            basePath="/shop"
            sort={filters.sort}
            searchQuery={filters.query || undefined}
          />
          {/* lg and up: filter sidebar on the left, product grid on the right. */}
          <div className="mt-8 flex flex-col gap-6 px-6 sm:px-12 lg:flex-row lg:gap-10">
            <AdvancedFilters
              colors={facets.colors}
              sizes={facets.sizes}
              activeColors={filters.colors}
              activeSizes={filters.sizes}
              inStockOnly={filters.inStockOnly}
              minPrice={filters.minPrice}
              maxPrice={filters.maxPrice}
              basePath="/shop"
              preservedParams={keep}
            />
            {/*
              `aria-label` + `<ResultsBusy>` give screen readers and sighted
              users a pending cue on filter clicks — the grid stays responsive
              (the click paints optimistically) while Next streams the new page.
            */}
            <div className="min-w-0 flex-1" aria-label="Product results">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
                <ResultsBusy />
                {products.length > 0 ? (
                  products.map(product => (
                    <ProductCard key={product.id} product={product} />
                  ))
                ) : (
                  <p className="col-span-full text-sm text-[#2B2620]/60">
                    {filters.query
                      ? `Nothing matches “${filters.query}”. Try another search.`
                      : 'No products match these filters. Try clearing some.'}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
