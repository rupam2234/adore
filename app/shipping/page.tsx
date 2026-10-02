import type { Metadata } from 'next';
import PageShell from '@/components/theme/page-shell';
import {
  FREE_SHIPPING_THRESHOLD,
  SHIPPING_FLAT,
} from '@/utils/checkout-format';

export const metadata: Metadata = {
  title: 'Shipping Policy',
  description:
    'How Adore processes, dispatches and delivers your order — timelines, charges, tracking, and what to do if something goes wrong.',
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10 first:mt-0">
      <h2 className="font-serif text-2xl">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-[#2B2620]/80">
        {children}
      </div>
    </section>
  );
}

const SUMMARY = [
  {
    topic: 'Order processing',
    detail:
      '1–3 business days after payment, while your order is packed and handed to the courier.',
  },
  {
    topic: 'Delivery time',
    detail:
      'Typically 3–7 business days after dispatch. The exact estimate for your PIN code is shown in your bag and at checkout.',
  },
  {
    topic: 'Shipping charges',
    detail:
      'The live courier rate for your PIN code and parcel weight, shown before you pay.',
  },
  {
    topic: 'Free shipping',
    detail: `On every order above ₹${FREE_SHIPPING_THRESHOLD}.`,
  },
  {
    topic: 'Payment',
    detail:
      'Prepaid only. Your order is booked with the courier once payment is confirmed.',
  },
  {
    topic: 'Serviceability',
    detail:
      'We check your PIN code with our courier before payment, so we never take money for an address we cannot deliver to.',
  },
  {
    topic: 'Address changes',
    detail:
      'Possible before dispatch — contact us quickly. We cannot promise an edit once the parcel is with the courier.',
  },
  {
    topic: 'International orders',
    detail: 'We currently ship within India only.',
  },
] as const;

