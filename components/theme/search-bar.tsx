'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

/**
 * Header search: pill-shaped input that submits to /shop?q=…
 * Reused in the desktop bar and above the hero on mobile.
 */
export default function SearchBar({
  className = '',
  borderless = false,
}: {
  className?: string;
  borderless?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    router.push(q ? `/shop?q=${encodeURIComponent(q)}` : '/shop');
  };

  return (
    <form
      onSubmit={handleSubmit}
      role="search"
      aria-label="Search products"
      className={className}
    >
      <div
        className={
          borderless
            ? 'flex items-center gap-2 px-4 py-2'
            : 'flex items-center gap-2 rounded-full border border-[#2B2620]/20 bg-[#FAF8F3] px-4 py-2 transition-colors focus-within:border-[#2B2620]'
        }
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="h-4 w-4 shrink-0 text-[#2B2620]/50"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search dresses, kurtis…"
          aria-label="Search products"
          className="w-full bg-transparent text-sm text-[#2B2620] placeholder:text-[#2B2620]/40 focus:outline-none"
        />
      </div>
    </form>
  );
}
