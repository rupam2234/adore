import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SiteHeader, Footer } from "@/components";
import OrderReceipt from "@/components/checkout/order-receipt";
import {
  getOrderConfirmation,
  RECENT_ORDER_COOKIE,
  type OrderConfirmation,
} from "@/utils/checkout";
import { getSessionUserId } from "@/utils/request-user";

export const metadata: Metadata = {
  title: "Order confirmed",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Receipt page. The order number arrives in an httpOnly cookie set by
 * /api/checkout/verify — so the URL never carries an order number and orders
 * aren't guessable. `?order=` is accepted only for the account that owns it.
 */
export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order: orderParam } = await searchParams;
  const cookieOrder = (await cookies()).get(RECENT_ORDER_COOKIE)?.value;

  let orderNumber: string | null = null;

  if (orderParam && orderParam === cookieOrder) {
    // The browser that just paid — the cookie already proves ownership.
    orderNumber = orderParam;
  } else if (orderParam) {
    // Someone opened a link with ?order=… — only the account that owns the
    // order may see it (guests fall through to the cookie path only).
    const userId = await getSessionUserId();
    if (userId) {
      const { ensureCustomerForUserId } = await import("@/utils/account");
      const { db, orders } = await import("@/utils/db");
      const { eq, and } = await import("drizzle-orm");
      const customer = await ensureCustomerForUserId(userId);
      const owned = await db
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.orderNumber, orderParam),
            eq(orders.customerId, customer.id),
          ),
        )
        .limit(1);
      orderNumber = owned.length > 0 ? orderParam : null;
    }
  } else {
    orderNumber = cookieOrder ?? null;
  }

  if (!orderNumber) redirect("/shop");

  let confirmation: OrderConfirmation | null = null;
  try {
    confirmation = await getOrderConfirmation(orderNumber);
  } catch {
    confirmation = null;
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#FAF8F3] font-sans text-[#2B2620]">
      <SiteHeader />
      <main className="w-full flex-1 px-6 py-12 sm:px-12">
        <div className="mx-auto max-w-2xl">
          <OrderReceipt orderNumber={orderNumber} confirmation={confirmation} />
        </div>
      </main>
      <Footer />
    </div>
  );
}
