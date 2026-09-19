import {
  SiteHeader,
  Footer,
  ProductCard,
  FilterStripe,
  AdvancedFilters,
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
          <h1 className="font-serif text-3xl sm:text-4xl">
            {filters.query ? `Results for “${filters.query}”` : 'Shop all'}
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
          <div className="px-6 pt-4 sm:px-12">
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
          </div>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-4 px-6 sm:grid-cols-4 sm:px-12">
          {products.length > 0 ? (
            products.map(product => (
              <ProductCard key={product.id} product={product} />
            ))
          ) : (
            <p className="col-span-2 text-sm text-[#2B2620]/60 sm:col-span-4">
              {filters.query
                ? `Nothing matches “${filters.query}” — try another search.`
                : 'No products match these filters — try clearing some.'}
            </p>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
