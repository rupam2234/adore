import type { Metadata } from 'next';
import Link from 'next/link';
import PageShell from '@/components/theme/page-shell';
import {
  DEFECT_CLAIM_WINDOW_HOURS,
  EXCHANGE_FEE,
  FREE_EXCHANGES_PER_ORDER,
  REFUND_PROCESSING_DAYS,
  RETURN_FEE,
  RETURN_REASONS,
  RETURN_WINDOW_DAYS,
  SELF_SHIP,
} from '@/utils/returns';

export const metadata: Metadata = {
  title: 'Returns & Exchanges',
  description:
    'How to return or exchange an Adore order: eligibility, the reverse pickup process, timelines, and your refund.',
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

const STEPS = [
  {
    title: 'Raise the request',
    body: 'Open the order in your Adore account, pick the item and tell us why. Takes about a minute.',
  },
  {
    title: 'We approve &amp; book pickup',
    body: 'We check eligibility, then schedule a reverse pickup from your address, usually within 24 hours.',
  },
  {
    title: 'Quality check',
    body: 'Your parcel reaches us and is inspected. This is where wear, missing tags or wrong items are caught.',
  },
  {
    title: 'Refund or exchange',
    body: 'Once the check passes, your refund is issued, or your replacement is packed and shipped.',
  },
] as const;

const SUMMARY = [
  {
    topic: 'Return window',
    detail: `${RETURN_WINDOW_DAYS} days from the date of delivery.`,
  },
  {
    topic: 'Exchanges',
    detail: `Yes, same size or a different one, subject to stock. The first ${FREE_EXCHANGES_PER_ORDER} exchange per order is free, then ₹${EXCHANGE_FEE} each.`,
  },
  {
    topic: 'Returns',
    detail: `Accepted on unworn items with tags intact. A ₹${RETURN_FEE} handling fee applies unless the fault is ours.`,
  },
  {
    topic: 'Damaged / wrong item',
    detail: `Tell us within ${DEFECT_CLAIM_WINDOW_HOURS} hours of delivery. We cover the return shipping and the fee is waived.`,
  },
  {
    topic: 'Refund method',
    detail: 'Back to your original payment method.',
  },
  {
    topic: 'Refund timeline',
    detail: `${REFUND_PROCESSING_DAYS} business days after the item passes inspection.`,
  },
  {
    topic: 'Reverse pickup',
    detail:
      'Free, arranged by us. If pickup fails, we ask you to self-ship and reimburse ₹150 (₹100 on an exchange).',
  },
  {
    topic: 'Sale items',
    detail: 'Exchange or store credit only. No refund on sale purchases.',
  },
  {
    topic: 'Start a return',
    detail:
      'Everything is raised from your account. There is no separate portal or app to install.',
  },
] as const;

export default function ReturnsPage() {
  return (
    <PageShell
      eyebrow="Help"
      title="Returns &amp; Exchanges"
      intro={`Last updated: September 2026. Changed your mind, or something isn't right? Here's how returning or exchanging an Adore order works, and exactly what we need from you.`}
    >
      <Section title="At a glance">
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
      </Section>

      <Section title="How it works">
        <ol className="space-y-5">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#E7DFCB] text-sm font-medium text-[#2B2620]">
                {i + 1}
              </span>
              <div>
                <p className="font-medium text-[#2B2620]">{step.title}</p>
                <p className="mt-1 text-[15px] leading-relaxed text-[#2B2620]/80">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <p>
          Reverse pickup is arranged through our courier partner, so you never
          have to pack a parcel yourself or pay postage up front.
        </p>
        <p>
          You can follow every step &mdash; request, pickup, arrival at our
          warehouse, inspection, refund &mdash; under{' '}
          <a
            href="/account/returns"
            className="underline underline-offset-4 hover:text-[#5C6B4B]"
          >
            Returns in your account
          </a>
          , and cancel a request there while it has not yet been collected. We
          use your account history to keep prices fair for everyone; see
          section 6.
        </p>
        <p>
          Pickups occasionally fail. Your PIN code may be outside reverse
          pickup coverage, the rider may be unable to reach you, or the first
          attempt may simply miss you. We try up to{' '}
          {SELF_SHIP.maxPickupAttempts} attempts. If pickup still can&rsquo;t
          happen, we will ask you to self-ship instead, and we will reimburse ₹
          {SELF_SHIP.returnReimbursement} toward your return shipping (₹
          {SELF_SHIP.exchangeReimbursement} on an exchange).{' '}
          <strong>
            If the pickup fails through no fault of yours, we also waive the ₹
            {RETURN_FEE} return fee entirely.
          </strong>{' '}
          We&rsquo;d rather you got your money back than have a failed pickup
          turn into a bad review.
        </p>
      </Section>

      <Section title="1. Which items can be returned">
        <p>
          You can return or exchange items bought on the Adore website within{' '}
          {RETURN_WINDOW_DAYS} days of delivery. Items must be:
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Unworn, unwashed and free from marks, odour or damage.</li>
          <li>With all original tags attached.</li>
          <li>In their original packaging, with the invoice.</li>
          <li>
            Free from perfume, deodorant, makeup or any other substance that
            makes them unsellable.
          </li>
        </ul>
        <p>
          For hygiene reasons we cannot accept innerwear and swimwear whose
          hygiene strip or seal has been removed. Items marked as final sale on
          the product page are not returnable or exchangeable &mdash; this is
          always shown clearly on the product page before you buy.
        </p>
      </Section>

      <Section title="2. Sale &amp; clearance items">
        <p>
          Anything bought during a sale, clearance or on a product page marked
          &ldquo;Sale&rdquo; can be exchanged for a different size, or converted
          to store credit &mdash; but it is not refundable to your payment
          method. This lets you try a sale item without the risk of losing the
          money entirely.
        </p>
      </Section>

      <Section title="3. Exchanges">
        <p>
          If a size does not work, exchange it for the next size up or down.
          Exchanges are subject to the replacement variant actually being in
          stock &mdash; we will tell you straight away if it isn&rsquo;t and
          offer a full refund instead so you are not stuck.
        </p>
        <p>
          Your first {FREE_EXCHANGES_PER_ORDER} exchange per order is free. Each
          additional exchange on the same order costs ₹{EXCHANGE_FEE}, which
          covers reverse pickup, return shipping and a second round of quality
          checking.
        </p>
      </Section>

      <Section title="4. Damaged, faulty or wrong items">
        <p>
          If something arrives damaged, faulty, or simply isn&rsquo;t what you
          ordered, tell us within {DEFECT_CLAIM_WINDOW_HOURS} hours of delivery
          with:
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Your order number.</li>
          <li>
            Photographs of the item as it arrived, including the packaging and
            the size or care tag.
          </li>
          <li>A short description of the fault.</li>
        </ul>
        <p>
          In these cases we arrange and pay for the reverse pickup, waive any
          return or exchange fee, and refund the original shipping charge. A
          faulty item is replaced or fully refunded &mdash; your choice &mdash;
          at our cost.
        </p>
      </Section>

      <Section title="5. Refunds">
        <p>
          Approved refunds go back to your original payment method, typically
          within {REFUND_PROCESSING_DAYS} business days of the item passing
          inspection. Some banks take a further 2&ndash;3 days to post the
          credit to your statement.
        </p>
        <p>The following are deducted where the return is at your choice:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>A ₹{RETURN_FEE} handling, return shipping and checking fee.</li>
          <li>The original shipping charge, since the parcel did reach you.</li>
          <li>
            Any discount benefit you received on the order, pro-rated across the
            items you are keeping.
          </li>
        </ul>
        <p>
          Refunds are always issued to the original payment method &mdash; never
          to a different card, UPI ID or bank account. Storing refunds as store
          credit is a choice you can make, not a condition of getting your money
          back.
        </p>
      </Section>

      <Section title="6. Why we ask for these conditions">
        <p>
          A generous return policy is only sustainable if honest customers keep
          getting good prices, so a small set of firm rules protects everyone:
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            The reverse pickup fee exists because a return is two shipments, not
            one. It keeps our prices honest for the 99% of customers who keep
            their items.
          </li>
          <li>
            Every order gets a limited number of free exchanges. Unlimited free
            size-exchanges would let anyone order five sizes, keep one and
            return four at our expense.
          </li>
          <li>
            Items must come back resaleable. We inspect every returned item and
            a fair proportion go straight back on the shelf &mdash; so a worn or
            soiled item genuinely costs us money.
          </li>
        </ul>
        <p>
          We monitor returns to keep prices fair. Behaviours we treat as abuse
          include returning a different, used or counterfeit item; returning an
          item after wearing or altering it; raising false damage claims;
          repeatedly returning most or all of an order; claiming refunds while
          raising chargebacks; and empty-box claims on orders tracking shows as
          delivered. Where we suspect abuse we may refuse the return, cancel the
          pending order, decline future orders, or withhold a refund. Our full
          list is in section 4 of our{' '}
          <a
            href="/terms"
            className="underline underline-offset-4 hover:text-[#5C6B4B]"
          >
            Terms &amp; Conditions
          </a>
          .
        </p>
      </Section>

      <Section title="7. If a return is refused">
        <p>
          If your return is refused after inspection, we will email you the
          reason with photographs where relevant, and offer to send the item
          back to you at your cost. If you don&rsquo;t collect it within 30 days
          the item may be disposed of and no refund is due. If you believe we
          have misjudged your return, reply to that email and a person &mdash;
          not an automated rule &mdash; will review it.
        </p>
      </Section>

      <Section title="8. What we need from you">
        <p>
          Most returns are simple, but a few things genuinely slow us down. We
          can&rsquo;t process a return, refund or exchange where:
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            The request is raised after the {RETURN_WINDOW_DAYS}-day window.
          </li>
          <li>
            The item reaches us without the tags, invoice or packaging it
            arrived with.
          </li>
          <li>
            The handover details are wrong. The wrong item is handed to the
            rider, or the parcel is left unattended where it can be lost or
            rained on.
          </li>
          <li>
            We can&rsquo;t reach you. Please keep your phone active for the
            duration of the pickup and QC window.
          </li>
        </ul>
        <p>
          We&rsquo;re not trying to catch people out here. We simply
          can&rsquo;t refund an item we never received. If something here
          applies to you, tell us and we&rsquo;ll almost always find a way to
          sort it out.
        </p>
      </Section>

      <Section title="9. Start a return">
        <p>
          Returns are raised from your own account, where the order is already
          linked to you:
        </p>
        <ol className="list-decimal space-y-2 pl-6">
          <li>
            Go to{' '}
            <Link
              href="/account/orders"
              className="underline underline-offset-4 hover:text-[#5C6B4B]"
            >
              your orders
            </Link>{' '}
            and open the order.
          </li>
          <li>
            Under the item, choose &ldquo;Return or exchange&rdquo;, pick Refund
            or Exchange, and select your reason.
          </li>
          <li>
            For an exchange, choose the size you want. Damage or wrong-item
            claims ask for a photo of the parcel. We can&rsquo;t verify those
            without one.
          </li>
          <li>Submit, and we&rsquo;ll confirm by email within 24 hours.</li>
        </ol>
        <p>
          Once we approve, we arrange the reverse pickup from your address and
          email you the details.
        </p>
        <p>
          We only ask you to pick from these reasons, because each one tells us
          whether the return costs us money:
        </p>
        <div className="flex flex-wrap gap-2">
          {RETURN_REASONS.map(reason => (
            <span
              key={reason}
              className="rounded-full border border-[#2B2620]/15 bg-white px-3 py-1 text-sm text-[#2B2620]/80"
            >
              {reason}
            </span>
          ))}
        </div>
        <p>
          Can&rsquo;t find your order, or the order was placed as a guest? Email
          us the order number and we will attach it to your account. Full
          details on the{' '}
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
