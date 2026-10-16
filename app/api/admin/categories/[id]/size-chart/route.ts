import { isAdminRequest } from '@/utils/admin-auth';
import { cloudinary, db, categories } from '@/utils';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
]);

/**
 * POST /api/admin/categories/[id]/size-chart — multipart upload (field `file`).
 *
 * One chart per category: uploading REPLACES any previous chart. The asset
 * lands in Cloudinary under `adore/size-charts/<slug>` (same conventions as
 * product images) and the category row is updated in the same request, so the
 * DB row and the cloud asset cannot drift apart for longer than one call.
 *
 * The previous Cloudinary asset is destroyed best-effort AFTER the DB row is
 * updated — an orphaned asset in the cloud is cosmetic, a chart URL pointing
 * at a deleted asset is not.
 */
export async function POST(request: Request, ctx: RouteContext) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  try {
    const rows = await db
      .select({
        id: categories.id,
        slug: categories.slug,
        previousPublicId: categories.sizeChartPublicId,
      })
      .from(categories)
      .where(eq(categories.id, id))
      .limit(1);
    const category = rows[0];
    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
    }
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }
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
        folder: `adore/size-charts/${category.slug}`,
        use_filename: true,
        unique_filename: true,
        overwrite: false,
        // A size chart is a table of text: never resize (legibility beats
        // bytes), just normalise format and quality.
        transformation: [{ quality: 'auto' }, { fetch_format: 'auto' }],
      }
    );

    const updated = await db
      .update(categories)
      .set({
        sizeChartPublicId: result.public_id,
        sizeChartUrl: result.secure_url,
      })
      .where(eq(categories.id, id))
      .returning({
        id: categories.id,
        slug: categories.slug,
        sizeChartUrl: categories.sizeChartUrl,
      });

    if (category.previousPublicId && category.previousPublicId !== result.public_id) {
      try {
        await cloudinary.uploader.destroy(category.previousPublicId);
      } catch (cloudinaryError) {
        console.warn(
          'cloudinary destroy failed (previous size chart, db updated anyway):',
          cloudinaryError
        );
      }
    }

    return NextResponse.json(
      { ok: true, category: updated[0] },
      { status: 200 }
    );
  } catch (error) {
    console.error('size chart upload failed:', error);
    return NextResponse.json(
      { error: 'Failed to upload size chart' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/categories/[id]/size-chart — remove the chart.
 * DB row first (the storefront stops showing it immediately), then best-effort
 * Cloudinary destroy, same ordering as the product-image delete.
 */
export async function DELETE(request: Request, ctx: RouteContext) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  try {
    const rows = await db
      .select({ previousPublicId: categories.sizeChartPublicId })
      .from(categories)
      .where(eq(categories.id, id))
      .limit(1);
    const category = rows[0];
    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    await db
      .update(categories)
      .set({ sizeChartPublicId: null, sizeChartUrl: null })
      .where(eq(categories.id, id));

    if (category.previousPublicId) {
      try {
        await cloudinary.uploader.destroy(category.previousPublicId);
      } catch (cloudinaryError) {
        console.warn(
          'cloudinary destroy failed (size chart, db updated anyway):',
          cloudinaryError
        );
      }
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error('size chart delete failed:', error);
    return NextResponse.json(
      { error: 'Failed to delete size chart' },
      { status: 500 }
    );
  }
}
