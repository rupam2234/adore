'use client';

import { useRouter } from 'next/navigation';
import { useLinkStatus } from 'next/link';
import { useEffect, useOptimistic, startTransition, useState } from 'react';
import { formatPrice } from '@/utils/product-format';

/** Fixed price scale for the slider — ₹0 → ₹5,000, independent of the catalog. */
const PRICE_MIN = 0;
const PRICE_MAX = 5000;
/** 50 stops across the scale. */
const PRICE_STEP = (PRICE_MAX - PRICE_MIN) / 50;
const PRICE_CURRENCY = 'INR';

// Chip styling, shared by the size and colour buttons so they can't drift apart.
const CHIP = 'cursor-pointer rounded-full border text-xs transition-colors';
const CHIP_ON = 'border-[#2B2620] bg-[#2B2620] text-[#FAF8F3]';
const CHIP_OFF = 'border-[#2B2620]/20 hover:border-[#2B2620]';
const chipClass = (active: boolean) =>
  `${CHIP} px-3 py-1.5 ${active ? CHIP_ON : CHIP_OFF}`;
const swatchClass = (active: boolean) =>
  `${CHIP} flex items-center gap-1.5 py-1 pl-1 pr-2.5 ${active ? CHIP_ON : CHIP_OFF}`;

// Dual-handle slider: native ranges have no two-handle variant, so two
// transparent overlays sit on one track and only their thumbs take pointer
// events. The track/fill are drawn by the spans behind them.
const SLIDER =
  'pointer-events-none absolute inset-x-0 h-6 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-[#2B2620]/30 [&::-webkit-slider-thumb]:bg-[#FAF8F3] [&::-webkit-slider-thumb]:shadow-sm [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-[#2B2620]/30 [&::-moz-range-thumb]:bg-[#FAF8F3] [&::-moz-range-track]:bg-transparent';

