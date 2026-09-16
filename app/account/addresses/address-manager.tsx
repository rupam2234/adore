"use client";

import { useState } from "react";
import type { CustomerAddress } from "@/utils/account";

type FormState = {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  addressType: string;
  isDefault: boolean;
};

const EMPTY_FORM: FormState = {
  fullName: "",
  phone: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  addressType: "Home",
  isDefault: false,
};

export default function AddressManager({
  initialAddresses,
}: {
  initialAddresses: CustomerAddress[];
}) {
  const [addresses, setAddresses] = useState(initialAddresses);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(initialAddresses.length === 0);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function openAdd() {
    setForm(EMPTY_FORM);
    setEditing(null);
    setAdding(true);
    setError("");
  }

  function openEdit(address: CustomerAddress) {
    setForm({
      fullName: address.fullName ?? "",
      phone: address.phone ?? "",
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2 ?? "",
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      addressType: address.addressType ?? "Home",
      isDefault: address.isDefault,
    });
    setEditing(address.id);
    setAdding(true);
    setError("");
  }

  function close() {
    setAdding(false);
    setEditing(null);
    setError("");
  }

  async function call(
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/account/addresses${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        credentials: "same-origin",
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return false;
      }
      setAddresses(data.addresses);
      return true;
    } catch {
      setError("Something went wrong. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const payload = {
      fullName: form.fullName,
      phone: form.phone,
      addressLine1: form.addressLine1,
      addressLine2: form.addressLine2 || null,
      city: form.city,
      state: form.state,
      postalCode: form.postalCode,
      addressType: form.addressType || null,
      isDefault: form.isDefault,
    };
    const ok = editing
      ? await call("PATCH", `/${editing}`, payload)
      : await call("POST", "", payload);
    if (ok) close();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg">Saved addresses</h2>
        {!adding && (
          <button
            type="button"
            onClick={openAdd}
            className="cursor-pointer rounded-full border border-[#2B2620] px-4 py-1.5 text-xs transition-colors hover:bg-[#2B2620] hover:text-[#FAF8F3]"
          >
            + Add address
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-[#A45A4B]/30 bg-[#A45A4B]/10 px-4 py-3 text-sm text-[#A45A4B]">
          {error}
        </p>
      )}

      {addresses.length === 0 && !adding && (
        <p className="mt-4 rounded-xl border border-dashed border-[#2B2620]/20 bg-white px-6 py-10 text-center text-sm text-[#2B2620]/60">
          No addresses saved yet.
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {addresses.map((address) => (
          <AddressCard
            key={address.id}
            address={address}
            busy={busy}
            onEdit={() => openEdit(address)}
            onSetDefault={() => call("PATCH", `/${address.id}`, { action: "setDefault" })}
            onRemove={() => call("DELETE", `/${address.id}`)}
          />
        ))}
      </div>

      {adding && (
        <AddressForm
          form={form}
          setForm={setForm}
          editing={!!editing}
          busy={busy}
          onSave={handleSave}
          onCancel={close}
        />
      )}
    </div>
  );
}

function AddressCard({
  address,
  busy,
  onEdit,
  onSetDefault,
  onRemove,
}: {
  address: CustomerAddress;
  busy: boolean;
  onEdit: () => void;
  onSetDefault: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={`relative rounded-xl border bg-white p-5 ${
        address.isDefault ? "border-[#5C6B4B]/50" : "border-[#2B2620]/10"
      }`}
    >
      {address.isDefault && (
        <span className="absolute right-4 top-4 rounded-full bg-[#5C6B4B]/10 px-2 py-0.5 text-xs font-medium text-[#5C6B4B]">
          Default
        </span>
      )}
      <p className="font-medium">{address.fullName}</p>
      <p className="mt-1 text-sm text-[#2B2620]/70">
        {address.addressLine1}
        {address.addressLine2 ? `, ${address.addressLine2}` : ""}
      </p>
      <p className="text-sm text-[#2B2620]/70">
        {address.city}, {address.state} {address.postalCode}
      </p>
      <p className="text-sm text-[#2B2620]/70">{address.country}</p>
      {address.phone && <p className="mt-1 text-sm text-[#2B2620]/50">{address.phone}</p>}
      <div className="mt-4 flex items-center gap-4 text-xs">
        <button type="button" onClick={onEdit} className="cursor-pointer underline-offset-2 hover:underline">
          Edit
        </button>
        {!address.isDefault && (
          <button
            type="button"
            onClick={onSetDefault}
            disabled={busy}
            className="cursor-pointer underline-offset-2 hover:underline disabled:opacity-40"
          >
            Set default
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="cursor-pointer text-[#A45A4B] underline-offset-2 hover:underline disabled:opacity-40"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function AddressForm({
  form,
  setForm,
  editing,
  busy,
  onSave,
  onCancel,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  editing: boolean;
  busy: boolean;
  onSave: (e: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const inputClass =
    "w-full rounded-lg border border-[#2B2620]/20 bg-white px-3 py-2 text-sm focus:border-[#2B2620] focus:outline-none";
  const labelClass = "mb-1 block text-xs uppercase tracking-wider text-[#2B2620]/60";
  const field = (
    label: string,
    key: keyof FormState,
    options?: { type?: string; span?: boolean; optional?: boolean },
  ) => (
    <div className={options?.span ? "sm:col-span-2" : undefined}>
      <label className={labelClass}>
        {options?.optional ? `${label} (optional)` : label}
      </label>
      <input
        type={options?.type ?? "text"}
        value={String(form[key])}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className={inputClass}
      />
    </div>
  );

  return (
    <form
      onSubmit={onSave}
      noValidate
      className="mt-6 rounded-xl border border-[#2B2620]/10 bg-white p-6"
    >
      <h3 className="font-serif text-base">{editing ? "Edit address" : "New address"}</h3>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {field("Recipient name", "fullName")}
        {field("Phone", "phone", { type: "tel" })}
        {field("Address line 1", "addressLine1", { span: true })}
        {field("Address line 2", "addressLine2", { span: true, optional: true })}
        {field("City", "city")}
        {field("State", "state")}
        {field("PIN code", "postalCode")}
        <div>
          <label className={labelClass}>Type</label>
          <select
            value={form.addressType}
            onChange={(e) => setForm((f) => ({ ...f, addressType: e.target.value }))}
            className={inputClass}
          >
            <option>Home</option>
            <option>Work</option>
            <option>Other</option>
          </select>
        </div>
      </div>
      <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.isDefault}
          onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
          className="h-4 w-4 accent-[#5C6B4B]"
        />
        Set as default address
      </label>

      <div className="mt-5 flex gap-3">
        <button
          type="submit"
          disabled={busy}
          className="cursor-pointer rounded-full bg-[#2B2620] px-5 py-2 text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Saving…" : editing ? "Save changes" : "Add address"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="cursor-pointer rounded-full border border-[#2B2620]/30 px-5 py-2 text-sm transition-colors hover:border-[#2B2620] disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
