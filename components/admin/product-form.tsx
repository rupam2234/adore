'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { CATEGORY_TREE } from '@/utils/categories';
import { slugify } from '@/utils/admin-schema';
import type { FieldErrors } from '@/utils/admin-schema';

/** Variant row as edited in the form (all strings for input ergonomics). */
type VariantRow = {
  color: string;
  colorHex: string;
  size: string;
  price: string;
  compareAtPrice: string;
  stock: string;
};

export type AdminProductFormValue = {
  id?: string;
  status?: string;
  name: string;
  slug: string;
  shortDescription: string;
  story: string;
  material: string;
  fit: string;
  careInstructions: string;
  details: string; // one bullet per line
  /** Packed weight per unit in grams (string for the input; '' = unset). */
  weightGrams: string;
  isFeatured: boolean;
  categorySlugs: string[];
  variants: VariantRow[];
};

const EMPTY_VARIANT: VariantRow = {
  color: '',
  colorHex: '#E7DFCB',
  size: '',
  price: '',
  compareAtPrice: '',
  stock: '0',
};

const inputCls =
  'w-full rounded-lg border border-[#2B2620]/15 bg-white px-3 py-2 text-sm outline-none focus:border-[#2B2620]';
const labelCls =
  'mb-1 block text-xs font-medium uppercase tracking-wide text-[#2B2620]/60';
const errorTextCls = 'mt-1 text-xs text-red-600';

