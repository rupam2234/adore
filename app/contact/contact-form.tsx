"use client";

import { useState, type FormEvent } from "react";

type Status = "idle" | "submitting" | "sent" | "error";

/**
 * Contact form placeholder.
 *
 * Email delivery is not configured yet — the submit handler currently
 * simulates a send so the UI is testable. Wire it up by POSTing to an API
 * route (e.g. app/api/contact/route.ts) that calls your email provider
 * (Resend, SendGrid, SES...) once the account is ready.
 */
export default function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "submitting") return;
    setStatus("submitting");

    // TODO: replace with a real POST once email is configured:
    // const res = await fetch("/api/contact", { method: "POST", body: new FormData(e.currentTarget) });
    // setStatus(res.ok ? "sent" : "error");
    await new Promise((r) => setTimeout(r, 600));
    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <div className="rounded-2xl border border-[#5C6B4B]/30 bg-[#5C6B4B]/10 p-8 text-center">
        <h2 className="font-serif text-2xl">Thank you — note received</h2>
        <p className="mt-3 text-[15px] text-[#2B2620]/70">
          Our team will reply within 1–2 business days. (Email delivery is
          being set up; messages sent before launch are still saved and
          answered.)
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-6 rounded-full border border-[#2B2620]/30 px-6 py-2.5 text-sm transition-colors hover:border-[#2B2620]"
        >
          Send another message
        </button>
      </div>
    );
  }

  const inputClass =
    "w-full rounded-xl border border-[#2B2620]/20 bg-white px-4 py-3 text-sm placeholder:text-[#2B2620]/40 focus:border-[#5C6B4B] focus:outline-none";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Name</span>
          <input required name="name" placeholder="Your name" className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Email</span>
          <input
            required
            type="email"
            name="email"
            placeholder="you@example.com"
            className={inputClass}
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">Order number (optional)</span>
        <input name="order" placeholder="e.g. ADR-12345" className={inputClass} />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">Subject</span>
        <select name="subject" className={inputClass} defaultValue="Order support">
          <option>Order support</option>
          <option>Returns &amp; exchanges</option>
          <option>Sizing &amp; fit</option>
          <option>Press &amp; partnerships</option>
          <option>Something else</option>
        </select>
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">Message</span>
        <textarea
          required
          name="message"
          rows={6}
          placeholder="How can we help?"
          className={inputClass}
        />
      </label>

      {status === "error" && (
        <p className="text-sm text-[#C98F82]">
          Something went wrong sending your message. Please try again.
        </p>
      )}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="rounded-full bg-[#2B2620] px-8 py-3 text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B] disabled:opacity-60"
      >
        {status === "submitting" ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
