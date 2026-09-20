/**
 * Admin product pipeline — shared types + server-side validation.
 *
 * Every write path validates its payload here before touching the DB, so a
 * bad request fails at the first checkpoint with per-field errors instead of
 * leaving half-written rows behind.
 */

export type ProductStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export const PRODUCT_STATUSES: ProductStatus[] = [
  'DRAFT',
  'ACTIVE',
  'ARCHIVED',
];

export type VariantInput = {
  color: string;
  colorHex: string | null;
  size: string;
  price: number;
  compareAtPrice: number | null;
  stock: number;
};

export type ProductPayload = {
  name: string;
  slug: string;
  shortDescription: string | null;
  details: string[];
  story: string | null;
  material: string | null;
  careInstructions: string | null;
  fit: string | null;
  /** Packed weight per unit in grams. Null → 400g estimate is used. */
  weightGrams: number | null;
  status: ProductStatus;
  isFeatured: boolean;
  categorySlugs: string[];
  variants: VariantInput[];
};

/** Fallback packed weight (grams/unit) when a product has none set. */
export const DEFAULT_WEIGHT_GRAMS = 400;

export type FieldErrors = Record<string, string>;

/** Slugify a string into a URL-safe slug. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Deterministic SKU for a variant: {slug}-{color}-{size}. */
export function buildSku(slug: string, variant: VariantInput): string {
  return slugify(`${slug}-${variant.color}-${variant.size}`);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalStr(value: unknown): string | null {
  const s = str(value);
  return s.length > 0 ? s : null;
}

function num(value: unknown): number | null {
  if (value == null || (typeof value === 'string' && !value.trim()))
    return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const n = typeof value === 'number' ? value : Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

/** Validate a product payload; returns the normalized payload or field errors. */
export function validateProductPayload(
  input: Record<string, unknown>
): { ok: true; value: ProductPayload } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};

  const name = str(input.name);
  if (name.length < 2) errors.name = 'Name must be at least 2 characters.';
  if (name.length > 120) errors.name = 'Name must be at most 120 characters.';

  const slug = slugify(str(input.slug) || name);
  if (slug.length < 2) errors.slug = 'Slug is required.';

  const status = PRODUCT_STATUSES.includes(input.status as ProductStatus)
    ? (input.status as ProductStatus)
    : 'DRAFT';

  // details: jsonb string list — one bullet per non-empty line
  const details = Array.isArray(input.details)
    ? input.details.map(d => str(d)).filter(Boolean)
    : str(input.details)
        .split('\n')
        .map(d => d.trim())
        .filter(Boolean);

  const variantsRaw = Array.isArray(input.variants) ? input.variants : [];
  const variants: VariantInput[] = [];
  const seen = new Set<string>();
  variantsRaw.forEach((raw, i) => {
    const v = (raw ?? {}) as Record<string, unknown>;
    const color = str(v.color);
    const size = str(v.size);
    const price = num(v.price);
    const compareAtPrice = num(v.compareAtPrice);
    const stock = num(v.stock) ?? 0;

    const label = `variants.${i}`;
    if (!color) errors[`${label}.color`] = 'Colour is required.';
    if (!size) errors[`${label}.size`] = 'Size is required.';
    if (price === null || price <= 0)
      errors[`${label}.price`] = 'Price must be a positive number.';
    if (
      v.compareAtPrice != null &&
      !(typeof v.compareAtPrice === 'string' && !v.compareAtPrice.trim()) &&
      compareAtPrice === null
    )
      errors[`${label}.compareAtPrice`] =
        'Compare-at price must be a valid number or left blank.';
    else if (
      compareAtPrice !== null &&
      price !== null &&
      compareAtPrice <= price
    )
      errors[`${label}.compareAtPrice`] =
        'Compare-at price must be higher than price to show a discount.';
    if (stock < 0) errors[`${label}.stock`] = 'Stock cannot be negative.';

    const key = `${color}|${size}`;
    if (color && size) {
      if (seen.has(key))
        errors[`${label}.size`] = `Duplicate variant ${color}/${size}.`;
      seen.add(key);
    }

    variants.push({
      color,
      colorHex: optionalStr(v.colorHex),
      size,
      price: price ?? 0,
      compareAtPrice,
      stock: Math.max(0, Math.floor(stock)),
    });
  });
  if (variants.length === 0)
    errors.variants = 'At least one variant is required.';

  const categorySlugs = Array.isArray(input.categorySlugs)
    ? input.categorySlugs.map(c => str(c)).filter(Boolean)
    : [];

  // weightGrams: optional packed weight per unit (grams). Blank → null
  // (falls back to the 400g estimate); otherwise a sane positive integer.
  let weightGrams: number | null = null;
  const rawWeight = num(input.weightGrams);
  if (rawWeight !== null) {
    if (rawWeight <= 0 || rawWeight > 50_000)
      errors.weightGrams = 'Weight must be between 1 and 50,000 grams.';
    else weightGrams = Math.floor(rawWeight);
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      slug,
      shortDescription: optionalStr(input.shortDescription),
      details,
      story: optionalStr(input.story),
      material: optionalStr(input.material),
      careInstructions: optionalStr(input.careInstructions),
      fit: optionalStr(input.fit),
      weightGrams,
      status,
      isFeatured: input.isFeatured === true,
      categorySlugs,
      variants,
    },
  };
}

/** A variant row as returned by the admin read path. */
export type AdminVariant = {
  id: string;
  color: string;
  colorHex: string | null;
  size: string;
  price: string;
  compareAtPrice: string | null;
  stock: number;
  isActive: boolean;
};

export type AdminProduct = {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  details: string[];
  story: string | null;
  material: string | null;
  careInstructions: string | null;
  fit: string | null;
  /** Packed weight per unit in grams. Null → 400g estimate is used. */
  weightGrams: number | null;
  status: ProductStatus;
  isFeatured: boolean;
  categorySlugs: string[];
  variants: AdminVariant[];
  images: {
    id: string;
    publicId: string;
    secureUrl: string;
    altText: string | null;
    sortOrder: number;
    isPrimary: boolean;
  }[];
};
