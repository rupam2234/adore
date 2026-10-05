import { requireAccountPage } from '@/utils/account-session';
import { ensureCustomerForUserId } from '@/utils/account';
import { listReturnRequests } from '@/utils/returns-db';
import CustomerReturnsList from '@/components/account/customer-returns-list';

export const metadata = {
  title: 'Returns',
  robots: { index: false, follow: false },
};

/**
 * The customer's returns dashboard. Every query is scoped by a session-derived
 * `customerId`, so there is no id in the path to tamper with.
 */
export default async function AccountReturnsPage() {
  const user = await requireAccountPage();
  const customer = await ensureCustomerForUserId(user.id);
  const returns = await listReturnRequests(customer.id);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-serif text-2xl">Returns &amp; exchanges</h2>
        <p className="mt-1 text-sm text-[#2B2620]/60">
          Track a return you have raised, or cancel one you no longer need.
        </p>
      </header>

      <CustomerReturnsList returns={returns} />
    </div>
  );
}
