import PageShell from "@/components/theme/page-shell";

export const metadata = {
  title: "Privacy Policy",
  description: "How Adore collects, uses, and protects your personal data.",
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

export default function PrivacyPolicyPage() {
  return (
    <PageShell
      eyebrow="Legal"
      title="Privacy Policy"
      intro="Last updated: September 2026. This policy explains what information Adore collects, why we collect it, and the choices you have."
    >
      <Section title="1. Information we collect">
        <p>
          When you browse, create an account, or place an order with Adore, we
          collect the information needed to fulfil your order and improve the
          store:
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Order information</strong> — name, shipping and billing
            address, email, phone number, and order history.
          </li>
          <li>
            <strong>Payment information</strong> — handled by our payment
            processors. We never store full card numbers, CVV codes, or payment
            credentials on our servers.
          </li>
          <li>
            <strong>Account information</strong> — email address and password
            (stored only as a secure hash) if you create an account.
          </li>
          <li>
            <strong>Usage data</strong> — pages viewed, cart activity, and
            device/browser information, used to improve the shopping
            experience.
          </li>
        </ul>
      </Section>

      <Section title="2. How we use your information">
        <ul className="list-disc space-y-2 pl-6">
          <li>Processing and delivering your orders, including returns.</li>
          <li>
            Providing customer support and responding to your enquiries.
          </li>
          <li>
            Detecting, preventing, and investigating fraud, abuse, and
            violations of our Terms &amp; Conditions.
          </li>
          <li>
            Sending transactional emails (order confirmations, shipping
            updates). Marketing emails are only sent with your consent and you
            can unsubscribe at any time.
          </li>
          <li>Complying with legal, tax, and regulatory obligations.</li>
        </ul>
      </Section>

      <Section title="3. Fraud prevention">
        <p>
          To protect you and our business from fraudulent orders, we may verify
          shipping and billing details, flag mismatched delivery information,
          limit or cancel orders that show risk indicators, and keep records of
          suspicious activity. Where an order is cancelled as a precaution, any
          payment authorisation is released and you will be notified by email.
          We may share limited data with payment processors, logistics
          partners, and law enforcement where required to investigate fraud or
          comply with the law.
        </p>
      </Section>

      <Section title="4. Sharing your information">
        <p>
          We only share data with service providers who need it to run the
          store — payment processors, delivery carriers, and email delivery
          services — under agreements that require them to protect your data.
          We never sell your personal information.
        </p>
      </Section>

      <Section title="5. Data retention & security">
        <p>
          Order records are kept for as long as required for accounting, tax,
          and fraud-prevention purposes. We apply industry-standard measures
          (encryption in transit, access controls, hashed credentials) to
          protect your data. No method of transmission is 100% secure, but we
          review and update our practices regularly.
        </p>
      </Section>

      <Section title="6. Cookies">
        <p>
          We use essential cookies to keep your cart, session, and login
          working, and lightweight analytics to understand how the site is
          used. You can control cookies in your browser settings; disabling
          essential cookies may break checkout.
        </p>
      </Section>

      <Section title="7. Your rights">
        <p>
          You may request access to, correction of, or deletion of your
          personal data, and object to marketing communications, by writing to
          us. We will respond within a reasonable time frame and verify your
          identity before disclosing or deleting data.
        </p>
      </Section>

      <Section title="8. Contact">
        <p>
          Questions about this policy? Reach us via the{" "}
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
