import {
  SiteHeader,
  Footer,
  ProductDetail,
  ProductCard,
  ProductReviews,
} from '@/components';
import {
  getProductBySlug,
  getRelatedProducts,
  getActiveProductSlugs,
} from '@/utils';
import { getApprovedReviews, getReviewSummary } from '@/utils/reviews';
import { EMPTY_SUMMARY } from '@/utils/review-format';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

// ISR: cache the product shell at the edge (60s). Only the logged-in
// reviewer name is resolved client-side (see <ProductReviews>), so the
// whole page is safe to cache — just like the homepage's `revalidate = 300`.
export const revalidate = 60;

/**
 * Prerender the live catalogue at build time.
 *
 * This is what actually turns caching on: for a dynamic segment, `revalidate`
 * alone does nothing — without `generateStaticParams` the route is treated as
 * fully dynamic and re-runs every query on every request (no Full Route Cache).
 *
 * Products published after the build still work: `dynamicParams` defaults to
 * true, so Next renders them on demand and caches them for `revalidate` too.
 */
export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  const slugs = await getActiveProductSlugs();
  return slugs.map(slug => ({ slug }));
}

type PageProps = {
  params: Promise<{ slug: string }>;
};

/** Unique metadata per product page (SEO + social sharing). */
export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return {};

  const description =
    product.shortDescription ?? product.details[0] ?? `${product.name} — Adore`;

  return {
    title: product.name, // root layout template appends "| Adore"
    description,
    alternates: { canonical: `/products/${product.slug}` },
    openGraph: {
      title: `${product.name} | Adore`,
      description,
      type: 'website',
      images: product.images[0]
        ? [
            {
              url: product.images[0].url,
              alt: product.images[0].alt ?? product.name,
            },
          ]
        : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${product.name} | Adore`,
      description,
      images: product.images[0] ? [product.images[0].url] : undefined,
    },
  };
}

export default async function ProductPage({ params }: PageProps) {
  const { slug } = await params;

  // Both lookups need only `slug`, so run them together. On the Neon HTTP
  // driver every query is its own network round-trip, so awaiting these
  // sequentially added a full round-trip to each render.
  const [product, related] = await Promise.all([
    getProductBySlug(slug),
    getRelatedProducts(slug, 4),
  ]);
  if (!product) notFound();

  let reviewSummary = EMPTY_SUMMARY;
  let initialReviews: Awaited<
    ReturnType<typeof getApprovedReviews>
  >['reviews'] = [];
  let reviewTotal = 0;
  try {
    const [summary, firstPage] = await Promise.all([
      getReviewSummary(product.id),
      getApprovedReviews(product.id, { page: 1, limit: 5, sort: 'recent' }),
    ]);
    reviewSummary = summary;
    initialReviews = firstPage.reviews;
    reviewTotal = firstPage.total;
  } catch {
    // Reviews table may not exist yet (migration not run) — page still renders.
  }

  const reviewJsonLd =
    reviewSummary.count > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: product.name,
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: reviewSummary.average,
            reviewCount: reviewSummary.count,
          },
        }
      : null;

  return (
    <div className="flex min-h-screen flex-col bg-[#FAF8F3] font-sans text-[#2B2620]">
      <SiteHeader />
      <main className="w-full px-6 py-8 sm:px-12 sm:py-12">
        <ProductDetail
          product={product}
          reviewSummary={reviewSummary}
          reviews={
            <ProductReviews
              slug={product.slug}
              initialSummary={reviewSummary}
              initialReviews={initialReviews}
              initialTotal={reviewTotal}
              sizes={product.sizes.map(s => s.size)}
            />
          }
        />
        {reviewJsonLd && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(reviewJsonLd) }}
          />
        )}
      </main>

      {related.length > 0 && (
        <section className="w-full px-6 pb-20 sm:px-12">
          <div className="flex items-baseline justify-between">
            <h2 className="font-serif text-2xl sm:text-3xl">
              We Think You Might Enjoy...
            </h2>
            <a href="#" className="text-sm underline underline-offset-4">
              View all
            </a>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4 md:mt-10">
            {related.map(p => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      <Footer />
    </div>
  );
}
