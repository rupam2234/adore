import {
  SiteHeader,
  Footer,
  ProductCard,
  FilterStripe,
  AdvancedFilters,
  ResultsBusy,
} from '@/components';
import {
  ALL_CATEGORIES,
  CATEGORY_TREE,
  categoryPageMetadata,
  getCategories,
  getProductsForSection,
  getFilterFacets,
  parseShopFilters,
  preservedParams,
} from '@/utils';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const meta = categoryPageMetadata(slug);

  return (
    meta ?? {
      title: 'Not found',
      robots: { index: false, follow: false },
    }
  );
}

export default async function ShopCategoryPage({
  params,
  searchParams,
}: PageProps) {
  const { slug } = await params;
  const filters = parseShopFilters(await searchParams);
  const keep = preservedParams(filters);

  // Validate against the static taxonomy (single source of truth).
  const category = ALL_CATEGORIES.find(c => c.slug === slug);
  if (!category) notFound();

  // Parent slugs (e.g. "kurti") include their children automatically. The
  // category tree for sub-navigation is fetched alongside them so it costs no
  // extra round trip; a missing `parent_id` column (migration not run) resolves
  // to null and we fall back to the static taxonomy below.
  const [products, facets, categoryRows] = await Promise.all([
    getProductsForSection({
      categorySlug: slug,
      sort: filters.sort,
      colors: filters.colors,
      sizes: filters.sizes,
      inStockOnly: filters.inStockOnly,
      minPrice: filters.minPrice,
      maxPrice: filters.maxPrice,
      limit: 24,
    }),
    getFilterFacets(slug),
    getCategories().catch(() => null),
  ]);

  // Siblings / children for sub-navigation (prefer live DB tree when present).
  let subNav: { slug: string; name: string }[] = [];
  if (categoryRows) {
    const byId = new Map(categoryRows.map(r => [r.id, r]));
    const current = categoryRows.find(r => r.slug === slug) ?? null;
    if (current) {
      const parentId = current.parentId;
      if (parentId) {
        // On a child page (e.g. short-kurti): show siblings + parent link.
        const parent = byId.get(parentId) ?? null;
        subNav = categoryRows
          .filter(r => r.parentId === parentId && r.slug !== slug)
          .map(r => ({ slug: r.slug, name: r.name }));
        if (parent)
          subNav.unshift({ slug: parent.slug, name: `All ${parent.name}` });
      } else {
        // On a parent page (e.g. kurti): show its children.
        subNav = categoryRows
          .filter(r => r.parentId === current.id)
          .map(r => ({ slug: r.slug, name: r.name }));
      }
    }
  } else {
    // categories table predates parent_id (migration not run) — fall back to
    // the taxonomy already imported above.
    const node = CATEGORY_TREE.find(n => n.slug === slug);
    subNav = (node?.children ?? []).map(c => ({
      slug: c.slug,
      name: c.name,
    }));
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#FAF8F3] font-sans text-[#2B2620]">
      <SiteHeader />
      <main className="w-full px-6 py-12 sm:px-12">
        <p className="text-xs uppercase tracking-wide text-[#2B2620]/50">
          <Link
            href="/shop"
            className="hover:underline hover:underline-offset-4"
          >
            Shop
          </Link>
          {' / '}
          {category.name}
        </p>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl sm:text-4xl">{category.name}</h1>
            {category.description && (
              <p className="mt-2 max-w-md text-sm text-[#2B2620]/60">
                {category.description}
              </p>
            )}
          </div>
          <p className="text-sm text-[#2B2620]/50">
            {products.length} {products.length === 1 ? 'style' : 'styles'}
          </p>
        </div>

        {subNav.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2">
            {subNav.map(s => (
              <Link
                key={s.slug}
                href={`/shop/${s.slug}`}
                className="rounded-full border border-[#2B2620]/20 px-4 py-1.5 text-xs transition-colors hover:border-[#2B2620] hover:bg-[#2B2620] hover:text-[#FAF8F3]"
              >
                {s.name}
              </Link>
            ))}
          </div>
        )}

        <div className="mt-8">
          <FilterStripe
            categories={CATEGORY_TREE}
            activeSlug={slug}
            basePath={`/shop/${slug}`}
            sort={filters.sort}
            showAllPill={false}
          />
          {/* lg and up: filter sidebar on the left, product grid on the right. */}
          <div className="mt-8 flex flex-col gap-6 lg:flex-row lg:gap-10">
            <AdvancedFilters
              colors={facets.colors}
              sizes={facets.sizes}
              activeColors={filters.colors}
              activeSizes={filters.sizes}
              inStockOnly={filters.inStockOnly}
              minPrice={filters.minPrice}
              maxPrice={filters.maxPrice}
              basePath={`/shop/${slug}`}
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
                    No {category.name.toLowerCase()} styles yet. Check back
                    soon.
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
