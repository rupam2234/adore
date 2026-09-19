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

export default function LoginForm() {
  const searchParams = useSearchParams();
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState<{
    email?: string;
    password?: string;
  }>({});
  const [busy, setBusy] = useState(false);

  function validate(): boolean {
    const next: typeof fieldError = {};
    if (!email.trim()) next.email = 'Enter your email.';
    else if (!/^\S+@\S+\.\S+$/.test(email.trim()))
      next.email = 'Enter a valid email address.';
    if (!password) next.password = 'Enter your password.';
    setFieldError(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    if (!validate()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Login failed. Please try again.');
        setPassword('');
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
        <h1 className="font-serif text-3xl">Welcome back</h1>
        <p className="mt-2 text-sm text-[#2B2620]/60">
          Log in to unlock member perks like promo codes.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <div>
          <label htmlFor={emailId} className={labelClass}>
            Email
          </label>
          <input
            id={emailId}
            name="email"
            type="email"
            autoComplete="email"
            autoFocus
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
            autoComplete="current-password"
            value={password}
            onChange={e => {
              setPassword(e.target.value);
              if (fieldError.password)
                setFieldError(f => ({ ...f, password: undefined }));
            }}
            placeholder="••••••••"
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
          {busy ? 'Signing in…' : 'Log in'}
        </button>
      </form>

      <p className="text-sm text-[#2B2620]/60">
        New to Adore?{' '}
        <Link
          href={
            searchParams.get('next')
              ? `/signup?next=${encodeURIComponent(searchParams.get('next')!)}`
              : '/signup'
          }
          className="font-medium underline underline-offset-4 hover:text-[#2B2620]"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
