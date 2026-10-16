import { SizeChartManager } from '@/components/admin/size-chart-manager';
import { requireAdminPage } from '@/utils/admin-session';

export const metadata = {
  title: 'Size charts | Admin',
  robots: { index: false, follow: false },
};

/**
 * Per-category size-chart management.
 *
 * One chart image per category, uploaded to Cloudinary from here and attached
 * to the category row. The product page resolves a shopper's chart from the
 * product's most specific category, falling back to the parent — so uploading
 * one chart on a parent category covers all of its sub-categories.
 */
export default async function SizeChartsPage() {
  await requireAdminPage();

  return (
    <section>
      <h1 className="font-admin font-bold text-2xl">Size charts</h1>
      <p className="mt-1 max-w-2xl text-sm text-[#2B2620]/60">
        One chart image per category, stored in Cloudinary like product photos.
        Shoppers see the chart of the product&rsquo;s most specific category,
        falling back to the parent category&rsquo;s chart.
      </p>
      <div className="mt-8">
        <SizeChartManager />
      </div>
    </section>
  );
}

