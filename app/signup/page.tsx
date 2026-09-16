import { Suspense } from "react";
import { SiteHeader, Footer } from "@/components";
import SignupForm from "./signup-form";

export const metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#FAF8F3] font-sans text-[#2B2620]">
      <SiteHeader />
      <main className="grid flex-1 grid-cols-1 lg:grid-cols-5">
        <section className="order-2 flex items-center justify-center px-6 py-16 sm:px-12 lg:order-1 lg:col-span-2">
          <div className="w-full max-w-md">
            <Suspense>
              <SignupForm />
            </Suspense>
          </div>
        </section>
        <aside
          aria-hidden="true"
          className="order-1 hidden bg-[linear-gradient(160deg,#C98F82_0%,#DDBBA4_45%,#E7DFCB_100%)] lg:order-2 lg:col-span-3 lg:block"
        >
          <div className="flex h-full flex-col justify-end p-12">
            <p className="text-sm text-[#2B2620]/70">The beauty of keeping</p>
            <p className="mt-2 max-w-md font-roboto text-2xl font-medium leading-snug tracking-tight text-[#2B2620]">
              Join Adore to unlock promo codes, early access to new drops, and a
              bag that follows you everywhere.
            </p>
          </div>
        </aside>
      </main>
      <Footer />
    </div>
  );
}
