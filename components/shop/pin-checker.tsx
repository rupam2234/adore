"use client";

import { useEffect, useState } from "react";

type PinResult = {
  serviceable: boolean;
  etaDays: number | null;
  estimatedDelivery: string | null;
  cod: boolean | null;
};

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "result"; pin: string; result: PinResult }
  | { kind: "error"; message: string };

const PIN_STORAGE_KEY = "adore_pin";

export function PinChecker({ className = "" }: { className?: string }) {
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // Restore a previously checked PIN so returning visitors see it instantly.
  useEffect(() => {
    const saved = localStorage.getItem(PIN_STORAGE_KEY);
    if (saved && /^\d{6}$/.test(saved)) setPin(saved);
  }, []);

  const check = async () => {
    if (!/^\d{6}$/.test(pin)) {
      setStatus({ kind: "error", message: "Enter a valid 6-digit PIN" });
      return;
    }
    setStatus({ kind: "checking" });
    try {
      const res = await fetch(`/api/shipping/pin?pin=${pin}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({
          kind: "error",
          message: data?.error ?? "Couldn't check delivery right now",
        });
        return;
      }
      const result: PinResult = {
        serviceable: Boolean(data.serviceable),
        etaDays: data.etaDays ?? null,
        estimatedDelivery: data.estimatedDelivery ?? null,
        cod: data.cod ?? null,
      };
      localStorage.setItem(PIN_STORAGE_KEY, pin);
      setStatus({ kind: "result", pin, result });
    } catch {
      setStatus({
        kind: "error",
        message: "Couldn't check delivery right now. Please try again.",
      });
    }
  };

  const resultLine = (() => {
    if (status.kind === "result") {
      const { result } = status;
      if (result.serviceable) {
        const eta =
          result.estimatedDelivery && result.etaDays
            ? `by ${formatDate(result.estimatedDelivery)} (${result.etaDays} days)`
            : result.estimatedDelivery
              ? `by ${formatDate(result.estimatedDelivery)}`
              : result.etaDays
                ? `in ${result.etaDays} days`
                : null;
        return (
          <p className="mt-1.5 text-xs text-[#5C6B4B]">
            ✓ Delivery to {status.pin}
            {eta ? ` ${eta}` : ""} ·{" "}
            {result.cod ? "Cash on Delivery available" : "Prepaid orders only"}
          </p>
        );
      }
      return (
        <p className="mt-1.5 text-xs text-[#A45A4B]">
          Not serviceable at {status.pin} yet — we&apos;re expanding to new
          PIN codes soon.
        </p>
      );
    }
    if (status.kind === "error") {
      return <p className="mt-1.5 text-xs text-[#A45A4B]">{status.message}</p>;
    }
    if (status.kind === "checking") {
      return <p className="mt-1.5 text-xs text-[#2B2620]/50">Checking…</p>;
    }
    return null;
  })();

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="postal-code"
          placeholder="Delivery PIN"
          aria-label="Delivery PIN code"
          maxLength={6}
          value={pin}
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, "").slice(0, 6));
            if (status.kind !== "idle") setStatus({ kind: "idle" });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              check();
            }
          }}
          className="w-32 rounded-full border border-[#2B2620]/20 bg-[#FAF8F3] px-4 py-2 text-sm tracking-widest outline-none placeholder:text-[#2B2620]/40 focus:border-[#2B2620]/50"
        />
        <button
          type="button"
          onClick={check}
          disabled={status.kind === "checking" || pin.length !== 6}
          className="cursor-pointer rounded-full border border-[#2B2620] px-4 py-2 text-sm text-[#2B2620] transition-colors hover:bg-[#2B2620] hover:text-[#FAF8F3] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {status.kind === "checking" ? "Checking…" : "Check"}
        </button>
      </div>
      {resultLine}
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
