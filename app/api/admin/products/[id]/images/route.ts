import { isAdminRequest } from '@/utils/admin-auth';
import { deleteProductImage, setPrimaryImage } from '@/utils/admin-products';
import { cloudinary } from '@/utils';
import { NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * DELETE /api/admin/products/[id]/images?image_id=… — delete one image.
 * DB row first, then best-effort Cloudinary destroy (orphan cleanup in
 * Cloudinary failing must not fail the request — the DB is the source of
 * truth for the storefront).
 */
export async function DELETE(request: Request, ctx: RouteContext) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const imageId = new URL(request.url).searchParams.get('image_id');
  if (!imageId) {
    return NextResponse.json(
      { error: 'image_id is required' },
      { status: 400 }
    );
  }

  try {
    const result = await deleteProductImage(id, imageId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    try {
      await cloudinary.uploader.destroy(result.publicId);
    } catch (cloudinaryError) {
      console.warn(
        'cloudinary destroy failed (db row removed anyway):',
        cloudinaryError
      );
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error('image delete failed:', error);
    return NextResponse.json(
      { error: 'Failed to delete image' },
      { status: 500 }
    );
  }
}

/** PATCH /api/admin/products/[id]/images — {image_id} → make it primary. */
export async function PATCH(request: Request, ctx: RouteContext) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  let body: { image_id?: string };
  try {
    body = (await request.json()) as { image_id?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.image_id) {
    return NextResponse.json(
      { error: 'image_id is required' },
      { status: 400 }
    );
  }

  try {
    const updated = await setPrimaryImage(id, body.image_id);
    if (!updated) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error('image primary update failed:', error);
    return NextResponse.json(
      { error: 'Failed to update image' },
      { status: 500 }
    );
  }
}
