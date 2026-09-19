import { requireAccountPage } from '@/utils/account-session';
import { ensureCustomerForUserId, listAddresses } from '@/utils/account';
import AddressManager from './address-manager';

export const metadata = {
  title: 'Addresses',
  robots: { index: false, follow: false },
};

export default async function AccountAddressesPage() {
  const user = await requireAccountPage();
  const customer = await ensureCustomerForUserId(user.id);
  const addresses = await listAddresses(customer.id);

  return (
    <section>
      <AddressManager initialAddresses={addresses} />
    </section>
  );
}
