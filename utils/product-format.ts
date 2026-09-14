/** Shared product types + pure helpers — safe to import in client components. */

export type ProductImage = {
  id: string;
  url: string;
  alt: string | null;
  isPrimary: boolean;
};

export type ProductColor = {
  name: string;
  hex: string | null;
};

export type ProductSizeStock = {
  size: string;
  stock: number;
  /** Cheapest active variant price for this size (price varies by size). */
  price: string;
  /** Compare-at price of the cheapest active variant for this size. */
  compareAtPrice: string | null;
};

export type ProductVariantOption = {
  id: string;
  color: string;
  colorHex: string | null;
  size: string;
  price: string;
  compareAtPrice: string | null;
  stock: number;
};

export type ProductCategory = {
  slug: string;
  name: string;
  parentSlug: string | null;
};

export type ProductCardData = {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  /** Detail bullets rendered as a list in the quick view ("Knitted in Peru", ...). */
  details: string[];
  story: string | null;
  material: string | null;
  fit: string | null;
  /** Cloth-care bullets rendered as a list, like details. */
  careInstructions: string[];
  /** Garment class(es), e.g. dress / kurti / short-kurti (with parent link). */
  categories: ProductCategory[];
  price: string;
  /** Original price when on sale (strikethrough next to price). */
  compareAtPrice: string | null;
  currency: string;
  colors: ProductColor[];
  /** Active variants with stock quantity per size. */
  sizes: ProductSizeStock[];
  /** Active variants for cart selection (color + size → variant id). */
  variants: ProductVariantOption[];
  totalStock: number;
  images: ProductImage[];
};

/** Format a DB price ("2499.00", INR) for display. */
export function formatPrice(price: string, currency: string): string {
  const amount = Number(price);
  const symbol = currency === "INR" ? "₹" : `${currency} `;
  return `${symbol}${amount.toLocaleString("en-IN", {
    maximumFractionDigits: 0,
  })}`;
}

/**
 * Normalize cloth-care instructions to a bullet list, like `details`.
 *
 * Accepts the legacy `text` value, a `jsonb` list (post-migration), or null:
 * - `["Machine wash cold.", "Do not bleach."]` → as-is (trimmed)
 * - `"Machine wash cold.\nDo not bleach."` → split on newlines
 * - `"Machine wash cold. Do not bleach. Hang dry."` → split into sentences
 *   so existing single-paragraph rows still render as a real list.
 */
export function normalizeCareInstructions(value: unknown): string[] {
  const cleaned = (s: string) =>
    s
      .replace(/^[\s\-•*·>]+/, "")
      .replace(/^\d+[.)\s]+/, "")
      .trim();
  const splitSentences = (s: string) =>
    s
      .split(/(?<=\.)\s+(?=[A-Z0-9"])/)
      .map(cleaned)
      .filter(Boolean);

  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (entry == null) return [];
      const text = String(entry).trim();
      if (!text) return [];
      // Array items may still hold newlines or multi-sentence prose.
      return text.split(/\r?\n+/).flatMap(splitSentences);
    });
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    return text.split(/\r?\n+/).flatMap(splitSentences);
  }
  return [];
}
