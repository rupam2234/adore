import { pool, ProductCardData, ProductImage } from ".";
import { getPublicUrl } from "./cloudinary";

export type { ProductCardData, ProductImage };

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  short_description: string | null;
  details: string[] | null;
  story: string | null;
  material: string | null;
  fit: string | null;
  care_instructions: string | null;
  price: string;
  compare_at_price: string | null;
  currency: string;
  colors: Array<{ name: string; hex: string | null }> | null;
  sizes: Array<{ size: string; stock: number; price: string; compare_at_price: string | null }> | null;
  total_stock: number | null;
  images: Array<{
    id: string;
    public_id: string;
    alt_text: string | null;
    is_primary: boolean;
  }> | null;
};

type QueryOptions = {
  /** Category slug, e.g. "dress" or "summer". Omit for all categories. */
  categorySlug?: string;
  /** Only products marked is_featured (e.g. "new arrivals"). */
  featuredOnly?: boolean;
  /** Max products to return (default 8). */
  limit?: number;
};

/** Map a raw SQL row (products + variant + image aggregates) to ProductCardData. */
function mapProductRow(row: ProductRow): ProductCardData {
  // DB aggregates sizes as snake_case { size, stock, price, compare_at_price };
  // normalize here so client components can read size.price / size.compareAtPrice.
  const sizes = (row.sizes ?? []).map((s) => {
    const raw = s as unknown as Record<string, unknown>;
    const price = (raw.price ?? raw.min_price ?? row.price) as string;
    const compareAtPrice = (raw.compareAtPrice ??
      raw.compare_at_price ??
      null) as string | null;
    return {
      size: String(raw.size),
      stock: Number(raw.stock ?? 0),
      price: String(price),
      compareAtPrice,
    };
  });
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortDescription: row.short_description,
    details: row.details ?? [],
    story: row.story,
    material: row.material,
    fit: row.fit,
    careInstructions: row.care_instructions,
    price: row.price,
    compareAtPrice: row.compare_at_price,
    currency: row.currency,
    colors: row.colors ?? [],
    sizes,
    totalStock: Number(row.total_stock ?? 0),
    images: (row.images ?? []).map((img) => ({
      id: img.id,
      url: getPublicUrl(img.public_id),
      alt: img.alt_text,
      isPrimary: img.is_primary,
    })),
  };
}

/**
 * Fetch products for a homepage/shop section in ONE round trip.
 *
 * - Images are aggregated with json_agg (no N+1 queries).
 * - Price comes from the cheapest active variant.
 * - Image delivery URLs are generated from the Cloudinary public_id.
 */
export async function getProductsForSection(
  options: QueryOptions = {},
): Promise<ProductCardData[]> {
  const { categorySlug, featuredOnly = false, limit = 8 } = options;

  const rows = (await pool`
    SELECT
      p.id,
      p.slug,
      p.name,
      p.short_description,
      p.details,
      p.story,
      p.material,
      p.fit,
      p.care_instructions,
      min_active.price AS price,
      min_active.currency AS currency,
      min_active.compare_at_price AS compare_at_price,
      (
        SELECT json_agg(
          json_build_object('name', c.name, 'hex', c.hex)
          ORDER BY c.name
        )
        FROM (
          SELECT DISTINCT ON (v.color) v.color AS name, v.color_hex AS hex
          FROM product_variants v
          WHERE v.product_id = p.id AND v.is_active
        ) c
      ) AS colors,
      (
        SELECT json_agg(
          json_build_object('size', s.size, 'stock', s.stock, 'price', s.price, 'compare_at_price', s.compare_at_price)
          ORDER BY s.size
        )
        FROM (
          SELECT v.size, SUM(v.stock_quantity) AS stock, MIN(v.price) AS price, (array_agg(v.compare_at_price ORDER BY v.price ASC))[1] AS compare_at_price
          FROM product_variants v
          WHERE v.product_id = p.id AND v.is_active
          GROUP BY v.size
        ) s
      ) AS sizes,
      (
        SELECT COALESCE(SUM(v.stock_quantity), 0)
        FROM product_variants v
        WHERE v.product_id = p.id AND v.is_active
      ) AS total_stock,
      (
        SELECT json_agg(
          json_build_object(
            'id', pi.id,
            'public_id', pi.public_id,
            'alt_text', pi.alt_text,
            'is_primary', pi.is_primary
          ) ORDER BY pi.is_primary DESC, pi.sort_order ASC
        )
        FROM product_images pi
        WHERE pi.product_id = p.id
      ) AS images
    FROM products p
    JOIN LATERAL (
      SELECT v.price, v.currency, v.compare_at_price
      FROM product_variants v
      WHERE v.product_id = p.id AND v.is_active
      ORDER BY v.price ASC
      LIMIT 1
    ) min_active ON TRUE
    WHERE p.status = 'ACTIVE'
      AND ${categorySlug ? pool`EXISTS (
            SELECT 1 FROM product_categories pc
            JOIN categories c ON c.id = pc.category_id
            WHERE pc.product_id = p.id AND c.slug = ${categorySlug}
          )` : pool`TRUE`}
      AND (${featuredOnly} = FALSE OR p.is_featured)
    ORDER BY p.is_featured DESC, p.created_at DESC
    LIMIT ${limit}
  `) as ProductRow[];

  return rows.map(mapProductRow);
}

