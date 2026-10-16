import { isAdminRequest } from '@/utils/admin-auth';
import {
  ensureCategoryRows,
  listCategoriesForAdmin,
} from '@/utils/admin-categories';
import { NextResponse } from 'next/server';

/**
 * GET /api/admin/categories — every category with its parent link and current
 * size-chart state, for the size-chart manager.
 *
 * Missing taxonomy rows are created on the way in (ensureCategoryRows), so a
 * fresh database — or a category added to the taxonomy later — always shows up
 * here and can be given a chart.
 */
export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await ensureCategoryRows();
    const categories = await listCategoriesForAdmin();
    return NextResponse.json({ categories });
  } catch (error) {
    console.error('admin categories list failed:', error);
    return NextResponse.json(
      { error: 'Failed to load categories' },
      { status: 500 }
    );
  }
}

