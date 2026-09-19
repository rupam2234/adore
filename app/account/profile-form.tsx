'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function ProfileForm({
  initialName,
  initialPhone,
}: {
  initialName: string;
  initialPhone: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setSaved(false);
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (phone.trim() && !/^[\d\s+-]{10,15}$/.test(phone.trim())) {
      setError('Enter a valid phone number.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/account/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Could not save your profile.');
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    'w-full rounded-lg border border-[#2B2620]/20 bg-white px-3 py-2 text-sm placeholder:text-[#2B2620]/30 focus:border-[#2B2620] focus:outline-none';
  const labelClass =
    'mb-1 block text-xs uppercase tracking-wider text-[#2B2620]/60';

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-5 space-y-4 border-t border-[#2B2620]/10 pt-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="profile-name" className={labelClass}>
            Name
          </label>
          <input
            id="profile-name"
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={busy}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="profile-phone" className={labelClass}>
            Phone
          </label>
          <input
            id="profile-phone"
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="98765 43210"
            disabled={busy}
            className={inputClass}
          />
        </div>
      </div>
      {error && <p className="text-sm text-[#A45A4B]">{error}</p>}
      {saved && <p className="text-sm text-[#5C6B4B]">Saved.</p>}
      <button
        type="submit"
        disabled={busy}
        className="cursor-pointer rounded-full bg-[#2B2620] px-5 py-2 text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}
