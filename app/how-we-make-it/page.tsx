import { Metadata } from 'next';
import Link from 'next/link';
import { Footer, SiteHeader } from '@/components';

export const metadata: Metadata = {
  title: 'Our Story | Adore',
  description:
    'Discover the story behind Adore, Wear Love — fashion that feels personal, modest, meaningful, and timeless.',
};

export default function HowWeMakeItPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        {/* Hero / Intro */}
        <section className="w-full bg-[#F3EFE6] px-6 py-16 sm:px-12 sm:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="font-serif text-3xl sm:text-4xl text-[#2B2620]">
              Our Story
            </h1>
            <p className="mt-4 text-lg text-[#2B2620]/60">
              Some things never go out of style, the feeling of wearing
              something you love, the beauty of little details, and the
              confidence that comes from being truly yourself.
            </p>
          </div>
        </section>

        {/* Story content */}
        <section className="w-full px-6 py-16 sm:px-12 sm:py-24">
          <div className="mx-auto max-w-3xl space-y-8 text-[#2B2620]/70 leading-relaxed">
            <p>
              Adore, was created with an idea to make fashion feel personal,
              modest, meaningful, and timeless. The beauty of everyday life,
              changing seasons, cherished moments, vintage charm, and effortless
              elegance. We believe every piece you wear should feel like a
              little part of you, bringing together comfort and style.
            </p>

            <p>
              More than just a clothing brand, Adore, Wear Love is about finding
              beauty in simplicity, expressing yourself without words, and
              creating memories in the outfits you cherish. Because the best
              pieces aren't just worn for a moment; they're loved for years.
            </p>

            <p>
              Each collection begins with a feeling: a season, a memory, a quiet
              moment and grows into pieces designed to be worn beautifully,
              lived in fully, and passed on. We choose fabrics that breathe,
              silhouettes that flatter without effort, and details that reveal
              themselves over time.
            </p>

            <p>
              This is slow fashion by intention, not trend. Made in small
              batches. Designed to last. Priced fairly. We're here to value
              quality over quantity, woman who dress for themselves, who know
              that true style is personal.
            </p>

            <div className="pt-8 text-center">
              <Link
                href="/shop"
                className="inline-flex items-center gap-2 rounded-full bg-[#2B2620] px-6 py-3 text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B]"
              >
                Explore the Collection
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
