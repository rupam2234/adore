import PageShell from '@/components/theme/page-shell';

export const metadata = {
  title: 'Sustainability',
  description:
    'At adore, we believe fashion should be beautiful, meaningful, and mindful of the planet. Learn about our commitment to sustainable fabrics, ethical sourcing, and low waste production.',
};

export default function SustainabilityPage() {
  return (
    <PageShell
      eyebrow="Our promise"
      title="Sustainability"
      intro="At adore, we believe that fashion should be beautiful, meaningful, and mindful of the planet."
    >
      <section className="mt-10 first:mt-0">
        <h2 className="font-serif text-2xl">Thoughtful fashion</h2>
        <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-[#2B2620]/80">
          <p>
            We aspire to encourage thoughtful fashion choices by celebrating
            timeless designs, versatile clothing, and pieces that can be
            treasured beyond fleeting trends.
          </p>
          <p>
            We are committed to a better tomorrow with small, thoughtful
            choices like sustainable fabrics, ethical sourcing, and low waste
            production.
          </p>
          <p>
            From valuing the craftsmanship behind every garment to encouraging
            longer wear and mindful shopping, our vision is to inspire a more
            conscious relationship with fashion.
          </p>
        </div>
      </section>

      <section className="mt-14 text-center">
        <p className="font-serif text-xl text-[#2B2620]">
          Wear what you love. Cherish what you wear. ♡
        </p>
      </section>
    </PageShell>
  );
}