/** Shared create/edit product form. Create posts, edit patches. */
export function ProductForm({ product }: { product?: AdminProductFormValue }) {
  const router = useRouter();
  const isEdit = Boolean(product?.id);

  const [form, setForm] = useState<AdminProductFormValue>(
    product ?? {
      name: '',
      slug: '',
      shortDescription: '',
      story: '',
      material: '',
      fit: '',
      careInstructions: '',
      details: '',
      weightGrams: '',
      isFeatured: false,
      categorySlugs: [],
      variants: [{ ...EMPTY_VARIANT }],
    }
  );
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [status, setStatus] = useState(product?.status ?? 'DRAFT');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{
    kind: 'error' | 'ok';
    text: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof AdminProductFormValue>(
    key: K,
    value: AdminProductFormValue[K]
  ) => setForm(f => ({ ...f, [key]: value }));

  // Auto-derive slug from the name until the user edits it manually.
  const derivedSlug = useMemo(() => slugify(form.name), [form.name]);

  const setVariant = (index: number, key: keyof VariantRow, value: string) =>
    setForm(f => ({
      ...f,
      variants: f.variants.map((v, i) =>
        i === index ? { ...v, [key]: value } : v
      ),
    }));

  const toggleCategory = (slug: string) =>
    setForm(f => ({
      ...f,
      categorySlugs: f.categorySlugs.includes(slug)
        ? f.categorySlugs.filter(s => s !== slug)
        : [...f.categorySlugs, slug],
    }));

  function buildPayload() {
    return {
      name: form.name,
      slug: form.slug || derivedSlug,
      shortDescription: form.shortDescription,
      story: form.story,
      material: form.material,
      fit: form.fit,
      careInstructions: form.careInstructions,
      details: form.details,
      weightGrams: form.weightGrams,
      isFeatured: form.isFeatured,
      status,
      categorySlugs: form.categorySlugs,
      variants: form.variants.map(v => ({
        color: v.color,
        colorHex: v.colorHex || null,
        size: v.size,
        price: v.price,
        compareAtPrice: v.compareAtPrice || null,
        stock: v.stock,
      })),
    };
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setFieldErrors({});

    try {
      const res = await fetch(
        isEdit && product?.id
          ? `/api/admin/products/${product.id}`
          : '/api/admin/products',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPayload()),
        }
      );
      const data = (await res.json()) as {
        product?: { id: string };
        error?: string;
        fields?: FieldErrors;
      };

      if (!res.ok) {
        if (data.fields) setFieldErrors(data.fields);
        setMessage({
          kind: 'error',
          text:
            data.error ?? 'Something went wrong — fix the errors and retry.',
        });
        return;
      }

      if (isEdit) {
        setMessage({ kind: 'ok', text: 'Saved.' });
        router.refresh();
      } else if (data.product?.id) {
        // Checkpoint reached: draft exists → edit page for images next
        router.push(`/admin/products/${data.product.id}`);
      }
    } catch {
      setMessage({
        kind: 'error',
        text: 'Network error — the request did not go through. Try again.',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border border-[#2B2620]/10 bg-white p-6"
    >
      {/* Basics */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="pf-name">
            Name *
          </label>
          <input
            id="pf-name"
            className={inputCls}
            value={form.name}
            onChange={e => set('name', e.target.value)}
            placeholder="Floral Meadow"
          />
          {fieldErrors.name && (
            <p className={errorTextCls}>{fieldErrors.name}</p>
          )}
        </div>
        <div>
          <label className={labelCls} htmlFor="pf-slug">
            Slug
          </label>
          <input
            id="pf-slug"
            className={inputCls}
            value={form.slug || derivedSlug}
            onChange={e => {
              setSlugTouched(true);
              set('slug', slugify(e.target.value));
            }}
            placeholder="floral-meadow"
          />
          <p className="mt-1 text-xs text-[#2B2620]/40">
            {slugTouched ? 'Custom slug' : 'Auto-generated from the name'}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <label className={labelCls} htmlFor="pf-short">
          Short description
        </label>
        <input
          id="pf-short"
          className={inputCls}
          value={form.shortDescription}
          onChange={e => set('shortDescription', e.target.value)}
          placeholder="One-liner shown under the product name"
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="pf-material">
            Material
          </label>
          <input
            id="pf-material"
            className={inputCls}
            value={form.material}
            onChange={e => set('material', e.target.value)}
            placeholder="Cotton"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="pf-fit">
            Fit
          </label>
          <input
            id="pf-fit"
            className={inputCls}
            value={form.fit}
            onChange={e => set('fit', e.target.value)}
            placeholder="Relaxed"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="pf-weight">
            Weight (g)
          </label>
          <input
            id="pf-weight"
            type="number"
            min="1"
            max="50000"
            inputMode="numeric"
            className={inputCls}
            value={form.weightGrams}
            onChange={e => set('weightGrams', e.target.value)}
            placeholder="400"
          />
          <p className="mt-1 text-xs text-[#2B2620]/50">
            Packed weight per unit — used for shipping rates. Defaults to 400g.
          </p>
        </div>
      </div>

      <div className="mt-4">
        <label className={labelCls} htmlFor="pf-details">
          Details (one bullet per line)
        </label>
        <textarea
          id="pf-details"
          className={`${inputCls} min-h-24`}
          value={form.details}
          onChange={e => set('details', e.target.value)}
          placeholder={'Side slit pockets\nSlightly sheer in sunlight'}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="pf-care">
            Cloth care
          </label>
          <textarea
            id="pf-care"
            className={`${inputCls} min-h-20`}
            value={form.careInstructions}
            onChange={e => set('careInstructions', e.target.value)}
            placeholder="Machine wash cold. Do not bleach. Hang dry."
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="pf-story">
            Story
          </label>
          <textarea
            id="pf-story"
            className={`${inputCls} min-h-20`}
            value={form.story}
            onChange={e => set('story', e.target.value)}
            placeholder="Inspired by quiet summer mornings…"
          />
        </div>
      </div>

      {/* Categories */}
      <div className="mt-6">
        <p className={labelCls}>Categories</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {CATEGORY_TREE.map(parent => (
            <div
              key={parent.slug}
              className="rounded-lg border border-[#2B2620]/10 p-3"
            >
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={form.categorySlugs.includes(parent.slug)}
                  onChange={() => toggleCategory(parent.slug)}
                />
                {parent.name}
              </label>
              {(parent.children ?? []).map(child => (
                <label
                  key={child.slug}
                  className="ml-5 mt-1.5 flex items-center gap-2 text-sm text-[#2B2620]/70"
                >
                  <input
                    type="checkbox"
                    checked={form.categorySlugs.includes(child.slug)}
                    onChange={() => toggleCategory(child.slug)}
                  />
                  {child.name}
                </label>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Variants */}
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <p className={labelCls}>Variants (colour × size) *</p>
          <button
            type="button"
            onClick={() =>
              set('variants', [...form.variants, { ...EMPTY_VARIANT }])
            }
            className="text-xs hover:underline"
          >
            + Add variant
          </button>
        </div>
        {fieldErrors.variants && (
          <p className={errorTextCls}>{fieldErrors.variants}</p>
        )}
        <div className="mt-2 space-y-2">
          {form.variants.map((v, i) => (
            <div
              key={i}
              className="grid grid-cols-12 items-start gap-2 rounded-lg border border-[#2B2620]/10 p-2"
            >
              <input
                className={`${inputCls} col-span-3`}
                value={v.color}
                onChange={e => setVariant(i, 'color', e.target.value)}
                placeholder="Colour *"
                aria-label={`Variant ${i + 1} colour`}
              />
              <input
                className={`${inputCls} col-span-1 px-1`}
                value={v.colorHex}
                onChange={e => setVariant(i, 'colorHex', e.target.value)}
                placeholder="#hex"
                aria-label={`Variant ${i + 1} swatch`}
              />
              <input
                className={`${inputCls} col-span-2`}
                value={v.size}
                onChange={e => setVariant(i, 'size', e.target.value)}
                placeholder="Size *"
                aria-label={`Variant ${i + 1} size`}
              />
              <input
                className={`${inputCls} col-span-2`}
                value={v.price}
                onChange={e => setVariant(i, 'price', e.target.value)}
                placeholder="Price *"
                inputMode="decimal"
                aria-label={`Variant ${i + 1} price`}
              />
              <input
                className={`${inputCls} col-span-2`}
                value={v.compareAtPrice}
                onChange={e => setVariant(i, 'compareAtPrice', e.target.value)}
                placeholder="Compare at (optional)"
                inputMode="decimal"
                aria-label={`Variant ${i + 1} compare-at price`}
              />
              <input
                className={`${inputCls} col-span-1`}
                value={v.stock}
                onChange={e => setVariant(i, 'stock', e.target.value)}
                placeholder="Qty"
                inputMode="numeric"
                aria-label={`Variant ${i + 1} stock`}
              />
              <button
                type="button"
                onClick={() =>
                  set(
                    'variants',
                    form.variants.filter((_, j) => j !== i)
                  )
                }
                className="col-span-1 text-xs text-[#2B2620]/40 hover:text-red-600"
                aria-label={`Remove variant ${i + 1}`}
              >
                ✕
              </button>
              {Object.entries(fieldErrors)
                .filter(([k]) => k.startsWith(`variants.${i}.`))
                .map(([k, msg]) => (
                  <p key={k} className={`${errorTextCls} col-span-12`}>
                    {msg}
                  </p>
                ))}
            </div>
          ))}
        </div>
      </div>

      {/* Status + featured + save */}
      <div className="mt-6 flex flex-wrap items-end gap-4 border-t border-[#2B2620]/10 pt-6">
        <div>
          <label className={labelCls} htmlFor="pf-status">
            Status
          </label>
          <select
            id="pf-status"
            className={inputCls}
            value={status}
            onChange={e => setStatus(e.target.value)}
          >
            <option value="DRAFT">Draft</option>
            <option value="ACTIVE">Active (storefront)</option>
            <option value="ARCHIVED">Archived</option>
          </select>
          {isEdit && status === 'ACTIVE' && product?.status !== 'ACTIVE' && (
            <p className="mt-1 text-xs text-[#2B2620]/50">
              Needs ≥1 variant and ≥1 image — upload images below first if new.
            </p>
          )}
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={form.isFeatured}
            onChange={e => set('isFeatured', e.target.checked)}
          />
          Featured
        </label>
        <div className="ml-auto flex items-center gap-3">
          {message && (
            <p
              className={`text-xs ${message.kind === 'error' ? 'text-red-600' : 'text-green-700'}`}
            >
              {message.text}
            </p>
          )}
          <button
            type="submit"
            disabled={saving}
            className="cursor-pointer rounded-full bg-[#2B2620] px-5 py-2 text-xs text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B] disabled:opacity-50"
          >
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create draft →'}
          </button>
        </div>
      </div>
    </form>
  );
}
