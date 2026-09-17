import Link from "next/link";
import { formatPrice } from "@/utils";
import { listAdminProducts } from "@/utils/admin-products";
import { requireAdminPage } from "@/utils/admin-session";
import { DeleteProductButton } from "@/components/admin/delete-product-button";

export const metadata = {
  title: "Products — Admin",
  robots: { index: false, follow: false },
};

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-amber-100 text-amber-800",
  ACTIVE: "bg-green-100 text-green-800",
  ARCHIVED: "bg-neutral-200 text-neutral-600",
};

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  await requireAdminPage();
  const params = await searchParams;
  const query = (typeof params.q === "string" ? params.q : "").trim();

  let products: Awaited<ReturnType<typeof listAdminProducts>> = [];
  let error: string | null = null;
  try {
    products = await listAdminProducts(query);
  } catch {
    error = "Could not load products — check the database connection.";
  }

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <h1 className="font-admin font-semibold text-2xl">Products</h1>
        <Link
          href="/admin/products/new"
          className="rounded-full bg-[#2B2620] px-4 py-2 text-xs text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B]"
        >
          + New product
        </Link>
      </div>

      {error && (
        <p className="mt-6 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <form
        action="/admin"
        method="GET"
        role="search"
        className="mt-6 flex flex-wrap items-end gap-3"
      >
        <div className="w-full sm:max-w-lg">
          <label
            htmlFor="product-search"
            className="mb-2 block text-sm font-medium"
          >
            Search products
          </label>
          <input
            key={query}
            id="product-search"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Product name, slug, or SKU"
            className="w-full rounded-lg border border-[#2B2620]/20 bg-white px-4 py-2 text-sm outline-none focus:border-[#5C6B4B] focus:ring-2 focus:ring-[#5C6B4B]/20"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-[#2B2620] px-5 py-2 text-sm font-medium text-white hover:bg-[#5C6B4B]"
        >
          Search
        </button>
        {query && (
          <Link
            href="/admin"
            className="px-2 py-2 text-sm font-medium hover:underline"
          >
            Clear
          </Link>
        )}
      </form>
      {!error && (
        <p className="mt-3 text-sm text-[#2B2620]/70">
          {products.length} {products.length === 1 ? "product" : "products"}
          {query ? ` matching “${query}”` : " in your catalogue"}
        </p>
      )}

      <div className="mt-6 overflow-x-auto rounded-xl border border-[#2B2620]/10 bg-white">
        <table className="w-full min-w-180 text-sm">
          <thead className="bg-[#FAF8F3] text-left text-[11px] uppercase tracking-[0.15em] text-[#2B2620]/50">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Variants</th>
              <th className="px-4 py-3">Images</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {products.length === 0 && !error && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-[#2B2620]/50"
                >
                  {query
                    ? "No products match your search. Try another name, slug, or SKU."
                    : "No products yet — create the first one."}
                </td>
              </tr>
            )}
            {products.map((p) => (
              <tr key={p.id} className="border-t border-[#2B2620]/10">
                <td className="px-4 py-3">
                  <p className="font-admin font-medium">{p.name}</p>
                  <p className="text-xs text-[#2B2620]/50">/{p.slug}</p>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[p.status]}`}
                  >
                    {p.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {p.minPrice === null
                    ? "—"
                    : formatPrice(String(p.minPrice), "INR")}
                </td>
                <td className="px-4 py-3">{p.variantCount}</td>
                <td className="px-4 py-3">{p.imageCount}</td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/admin/products/${p.id}`}
                    className="text-xs hover:underline"
                  >
                    Edit →
                  </Link>
                  <DeleteProductButton id={p.id} name={p.name} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
