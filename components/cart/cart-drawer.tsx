"use client";

import Link from "next/link";
import { useEffect } from "react";
import { formatPrice } from "@/utils/product-format";
import { useCart } from "./cart-provider";

export function CartDrawer() {
  const { cart, drawerOpen, setDrawerOpen, updateItem, removeItem, clear } =
    useCart();

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [drawerOpen, setDrawerOpen]);

  return (
    <div
      aria-hidden={!drawerOpen}
      className={`fixed inset-0 z-[60] ${drawerOpen ? "" : "pointer-events-none"}`}
    >
      <div
        onClick={() => setDrawerOpen(false)}
        className={`absolute inset-0 bg-[#2B2620]/60 transition-opacity duration-300 ${
          drawerOpen ? "opacity-100" : "opacity-0"
        }`}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Shopping bag"
        className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-[#FAF8F3] shadow-2xl transition-transform duration-300 ease-out ${
          drawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-[#2B2620]/10 px-6 py-5">
          <h2 className="font-serif text-xl">
            Bag{" "}
            <span className="text-sm text-[#2B2620]/50">
              ({cart.itemCount})
            </span>
          </h2>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close bag"
            className="cursor-pointer text-2xl leading-none text-[#2B2620]/50 transition-colors hover:text-[#2B2620]"
          >
            ×
          </button>
        </div>

        {cart.items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="text-sm text-[#2B2620]/60">Your bag is empty.</p>
            <Link
              href="/shop"
              onClick={() => setDrawerOpen(false)}
              className="rounded-full bg-[#2B2620] px-6 py-2.5 text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B]"
            >
              Shop the collection
            </Link>
          </div>
        ) : (
          <DrawerBody />
        )}
      </aside>
    </div>
  );
}

function DrawerBody() {
  const { cart, setDrawerOpen, updateItem, removeItem, clear } = useCart();

  return (
    <>
      <ul className="flex-1 divide-y divide-[#2B2620]/10 overflow-y-auto px-6">
        {cart.items.map((item) => (
          <li key={item.id} className="flex gap-4 py-4">
            <Link
              href={`/products/${item.slug}`}
              onClick={() => setDrawerOpen(false)}
              className="h-24 w-20 shrink-0 overflow-hidden bg-[#E7DFCB]"
            >
              {item.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  className="h-full w-full object-cover"
                />
              )}
            </Link>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/products/${item.slug}`}
                  onClick={() => setDrawerOpen(false)}
                  className="truncate text-sm font-medium underline-offset-4 hover:underline"
                >
                  {item.name}
                </Link>
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  aria-label={`Remove ${item.name} from bag`}
                  className="cursor-pointer text-xs text-[#2B2620]/40 underline-offset-2 transition-colors hover:text-[#A45A4B] hover:underline"
                >
                  Remove
                </button>
              </div>
              <p className="mt-0.5 text-xs text-[#2B2620]/50">
                {item.color} · {item.size}
              </p>
              <div className="mt-auto flex items-center justify-between pt-2">
                <div className="flex items-center border border-[#2B2620]/20">
                  <button
                    type="button"
                    onClick={() => updateItem(item.id, item.quantity - 1)}
                    aria-label="Decrease quantity"
                    disabled={item.quantity <= 1}
                    className="cursor-pointer px-2.5 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    −
                  </button>
                  <span className="min-w-6 text-center text-sm">
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateItem(item.id, item.quantity + 1)}
                    aria-label="Increase quantity"
                    disabled={item.quantity >= item.stock}
                    title={
                      item.quantity >= item.stock
                        ? "Only this many in stock"
                        : undefined
                    }
                    className="cursor-pointer px-2.5 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
                <p className="text-sm">
                  {formatPrice(item.lineTotal, item.currency)}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="border-t border-[#2B2620]/10 px-6 py-5">
        <div className="flex items-center justify-between text-sm">
          <span>Subtotal</span>
          <span className="font-medium">
            {formatPrice(cart.subtotal, cart.currency!)}
          </span>
        </div>
        <p className="mt-1 text-xs text-[#2B2620]/50">
          Shipping and taxes calculated at checkout.
        </p>
        <button
          type="button"
          disabled
          className="mt-4 w-full cursor-not-allowed rounded-full bg-[#2B2620] px-6 py-3 text-sm text-[#FAF8F3] opacity-60"
        >
          Checkout — coming soon
        </button>
        <button
          type="button"
          onClick={clear}
          className="mt-3 w-full cursor-pointer text-xs text-[#2B2620]/50 underline-offset-4 transition-colors hover:text-[#2B2620] hover:underline"
        >
          Clear bag
        </button>
      </div>
    </>
  );
}
