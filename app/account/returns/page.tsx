import {
  clampPage,
  offsetFor,
  pageHref,
  parsePage,
  PAGE_SIZE,
  totalPagesFor,
} from '@/utils';
import { Pagination } from '@/components';
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
export default async function AccountReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const user = await requireAccountPage();
  const customer = await ensureCustomerForUserId(user.id);
  const returns = await listReturnRequests(customer.id);

  const totalPages = totalPagesFor(returns.length);
  const page = clampPage(parsePage((await searchParams).page), totalPages);
  const visible = returns.slice(offsetFor(page), offsetFor(page) + PAGE_SIZE);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-serif text-2xl">Returns &amp; exchanges</h2>
        <p className="mt-1 text-sm text-[#2B2620]/60">
          Track a return you have raised, or cancel one you no longer need.
        </p>
      </header>

      <CustomerReturnsList returns={visible} />

      {returns.length > 0 && (
        <p className="text-center text-xs text-[#2B2620]/50">
          Showing {offsetFor(page) + 1}–
          {Math.min(offsetFor(page) + PAGE_SIZE, returns.length)} of{' '}
          {returns.length} requests
        </p>
      )}
      <Pagination
        page={page}
        totalPages={totalPages}
        makeHref={p => pageHref('/account/returns', {}, p)}
      />
    </div>
  );
}
