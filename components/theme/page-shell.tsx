import { SiteHeader, Footer } from "@/components";

/**
 * Shared shell for standalone content pages (legal, contact, etc.).
 * Keeps the cream/ink palette and serif headings consistent with the homepage.
 */
export default function PageShell({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[#FAF8F3] font-sans text-[#2B2620]">
      <SiteHeader />
      <main className="flex-1 w-full px-6 pb-24 sm:px-12">
        <div className="mx-auto max-w-3xl py-16">
          {eyebrow && (
            <p className="text-sm text-[#5C6B4B]">{eyebrow}</p>
          )}
          <h1 className="mt-2 font-serif text-4xl leading-tight sm:text-5xl">
            {title}
          </h1>
          {intro && (
            <p className="mt-4 max-w-xl text-[#2B2620]/70 leading-relaxed">
              {intro}
            </p>
          )}
          <div className="mt-12">{children}</div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
