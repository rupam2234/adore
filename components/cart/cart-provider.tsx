"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CartSummary } from "@/utils/cart";

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
};

const EMPTY_CART: CartSummary = {
  items: [],
  itemCount: 0,
  subtotal: "0",
  currency: null,
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartSummary>(EMPTY_CART);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/cart", { cache: "no-store" });
      if (res.ok) setCart(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addItem = useCallback(
    async (variantId: string, quantity = 1) => {
      setAdding(true);
      setError(null);
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
        setCart(data);
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

  const updateItem = useCallback(async (itemId: string, quantity: number) => {
    setError(null);
    const res = await fetch(`/api/cart/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity }),
    });
    if (res.ok) setCart(await res.json());
  }, []);

  const removeItem = useCallback(async (itemId: string) => {
    setError(null);
    const res = await fetch(`/api/cart/items/${itemId}`, { method: "DELETE" });
    if (res.ok) setCart(await res.json());
  }, []);

  const clear = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/cart", { method: "DELETE" });
    if (res.ok) setCart(await res.json());
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
    }),
    [cart, loading, adding, error, drawerOpen, addItem, updateItem, removeItem, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
