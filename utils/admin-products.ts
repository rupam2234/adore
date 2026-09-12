import { pool } from "./db.ts";
import { getPublicUrl } from "./cloudinary.ts";
import { buildSku, slugify, type ProductPayload, type ProductStatus } from "./admin-schema.ts";

/**
 * Admin product pipeline — all DB reads/writes for the admin product pages.
 *
 * Design rules (checkpoints / fallbacks):
 * - Products are created as DRAFT first; the storefront only queries
 *   status = 'ACTIVE', so partial products are invisible to shoppers.
 * - Variant sync deactivates all existing rows, then upserts the payload
 *   (ON CONFLICT (product_id, color, size)). Removed variants are never
 *   hard-deleted, so image references and history survive.
 * - Category sync deletes only removed links and upserts the rest.
 * - Activation (DRAFT → ACTIVE) is gated: ≥1 active variant and ≥1 image.
 */

/** Generate a unique product slug (appends -2, -3, … on collision). */
export async function uniqueSlug(
  base: string,
  excludeId?: string,
): Promise<string> {
  const root = slugify(base) || "product";
  for (let i = 1; i < 100; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    const rows = excludeId
      ? await pool`SELECT 1 FROM products WHERE slug = ${candidate} AND id <> ${excludeId} LIMIT 1`
      : await pool`SELECT 1 FROM products WHERE slug = ${candidate} LIMIT 1`;
    if (rows.length === 0) return candidate;
  }
  return `${root}-${Date.now()}`;
}

/** Create a DRAFT product with its variants + categories. Returns id + slug. */
export async function createProduct(payload: ProductPayload): Promise<{
  id: string;
  slug: string;
}> {
  const slug = await uniqueSlug(payload.slug);

  const rows = await pool`
    INSERT INTO products
      (name, slug, short_description, details, story, material,
       care_instructions, fit, status, is_featured)
    VALUES
      (${payload.name}, ${slug}, ${payload.shortDescription},
       ${JSON.stringify(payload.details)}::jsonb, ${payload.story},
       ${payload.material}, ${payload.careInstructions}, ${payload.fit},
       'DRAFT'::product_status, ${payload.isFeatured})
    RETURNING id, slug`;
  const product = rows[0] as { id: string; slug: string };

  await syncVariants(product.id, product.slug, payload.variants);
  await syncCategories(product.id, payload.categorySlugs);

  return product;
}

/** Sync variants: deactivate all, then upsert the payload rows as active. */
async function syncVariants(
  productId: string,
  slug: string,
  variants: ProductPayload["variants"],
): Promise<void> {
  await pool`
    UPDATE product_variants SET is_active = false, updated_at = NOW()
    WHERE product_id = ${productId}`;

  for (const v of variants) {
    await pool`
      INSERT INTO product_variants
        (product_id, sku, color, color_hex, size, price, compare_at_price,
         currency, stock_quantity, is_active)
      VALUES
        (${productId}, ${buildSku(slug, v)}, ${v.color}, ${v.colorHex},
         ${v.size}, ${v.price}, ${v.compareAtPrice}, 'INR', ${v.stock}, true)
      ON CONFLICT (product_id, color, size) DO UPDATE SET
        sku = EXCLUDED.sku,
        color_hex = EXCLUDED.color_hex,
        price = EXCLUDED.price,
        compare_at_price = EXCLUDED.compare_at_price,
        stock_quantity = EXCLUDED.stock_quantity,
        is_active = true,
        updated_at = NOW()`;
  }
}

/** Replace the product's category links with the given slugs. */
export async function syncCategories(
  productId: string,
  categorySlugs: string[],
): Promise<void> {
  if (categorySlugs.length === 0) {
    await pool`
      DELETE FROM product_categories WHERE product_id = ${productId}`;
    return;
  }

  // Unknown slugs are skipped (checkpoint: bad ids never 500 the request)
  const categories = await pool`
    SELECT id FROM categories
    WHERE slug = ANY(${categorySlugs}::text[])`;

  for (const c of categories) {
    await pool`
      INSERT INTO product_categories (product_id, category_id)
      VALUES (${productId}, ${c.id})
      ON CONFLICT DO NOTHING`;
  }

  // Remove links not in the payload
  const keepIds = (categories as { id: string }[]).map((c) => c.id);
  await pool`
    DELETE FROM product_categories
    WHERE product_id = ${productId}
      AND category_id <> ALL(${keepIds}::uuid[])`;
}

