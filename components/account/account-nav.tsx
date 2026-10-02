'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/account', label: 'Overview' },
  { href: '/account/orders', label: 'Orders' },
  { href: '/account/returns', label: 'Returns' },
  { href: '/account/addresses', label: 'Addresses' },
];

export default function AccountNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Account"
      className="flex flex-row gap-1 sm:flex-col sm:gap-0.5"
    >
      {NAV.map(item => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`relative rounded-lg px-3 py-2 text-sm transition-colors ${
              active
                ? 'font-medium text-[#2B2620]'
                : 'text-[#2B2620]/60 hover:bg-[#2B2620]/5 hover:text-[#2B2620]'
            }`}
          >
            {item.label}
            <span
              aria-hidden="true"
              className={`absolute bottom-0 left-3 h-px w-[calc(100%-1.5rem)] origin-left bg-[#5C6B4B] transition-transform duration-300 ease-out ${
                active ? 'scale-x-100' : 'scale-x-0'
              }`}
            />
          </Link>
        );
      })}
    </nav>
  );
}
