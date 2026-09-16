import { formatPrice } from "@/utils";
import { listPromos } from "@/utils/admin-promos";
import { requireAdminPage } from "@/utils/admin-session";
import PromoForm, { PromoRowActions } from "./promo-form";

export const metadata = { title: "Promo Codes — Admin", robots: { index: false, follow: false } };

export default async function AdminPromosPage() {
  await requireAdminPage();

  let promos: Awaited<ReturnType<typeof listPromos>> = [];
  let error: string | null = null;
  try {
    promos = await listPromos();
  } catch {
    error = "Could not load promo codes — check the database connection.";
  }

  return (
    <section>
      <h1 className="font-serif text-2xl">Promo Codes</h1>

      {error && (
        <p className="mt-6 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <PromoForm />

      <div className="mt-6 overflow-hidden border border-[#2B2620]/10 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-[#FAF8F3] text-left text-[11px] uppercase tracking-[0.15em] text-[#2B2620]/50">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Discount</th>
              <th className="px-4 py-3">Min. order</th>
              <th className="px-4 py-3">Redemptions</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {promos.length === 0 && !error && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[#2B2620]/50">
                  No promo codes yet.
                </td>
              </tr>
            )}
            {promos.map((promo) => (
              <tr key={promo.id} className="border-t border-[#2B2620]/10">
                <td className="px-4 py-3">
                  <p className="font-medium uppercase">{promo.code}</p>
                  {promo.description && (
                    <p className="text-xs text-[#2B2620]/50">{promo.description}</p>
                  )}
                </td>
                <td className="px-4 py-3">
                  {promo.discountType === "PERCENT"
                    ? `${Number(promo.discountValue)}%`
                    : formatPrice(promo.discountValue, "INR")}
                </td>
                <td className="px-4 py-3">
                  {promo.minSubtotal === null ? "—" : formatPrice(promo.minSubtotal, "INR")}
                </td>
                <td className="px-4 py-3">
                  {promo.redemptionCount}
                  {promo.maxRedemptions !== null ? ` / ${promo.maxRedemptions}` : ""}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      promo.isActive
                        ? "bg-green-100 text-green-800"
                        : "bg-neutral-200 text-neutral-600"
                    }`}
                  >
                    {promo.isActive ? "ACTIVE" : "PAUSED"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <PromoRowActions id={promo.id} isActive={promo.isActive} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
