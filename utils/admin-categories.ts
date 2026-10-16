/**
 * Admin-side category management for the size-chart pipeline.
 *
 * The taxonomy itself is static code (utils/categories.ts — the single source
 * of truth); the `categories` table mirrors it so products can link to rows.
 * Rows are created by whatever seeded the table, so before the admin lists
 * categories we make sure every taxonomy slug HAS a row (and its parent link),
 * otherwise a category could silently be missing from the size-chart manager.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { db, rawQuery, sql } from './db';
import { categories } from './schema';
import { ALL_CATEGORIES, CATEGORY_PARENTS } from './categories';

export type AdminCategory = {
  id: string;
  slug: string;
  name: string;
  parentSlug: string | null;
  parentName: string | null;
  sizeChartUrl: string | null;
};

/**
 * Idempotently create any taxonomy category that is missing a DB row, and link
 * children to parents. Cheap (a handful of rows), admin-triggered only, and
 * safe to run on every page load: existing rows are never rewritten.
 */
export async function ensureCategoryRows(): Promise<void> {
  const existing = await db
    .select({ id: categories.id, slug: categories.slug })
    .from(categories);
  const idBySlug = new Map(existing.map(row => [row.slug, row.id]));

  for (const cat of ALL_CATEGORIES) {
    if (idBySlug.has(cat.slug)) continue;
    const rows = await db
      .insert(categories)
      .values({
        slug: cat.slug,
        name: cat.name,
        description: cat.description,
      })
      .onConflictDoNothing({ target: categories.slug })
      .returning({ id: categories.id });
    if (rows[0]) idBySlug.set(cat.slug, rows[0].id);
  }

  // Link children to parents. The `parent_id IS NULL` guard keeps this a no-op
  // for rows that are already linked (and never overrides a manual link).
  for (const [childSlug, parentSlug] of Object.entries(CATEGORY_PARENTS)) {
    const childId = idBySlug.get(childSlug);
    const parentId = idBySlug.get(parentSlug);
    if (!childId || !parentId) continue;
    await db
      .update(categories)
      .set({ parentId })
      .where(and(eq(categories.id, childId), isNull(categories.parentId)));
  }
}

/**
 * Every category with its parent link and current size-chart state, ordered
 * parent-first then by slug — the order the size-chart manager renders.
 */
export async function listCategoriesForAdmin(): Promise<AdminCategory[]> {
  return rawQuery<AdminCategory>(sql`
    SELECT
      c.id,
      c.slug,
      c.name,
      c.size_chart_url AS "sizeChartUrl",
      p.slug AS "parentSlug",
      p.name AS "parentName"
    FROM categories c
    LEFT JOIN categories p ON p.id = c.parent_id
    ORDER BY COALESCE(p.slug, c.slug) ASC,
             (p.id IS NOT NULL) ASC,
             c.slug ASC
  `);
}
