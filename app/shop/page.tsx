import {
  SiteHeader,
  Footer,
  ProductCard,
  FilterStripe,
  AdvancedFilters,
  ResultsBusy,
  Pagination,
} from '@/components';
import {
  CATEGORY_TREE,
  getShopProductPage,
  getShopProductCount,
  getFilterFacets,
  parseShopFilters,
  preservedParams,
  allFilterParams,
  PAGE_SIZE,
  parsePage,
  totalPagesFor,
  clampPage,
  offsetFor,
  pageHref,
} from '@/utils';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Shop all | dresses & kurtis',
  description:
    'Browse the full Adore collection: dresses and kurtis, thoughtfully made in small batches.',
  alternates: { canonical: '/shop' },
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ShopAllPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters = parseShopFilters(params);
  const keep = preservedParams(filters);

  const requestedPage = parsePage(params.page);
  const listOptions = {
    search: filters.query || undefined,
    sort: filters.sort,
    colors: filters.colors,
    sizes: filters.sizes,
    inStockOnly: filters.inStockOnly,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
  };

  const [products, total, facets] = await Promise.all([
    getShopProductPage({
      ...listOptions,
      limit: PAGE_SIZE,
      offset: offsetFor(requestedPage),
    }),
    getShopProductCount(listOptions),
    getFilterFacets(),
  ]);

  const totalPages = totalPagesFor(total);
  const page = clampPage(requestedPage, totalPages);
  // A hand-edited ?page past the end re-fetches the clamped page rather than
  // rendering an empty grid.
  const visible =
    page === requestedPage
      ? products
      : await getShopProductPage({
          ...listOptions,
          limit: PAGE_SIZE,
          offset: offsetFor(page),
        });

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
              ? `${total} ${total === 1 ? 'match' : 'matches'} in the full collection.`
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
                {visible.length > 0 ? (
                  visible.map(product => (
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
              <Pagination
                page={page}
                totalPages={totalPages}
                makeHref={p => pageHref('/shop', allFilterParams(filters), p)}
              />
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
