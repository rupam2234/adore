"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CartLine, CartSummary } from "@/utils/cart";
import { computeDiscount } from "@/utils/promo-format";

type CartContextValue = {
  cart: CartSummary;
  loading: boolean;
  adding: boolean;
  error: string | null;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  addItem: (variantId: string, quantity?: number) => Promise<boolean>;
  updateItem: (itemId: string, quantity: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  clear: () => Promise<void>;
  applyPromo: (code: string) => Promise<boolean>;
  removePromo: () => Promise<void>;
};

const EMPTY_CART: CartSummary = {
  items: [],
  itemCount: 0,
  subtotal: "0",
  discount: "0",
  total: "0",
  promo: null,
  currency: null,
};

function summarize(items: CartLine[], promo: CartSummary["promo"], currency: string | null): CartSummary {
  const subtotal = String(
    items.reduce((sum, item) => sum + Number(item.lineTotal), 0),
  );
  const discount = promo
    ? computeDiscount(promo.discountType, promo.discountValue, subtotal)
    : "0";
  return {
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal,
    discount,
    total: String(Number(subtotal) - Number(discount)),
    promo,
    currency: items[0]?.currency ?? currency,
  };
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartSummary>(EMPTY_CART);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Guards against race conditions from concurrent/out-of-order mutations.
  const seqRef = useRef(0); // bumped when a mutation is issued; only the latest may apply a snapshot
  // Debounces quantity changes: rapid +/- clicks coalesce into ONE server request.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const QUANTITY_DEBOUNCE_MS = 500;

  const applySnapshot = useCallback((snapshot: CartSummary, seq: number) => {
    // Ignore snapshots from requests that are no longer the latest mutation.
    if (seq !== seqRef.current) return;
    setCart(snapshot);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/cart", { cache: "no-store" });
      // Don't bump the sequence: a background load must never override a
      // newer user mutation, so it only applies if nothing else is pending.
      if (res.ok) applySnapshot(await res.json(), seqRef.current);
    } finally {
      setLoading(false);
    }
  }, [applySnapshot]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addItem = useCallback(
    async (variantId: string, quantity = 1) => {
      setAdding(true);
      setError(null);
      const seq = ++seqRef.current;
      try {
        const res = await fetch("/api/cart/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ variantId, quantity }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error ?? "Could not add to cart");
          return false;
        }
        applySnapshot(data, seq);
        setDrawerOpen(true);
        return true;
      } catch {
        setError("Could not add to cart");
        return false;
      } finally {
        setAdding(false);
      }
    },
    [],
  );

  const updateItem = useCallback(
    async (itemId: string, quantity: number) => {
      setError(null);
      const prev = cart;
      // Optimistically update the UI so quantity changes feel instant.
      setCart((current) => {
        const items = current.items.map((item) => {
          if (item.id !== itemId) return item;
          const capped = Math.min(Math.max(quantity, 1), item.stock);
          return {
            ...item,
            quantity: capped,
            lineTotal: String(Number(item.unitPrice) * capped),
          };
        });
        return summarize(items, current.promo, current.currency);
      });
      // Coalesce rapid clicks: reset the per-item timer so only the FINAL
      // quantity is sent to the server once, after the user stops clicking.
      const timers = timersRef.current;
      const existing = timers.get(itemId);
      if (existing) clearTimeout(existing);
      timers.set(
        itemId,
        setTimeout(async () => {
          timers.delete(itemId);
          const seq = ++seqRef.current;
          try {
            const res = await fetch(`/api/cart/items/${itemId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ quantity }),
            });
            if (res.ok) {
              applySnapshot(await res.json(), seq);
            } else if (seq === seqRef.current) {
              setError("Could not update quantity");
              refresh(); // resync from the server's source of truth
            }
          } catch {
            if (seq === seqRef.current) {
              setError("Could not update quantity");
              refresh();
            }
          }
        }, QUANTITY_DEBOUNCE_MS),
      );
    },
    [cart, applySnapshot, refresh],
  );

  const removeItem = useCallback(
    async (itemId: string) => {
      setError(null);
      // Cancel any pending debounced update for this item — it's going away.
      const pending = timersRef.current.get(itemId);
      if (pending) {
        clearTimeout(pending);
        timersRef.current.delete(itemId);
      }
      const seq = ++seqRef.current;
      const prev = cart;
      // Optimistically remove from UI.
      setCart((current) => {
        const items = current.items.filter((item) => item.id !== itemId);
        return summarize(items, current.promo, current.currency);
      });
      try {
        const res = await fetch(`/api/cart/items/${itemId}`, {
          method: "DELETE",
        });
        if (res.ok) {
          applySnapshot(await res.json(), seq);
        } else {
          setCart(prev);
          setError("Could not remove item");
        }
      } catch {
        setCart(prev);
        setError("Could not remove item");
      }
    },
    [cart, applySnapshot],
  );

  const clear = useCallback(async () => {
    setError(null);
    // Cancel all pending debounced updates.
    for (const timer of timersRef.current.values()) clearTimeout(timer);
    timersRef.current.clear();
    const seq = ++seqRef.current;
    try {
      const res = await fetch("/api/cart", { method: "DELETE" });
      if (res.ok) applySnapshot(await res.json(), seq);
      else setError("Could not clear bag");
    } catch {
      setError("Could not clear bag");
    }
  }, [applySnapshot]);

  const applyPromo = useCallback(
    async (code: string) => {
      setError(null);
      try {
        const res = await fetch("/api/cart/promo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error ?? "Could not apply promo code");
          return false;
        }
        setCart(data);
        return true;
      } catch {
        setError("Could not apply promo code");
        return false;
      }
    },
    [],
  );

  const removePromo = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/cart/promo", { method: "DELETE" });
      if (res.ok) setCart(await res.json());
      else setError("Could not remove promo code");
    } catch {
      setError("Could not remove promo code");
    }
  }, []);

  const value = useMemo(
    () => ({
      cart,
      loading,
      adding,
      error,
      drawerOpen,
      setDrawerOpen,
      addItem,
      updateItem,
      removeItem,
      clear,
      applyPromo,
      removePromo,
    }),
    [cart, loading, adding, error, drawerOpen, addItem, updateItem, removeItem, clear, applyPromo, removePromo],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
