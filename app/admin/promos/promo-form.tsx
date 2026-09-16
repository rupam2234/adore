"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function PromoForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [discountType, setDiscountType] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [discountValue, setDiscountValue] = useState("");
  const [minSubtotal, setMinSubtotal] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/admin/promos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          description,
          discountType,
          discountValue: Number(discountValue),
          minSubtotal: minSubtotal === "" ? null : Number(minSubtotal),
          maxRedemptions: maxRedemptions === "" ? null : Number(maxRedemptions),
          startsAt: startsAt || null,
          expiresAt: expiresAt || null,
          isActive: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not create promo code");
        return;
      }
      setCode("");
      setDescription("");
      setDiscountValue("");
      setMinSubtotal("");
      setMaxRedemptions("");
      setStartsAt("");
      setExpiresAt("");
      router.refresh();
    } catch {
      setError("Could not create promo code");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-[#2B2620]/20 bg-white px-3 py-2 text-sm placeholder:text-[#2B2620]/30 focus:border-[#2B2620] focus:outline-none";
  const labelClass = "mb-1 block text-xs uppercase tracking-wider text-[#2B2620]/60";

  return (
    <form onSubmit={handleSubmit} className="mt-6 rounded-xl border border-[#2B2620]/10 bg-white p-6">
      <h2 className="font-serif text-lg">New promo code</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="promo-code" className={labelClass}>Code</label>
          <input
            id="promo-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="WELCOME10"
            disabled={busy}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="promo-description" className={labelClass}>Description</label>
          <input
            id="promo-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Shown to customers"
            disabled={busy}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="promo-type" className={labelClass}>Discount type</label>
          <select
            id="promo-type"
            value={discountType}
            onChange={(e) => setDiscountType(e.target.value as "PERCENT" | "FIXED")}
            disabled={busy}
            className={inputClass}
          >
            <option value="PERCENT">Percent (%)</option>
            <option value="FIXED">Fixed (₹)</option>
          </select>
        </div>
        <div>
          <label htmlFor="promo-value" className={labelClass}>
            {discountType === "PERCENT" ? "Percent off" : "Amount off (₹)"}
          </label>
          <input
            id="promo-value"
            type="number"
            min="0"
            step="0.01"
            value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
            disabled={busy}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="promo-min" className={labelClass}>Minimum order (₹, optional)</label>
          <input
            id="promo-min"
            type="number"
            min="0"
            step="0.01"
            value={minSubtotal}
            onChange={(e) => setMinSubtotal(e.target.value)}
            disabled={busy}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="promo-max" className={labelClass}>Max redemptions (optional)</label>
          <input
            id="promo-max"
            type="number"
            min="1"
            step="1"
            value={maxRedemptions}
            onChange={(e) => setMaxRedemptions(e.target.value)}
            disabled={busy}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="promo-starts" className={labelClass}>Starts at (optional)</label>
          <input
            id="promo-starts"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            disabled={busy}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="promo-expires" className={labelClass}>Expires at (optional)</label>
          <input
            id="promo-expires"
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            disabled={busy}
            className={inputClass}
          />
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="mt-4 cursor-pointer rounded-full bg-[#2B2620] px-6 py-2.5 text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create promo code"}
      </button>
    </form>
  );
}

export function PromoRowActions({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function act(method: "PATCH" | "DELETE") {
    setBusy(true);
    try {
      const res = await fetch(
        method === "DELETE" ? `/api/admin/promos?id=${id}` : "/api/admin/promos",
        {
          method,
          headers: method === "PATCH" ? { "Content-Type": "application/json" } : undefined,
          body: method === "PATCH" ? JSON.stringify({ id, isActive: !isActive }) : undefined,
        },
      );
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-4 text-xs">
      <button
        type="button"
        onClick={() => act("PATCH")}
        disabled={busy}
        className="cursor-pointer underline-offset-2 hover:underline disabled:opacity-40"
      >
        {isActive ? "Pause" : "Activate"}
      </button>
      <button
        type="button"
        onClick={() => act("DELETE")}
        disabled={busy}
        className="cursor-pointer text-[#A45A4B] underline-offset-2 hover:underline disabled:opacity-40"
      >
        Delete
      </button>
    </div>
  );
}