export default function ShippingPolicyPage() {
  return (
    <PageShell
      eyebrow="Help"
      title="Shipping Policy"
      intro="Last updated: September 2026. This page explains how long your order takes to reach you, what delivery costs, and what happens if something goes wrong on the way."
    >
      <Section title="Shipping at a glance">
        <div className="overflow-hidden rounded-2xl border border-[#2B2620]/10">
          <dl>
            {SUMMARY.map(({ topic, detail }, i) => (
              <div
                key={topic}
                className={`grid gap-1 px-5 py-4 sm:grid-cols-[200px_1fr] sm:gap-6 ${
                  i % 2 === 0 ? 'bg-[#E7DFCB]/30' : 'bg-white'
                }`}
              >
                <dt className="text-sm font-medium text-[#2B2620]">{topic}</dt>
                <dd className="text-sm leading-relaxed text-[#2B2620]/70">
                  {detail}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="text-sm text-[#2B2620]/60">
          This summary is for convenience — the detailed terms below apply in
          full.
        </p>
      </Section>

      <Section title="1. About this policy">
        <p>
          This Shipping Policy covers processing, dispatch, delivery, tracking,
          failed deliveries and address changes for every order placed on the
          Adore website. By placing an order, paying for it, choosing a delivery
          option or accepting a delivery, you confirm that you have read and
          accepted this policy along with our{' '}
          <a
            href="/terms"
            className="underline underline-offset-4 hover:text-[#5C6B4B]"
          >
            Terms &amp; Conditions
          </a>
          .
        </p>
      </Section>

      <Section title="2. Where we ship">
        <p>
          We ship across all serviceable PIN codes in India. Before you pay, we
          check your PIN code against live courier availability and the weight
          of your parcel. If your PIN code is not serviceable we will tell you
          straight away rather than take your money — a pickup point may be a
          better option.
        </p>
      </Section>

      <Section title="3. Order processing time">
        <p>
          Orders are typically processed within 1–3 business days of confirmed
          payment. Processing includes picking and checking your items, packing,
          and generating a label with our courier partner. Orders placed after
          2:00 PM IST, or on Sundays and public holidays, are usually processed
          the next working day.
        </p>
        <p>
          During sale periods, festive seasons and stock sales, processing may
          take slightly longer. We will let you know by email if your order is
          delayed.
        </p>
      </Section>

      <Section title="4. Delivery timelines">
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Standard delivery.</strong> Typically 3–7 business days
            after dispatch to most PIN codes.
          </li>
          <li>
            <strong>Metro cities.</strong> Usually 2–4 business days after
            dispatch.
          </li>
          <li>
            <strong>North-east, hill regions and remote PIN codes.</strong>{' '}
            Typically 5–10 business days after dispatch.
          </li>
        </ul>
        <p>
          The most accurate estimate for your address is the delivery date shown
          in your bag once you enter your PIN code, and again at checkout before
          you pay. Timelines are estimates, not guarantees — couriers operate on
          their own schedules, and weather, road conditions, strikes, public
          holidays and logistics congestion can extend them. Risk of loss passes
          to you when the parcel is delivered to the address you gave us.
        </p>
      </Section>

      <Section title="5. Shipping charges">
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Live courier rates.</strong> The amount we charge is the
            actual rate quoted by our courier partner for your PIN code and your
            parcel&rsquo;s packed weight, shown to you at checkout before
            payment.
          </li>
          <li>
            <strong>Free shipping.</strong> Shipping is free on orders above ₹
            {FREE_SHIPPING_THRESHOLD}, applied automatically.
          </li>
          <li>
            <strong>Fallback rate.</strong> If a live rate cannot be retrieved
            for a PIN code, a flat rate of ₹{SHIPPING_FLAT} applies.
          </li>
          <li>
            <strong>Changes.</strong> Rates may change with courier pricing or
            fuel surcharges. The rate shown at checkout is the rate that applies
            to your order.
          </li>
        </ul>
        <p>
          Shipping charges are not refundable once an order has been dispatched,
          except where an item is defective or incorrect — in which case we
          cover the cost of returning it. Our returns and exchange terms live in
          section 3 of our{' '}
          <a
            href="/terms"
            className="underline underline-offset-4 hover:text-[#5C6B4B]"
          >
            Terms &amp; Conditions
          </a>
          .
        </p>
      </Section>

      <Section title="6. Payment">
        <p>
          Adore is a prepaid store. We open a secure payment window for your
          order total, and your parcel is booked with our courier partner only
          after the payment is confirmed. We never ask for card details over
          email, message or phone — if anyone claiming to be from Adore does,
          please{' '}
          <a
            href="/contact"
            className="underline underline-offset-4 hover:text-[#5C6B4B]"
          >
            tell us
          </a>{' '}
          immediately.
        </p>
      </Section>

      <Section title="7. Order confirmation &amp; tracking">
        <p>
          You will receive an order confirmation email once payment goes
          through, followed by a shipping email with your courier&rsquo;s
          tracking link as soon as the parcel is picked up. Tracking updates can
          take up to 24 hours to appear after the courier scans the parcel. If a
          parcel shows no movement for 5 business days, contact us and we will
          chase it with the carrier on your behalf.
        </p>
      </Section>

      <Section title="8. Address accuracy &amp; changes">
        <ul className="list-disc space-y-2 pl-6">
          <li>
            Please check your name, phone number, address and PIN code carefully
            before paying — couriers deliver to whatever address we give them.
          </li>
          <li>
            <strong>Before dispatch.</strong> If something is wrong, email us
            with your order number and we will try to correct it. We cannot
            guarantee an edit once the parcel has left our warehouse.
          </li>
          <li>
            <strong>After dispatch.</strong> An address change usually means a
            cancellation and a new order, so please contact us within a few
            hours rather than days.
          </li>
          <li>
            An undeliverable parcel returned to us (RTO) due to an incorrect
            address may be refunded less the original shipping charge and any
            re-shipping fee we have incurred. Please double-check your details —
            it saves everyone time.
          </li>
          <li>
            Please keep your phone number active. Many couriers call before
            delivery, and undelivered parcels are often returned simply because
            nobody answered.
          </li>
        </ul>
      </Section>

      <Section title="9. Failed deliveries &amp; delays">
        <p>
          If delivery fails on the first attempt, couriers usually attempt
          delivery two or three times and hold the parcel at a local centre
          before returning it to us. Undelivered parcels are refunded to the
          original payment method once the parcel reaches us and the return is
          recorded. We are not able to ship again at our cost.
        </p>
      </Section>

      <Section title="10. Marked delivered but not received">
        <p>
          If tracking shows delivered and you have not received your parcel,
          please check with neighbours, your building reception or the delivery
          agent, then contact us within 48 hours of the delivery status update.
          We will raise a delivery investigation with the courier and share the
          outcome. Claims made after 48 hours are difficult for us to verify and
          may not be eligible for a refund.
        </p>
      </Section>

      <Section title="11. Damaged or incorrect items">
        <p>
          If your parcel arrives damaged or contains the wrong item, please
          photograph the packaging and the item as it arrived, and email us with
          your order number within 48 hours of delivery. We will arrange a
          replacement or a full refund, and we will cover the return shipping.
        </p>
      </Section>

      <Section title="12. Delays beyond our control">
        <p>
          We are not liable for shipping or delivery delays caused by events
          outside our reasonable control — courier failures, logistics
          congestion, strikes, natural disasters, epidemic or pandemic measures,
          government action, transport disruption, cyberattacks or platform
          outages. Where we can, we will offer a full refund instead of a
          delayed parcel; your statutory consumer rights are unaffected.
        </p>
      </Section>

      <Section title="13. Updates to this policy">
        <p>
          We may update this policy from time to time as our logistics, courier
          partners or legal obligations change. The version on this page at the
          time your order is placed is the version that applies to it.
        </p>
      </Section>

      <Section title="14. Contact us">
        <p>
          Questions about a delivery? Send us your order number and we will look
          into it straight away — the more detail you share (order ID, contact
          number, email and screenshots of the tracking page), the faster we can
          help. Use the{' '}
          <a
            href="/contact"
            className="underline underline-offset-4 hover:text-[#5C6B4B]"
          >
            contact page
          </a>
          .
        </p>
      </Section>
    </PageShell>
  );
}
