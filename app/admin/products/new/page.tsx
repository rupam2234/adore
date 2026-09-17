import { ProductForm } from "@/components/admin/product-form";
import { requireAdminPage } from "@/utils/admin-session";

export const metadata = { title: "New product — Admin", robots: { index: false, follow: false } };

export default async function NewProductPage() {
  await requireAdminPage();

  return (
    <section>
      <h1 className="font-admin font-bold text-2xl">New product</h1>
      <p className="mt-1 text-sm text-[#2B2620]/60">
        Saved as a draft first — upload images, then activate when ready.
      </p>
      <div className="mt-8">
        <ProductForm />
      </div>
    </section>
  );
}