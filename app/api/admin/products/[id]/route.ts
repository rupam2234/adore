import { isAdminRequest } from '@/utils/admin-auth';
import { validateProductPayload } from '@/utils/admin-schema';
import {
  archiveProduct,
  getAdminProduct,
  setStatus,
  updateProduct,
} from '@/utils/admin-products';
import { NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/admin/products/[id] — full product for the edit form. */
export async function GET(request: Request, ctx: RouteContext) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    const product = await getAdminProduct(id);
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    return NextResponse.json({ product }, { status: 200 });
  } catch (error) {
    console.error('admin read failed:', error);
    return NextResponse.json(
      { error: 'Failed to load product' },
      { status: 500 }
    );
  }
}

/** PATCH /api/admin/products/[id] — update fields/variants/categories/status. */
export async function PATCH(request: Request, ctx: RouteContext) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Full-payload checkpoint: the form always sends the complete product, so
  // validation here covers fields, variants and the requested status.
  const parsed = validateProductPayload(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: 'Validation failed', fields: parsed.errors },
      { status: 422 }
    );
  }

  try {
    const result = await updateProduct(id, parsed.value);
    if (!result.ok) {
      // e.g. activation checkpoint failed → product stays in its old status
      return NextResponse.json({ error: result.error }, { status: 422 });
    }
    const product = await getAdminProduct(id);
    return NextResponse.json({ product }, { status: 200 });
  } catch (error) {
    console.error('admin update failed:', error);
    return NextResponse.json(
      { error: 'Failed to update product' },
      { status: 500 }
    );
  }
}

/** PATCH-free status shortcut: DELETE archives (soft delete). */
export async function DELETE(request: Request, ctx: RouteContext) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    const archived = await archiveProduct(id);
    if (!archived) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error('admin archive failed:', error);
    return NextResponse.json(
      { error: 'Failed to archive product' },
      { status: 500 }
    );
  }
}

/** POST /api/admin/products/[id] with {action:"status", status} — quick transitions. */
export async function POST(request: Request, ctx: RouteContext) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  let body: { action?: string; status?: string };
  try {
    body = (await request.json()) as { action?: string; status?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (body.action !== 'status' || !body.status) {
    return NextResponse.json(
      {
        error: 'Expected {action:"status", status:"DRAFT"|"ACTIVE"|"ARCHIVED"}',
      },
      { status: 400 }
    );
  }
  if (!['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(body.status)) {
    return NextResponse.json({ error: 'Unknown status' }, { status: 422 });
  }

  try {
    const result = await setStatus(
      id,
      body.status as 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }
    const product = await getAdminProduct(id);
    return NextResponse.json({ product }, { status: 200 });
  } catch (error) {
    console.error('admin status change failed:', error);
    return NextResponse.json(
      { error: 'Failed to set status' },
      { status: 500 }
    );
  }
}
