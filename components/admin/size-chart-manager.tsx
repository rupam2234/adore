'use client';

import { useEffect, useRef, useState } from 'react';

type CategoryEntry = {
  id: string;
  slug: string;
  name: string;
  parentSlug: string | null;
  parentName: string | null;
  sizeChartUrl: string | null;
};

const ALLOWED = 'image/jpeg,image/png,image/webp,image/avif';

/**
 * Per-category size-chart manager (admin).
 *
 * One chart image per category, stored in Cloudinary and attached to the
 * category row. The storefront shows a product's most specific category chart
 * and falls back to the parent category's chart — so one "Kurti" upload covers
 * every kurti sub-category until each gets its own.
 *
 * Loads the live list from /api/admin/categories (which also backfills any
 * taxonomy category missing a DB row) and updates one card in place after an
 * upload/remove, so the page never needs a full reload.
 */
export function SizeChartManager() {
  const [categories, setCategories] = useState<CategoryEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/categories');
        if (!res.ok) throw new Error('load failed');
        const data = (await res.json()) as { categories: CategoryEntry[] };
        if (!cancelled) setCategories(data.categories);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function applyUpdate(next: CategoryEntry) {
    setCategories(
      list => list?.map(c => (c.id === next.id ? next : c)) ?? list
    );
  }

  if (loadError) {
    return (
      <p className="text-sm text-red-700">
        Couldn&rsquo;t load categories. Refresh the page to try again.
      </p>
    );
  }
  if (categories === null) {
    return <p className="text-sm text-[#2B2620]/50">Loading categories…</p>;
  }

  const parents = categories.filter(c => c.parentSlug === null);
  const childrenOf = (slug: string) =>
    categories.filter(c => c.parentSlug === slug);
  const orphans = categories.filter(
    c => c.parentSlug !== null && !parents.some(p => p.slug === c.parentSlug)
  );

  return (
    <div>
      {parents.map(parent => (
        <section key={parent.id} className="mt-10 first:mt-0">
          <h2 className="font-admin font-semibold text-lg">{parent.name}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <CategoryCard category={parent} onUpdated={applyUpdate} />
            {childrenOf(parent.slug).map(child => (
              <CategoryCard
                key={child.id}
                category={child}
                onUpdated={applyUpdate}
              />
            ))}
          </div>
        </section>
      ))}
      {orphans.length > 0 && (
        <section className="mt-10">
          <h2 className="font-admin font-semibold text-lg">Other</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {orphans.map(c => (
              <CategoryCard key={c.id} category={c} onUpdated={applyUpdate} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** One category: current chart preview + upload / replace / remove. */
function CategoryCard({
  category,
  onUpdated,
}: {
  category: CategoryEntry;
  onUpdated: (next: CategoryEntry) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set('file', file);
      const res = await fetch(
        `/api/admin/categories/${category.id}/size-chart`,
        { method: 'POST', body }
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        category?: { sizeChartUrl: string | null };
      };
      if (!res.ok || !data.category) {
        setError(data.error ?? 'Upload failed. Please try again.');
        return;
      }
      onUpdated({ ...category, sizeChartUrl: data.category.sizeChartUrl });
    } catch {
      setError('Upload failed. Please try again.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/categories/${category.id}/size-chart`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        setError('Could not remove the chart. Please try again.');
        return;
      }
      onUpdated({ ...category, sizeChartUrl: null });
    } catch {
      setError('Could not remove the chart. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-[#2B2620]/10 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium">{category.name}</p>
        <p className="text-xs text-[#2B2620]/40">{category.slug}</p>
      </div>

      {category.sizeChartUrl ? (
        <div className="mt-3 border border-[#2B2620]/10 bg-[#FAF8F3] p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={category.sizeChartUrl}
            alt={`Size chart for ${category.name}`}
            loading="lazy"
            className="mx-auto max-h-48 w-auto"
          />
        </div>
      ) : (
        <p className="mt-3 border border-dashed border-[#2B2620]/20 bg-[#FAF8F3] px-3 py-6 text-center text-xs text-[#2B2620]/50">
          No size chart yet. Products here fall back to the parent
          category&rsquo;s chart, if it has one.
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED}
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="flex-1 cursor-pointer bg-[#2B2620] px-3 py-2 text-xs uppercase tracking-wide text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy
            ? 'Working…'
            : category.sizeChartUrl
              ? 'Replace'
              : 'Upload chart'}
        </button>
        {category.sizeChartUrl && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className="cursor-pointer border border-[#2B2620]/20 px-3 py-2 text-xs uppercase tracking-wide text-[#2B2620]/70 transition-colors hover:border-red-700 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Remove
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}


