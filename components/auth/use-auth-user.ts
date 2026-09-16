"use client";

import { useEffect, useState } from "react";

type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export function useAuthUser() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json();
        return data?.user ?? null;
      })
      .then((user) => {
        if (!cancelled) setUser(user);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { user, loading };
}
