import { SiteHeader, Footer } from '@/components';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-[#FAF8F3] font-sans text-[#2B2620]">
      <SiteHeader />

      <main className="flex flex-1 flex-col items-center py-25 justify-center px-6 text-center">
        <div className="space-y-6">
          <h1 className="font-serif text-6xl sm:text-8xl font-medium text-[#2B2620]">
            404
          </h1>
          <p className="font-serif text-xl sm:text-2xl text-[#2B2620]/70">
            Page not found
          </p>
          <p className="max-w-md mx-auto text-sm text-[#2B2620]/60">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:gap-4">
            <Link
              href="/"
              className="inline-block rounded-full border border-[#2B2620]/30 px-6 py-3 text-sm transition-colors hover:border-[#2B2620]"
            >
              Back to home
            </Link>
            <Link
              href="/shop"
              className="inline-block rounded-full border border-[#2B2620]/30 px-6 py-3 text-sm transition-colors hover:border-[#2B2620]"
            >
              Browse shop
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
