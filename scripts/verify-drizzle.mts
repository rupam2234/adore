/**
 * Read-only smoke test for the Drizzle migration. Loads .env.local, calls the
 * converted query helpers, prints row counts. Never writes to the DB.
 */
import { readFileSync } from "fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const { getProductsForSection, getProductBySlug, getCategories, getRelatedProducts } = await import("../utils/products.ts");
const { getReviewSummary, getApprovedReviews, getProductIdBySlug } = await import("../utils/reviews.ts");
const { listAdminProducts } = await import("../utils/admin-products.ts");
const { getUserByEmail } = await import("../utils/auth.ts");
const { db, users } = await import("../utils/db.ts");
const { count } = await import("drizzle-orm");

const checks: Array<[string, () => Promise<unknown>]> = [
  ["getCategories", () => getCategories()],
  ["getProductsForSection (no filter)", () => getProductsForSection()],
  ["getProductsForSection (category)", () => getProductsForSection({ categorySlug: "kurti", limit: 4 })],
  ["getProductsForSection (featured)", () => getProductsForSection({ featuredOnly: true, limit: 4 })],
  ["users count", () => db.select({ c: count() }).from(users)],
  ["listAdminProducts", () => listAdminProducts()],
];

let failed = 0;
for (const [name, fn] of checks) {
  try {
    const r = await fn();
    const n = Array.isArray(r) ? r.length : "ok";
    console.log(`✔ ${name}: ${n}`);
  } catch (e) {
    failed++;
    console.error(`✘ ${name}:`, (e as Error).message);
  }
}

// Dependent checks need real ids/slugs
try {
  const cats = await getCategories();
  if (cats[0]) {
    const byCat = await getProductsForSection({ categorySlug: cats[0].slug, limit: 4 });
    console.log(`✔ getProductsForSection (${cats[0].slug}): ${byCat.length}`);
  }
  await listAdminProducts();
  const active = await getProductsForSection({ limit: 1 });
  const slug = active[0]?.slug;
  if (slug) {
    const p = await getProductBySlug(slug);
    console.log(`✔ getProductBySlug(${slug}): ${p ? "found, sizes=" + p.sizes.length : "null"}`);
    const rel = await getRelatedProducts(slug, 4);
    console.log(`✔ getRelatedProducts: ${rel.length}`);
    const pid = await getProductIdBySlug(slug);
    if (pid) {
      console.log(`✔ getProductIdBySlug: ${pid}`);
      console.log(`✔ getReviewSummary: avg=${(await getReviewSummary(pid)).average}`);
      console.log(`✔ getApprovedReviews: ${(await getApprovedReviews(pid)).total} total`);
    }
  }
  console.log(`✔ user lookup (nonexistent email): ${await getUserByEmail("nobody@example.invalid")}`);
} catch (e) {
  failed++;
  console.error("✘ dependent checks:", (e as Error).message);
}

console.log(failed === 0 ? "ALL CHECKS PASSED" : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
