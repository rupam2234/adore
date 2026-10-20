'use client';

import { useState } from 'react';

/**
 * Footer newsletter signup.
 *
 * The Footer itself is a server component, so the interactive form lives here.
 * Marks itself with `data-protonpass-form` so password managers (Proton Pass
 * and most others) offer to fill the email field like any login form.
 */
export default function NewsletterSignup() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'error'>(
    'idle'
  );
  const [message, setMessage] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status === 'busy') return;
    setStatus('busy');
    setMessage('');

    try {
      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };

      if (res.ok) {
        setStatus('done');
        setMessage(
          "You're already on the list. Watch your inbox for our next drop."
        );
        setEmail('');
      } else {
        setStatus('error');
        setMessage(data.error ?? 'Something went wrong. Please try again.');
      }
    } catch {
      setStatus('error');
      setMessage('Network error. Please try again.');
    }
  }

  if (status === 'done') {
    return (
      <p className="text-sm leading-relaxed text-[#E7DFCB]" role="status">
        {message}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm" noValidate>
      <div className="flex w-full gap-2">
        <input
          type="email"
          name="email"
          autoComplete="email"
          aria-label="Email address"
          placeholder="Your email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          disabled={status === 'busy'}
          className="w-full rounded-full border border-[#FAF8F3]/30 bg-transparent px-5 py-3 text-sm placeholder:text-[#FAF8F3]/50 focus:border-[#FAF8F3] focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={status === 'busy'}
          className="rounded-full bg-[#FAF8F3] px-6 py-3 text-sm text-[#2B2620] transition-colors hover:bg-[#DDBBA4] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === 'busy' ? '…' : 'Sign up'}
        </button>
      </div>
      {status === 'error' && message && (
        <p className="mt-2 text-xs text-[#E7DFCB]" role="alert">
          {message}
        </p>
      )}
    </form>
  );
}
