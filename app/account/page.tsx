import Link from "next/link";
import { requireAccountPage } from "@/utils/account-session";
import { ensureCustomerForUserId, listAddresses, listOrders } from "@/utils/account";
import ProfileForm from "./profile-form";

export default async function AccountOverviewPage() {
  const user = await requireAccountPage();
  const customer = await ensureCustomerForUserId(user.id);
  const [orders, addresses] = await Promise.all([
    listOrders(customer.id),
    listAddresses(customer.id),
  ]);
  const defaultAddress = addresses.find((a) => a.isDefault) ?? addresses[0];

  return (
    <section className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Link
          href="/account/orders"
          className="group rounded-2xl border border-[#2B2620]/10 bg-white p-5 transition-colors hover:border-[#5C6B4B]/50"
        >
          <p className="font-roboto text-2xl font-medium">{orders.length}</p>
          <p className="mt-1 text-sm text-[#2B2620]/60 group-hover:text-[#2B2620]">
            {orders.length === 1 ? "Order" : "Orders"}
          </p>
        </Link>
        <Link
          href="/account/addresses"
          className="group rounded-2xl border border-[#2B2620]/10 bg-white p-5 transition-colors hover:border-[#5C6B4B]/50"
        >
          <p className="font-roboto text-2xl font-medium">{addresses.length}</p>
          <p className="mt-1 text-sm text-[#2B2620]/60 group-hover:text-[#2B2620]">
            {addresses.length === 1 ? "Address" : "Addresses"}
          </p>
        </Link>
        <div className="rounded-2xl border border-[#2B2620]/10 bg-white p-5">
          <p className="font-roboto text-sm font-medium uppercase tracking-[0.15em] text-[#5C6B4B]">
            Member
          </p>
          <p className="mt-1 text-sm text-[#2B2620]/60">
            Since{" "}
            {new Date(customer.createdAt).toLocaleDateString("en-IN", {
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-[#2B2620]/10 bg-white p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="font-serif text-lg">Default delivery address</h2>
          <Link
            href="/account/addresses"
            className="text-xs underline-offset-2 hover:underline"
          >
            Manage
          </Link>
        </div>
        {defaultAddress ? (
          <div className="mt-3 text-sm text-[#2B2620]/70">
            <p className="font-medium text-[#2B2620]">{defaultAddress.fullName}</p>
            <p>
              {defaultAddress.addressLine1}
              {defaultAddress.addressLine2 ? `, ${defaultAddress.addressLine2}` : ""}
            </p>
            <p>
              {defaultAddress.city}, {defaultAddress.state} {defaultAddress.postalCode}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-[#2B2620]/60">
            No address saved yet — add one to speed up checkout.
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-[#2B2620]/10 bg-white p-6">
        <h2 className="font-serif text-lg">Profile</h2>
        <ProfileForm initialName={user.name} initialPhone={customer.phone ?? ""} />
      </div>
    </section>
  );
}
