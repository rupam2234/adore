import Link from 'next/link';
import { CATEGORY_TREE } from '@/utils/categories';

/** Footer link columns — content only, rendering is shared below. */
const FOOTER_COLUMNS = [
  {
    title: 'Shop',
    links: CATEGORY_TREE.map(cat => ({
      label: cat.name,
      href: `/shop/${cat.slug}`,
    })),
  },
  {
    title: 'Help',
    links: [
      { label: 'Shipping', href: '/shipping' },
      { label: 'Returns & exchanges', href: '/returns' },
      { label: 'Size guide', href: '/size-guide' },
      { label: 'Contact us', href: '/contact' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Our story', href: '/#how-we-make-it' },
      { label: 'Sustainability', href: '/sustainability' },
      { label: 'Journal', href: '/journal' },
    ],
  },
] as const;

const SOCIAL_LINKS = [
  { label: 'Instagram', href: 'https://instagram.com' },
  { label: 'Pinterest', href: 'https://pinterest.com' },
  { label: 'Facebook', href: 'https://facebook.com' },
] as const;

const LEGAL_LINKS = [
  { label: 'Privacy policy', href: '/privacy' },
  { label: 'Terms of service', href: '/terms' },
] as const;

/** Site footer — server component, no interactivity. */
export default function Footer() {
  return (
    <footer className="mt-auto w-full bg-[#2B2620] text-[#FAF8F3]">
      <div className="px-6 py-12 sm:px-12 sm:py-16">
        {/* Top: brand + link columns */}
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:grid-cols-5">
          <div className="col-span-2 sm:col-span-3 lg:col-span-2">
            <Link
              href="/"
              className="font-serif text-3xl tracking-tight transition-colors hover:text-[#E7DFCB]"
            >
              Adore
            </Link>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-[#FAF8F3]/60">
              Dresses and kurtis, thoughtfully made in small batches with
              natural fabrics.
            </p>
            <div className="mt-6 flex gap-5">
              {SOCIAL_LINKS.map(({ label, href }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-[#FAF8F3]/60 underline-offset-4 transition-colors hover:text-[#FAF8F3] hover:underline"
                >
                  {label}
                </a>
              ))}
            </div>
          </div>

          {FOOTER_COLUMNS.map(({ title, links }) => (
            <nav key={title} aria-label={title}>
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#FAF8F3]/50">
                {title}
              </p>
              <ul className="mt-4 space-y-2.5">
                {links.map(({ label, href }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      className="text-sm text-[#FAF8F3]/70 underline-offset-4 transition-colors hover:text-[#FAF8F3] hover:underline"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* Bottom: legal bar */}
        <div className="mt-12 flex flex-col gap-4 border-t border-[#FAF8F3]/10 pt-6 text-xs text-[#FAF8F3]/50 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Adore. All rights reserved.</p>
          <div className="flex gap-6">
            {LEGAL_LINKS.map(({ label, href }) => (
              <Link
                key={href}
                href={href}
                className="underline-offset-4 transition-colors hover:text-[#FAF8F3] hover:underline"
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
