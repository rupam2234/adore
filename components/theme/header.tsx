"use client";

import Link from "next/link";
import { useState } from "react";
import { CATEGORY_TREE } from "@/utils/categories";
import SearchBar from "./search-bar";
import { useCart } from "@/components/cart/cart-provider";
import { useAuthUser } from "@/components/auth/use-auth-user";
import Image from "next/image";

export default function Header() {
  const [megaOpen, setMegaOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState<string | null>(null);
  const { cart, setDrawerOpen } = useCart();
  const { user, loading } = useAuthUser();

  return (
    <header
      className="sticky top-0 z-50 w-full border-b border-[#2B2620]/10 bg-[#FAF8F3]/90 backdrop-blur-md"
      onMouseLeave={() => setMegaOpen(false)}
    >
      <div className="relative flex w-full items-center justify-between px-6 py-5 sm:px-12">
        <Link
          href="/"
          className="font-semibold text-3xl tracking-tight text-primary/80 transition-colors"
        >
          {/* Adore */}
          <Image
            src={"/images/Adore_logo.png"}
            alt="Adore_tag"
            width={100}
            height={42}
          />
        </Link>
        <nav
          aria-label="Primary"
          className="hidden items-center gap-8 text-sm sm:flex"
        >
          <Link
            href="/"
            className="group relative inline-block hover:text-[#5C6B4B]"
          >
            Home
            <span className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-[#5C6B4B] transition-transform duration-300 ease-out group-hover:scale-x-100" />
          </Link>
          <div
            className="relative"
            onMouseEnter={() => setMegaOpen(true)}
            onMouseLeave={() => setMegaOpen(false)}
          >
            <Link
              href="/shop"
              onClick={() => setMegaOpen(false)}
              onFocus={() => setMegaOpen(true)}
              onBlur={() => setMegaOpen(false)}
              aria-expanded={megaOpen}
              aria-haspopup="true"
              className="group relative inline-flex items-center gap-1.5 rounded-full px-1 py-2 hover:text-[#5C6B4B]"
            >
              Categories
              <span
                aria-hidden="true"
                className={`text-xs leading-none transition-transform duration-300 ${megaOpen ? "rotate-45" : ""}`}
              >
                +
              </span>
              <span className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-[#5C6B4B] transition-transform duration-300 ease-out group-hover:scale-x-100" />
            </Link>
            {/* Dropdown — anchored to this item, floats over content. */}
            <div
              aria-hidden={!megaOpen}
              className={`absolute left-1/2 top-full z-50 w-[min(40rem,88vw)] -translate-x-1/2 pt-3 transition-[opacity,transform] duration-200 ease-out ${megaOpen ? "visible translate-y-0 opacity-100" : "invisible -translate-y-1 opacity-0"}`}
            >
              <div className="overflow-hidden rounded-2xl border border-[#2B2620]/10 bg-[#FAF8F3] shadow-2xl shadow-[#2B2620]/15">
                <nav
                  aria-label="Shop by category"
                  className="grid w-full grid-cols-[1fr_1fr_1fr] gap-0"
                >
                  <Link
                    href="/shop"
                    onClick={() => setMegaOpen(false)}
                    tabIndex={megaOpen ? 0 : -1}
                    className="group flex flex-col justify-between gap-6 bg-[#2B2620] p-6 text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B]"
                  >
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.2em] text-[#FAF8F3]/60">
                        Shop
                      </p>
                      <p className="mt-2 font-serif text-2xl leading-tight">
                        View all styles
                      </p>
                      <p className="mt-2 text-xs leading-relaxed text-[#FAF8F3]/70">
                        Browse the full collection in one place.
                      </p>
                    </div>
                    <span className="text-sm underline underline-offset-4">
                      Shop all →
                    </span>
                  </Link>
                  {CATEGORY_TREE.map((cat) => (
                    <div
                      key={cat.slug}
                      className="border-l border-[#2B2620]/10 p-6"
                    >
                      <Link
                        href={`/shop/${cat.slug}`}
                        onClick={() => setMegaOpen(false)}
                        tabIndex={megaOpen ? 0 : -1}
                        className="group inline-flex items-baseline gap-2"
                      >
                        <span className="font-serif text-lg transition-colors group-hover:text-[#5C6B4B]">
                          {cat.name}
                        </span>
                        <span
                          aria-hidden="true"
                          className="text-xs text-[#2B2620]/40 transition-transform duration-300 group-hover:translate-x-0.5"
                        >
                          →
                        </span>
                      </Link>
                      {cat.description && (
                        <p className="mt-1 text-xs leading-relaxed text-[#2B2620]/50">
                          {cat.description}
                        </p>
                      )}
                      {cat.children && cat.children.length > 0 ? (
                        <ul className="mt-4 space-y-1">
                          {cat.children.map((sub) => (
                            <li key={sub.slug}>
                              <Link
                                href={`/shop/${sub.slug}`}
                                onClick={() => setMegaOpen(false)}
                                tabIndex={megaOpen ? 0 : -1}
                                className="group/sub flex items-center justify-between rounded-lg px-2 py-1.5 text-sm text-[#2B2620]/70 transition-colors hover:bg-[#2B2620]/5 hover:text-[#2B2620]"
                              >
                                {sub.name}
                                <span
                                  aria-hidden="true"
                                  className="opacity-0 transition-all duration-200 group-hover/sub:translate-x-0.5 group-hover/sub:opacity-100"
                                >
                                  →
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-4 text-xs text-[#2B2620]/40">
                          No sub-categories yet.
                        </p>
                      )}
                    </div>
                  ))}
                </nav>
              </div>
            </div>
          </div>
          <Link
            href="/#how-we-make-it"
            className="group relative inline-block hover:text-[#5C6B4B]"
          >
            How we make it
            <span className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-[#5C6B4B] transition-transform duration-300 ease-out group-hover:scale-x-100" />
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <SearchBar className="hidden w-56 lg:block xl:w-64" />
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label={`Open bag (${cart.itemCount} items)`}
            className="relative cursor-pointer rounded-full border border-[#2B2620]/20 p-2.5 transition-colors hover:border-[#2B2620]"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4.5 w-4.5"
            >
              <path d="M6 7h12l1 14H5L6 7Z" />
              <path d="M9 10V6a3 3 0 0 1 6 0v4" />
            </svg>
            {cart.itemCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#5C6B4B] px-1 text-[10px] font-medium leading-none text-[#FAF8F3]">
                {cart.itemCount}
              </span>
            )}
          </button>
          <Link
            href={user ? "/account" : "/login"}
            className="group relative inline-flex items-center gap-1.5 text-sm hover:text-[#5C6B4B]"
            aria-label={user ? "Your account" : "Log in"}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4.5 w-4.5"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
            </svg>
            {!loading && user && (
              <span className="hidden lg:inline">{user.name.split(" ")[0]}</span>
            )}
          </Link>
          <Link
            href="/shop"
            className="hidden rounded-full border border-[#2B2620] px-5 py-2 text-sm transition-colors hover:bg-[#2B2620] hover:text-[#FAF8F3] sm:inline-block"
          >
            Shop the collection
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen((o) => !o)}
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            className="cursor-pointer text-2xl leading-none sm:hidden"
          >
            {mobileOpen ? "×" : "☰"}
          </button>
        </div>
      </div>
      {/* Mobile menu */}
      {mobileOpen && (
        <nav
          aria-label="Mobile"
          className="border-t border-[#2B2620]/10 bg-[#FAF8F3] px-6 py-4 sm:hidden"
        >
          <SearchBar className="mb-3" />
          <Link
            href="/"
            onClick={() => setMobileOpen(false)}
            className="block py-2 text-sm font-medium"
          >
            Home
          </Link>
          <Link
            href="/shop"
            onClick={() => setMobileOpen(false)}
            className="block py-2 text-sm font-medium"
          >
            Shop all
          </Link>
          {CATEGORY_TREE.map((cat) => (
            <div key={cat.slug} className="border-t border-[#2B2620]/10">
              <div className="flex items-center justify-between">
                <Link
                  href={`/shop/${cat.slug}`}
                  onClick={() => setMobileOpen(false)}
                  className="block py-2 text-sm font-medium"
                >
                  {cat.name}
                </Link>
                {cat.children && cat.children.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setMobileExpanded((s) =>
                        s === cat.slug ? null : cat.slug,
                      )
                    }
                    aria-expanded={mobileExpanded === cat.slug}
                    aria-label={`Expand ${cat.name} sub-categories`}
                    className="cursor-pointer px-2 text-lg leading-none"
                  >
                    <span
                      aria-hidden="true"
                      className={`inline-block transition-transform duration-300 ${mobileExpanded === cat.slug ? "rotate-45" : ""}`}
                    >
                      +
                    </span>
                  </button>
                )}
              </div>
              {cat.children && mobileExpanded === cat.slug && (
                <ul className="pb-2 pl-4">
                  {cat.children.map((sub) => (
                    <li key={sub.slug}>
                      <Link
                        href={`/shop/${sub.slug}`}
                        onClick={() => setMobileOpen(false)}
                        className="block py-1.5 text-sm text-[#2B2620]/70"
                      >
                        {sub.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <Link
            href={user ? "/account" : "/login"}
            onClick={() => setMobileOpen(false)}
            className="block border-t border-[#2B2620]/10 py-2 text-sm font-medium"
          >
            {user ? "My account" : "Log in"}
          </Link>
          <Link
            href="/#how-we-make-it"
            onClick={() => setMobileOpen(false)}
            className="block border-t border-[#2B2620]/10 py-2 text-sm font-medium"
          >
            How we make it
          </Link>
        </nav>
      )}
    </header>
  );
}
