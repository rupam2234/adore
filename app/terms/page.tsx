import PageShell from "@/components/theme/page-shell";

export const metadata = {
  title: "Terms & Conditions",
  description:
    "Terms of service for shopping with Adore — orders, returns, and fraud prevention.",
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

export default function TermsPage() {
  return (
    <PageShell
      eyebrow="Legal"
      title="Terms & Conditions"
      intro="Last updated: September 2026. By browsing or purchasing from Adore, you agree to these terms. Please read them carefully."
    >
      <Section title="1. About these terms">
        <p>
          These Terms &amp; Conditions govern your use of the Adore website and
          any purchase you make through it. Adore sells dresses and kurtis to
          consumers; purchases for commercial resale are not permitted without
          our prior written agreement.
        </p>
      </Section>

      <Section title="2. Orders & pricing">
        <ul className="list-disc space-y-2 pl-6">
          <li>
            All prices are shown in the currency displayed at checkout and may
            change without notice, except for orders already confirmed.
          </li>
          <li>
            An order is a request to buy. It becomes binding once we confirm
            it. We may refuse or cancel an order if the product is out of
            stock, if pricing information is wrong, or if we reasonably suspect
            the order is fraudulent (see section 6).
          </li>
          <li>
            If we cancel a paid order, the payment authorisation is released or
            a full refund is issued to the original payment method.
          </li>
        </ul>
      </Section>

      <Section title="3. Returns & exchanges">
        <p>
          We want you to love what you ordered — but returns must be fair to
          both of us. The following rules apply:
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Window.</strong> Items may be returned or exchanged within
            7 days of delivery, unless marked as a final-sale item on the
            product page.
          </li>
          <li>
            <strong>Condition.</strong> Items must be unworn, unwashed,
            unaltered, and free of perfume, makeup, or deodorant marks, with
            all original tags and packaging intact. For hygiene reasons, items
            without hygiene strips or seals intact cannot be returned.
          </li>
          <li>
            <strong>Proof.</strong> A return request must include your order
            number and photographs of the item as received, taken before it is
            worn.
          </li>
          <li>
            <strong>Defects.</strong> Genuine manufacturing defects are
            corrected by repair, replacement, or full refund — including
            shipping costs — at our choice. Minor variations in natural-fabric
            texture, dye, or hand-finished stitching are characteristics of
            small-batch production, not defects.
          </li>
          <li>
            <strong>Refunds.</strong> Once the return passes inspection, we
            refund to the original payment method within 5–7 business days.
            Refunds are only issued to the original payment method — never to a
            different card, account, or in cash.
          </li>
        </ul>
      </Section>

      <Section title="4. Return abuse & misuse">
        <p>
          We monitor returns to keep prices fair for honest customers. The
          following behaviours are considered abuse of our return policy and we
          reserve the right to refuse returns, cancel outstanding orders, close
          accounts, and withhold refunds in these cases:
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Wear-and-return ("wardrobing")</strong> — wearing an item
            (including to an event) and returning it as unused. We may refuse
            items showing signs of wear, washing, or dry-cleaning.
          </li>
          <li>
            <strong>Item swapping</strong> — returning a different, used, or
            counterfeit item in place of the one purchased.
          </li>
          <li>
            <strong>Serial returning</strong> — repeatedly ordering with the
            intention of returning most or all items.
          </li>
          <li>
            <strong>Empty-box or short-ship claims</strong> — claiming items
            were never received or arrived damaged without supporting evidence,
            when tracking indicates delivery.
          </li>
          <li>
            <strong>Refund manipulation</strong> — requesting refunds while
            initiating chargebacks, or double-claiming the same loss.
          </li>
        </ul>
        <p>
          Where a return fails inspection, we will contact you and offer to
          return the item to you at your cost. Items unclaimed for 30 days may
          be disposed of, and no refund will be issued for failed returns.
        </p>
      </Section>

      <Section title="5. Accounts">
        <p>
          You are responsible for the accuracy of the information you provide
          and for keeping your account credentials secure. You must be at least
          18 years old (or the age of majority in your region) to place an
          order. We may suspend or close accounts that violate these terms or
          that we reasonably believe are used for fraudulent activity.
        </p>
      </Section>

      <Section title="6. Fraud prevention">
        <p>
          Every order may be screened for fraud risk. To protect our customers
          and business we may:
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            Verify billing and delivery details with your payment provider.
          </li>
          <li>
            Cancel and refund any order we reasonably believe to be fraudulent,
            unauthorised, or resold in breach of these terms.
          </li>
          <li>
            Require photo identification or additional verification before
            shipping or refunding high-value orders.
          </li>
          <li>
            Report suspected fraud, chargeback abuse, and criminal activity to
            payment networks and law-enforcement authorities.
          </li>
        </ul>
        <p>
          Making a false claim (for example, a false "not received" or
          chargeback dispute on a delivered order) is fraud. We keep
          delivery-confirmation records and will contest fraudulent chargebacks
          with that evidence.
        </p>
      </Section>

      <Section title="7. Shipping">
        <p>
          Delivery estimates are provided in good faith but are not guaranteed.
          Risk of loss passes to you on delivery to the address you provided.
          If tracking shows delivery but you have not received your parcel,
          contact us within 48 hours so we can investigate with the carrier.
        </p>
      </Section>

      <Section title="8. Intellectual property">
        <p>
          All content on this site — text, photography, logos, and design — is
          owned by Adore or licensed to us and may not be copied or reused
          commercially without permission.
        </p>
      </Section>

      <Section title="9. Liability">
        <p>
          To the fullest extent permitted by law, Adore's liability for any
          claim relating to an order is limited to the amount you paid for the
          item(s) concerned. We are not liable for indirect or consequential
          losses. Nothing in these terms limits your statutory consumer
          rights.
        </p>
      </Section>

      <Section title="10. Changes & contact">
        <p>
          We may update these terms from time to time; the version on this page
          at the time of your order applies. Questions? Reach us via the{" "}
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