/**
 * Fetch a single product by slug for the product detail page.
 * Same shape as ProductCardData; returns null when not found or inactive.
 */
export async function getProductBySlug(
  slug: string,
): Promise<ProductCardData | null> {
  const rows = (await pool`
    SELECT
      p.id,
      p.slug,
      p.name,
      p.short_description,
      p.details,
      p.story,
      p.material,
      p.fit,
      p.care_instructions,
      min_active.price AS price,
      min_active.currency AS currency,
      min_active.compare_at_price AS compare_at_price,
      (
        SELECT json_agg(
          json_build_object('name', c.name, 'hex', c.hex)
          ORDER BY c.name
        )
        FROM (
          SELECT DISTINCT ON (v.color) v.color AS name, v.color_hex AS hex
          FROM product_variants v
          WHERE v.product_id = p.id AND v.is_active
        ) c
      ) AS colors,
      (
        SELECT json_agg(
          json_build_object('size', s.size, 'stock', s.stock, 'price', s.price, 'compare_at_price', s.compare_at_price)
          ORDER BY s.size
        )
        FROM (
          SELECT v.size, SUM(v.stock_quantity) AS stock, MIN(v.price) AS price, (array_agg(v.compare_at_price ORDER BY v.price ASC))[1] AS compare_at_price
          FROM product_variants v
          WHERE v.product_id = p.id AND v.is_active
          GROUP BY v.size
        ) s
      ) AS sizes,
      (
        SELECT COALESCE(SUM(v.stock_quantity), 0)
        FROM product_variants v
        WHERE v.product_id = p.id AND v.is_active
      ) AS total_stock,
      (
        SELECT json_agg(
          json_build_object(
            'id', pi.id,
            'public_id', pi.public_id,
            'alt_text', pi.alt_text,
            'is_primary', pi.is_primary
          ) ORDER BY pi.is_primary DESC, pi.sort_order ASC
        )
        FROM product_images pi
        WHERE pi.product_id = p.id
      ) AS images
    FROM products p
    JOIN LATERAL (
      SELECT v.price, v.currency, v.compare_at_price
      FROM product_variants v
      WHERE v.product_id = p.id AND v.is_active
      ORDER BY v.price ASC
      LIMIT 1
    ) min_active ON TRUE
    WHERE p.slug = ${slug} AND p.status = 'ACTIVE'
    LIMIT 1
  `) as ProductRow[];

  const row = rows[0];
  if (!row) return null;

  return mapProductRow(row);
}

/**
 * Fetch related products for the "We think you might enjoy…" section:
 * active products sharing a category with the given product (excluding it),
 * falling back to the newest active products when there are no shared
 * categories. Same shape as ProductCardData.
 */
