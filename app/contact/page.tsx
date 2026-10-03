import PageShell from '@/components/theme/page-shell';
import ContactForm from './contact-form';

export const metadata = {
  title: 'Contact Us',
  description: "Get in touch with the Adore team. We'd love to hear from you.",
};

const CONTACT_CHANNELS = [
  {
    title: 'Email us',
    detail: 'hello@adore.example',
    note: 'We reply within 1–2 business days.',
  },
  {
    title: 'Order support',
    detail: 'Include your order number so we can help faster.',
    note: 'Shipping questions, returns, exchanges, and defects.',
  },
  {
    title: 'Press & partnerships',
    detail: 'For collaborations and press enquiries, use the same form.',
    note: "Mark your subject as 'Press' or 'Partnership'.",
  },
];

export default function ContactPage() {
  return (
    <PageShell
      eyebrow="Help"
      title="Contact us"
      intro="Questions about an order, a fabric, or a fit? Send us a note and the team will get back to you."
    >
      <div className="grid grid-cols-1 gap-12 sm:grid-cols-5">
        <div className="space-y-8 sm:col-span-2">
          {CONTACT_CHANNELS.map(({ title, detail, note }) => (
            <div key={title} className="border-b border-[#2B2620]/10 pb-6">
              <h2 className="font-serif text-xl">{title}</h2>
              <p className="mt-2 text-[15px] text-[#2B2620]/80">{detail}</p>
              <p className="mt-1 text-sm italic text-[#2B2620]/60">{note}</p>
            </div>
          ))}
        </div>

        <div className="sm:col-span-3">
          <ContactForm />
        </div>
      </div>
    </PageShell>
  );
}
