import { and, count, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import {
  db,
  rawQuery,
  categories,
  productCategories,
  productImages,
  productVariants,
  products,
} from "./db";
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
      ? await db
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.slug, candidate), ne(products.id, excludeId)))
          .limit(1)
      : await db
          .select({ id: products.id })
          .from(products)
          .where(eq(products.slug, candidate))
          .limit(1);
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

  const inserted = await db
    .insert(products)
    .values({
      name: payload.name,
      slug,
      shortDescription: payload.shortDescription,
      details: payload.details,
      story: payload.story,
      material: payload.material,
      careInstructions: payload.careInstructions,
      fit: payload.fit,
      status: "DRAFT",
      isFeatured: payload.isFeatured,
    })
    .returning({ id: products.id, slug: products.slug });
  const product = inserted[0];

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
  await db
    .update(productVariants)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(productVariants.productId, productId));

  if (variants.length > 0) {
    await db
      .insert(productVariants)
      .values(
        variants.map((v) => ({
          productId,
          sku: buildSku(slug, v),
          color: v.color,
          colorHex: v.colorHex,
          size: v.size,
          price: String(v.price),
          compareAtPrice: v.compareAtPrice === null ? null : String(v.compareAtPrice),
          currency: "INR",
          stockQuantity: v.stock,
          isActive: true,
        })),
      )
      .onConflictDoUpdate({
        target: [productVariants.productId, productVariants.color, productVariants.size],
        set: {
          sku: sql`excluded.sku`,
          colorHex: sql`excluded.color_hex`,
          price: sql`excluded.price`,
          compareAtPrice: sql`excluded.compare_at_price`,
          stockQuantity: sql`excluded.stock_quantity`,
          isActive: sql`true`,
          updatedAt: sql`NOW()`,
        },
      });
  }
}

/** Replace the product's category links with the given slugs. */
export async function syncCategories(
  productId: string,
  categorySlugs: string[],
): Promise<void> {
  if (categorySlugs.length === 0) {
    await db
      .delete(productCategories)
      .where(eq(productCategories.productId, productId));
    return;
  }

  // Unknown slugs are skipped (checkpoint: bad ids never 500 the request)
  const matched = await db
    .select({ id: categories.id })
    .from(categories)
    .where(inArray(categories.slug, categorySlugs));

  for (const c of matched) {
    await db
      .insert(productCategories)
      .values({ productId, categoryId: c.id })
      .onConflictDoNothing();
  }

  // Remove links not in the payload
  const keepIds = matched.map((c) => c.id);
  await db.delete(productCategories).where(
    keepIds.length > 0
      ? and(
          eq(productCategories.productId, productId),
          notInArray(productCategories.categoryId, keepIds),
        )
      : eq(productCategories.productId, productId),
  );
}

/** Update an existing product (fields + variants + categories + status). */
export async function updateProduct(
  productId: string,
  payload: ProductPayload,
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const current = await db
    .select({ id: products.id, slug: products.slug, status: products.status })
    .from(products)
    .where(eq(products.id, productId));
  if (current.length === 0) return { ok: false, error: "Product not found" };

  const row = current[0];
  const slug =
    payload.slug === row.slug ? row.slug : await uniqueSlug(payload.slug, productId);

  await db
    .update(products)
    .set({
      name: payload.name,
      slug,
      shortDescription: payload.shortDescription,
      details: payload.details,
      story: payload.story,
      material: payload.material,
      careInstructions: payload.careInstructions,
      fit: payload.fit,
      isFeatured: payload.isFeatured,
      updatedAt: new Date(),
    })
    .where(eq(products.id, productId));

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
    const [variantRows, imageRows] = await Promise.all([
      db
        .select({ c: count() })
        .from(productVariants)
        .where(
          and(
            eq(productVariants.productId, productId),
            eq(productVariants.isActive, true),
          ),
        ),
      db
        .select({ c: count() })
        .from(productImages)
        .where(eq(productImages.productId, productId)),
    ]);
    const variants = Number(variantRows[0]?.c ?? 0);
    const images = Number(imageRows[0]?.c ?? 0);
    if (variants === 0)
      return { ok: false, error: "Cannot activate: at least one active variant is required." };
    if (images === 0)
      return { ok: false, error: "Cannot activate: upload at least one image first." };
  }

  await db
    .update(products)
    .set({ status, updatedAt: new Date() })
    .where(eq(products.id, productId));
  return { ok: true };
}