export async function getRelatedProducts(
  slug: string,
  limit = 4,
): Promise<ProductCardData[]> {
  const categoryFiltered = (await pool`
    SELECT
      p.id,
      p.slug,
      p.name,
      p.short_description,
      p.details,
      p.story,
      p.material,
      p.fit,
      p.care_instructions,
      min_active.price AS price,
      min_active.currency AS currency,
      min_active.compare_at_price AS compare_at_price,
      (
        SELECT json_agg(
          json_build_object('name', c.name, 'hex', c.hex)
          ORDER BY c.name
        )
        FROM (
          SELECT DISTINCT ON (v.color) v.color AS name, v.color_hex AS hex
          FROM product_variants v
          WHERE v.product_id = p.id AND v.is_active
        ) c
      ) AS colors,
      (
        SELECT json_agg(
          json_build_object('size', s.size, 'stock', s.stock, 'price', s.price, 'compare_at_price', s.compare_at_price)
          ORDER BY s.size
        )
        FROM (
          SELECT v.size, SUM(v.stock_quantity) AS stock, MIN(v.price) AS price, (array_agg(v.compare_at_price ORDER BY v.price ASC))[1] AS compare_at_price
          FROM product_variants v
          WHERE v.product_id = p.id AND v.is_active
          GROUP BY v.size
        ) s
      ) AS sizes,
      (
        SELECT COALESCE(SUM(v.stock_quantity), 0)
        FROM product_variants v
        WHERE v.product_id = p.id AND v.is_active
      ) AS total_stock,
      (
        SELECT json_agg(
          json_build_object(
            'id', pi.id,
            'public_id', pi.public_id,
            'alt_text', pi.alt_text,
            'is_primary', pi.is_primary
          ) ORDER BY pi.is_primary DESC, pi.sort_order ASC
        )
        FROM product_images pi
        WHERE pi.product_id = p.id
      ) AS images
    FROM products p
    JOIN LATERAL (
      SELECT v.price, v.currency, v.compare_at_price
      FROM product_variants v
      WHERE v.product_id = p.id AND v.is_active
      ORDER BY v.price ASC
      LIMIT 1
    ) min_active ON TRUE
    WHERE p.status = 'ACTIVE'
      AND p.slug != ${slug}
      AND EXISTS (
        SELECT 1
        FROM product_categories pc
        WHERE pc.product_id = p.id
          AND pc.category_id IN (
            SELECT pc2.category_id
            FROM product_categories pc2
            JOIN products p2 ON p2.id = pc2.product_id
            WHERE p2.slug = ${slug}
          )
      )
    ORDER BY p.is_featured DESC, p.created_at DESC
    LIMIT ${limit}
  `) as ProductRow[];

  if (categoryFiltered.length >= limit) {
    return categoryFiltered.map(mapProductRow);
  }

  // Fallback: fill up with the newest active products excluding the current one
  const filler = (await pool`
    SELECT
      p.id,
      p.slug,
      p.name,
      p.short_description,
      p.details,
      p.story,
      p.material,
      p.fit,
      p.care_instructions,
      min_active.price AS price,
      min_active.currency AS currency,
      min_active.compare_at_price AS compare_at_price,
      (
        SELECT json_agg(
          json_build_object('name', c.name, 'hex', c.hex)
          ORDER BY c.name
        )
        FROM (
          SELECT DISTINCT ON (v.color) v.color AS name, v.color_hex AS hex
          FROM product_variants v
          WHERE v.product_id = p.id AND v.is_active
        ) c
      ) AS colors,
      (
        SELECT json_agg(
          json_build_object('size', s.size, 'stock', s.stock, 'price', s.price, 'compare_at_price', s.compare_at_price)
          ORDER BY s.size
        )
        FROM (
          SELECT v.size, SUM(v.stock_quantity) AS stock, MIN(v.price) AS price, (array_agg(v.compare_at_price ORDER BY v.price ASC))[1] AS compare_at_price
          FROM product_variants v
          WHERE v.product_id = p.id AND v.is_active
          GROUP BY v.size
        ) s
      ) AS sizes,
      (
        SELECT COALESCE(SUM(v.stock_quantity), 0)
        FROM product_variants v
        WHERE v.product_id = p.id AND v.is_active
      ) AS total_stock,
      (
        SELECT json_agg(
          json_build_object(
            'id', pi.id,
            'public_id', pi.public_id,
            'alt_text', pi.alt_text,
            'is_primary', pi.is_primary
          ) ORDER BY pi.is_primary DESC, pi.sort_order ASC
        )
        FROM product_images pi
        WHERE pi.product_id = p.id
      ) AS images
    FROM products p
    JOIN LATERAL (
      SELECT v.price, v.currency, v.compare_at_price
      FROM product_variants v
      WHERE v.product_id = p.id AND v.is_active
      ORDER BY v.price ASC
      LIMIT 1
    ) min_active ON TRUE
    WHERE p.status = 'ACTIVE' AND p.slug != ${slug}
    ORDER BY p.created_at DESC
    LIMIT ${limit}
  `) as ProductRow[];

  const byId = new Map<string, ProductRow>();
  [...categoryFiltered, ...filler].forEach((row) => byId.set(row.id, row));
  return [...byId.values()].slice(0, limit).map(mapProductRow);
}