/** Update an existing product (fields + variants + categories + status). */
export async function updateProduct(
  productId: string,
  payload: ProductPayload,
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const current = await pool`
    SELECT id, slug, status FROM products WHERE id = ${productId}`;
  if (current.length === 0) return { ok: false, error: "Product not found" };

  const row = current[0] as { slug: string; status: ProductStatus };
  const slug =
    payload.slug === row.slug ? row.slug : await uniqueSlug(payload.slug, productId);

  await pool`
    UPDATE products SET
      name = ${payload.name},
      slug = ${slug},
      short_description = ${payload.shortDescription},
      details = ${JSON.stringify(payload.details)}::jsonb,
      story = ${payload.story},
      material = ${payload.material},
      care_instructions = ${payload.careInstructions},
      fit = ${payload.fit},
      is_featured = ${payload.isFeatured},
      updated_at = NOW()
    WHERE id = ${productId}`;

  await syncVariants(productId, slug, payload.variants);
  await syncCategories(productId, payload.categorySlugs);

  // Status checkpoint: activation is validated, other transitions set directly.
  if (payload.status !== row.status) {
    const activation = await setStatus(productId, payload.status);
    if (!activation.ok) return activation;
  }

  return { ok: true, slug };
}

/**
 * Set product status with an activation checkpoint:
 * → ACTIVE requires ≥1 active variant and ≥1 image.
 */
export async function setStatus(
  productId: string,
  status: ProductStatus,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (status === "ACTIVE") {
    const checks = await pool`
      SELECT
        (SELECT COUNT(*) FROM product_variants
         WHERE product_id = ${productId} AND is_active) AS variants,
        (SELECT COUNT(*) FROM product_images
         WHERE product_id = ${productId}) AS images`;
    const { variants, images } = checks[0] as { variants: number; images: number };
    if (Number(variants) === 0)
      return { ok: false, error: "Cannot activate: at least one active variant is required." };
    if (Number(images) === 0)
      return { ok: false, error: "Cannot activate: upload at least one image first." };
  }

  await pool`
    UPDATE products SET status = ${status}::product_status, updated_at = NOW()
    WHERE id = ${productId}`;
  return { ok: true };
}

/** Soft-delete a product (ARCHIVED). The storefront stops seeing it. */
export async function archiveProduct(productId: string): Promise<boolean> {
  const rows = await pool`
    UPDATE products SET status = 'ARCHIVED'::product_status, updated_at = NOW()
    WHERE id = ${productId} RETURNING id`;
  return rows.length > 0;
}

/** List every product (all statuses) with light aggregates for the admin table. */
export async function listAdminProducts(): Promise<
  {
    id: string;
    name: string;
    slug: string;
    status: ProductStatus;
    isFeatured: boolean;
    variantCount: number;
    imageCount: number;
    minPrice: number | null;
    updatedAt: string;
  }[]
> {
  const rows = await pool`
    SELECT p.id, p.name, p.slug, p.status, p.is_featured, p.updated_at,
      (SELECT COUNT(*) FROM product_variants v
       WHERE v.product_id = p.id AND v.is_active) AS variant_count,
      (SELECT COUNT(*) FROM product_images i WHERE i.product_id = p.id) AS image_count,
      (SELECT MIN(v.price) FROM product_variants v
       WHERE v.product_id = p.id AND v.is_active) AS min_price
    FROM products p
    ORDER BY p.updated_at DESC`;
  return (rows as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    slug: r.slug as string,
    status: r.status as ProductStatus,
    isFeatured: r.is_featured as boolean,
    variantCount: Number(r.variant_count ?? 0),
    imageCount: Number(r.image_count ?? 0),
    minPrice: r.min_price === null ? null : Number(r.min_price),
    updatedAt: String(r.updated_at),
  }));
}

