import type { Metadata } from 'next';
import { SiteHeader, Footer } from '@/components';
import CheckoutForm, {
  type CheckoutAddressOption,
} from '@/components/checkout/checkout-form';
import BackToBag from '@/components/checkout/back-to-bag';
import { getSessionUserId } from '@/utils/request-user';
import { ensureCustomerForUserId, listAddresses } from '@/utils/account';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

// The page reads the session cookie (saved addresses) and the cart is per
// visitor, so it is always rendered per request.
export const dynamic = 'force-dynamic';

export default async function CheckoutPage() {
  const userId = await getSessionUserId();

  let member: { name: string; email: string } | null = null;
  let addresses: CheckoutAddressOption[] = [];

  if (userId) {
    const { getUserById } = await import('@/utils/auth');
    const user = await getUserById(userId);
    if (user) {
      member = { name: user.name, email: user.email };
      // Listing the customer ensures one exists before we show their addresses.
      const customer = await ensureCustomerForUserId(user.id);
      addresses = await listAddresses(customer.id);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#FAF8F3] font-sans text-[#2B2620]">
      <SiteHeader />
      <main className="w-full flex-1 px-6 py-12 sm:px-12">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-baseline justify-between">
            <h1 className="font-serif text-3xl sm:text-4xl">Checkout</h1>
            <BackToBag />
          </div>
          <p className="mt-2 max-w-lg text-sm text-[#2B2620]/60">
            We verify your PIN with our courier partner before the payment so
            delivery is confirmed up front.
          </p>

          <div className="mt-8">
            <CheckoutForm member={member} addresses={addresses} />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
