'use client';

import { useState } from 'react';

interface LoginFormProps {
  next: string;
}

export default function LoginForm({ next }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    if (!email.trim()) {
      setError('Enter your email.');
      return;
    }
    if (!password.trim()) {
      setError('Enter your password.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Login failed.');
        return;
      }
      const data = await res.json();
      console.log('[login-form] Login success:', data);
      window.location.href = next;
    } catch (err) {
      console.error('Login error:', err);
      setError('Network error. Is the server running?');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-24 flex max-w-md flex-col items-center gap-8">
      <div className="flex flex-col items-center gap-3">
        <span className="font-admin text-5xl text-[#2B2620]">🛍️</span>
        <h1 className="font-admin font-bold text-2xl text-[#2B2620]">Admin</h1>
        <p className="text-sm text-[#2B2620]/60">
          Sign in with your email and password to continue.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="w-full space-y-4 rounded-xl border border-[#2B2620]/10 bg-white p-6"
      >
        <div>
          <label
            htmlFor="admin-email"
            className="mb-1.5 block text-xs uppercase tracking-wider text-[#2B2620]/70"
          >
            Email
          </label>
          <input
            id="admin-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={busy}
            className="w-full rounded-lg border border-[#2B2620]/20 bg-white px-3 py-2 text-sm
                     placeholder:text-[#2B2620]/30 focus:border-[#2B2620] focus:outline-none"
          />
        </div>

        <div>
          <label
            htmlFor="admin-password"
            className="mb-1.5 block text-xs uppercase tracking-wider text-[#2B2620]/70"
          >
            Password
          </label>
          <input
            id="admin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            disabled={busy}
            className="w-full rounded-lg border border-[#2B2620]/20 bg-white px-3 py-2 text-sm
                     placeholder:text-[#2B2620]/30 focus:border-[#2B2620] focus:outline-none"
          />
        </div>

        {error && <p className="text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg border border-[#2B2620] bg-[#2B2620] px-4 py-2 text-sm
                   uppercase tracking-wider text-[#FAF8F3] transition-colors
                   hover:bg-[#3A332A] focus:outline-none focus:ring-2 focus:ring-[#2B2620]/40
                   disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="text-xs text-[#2B2620]/50">
        If you don&apos;t have an account, contact an administrator.
      </p>
    </div>
  );
}
