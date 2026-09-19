'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export type AdvancedFiltersProps = {
  /** Available colour facets (name + swatch hex). */
  colors: { name: string; hex: string | null }[];
  /** Available size facets. */
  sizes: string[];
  /** Currently applied colour names (URL-derived). */
  activeColors: string[];
  /** Currently applied sizes (URL-derived). */
  activeSizes: string[];
  /** In-stock-only toggle (URL-derived). */
  inStockOnly: boolean;
  /** Applied price range (URL-derived). */
  minPrice?: number;
  maxPrice?: number;
  /** Page path filters navigate within (e.g. "/shop" or "/shop/dress"). */
  basePath: string;
  /** Params preserved untouched across filter changes (q, sort). */
  preservedParams?: Record<string, string | undefined>;
};

type FilterState = {
  colors: string[];
  sizes: string[];
  stock: boolean;
  min?: string;
  max?: string;
};

/**
 * Advanced product filters — colour swatches, size chips, price range and an
 * in-stock toggle. All state lives in the URL (one param per concern) so
 * results stay shareable, SSR/ISR-friendly, and in sync with the back button.
 */
export default function AdvancedFilters({
  colors,
  sizes,
  activeColors,
  activeSizes,
  inStockOnly,
  minPrice,
  maxPrice,
  basePath,
  preservedParams = {},
}: AdvancedFiltersProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [minInput, setMinInput] = useState(minPrice?.toString() ?? '');
  const [maxInput, setMaxInput] = useState(maxPrice?.toString() ?? '');

  const activeCount =
    activeColors.length +
    activeSizes.length +
    (inStockOnly ? 1 : 0) +
    (minPrice != null ? 1 : 0) +
    (maxPrice != null ? 1 : 0);

  /** Pushes a new filter state to the URL, preserving q/sort context. */
  const apply = (next: FilterState) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(preservedParams)) {
      if (value) params.set(key, value);
    }
    if (next.colors.length) params.set('colors', next.colors.join(','));
    if (next.sizes.length) params.set('sizes', next.sizes.join(','));
    if (next.stock) params.set('stock', '1');
    if (next.min) params.set('min', next.min);
    if (next.max) params.set('max', next.max);
    const qs = params.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  };

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter(v => v !== value) : [...list, value];

  const chip = (active: boolean) =>
    `cursor-pointer rounded-full border px-3 py-1.5 text-xs transition-colors ${
      active
        ? 'border-[#2B2620] bg-[#2B2620] text-[#FAF8F3]'
        : 'border-[#2B2620]/20 hover:border-[#2B2620]'
    }`;

  return (
    <div>
      {/* Toggle row — matches the stripe's height and typography */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="flex cursor-pointer items-center gap-2 rounded-full border border-[#2B2620]/20 px-4 py-1.5 text-xs transition-colors hover:border-[#2B2620]"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="h-3.5 w-3.5"
          >
            <path d="M4 6h16M7 12h10m-7 6h4" />
          </svg>
          Filters
          {activeCount > 0 && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#2B2620] text-[10px] leading-none text-[#FAF8F3]">
              {activeCount}
            </span>
          )}
          <span
            aria-hidden="true"
            className={`text-base leading-none transition-transform duration-300 ${open ? 'rotate-45' : ''}`}
          >
            +
          </span>
        </button>

        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => {
              setMinInput('');
              setMaxInput('');
              apply({ colors: [], sizes: [], stock: false });
            }}
            className="cursor-pointer text-xs text-[#2B2620]/50 underline-offset-4 transition-colors hover:text-[#2B2620] hover:underline"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Expanding panel — same grid-rows animation as the accordions */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className="mt-4 grid gap-6 rounded-2xl border border-[#2B2620]/10 bg-[#FAF8F3] p-5 sm:grid-cols-2 lg:grid-cols-4">
            {colors.length > 0 && (
              <fieldset>
                <legend className="text-[11px] uppercase tracking-wide text-[#2B2620]/50">
                  Colour
                </legend>
                <div className="mt-3 flex flex-wrap gap-2">
                  {colors.map(({ name, hex }) => {
                    const active = activeColors.includes(name);
                    const next = {
                      colors: toggle(activeColors, name),
                      sizes: activeSizes,
                      stock: inStockOnly,
                      min: minInput,
                      max: maxInput,
                    };
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => apply(next)}
                        title={name}
                        aria-pressed={active}
                        className={`flex cursor-pointer items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-xs transition-colors ${
                          active
                            ? 'border-[#2B2620] bg-[#2B2620] text-[#FAF8F3]'
                            : 'border-[#2B2620]/20 hover:border-[#2B2620]'
                        }`}
                      >
                        <span
                          className="h-4 w-4 rounded-full border border-[#2B2620]/10"
                          style={{ backgroundColor: hex ?? '#E7DFCB' }}
                        />
                        {name}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}

            {sizes.length > 0 && (
              <fieldset>
                <legend className="text-[11px] uppercase tracking-wide text-[#2B2620]/50">
                  Size
                </legend>
                <div className="mt-3 flex flex-wrap gap-2">
                  {sizes.map(size => {
                    const active = activeSizes.includes(size);
                    const next = {
                      colors: activeColors,
                      sizes: toggle(activeSizes, size),
                      stock: inStockOnly,
                      min: minInput,
                      max: maxInput,
                    };
                    return (
                      <button
                        key={size}
                        type="button"
                        onClick={() => apply(next)}
                        aria-pressed={active}
                        className={chip(active)}
                      >
                        {size}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}

            <fieldset>
              <legend className="text-[11px] uppercase tracking-wide text-[#2B2620]/50">
                Price
              </legend>
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  placeholder="Min"
                  value={minInput}
                  onChange={e => setMinInput(e.target.value)}
                  aria-label="Minimum price"
                  className="w-full rounded-lg border border-[#2B2620]/20 bg-transparent px-3 py-1.5 text-sm focus:border-[#2B2620] focus:outline-none"
                />
                <span aria-hidden="true" className="text-[#2B2620]/40">
                  –
                </span>
                <input
                  type="number"
                  min="0"
                  placeholder="Max"
                  value={maxInput}
                  onChange={e => setMaxInput(e.target.value)}
                  aria-label="Maximum price"
                  className="w-full rounded-lg border border-[#2B2620]/20 bg-transparent px-3 py-1.5 text-sm focus:border-[#2B2620] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() =>
                    apply({
                      colors: activeColors,
                      sizes: activeSizes,
                      stock: inStockOnly,
                      min: minInput,
                      max: maxInput,
                    })
                  }
                  className="shrink-0 cursor-pointer rounded-full bg-[#2B2620] px-4 py-1.5 text-xs text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B]"
                >
                  Go
                </button>
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-[11px] uppercase tracking-wide text-[#2B2620]/50">
                Availability
              </legend>
              <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={inStockOnly}
                  onChange={e =>
                    apply({
                      colors: activeColors,
                      sizes: activeSizes,
                      stock: e.target.checked,
                      min: minInput,
                      max: maxInput,
                    })
                  }
                  className="h-4 w-4 accent-[#2B2620]"
                />
                In stock only
              </label>
            </fieldset>
          </div>
        </div>
      </div>
    </div>
  );
}
