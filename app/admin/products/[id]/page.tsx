import { notFound } from "next/navigation";
import { getAdminProduct } from "@/utils/admin-products";
import { ProductForm } from "@/components/admin/product-form";
import { ImageManager } from "@/components/admin/image-manager";
import { requireAdminPage } from "@/utils/admin-session";

export const metadata = {
  title: "Edit product — Admin",
  robots: { index: false, follow: false },
};

type PageProps = { params: Promise<{ id: string }> };

export default async function EditProductPage({ params }: PageProps) {
  await requireAdminPage();

  const { id } = await params;
  const product = await getAdminProduct(id);
  if (!product) notFound();

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <h1 className="font-admin font-bold text-2xl">{product.name}</h1>
        <span className="rounded-full bg-[#2B2620]/10 px-3 py-1 text-xs">
          {product.status}
        </span>
      </div>
      <p className="mt-1 text-sm text-[#2B2620]/60">/products/{product.slug}</p>

      <div className="mt-8">
        <ProductForm
          product={{
            id: product.id,
            status: product.status,
            name: product.name,
            slug: product.slug,
            shortDescription: product.shortDescription ?? "",
            story: product.story ?? "",
            material: product.material ?? "",
            fit: product.fit ?? "",
            careInstructions: product.careInstructions ?? "",
            details: product.details.join("\n"),
            isFeatured: product.isFeatured,
            categorySlugs: product.categorySlugs,
            variants: product.variants
              .filter((v) => v.isActive)
              .map((v) => ({
                color: v.color,
                colorHex: v.colorHex ?? "#E7DFCB",
                size: v.size,
                price: v.price,
                compareAtPrice: v.compareAtPrice ?? "",
                stock: String(v.stock),
              })),
          }}
        />
      </div>
      <div className="mt-8">
        <ImageManager productId={product.id} images={product.images} />
      </div>
    </section>
  );
}
