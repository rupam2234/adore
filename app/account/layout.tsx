import Link from "next/link";
import { SiteHeader, Footer } from "@/components";
import { requireAccountPage } from "@/utils/account-session";
import { ensureCustomerForUserId } from "@/utils/account";
import AccountNav from "@/components/account/account-nav";
import LogoutButton from "@/components/account/logout-button";

export const metadata = { title: "Account", robots: { index: false, follow: false } };

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAccountPage();
  const customer = await ensureCustomerForUserId(user.id);
  const displayName = customer.firstName ?? user.name;
  const initial = displayName.trim().charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen flex-col bg-[#FAF8F3] font-sans text-[#2B2620]">
      <SiteHeader />
      <main className="flex-1">
        <section className="bg-[linear-gradient(160deg,#C98F82_0%,#DDBBA4_45%,#E7DFCB_100%)] px-6 py-12 sm:px-12">
          <div className="mx-auto flex max-w-5xl items-center gap-5">
            <div
              aria-hidden="true"
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#2B2620] font-roboto text-xl font-medium text-[#FAF8F3]"
            >
              {initial}
            </div>
            <div className="min-w-0">
              <p className="text-sm text-[#2B2620]/70">My account</p>
              <h1 className="truncate font-serif text-3xl">{displayName}</h1>
              <p className="truncate text-sm text-[#2B2620]/60">{user.email}</p>
            </div>
          </div>
        </section>

        <div className="mx-auto grid w-full max-w-5xl gap-8 px-6 py-10 sm:px-12 sm:grid-cols-[11rem_1fr]">
          <div className="flex flex-col gap-1 sm:sticky sm:top-28 sm:self-start">
            <AccountNav />
            <LogoutButton />
            <Link
              href="/shop"
              className="mt-2 hidden rounded-lg px-3 py-2 text-sm text-[#2B2620]/50 transition-colors hover:text-[#2B2620] sm:block"
            >
              ← Continue shopping
            </Link>
          </div>
          <div className="min-w-0">{children}</div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