/** One thumb of the dual-handle slider (module scope, so identity is stable). */
function PriceHandle({
  label,
  value,
  zIndex,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  zIndex: number;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  return (
    <input
      type="range"
      min={PRICE_MIN}
      max={PRICE_MAX}
      step={PRICE_STEP}
      value={value}
      onChange={event => onChange(Number(event.target.value))}
      // Commit on release (pointer, keyboard or blur) so one drag is one
      // navigation instead of one per pixel.
      onPointerUp={onCommit}
      onKeyUp={onCommit}
      onBlur={onCommit}
      aria-label={label}
      className={SLIDER}
      style={{ zIndex }}
    />
  );
}

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
 * Advanced product filters — size chips, an in-stock toggle, a price slider and
 * colour swatches (in that order). All state lives in the URL (one param per
 * concern) so results stay shareable, SSR/ISR-friendly, and in sync with the
 * back button.
 *
 * Layout follows the Shopify pattern:
 * - lg and up: a sticky left sidebar beside the product grid
 * - below lg: a "Filters" pill that opens a left slide-in drawer
 * Both views render the same panel from the same state, so they never drift
 * apart; only one of them is in the accessibility tree per breakpoint.
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
  // The URL is the source of truth for every filter, so results stay shareable
  // and the back button works. `useOptimistic` paints a click or drag instantly
  // by reflecting the intended state before the server round-trip completes, so
  // the controls never freeze or snap back to their old value.
  const [filters, setFilters] = useOptimistic<FilterState>({
    colors: activeColors,
    sizes: activeSizes,
    stock: inStockOnly,
    min: minPrice != null ? String(minPrice) : undefined,
    max: maxPrice != null ? String(maxPrice) : undefined,
  });

  // `useLinkStatus` gives us a `pending` flag for any navigation, including filter clicks.
  // The `aria-busy` attribute tells assistive tech that a click is reflected here but
  // the product grid is still catching up.
  const { pending } = useLinkStatus();

  // The slider is a fixed ₹0 → ₹5,000 scale: the low handle means "no minimum",
  // the high handle a budget ceiling. A drag keeps a local draft so it never
  // navigates per input event; the draft is keyed to the range it started from,
  // so committing (or the URL changing) discards it and the handles follow the
  // state again — no sync effect needed.
  const rangeKey = `${filters.min ?? ''}:${filters.max ?? ''}`;
  const [drag, setDrag] = useState<{
    key: string;
    min: number;
    max: number;
  } | null>(null);
  const rawPriceMin =
    drag?.key === rangeKey ? drag.min : Number(filters.min ?? PRICE_MIN);
  const rawPriceMax =
    drag?.key === rangeKey ? drag.max : Number(filters.max ?? PRICE_MAX);
  // Clamp into the track and keep the pair ordered, so hand-edited URLs like
  // ?min=90000 or ?min=3000&max=1000 still paint inside the slider.
  const priceMin = Math.min(Math.max(rawPriceMin, PRICE_MIN), PRICE_MAX);
  const priceMax = Math.max(Math.min(rawPriceMax, PRICE_MAX), priceMin);
  // Drag a handle; the other one stays put and the pair never crosses over.
  const dragPriceMin = (value: number) =>
    setDrag({ key: rangeKey, min: value, max: priceMax });
  const dragPriceMax = (value: number) =>
    setDrag({ key: rangeKey, min: priceMin, max: value });

  const activeCount =
    filters.colors.length +
    filters.sizes.length +
    (filters.stock ? 1 : 0) +
    (filters.min != null ? 1 : 0) +
    (filters.max != null ? 1 : 0);

  /** Paints `next` immediately (optimistic), then navigates to its URL. */
  const apply = (next: FilterState) => {
    startTransition(() => {
      setFilters(next);
    });
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

  /** Current filters with overrides merged in — what a click should apply. */
  const withFilters = (overrides: Partial<FilterState>): FilterState => ({
    ...filters,
    ...overrides,
  });

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter(v => v !== value) : [...list, value];

  /**
   * Push the dragged range, skipping no-op commits. Handles resting on the scale
   * ends mean "no price filter", so an untouched slider keeps the URL clean.
   */
  const commitPrice = () => {
    const next = withFilters({
      min: priceMin > PRICE_MIN ? String(priceMin) : undefined,
      max: priceMax < PRICE_MAX ? String(priceMax) : undefined,
    });
    if (next.min === filters.min && next.max === filters.max) return;
    apply(next);
  };

  /** Handle position as a % of the fixed scale. */
  const percent = (value: number) =>
    ((value - PRICE_MIN) / (PRICE_MAX - PRICE_MIN)) * 100;

  const clearAll = () => {
    // The price handles fall back to the scale ends once the state drops min/max.
    apply({ colors: [], sizes: [], stock: false });
  };

  // Escape closes the mobile drawer and body scroll is locked while it is open.
  // The trigger only exists below lg, so this never affects desktop scrolling.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  // Shown in the mobile header, the mobile footer and the desktop sidebar.
  const clearButton = activeCount > 0 && (
    <button
      type="button"
      onClick={clearAll}
      className="cursor-pointer text-xs text-[#2B2620]/50 underline-offset-4 transition-colors hover:text-[#2B2620] hover:underline"
    >
      Clear all
    </button>
  );

  // Plain JSX (not a component) so shared state can't be remounted mid-typing —
  // the desktop sidebar and the mobile drawer render this same panel.
  // `aria-busy` tells assistive tech that a click is already reflected here but
  // the product grid is still catching up.
  const panel = (
    <div aria-busy={pending} className="divide-y divide-[#2B2620]/10">
      {sizes.length > 0 && (
        <fieldset className="py-5 first:pt-0">
          <legend className="text-[11px] uppercase tracking-wide text-[#2B2620]/50">
            Size
          </legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {sizes.map(size => {
              const active = filters.sizes.includes(size);
              return (
                <button
                  key={size}
                  type="button"
                  onClick={() =>
                    apply(withFilters({ sizes: toggle(filters.sizes, size) }))
                  }
                  aria-pressed={active}
                  className={chipClass(active)}
                >
                  {size}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      <fieldset className="py-5 first:pt-0 last:pb-0">
        <legend className="text-[11px] uppercase tracking-wide text-[#2B2620]/50">
          Availability
        </legend>
        <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={filters.stock}
            onChange={event =>
              apply(withFilters({ stock: event.target.checked }))
            }
            className="h-4 w-4 accent-[#2B2620]"
          />
          In stock only
        </label>
      </fieldset>

      <fieldset className="py-5 first:pt-0 last:pb-0">
        <legend className="text-[11px] uppercase tracking-wide text-[#2B2620]/50">
          Price
        </legend>
        <div className="mt-3">
          <p className="flex items-baseline justify-between text-xs tabular-nums">
            <span>{formatPrice(String(priceMin), PRICE_CURRENCY)}</span>
            <span aria-hidden="true" className="text-[#2B2620]/40">
              –
            </span>
            <span>{formatPrice(String(priceMax), PRICE_CURRENCY)}</span>
          </p>
          {/* Two overlaid native ranges make one dual-handle slider; values
              commit on release so a drag costs a single navigation. */}
          <div className="relative mt-2 flex h-6 items-center">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-[#2B2620]/15"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute h-0.5 rounded-full bg-[#2B2620]"
              style={{
                left: `${percent(priceMin)}%`,
                right: `${100 - percent(priceMax)}%`,
              }}
            />
            <PriceHandle
              label="Minimum price"
              value={priceMin}
              zIndex={priceMin >= priceMax ? 5 : 3}
              onChange={value => dragPriceMin(Math.min(value, priceMax))}
              onCommit={commitPrice}
            />
            <PriceHandle
              label="Maximum price"
              value={priceMax}
              zIndex={4}
              onChange={value => dragPriceMax(Math.max(value, priceMin))}
              onCommit={commitPrice}
            />
          </div>
        </div>
      </fieldset>

      {colors.length > 0 && (
        <fieldset className="py-5 first:pt-0 last:pb-0">
          <legend className="text-[11px] uppercase tracking-wide text-[#2B2620]/50">
            Colour
          </legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {colors.map(({ name, hex }) => {
              const active = filters.colors.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() =>
                    apply(withFilters({ colors: toggle(filters.colors, name) }))
                  }
                  title={name}
                  aria-pressed={active}
                  className={swatchClass(active)}
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
    </div>
  );

  return (
    <div className="lg:w-60 lg:shrink-0">
      {/* Mobile: pill trigger that opens the left drawer */}
      <div className="flex items-center justify-between lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
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
        </button>

        {clearButton}
      </div>

      {/* Mobile drawer — slides in from the left, like Shopify's */}
      <div
        aria-hidden={!open}
        inert={!open ? true : undefined}
        className={`fixed inset-0 z-60 lg:hidden ${
          open ? '' : 'pointer-events-none'
        }`}
      >
        <div
          onClick={() => setOpen(false)}
          className={`absolute inset-0 bg-[#2B2620]/60 transition-opacity duration-300 ${
            open ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="Filters"
          className={`absolute left-0 top-0 flex h-full w-full max-w-sm flex-col bg-[#FAF8F3] shadow-2xl transition-transform duration-300 ease-out ${
            open ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex items-center justify-between border-b border-[#2B2620]/10 px-6 py-5">
            <h2 className="font-serif text-xl">
              Filters
              {activeCount > 0 && (
                <span className="ml-2 text-sm text-[#2B2620]/50">
                  ({activeCount})
                </span>
              )}
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close filters"
              className="cursor-pointer text-2xl leading-none text-[#2B2620]/50 transition-colors hover:text-[#2B2620]"
            >
              ×
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">{panel}</div>

          <div className="flex items-center gap-4 border-t border-[#2B2620]/10 px-6 py-4">
            {clearButton}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="ml-auto w-full max-w-48 cursor-pointer rounded-full bg-[#2B2620] px-6 py-2.5 text-center text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B]"
            >
              Show results
            </button>
          </div>
        </aside>
      </div>

      {/* Desktop: sticky left sidebar beside the grid */}
      <aside
        aria-label="Filters"
        className="hidden lg:sticky lg:top-6 lg:block lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto lg:pr-1"
      >
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-serif text-xl">Filters</h2>
          {clearButton}
        </div>
        <div className="mt-4">{panel}</div>
      </aside>
    </div>
  );
}