/** Load one product with variants, images and category slugs for the edit form. */
export async function getAdminProduct(productId: string) {
  const rows = await pool`
    SELECT id, slug, name, short_description, details, story, material,
           care_instructions, fit, status, is_featured
    FROM products WHERE id = ${productId}`;
  if (rows.length === 0) return null;

  const p = rows[0] as Record<string, unknown>;

  const variantRows = await pool`
    SELECT id, color, color_hex, size, price, compare_at_price,
           stock_quantity, is_active
    FROM product_variants WHERE product_id = ${productId}
    ORDER BY is_active DESC, color, size`;
  const imageRows = await pool`
    SELECT id, public_id, secure_url, alt_text, sort_order, is_primary
    FROM product_images WHERE product_id = ${productId}
    ORDER BY is_primary DESC, sort_order`;
  const categoryRows = await pool`
    SELECT c.slug FROM product_categories pc
    JOIN categories c ON c.id = pc.category_id
    WHERE pc.product_id = ${productId}`;

  return {
    id: p.id as string,
    slug: p.slug as string,
    name: p.name as string,
    shortDescription: (p.short_description as string | null) ?? null,
    details: (p.details as string[] | null) ?? [],
    story: (p.story as string | null) ?? null,
    material: (p.material as string | null) ?? null,
    careInstructions: (p.care_instructions as string | null) ?? null,
    fit: (p.fit as string | null) ?? null,
    status: p.status as ProductStatus,
    isFeatured: p.is_featured as boolean,
    categorySlugs: (categoryRows as { slug: string }[]).map((c) => c.slug),
    variants: (variantRows as Record<string, unknown>[]).map((v) => ({
      id: v.id as string,
      color: v.color as string,
      colorHex: (v.color_hex as string | null) ?? null,
      size: v.size as string,
      price: String(v.price ?? ""),
      compareAtPrice:
        v.compare_at_price === null ? null : String(v.compare_at_price),
      stock: Number(v.stock_quantity ?? 0),
      isActive: v.is_active as boolean,
    })),
    images: (imageRows as Record<string, unknown>[]).map((i) => ({
      id: i.id as string,
      publicId: i.public_id as string,
      // Build the delivery URL from public_id, exactly like the storefront —
      // never trust the stored secure_url, which can go stale (cloud/env
      // changes) and is what previously broke the admin image grid.
      url: getPublicUrl(i.public_id as string),
      secureUrl: i.secure_url as string,
      altText: (i.alt_text as string | null) ?? null,
      sortOrder: Number(i.sort_order ?? 0),
      isPrimary: i.is_primary as boolean,
    })),
  };
}

/** Delete one image: Cloudinary asset + DB row (order matters — DB first). */
export async function deleteProductImage(
  productId: string,
  imageId: string,
): Promise<{ ok: true; publicId: string } | { ok: false; error: string }> {
  const rows = await pool`
    SELECT id, public_id FROM product_images
    WHERE id = ${imageId} AND product_id = ${productId}`;
  if (rows.length === 0) return { ok: false, error: "Image not found" };

  const wasPrimary = await pool`
    SELECT is_primary FROM product_images WHERE id = ${imageId}`;
  await pool`DELETE FROM product_images WHERE id = ${imageId}`;

  // Fallback: if we removed the primary, promote the first remaining image
  if (wasPrimary[0]?.is_primary) {
    await pool`
      UPDATE product_images SET is_primary = true
      WHERE id = (
        SELECT id FROM product_images WHERE product_id = ${productId}
        ORDER BY sort_order LIMIT 1
      )`;
  }

  return { ok: true, publicId: rows[0].public_id as string };
}

/** Set which image is primary (exactly one per product). */
export async function setPrimaryImage(
  productId: string,
  imageId: string,
): Promise<boolean> {
  const owned = await pool`
    SELECT 1 FROM product_images WHERE id = ${imageId} AND product_id = ${productId}`;
  if (owned.length === 0) return false;

  await pool`
    UPDATE product_images SET is_primary = false WHERE product_id = ${productId}`;
  await pool`
    UPDATE product_images SET is_primary = true WHERE id = ${imageId}`;
  return true;
}