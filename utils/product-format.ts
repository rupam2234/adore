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
  careInstructions: string | null;
  price: string;
  /** Original price when on sale (strikethrough next to price). */
  compareAtPrice: string | null;
  currency: string;
  colors: ProductColor[];
  /** Active variants with stock quantity per size. */
  sizes: ProductSizeStock[];
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