/** Soft-delete a product (ARCHIVED). The storefront stops seeing it. */
export async function archiveProduct(productId: string): Promise<boolean> {
  const rows = await db
    .update(products)
    .set({ status: "ARCHIVED", updatedAt: new Date() })
    .where(eq(products.id, productId))
    .returning({ id: products.id });
  return rows.length > 0;
}

/** List every product (all statuses) with light aggregates for the admin table. */
export async function listAdminProducts(search = ""): Promise<
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
  const rows = await rawQuery<Record<string, unknown>>(sql`
    SELECT p.id, p.name, p.slug, p.status, p.is_featured, p.updated_at,
      (SELECT COUNT(*) FROM product_variants v
       WHERE v.product_id = p.id AND v.is_active) AS variant_count,
      (SELECT COUNT(*) FROM product_images i WHERE i.product_id = p.id) AS image_count,
      (SELECT MIN(v.price) FROM product_variants v
       WHERE v.product_id = p.id AND v.is_active) AS min_price
    FROM products p
    WHERE (${search.trim()} = ''
      OR STRPOS(LOWER(p.name), LOWER(${search.trim()})) > 0
      OR STRPOS(LOWER(p.slug), LOWER(${search.trim()})) > 0
      OR EXISTS (
        SELECT 1 FROM product_variants sv
        WHERE sv.product_id = p.id
          AND STRPOS(LOWER(sv.sku), LOWER(${search.trim()})) > 0
      ))
    ORDER BY p.updated_at DESC`);
  return rows.map((r) => ({
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
  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      short_description: products.shortDescription,
      details: products.details,
      story: products.story,
      material: products.material,
      care_instructions: products.careInstructions,
      fit: products.fit,
      status: products.status,
      is_featured: products.isFeatured,
    })
    .from(products)
    .where(eq(products.id, productId));
  if (rows.length === 0) return null;

  const p = rows[0];

  const [variantRows, imageRows, categoryRows] = await Promise.all([
    db
      .select({
        id: productVariants.id,
        color: productVariants.color,
        color_hex: productVariants.colorHex,
        size: productVariants.size,
        price: productVariants.price,
        compare_at_price: productVariants.compareAtPrice,
        stock_quantity: productVariants.stockQuantity,
        is_active: productVariants.isActive,
      })
      .from(productVariants)
      .where(eq(productVariants.productId, productId))
      .orderBy(desc(productVariants.isActive), productVariants.color, productVariants.size),
    db
      .select({
        id: productImages.id,
        public_id: productImages.publicId,
        secure_url: productImages.secureUrl,
        alt_text: productImages.altText,
        sort_order: productImages.sortOrder,
        is_primary: productImages.isPrimary,
      })
      .from(productImages)
      .where(eq(productImages.productId, productId))
      .orderBy(desc(productImages.isPrimary), productImages.sortOrder),
    db
      .select({ slug: categories.slug })
      .from(productCategories)
      .innerJoin(categories, eq(categories.id, productCategories.categoryId))
      .where(eq(productCategories.productId, productId)),
  ]);

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
  const rows = await db
    .select({ id: productImages.id, publicId: productImages.publicId })
    .from(productImages)
    .where(and(eq(productImages.id, imageId), eq(productImages.productId, productId)));
  if (rows.length === 0) return { ok: false, error: "Image not found" };

  const wasPrimary = await db
    .select({ isPrimary: productImages.isPrimary })
    .from(productImages)
    .where(eq(productImages.id, imageId));
  await db.delete(productImages).where(eq(productImages.id, imageId));

  // Fallback: if we removed the primary, promote the first remaining image
  if (wasPrimary[0]?.isPrimary) {
    await db
      .update(productImages)
      .set({ isPrimary: true })
      .where(eq(
        productImages.id,
        db
          .select({ id: productImages.id })
          .from(productImages)
          .where(eq(productImages.productId, productId))
          .orderBy(productImages.sortOrder)
          .limit(1),
      ));
  }

  return { ok: true, publicId: rows[0].publicId };
}

/** Set which image is primary (exactly one per product). */
export async function setPrimaryImage(
  productId: string,
  imageId: string,
): Promise<boolean> {
  const owned = await db
    .select({ id: productImages.id })
    .from(productImages)
    .where(and(eq(productImages.id, imageId), eq(productImages.productId, productId)));
  if (owned.length === 0) return false;

  await db
    .update(productImages)
    .set({ isPrimary: false })
    .where(eq(productImages.productId, productId));
  await db
    .update(productImages)
    .set({ isPrimary: true })
    .where(eq(productImages.id, imageId));
  return true;
}