'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';

function safeNext(raw: string | null): string {
  if (!raw) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    return '/';
  }
  return raw;
}

export default function SignupForm() {
  const searchParams = useSearchParams();
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const confirmId = useId();
  const phoneId = useId();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [phone, setPhone] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState<{
    name?: string;
    email?: string;
    password?: string;
    confirm?: string;
    phone?: string;
  }>({});
  const [busy, setBusy] = useState(false);

  function validate(): boolean {
    const next: typeof fieldError = {};
    if (!name.trim()) next.name = 'Enter your name.';
    if (!email.trim()) next.email = 'Enter your email.';
    else if (!/^\S+@\S+\.\S+$/.test(email.trim()))
      next.email = 'Enter a valid email address.';
    if (!password) next.password = 'Choose a password.';
    else if (password.length < 8) next.password = 'Use at least 8 characters.';
    if (confirm !== password) next.confirm = 'Passwords do not match.';
    // Counted before submit so the customer finds out here rather than after a
    // round trip. Matches the server rule in utils/phone.ts: 10 digits, and
    // nothing but digits once the usual separators are ignored.
    const digits = phone.replace(/\D/g, '');
    if (!phone.trim()) next.phone = 'Enter your mobile number.';
    else if (!/^[\d\s+()-]+$/.test(phone.trim()) || digits.length !== 10)
      next.phone = 'Enter a valid 10-digit mobile number.';
    setFieldError(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    if (!validate()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
          phone: phone.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data.error ?? 'Could not create your account. Please try again.'
        );
        return;
      }
      window.location.href = safeNext(searchParams.get('next'));
    } catch {
      setError(
        'Something went wrong. Please check your connection and try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  const inputClass = (invalid?: string) =>
    `w-full rounded-lg border bg-white px-4 py-3 text-sm transition-colors placeholder:text-[#2B2620]/30 focus:outline-none ${
      invalid
        ? 'border-[#A45A4B] focus:border-[#A45A4B]'
        : 'border-[#2B2620]/20 focus:border-[#2B2620]'
    }`;
  const labelClass =
    'mb-1.5 block text-xs uppercase tracking-[0.15em] text-[#2B2620]/60';

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-serif text-3xl">Create your account</h1>
        <p className="mt-2 text-sm text-[#2B2620]/60">
          Member perks like promo codes, straight away.
        </p>
      </div>
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <div>
          <label htmlFor={nameId} className={labelClass}>
            Name
          </label>
          <input
            id={nameId}
            name="name"
            type="text"
            autoComplete="name"
            autoFocus
            value={name}
            onChange={e => {
              setName(e.target.value);
              if (fieldError.name)
                setFieldError(f => ({ ...f, name: undefined }));
            }}
            placeholder="Your name"
            disabled={busy}
            aria-invalid={!!fieldError.name}
            aria-describedby={fieldError.name ? `${nameId}-error` : undefined}
            className={inputClass(fieldError.name)}
          />
          {fieldError.name && (
            <p id={`${nameId}-error`} className="mt-1.5 text-xs text-[#A45A4B]">
              {fieldError.name}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={emailId} className={labelClass}>
            Email
          </label>
          <input
            id={emailId}
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={e => {
              setEmail(e.target.value);
              if (fieldError.email)
                setFieldError(f => ({ ...f, email: undefined }));
            }}
            placeholder="you@example.com"
            disabled={busy}
            aria-invalid={!!fieldError.email}
            aria-describedby={fieldError.email ? `${emailId}-error` : undefined}
            className={inputClass(fieldError.email)}
          />
          {fieldError.email && (
            <p
              id={`${emailId}-error`}
              className="mt-1.5 text-xs text-[#A45A4B]"
            >
              {fieldError.email}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={phoneId} className={labelClass}>
            Mobile number
          </label>
          <input
            id={phoneId}
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={phone}
            onChange={e => {
              setPhone(e.target.value);
              if (fieldError.phone)
                setFieldError(f => ({ ...f, phone: undefined }));
            }}
            placeholder="98765 43210"
            disabled={busy}
            aria-invalid={!!fieldError.phone}
            aria-describedby={fieldError.phone ? `${phoneId}-error` : undefined}
            className={inputClass(fieldError.phone)}
          />
          {fieldError.phone ? (
            <p id={`${phoneId}-error`} className="mt-1.5 text-xs text-[#A45A4B]">
              {fieldError.phone}
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-[#2B2620]/50">
              For delivery updates. One account per number.
            </p>
          )}
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor={passwordId} className={labelClass}>
              Password
            </label>
            <button
              type="button"
              onClick={() => setShowPassword(s => !s)}
              className="cursor-pointer text-xs text-[#2B2620]/50 underline-offset-2 hover:text-[#2B2620] hover:underline"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <input
            id={passwordId}
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={e => {
              setPassword(e.target.value);
              if (fieldError.password)
                setFieldError(f => ({ ...f, password: undefined }));
            }}
            placeholder="At least 8 characters"
            disabled={busy}
            aria-invalid={!!fieldError.password}
            aria-describedby={
              fieldError.password ? `${passwordId}-error` : undefined
            }
            className={inputClass(fieldError.password)}
          />
          {fieldError.password && (
            <p
              id={`${passwordId}-error`}
              className="mt-1.5 text-xs text-[#A45A4B]"
            >
              {fieldError.password}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={confirmId} className={labelClass}>
            Confirm password
          </label>
          <input
            id={confirmId}
            name="confirmPassword"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirm}
            onChange={e => {
              setConfirm(e.target.value);
              if (fieldError.confirm)
                setFieldError(f => ({ ...f, confirm: undefined }));
            }}
            placeholder="Repeat your password"
            disabled={busy}
            aria-invalid={!!fieldError.confirm}
            aria-describedby={
              fieldError.confirm ? `${confirmId}-error` : undefined
            }
            className={inputClass(fieldError.confirm)}
          />
          {fieldError.confirm && (
            <p
              id={`${confirmId}-error`}
              className="mt-1.5 text-xs text-[#A45A4B]"
            >
              {fieldError.confirm}
            </p>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-[#A45A4B]/30 bg-[#A45A4B]/10 px-4 py-3 text-sm text-[#A45A4B]"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full cursor-pointer rounded-full bg-[#2B2620] px-6 py-3 text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="text-sm text-[#2B2620]/60">
        Already have an account?{' '}
        <Link
          href={
            searchParams.get('next')
              ? `/login?next=${encodeURIComponent(searchParams.get('next')!)}`
              : '/login'
          }
          className="font-medium underline underline-offset-4 hover:text-[#2B2620]"
        >
          Log in
        </Link>
      </p>
    </div>
  );
}
