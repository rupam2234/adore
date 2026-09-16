import Link from "next/link";
import { requireAdminPage } from "@/utils/admin-session";

export const metadata = { title: "Admin", robots: { index: false, follow: false } };

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#FAF8F3] font-sans text-[#2B2620]">
      <header className="sticky top-0 z-40 w-full border-b border-[#2B2620]/10 bg-[#FAF8F3]/90 px-6 py-5 backdrop-blur-md">
        <nav className="mx-auto flex max-w-5xl items-center justify-between text-sm">
          <Link href="/admin" className="font-semibold text-xl tracking-tight text-[#2B2620]/80">
            Adore
            <span className="ml-2 align-middle text-[11px] uppercase tracking-[0.2em] text-[#2B2620]/50">
              Admin
            </span>
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/admin" className="group relative inline-block">
              Products
              <span className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-[#5C6B4B] transition-transform duration-300 ease-out group-hover:scale-x-100" />
            </Link>
            <Link href="/admin/promos" className="group relative inline-block">
              Promo codes
              <span className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-[#5C6B4B] transition-transform duration-300 ease-out group-hover:scale-x-100" />
            </Link>
            <Link href="/admin/products/new" className="group relative inline-block">
              + New product
              <span className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-[#5C6B4B] transition-transform duration-300 ease-out group-hover:scale-x-100" />
            </Link>
            <Link
              href="/"
              className="rounded-full border border-[#2B2620] px-4 py-1.5 transition-colors hover:bg-[#2B2620] hover:text-[#FAF8F3]"
            >
              ← Storefront
            </Link>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}