import { cloudinary, db, productImages, products } from '@/utils';
import { count, eq, max } from 'drizzle-orm';
import { isAdminRequest } from '@/utils/admin-auth';
import { NextResponse } from 'next/server';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
]);

export async function POST(request: Request) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const formData = await request.formData();

    const productId = formData.get('product_id');
    if (typeof productId !== 'string' || productId.length === 0) {
      return NextResponse.json(
        { error: 'product_id is required' },
        { status: 400 }
      );
    }

    const productRows = await db
      .select({ id: products.id, slug: products.slug })
      .from(products)
      .where(eq(products.id, productId));
    if (productRows.length === 0) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    const slug = productRows[0].slug;

    const files = formData
      .getAll('file')
      .filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }

    const makePrimary = formData.get('is_primary') === 'true';

    const existingRows = await db
      .select({ maxSort: max(productImages.sortOrder), c: count() })
      .from(productImages)
      .where(eq(productImages.productId, productId));
    let nextSort = Number(existingRows[0]?.maxSort ?? 0) + 1;
    const hasImages = Number(existingRows[0]?.c ?? 0) > 0;

    if (makePrimary && hasImages) {
      await db
        .update(productImages)
        .set({ isPrimary: false })
        .where(eq(productImages.productId, productId));
    }

    const inserted = [];
    for (const [index, file] of files.entries()) {
      if (!ALLOWED_TYPES.has(file.type)) {
        return NextResponse.json(
          { error: `Unsupported file type: ${file.type || file.name}` },
          { status: 415 }
        );
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: `${file.name} is larger than 10 MB` },
          { status: 413 }
        );
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await cloudinary.uploader.upload(
        `data:${file.type};base64,${buffer.toString('base64')}`,
        {
          folder: `adore/products/${slug}`,
          use_filename: true,
          unique_filename: true,
          overwrite: false,
        }
      );

      const altText =
        (formData.get('alt_text') as string) ||
        file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
      const isPrimary = !hasImages && index === 0;

      const rows = await db
        .insert(productImages)
        .values({
          productId,
          publicId: result.public_id,
          secureUrl: result.secure_url,
          altText: altText,
          width: result.width,
          height: result.height,
          sortOrder: nextSort,
          isPrimary: isPrimary,
        })
        .returning({
          id: productImages.id,
          public_id: productImages.publicId,
          secure_url: productImages.secureUrl,
          alt_text: productImages.altText,
          width: productImages.width,
          height: productImages.height,
          sort_order: productImages.sortOrder,
          is_primary: productImages.isPrimary,
        });
      inserted.push(rows[0]);
      nextSort++;
    }

    return NextResponse.json({ images: inserted }, { status: 201 });
  } catch (error) {
    console.error('upload failed:', error);
    return NextResponse.json(
      { error: 'Failed to upload image' },
      { status: 500 }
    );
  }
}
