import { getPublicUrl, rawQuery, sql } from '@/utils';
import { normalizeCareInstructions } from '@/utils/product-format';
import { NextResponse } from 'next/server';

type Images = {
  public_id: string;
  alt_text: string;
  sort_order: number;
};

export async function GET() {
  try {
    const products = (await rawQuery(sql` SELECT
            p.id,
            p.name,
            p.slug,
            p.short_description,
            p.details,
            p.story,
            p.material,
            p.fit,
            p.care_instructions,
            p.is_featured,

            (
              SELECT MIN(v.price)
              FROM product_variants v
              WHERE v.product_id = p.id
                AND v.is_active = true
            ) AS price,

            (
              SELECT MIN(v.compare_at_price)
              FROM product_variants v
              WHERE v.product_id = p.id
                AND v.is_active = true
            ) AS compare_at_price,

            (
              SELECT MIN(v.currency)
              FROM product_variants v
              WHERE v.product_id = p.id
                AND v.is_active = true
            ) AS currency,

            (
              SELECT COALESCE(SUM(v.stock_quantity), 0)
              FROM product_variants v
              WHERE v.product_id = p.id
                AND v.is_active = true
            ) AS total_stock,

            (
              SELECT JSON_AGG(
                JSON_BUILD_OBJECT('name', c.name, 'hex', c.hex)
                ORDER BY c.name
              )
              FROM (
                SELECT DISTINCT ON (v.color) v.color AS name, v.color_hex AS hex
                FROM product_variants v
                WHERE v.product_id = p.id AND v.is_active = true
              ) c
            ) AS colors,

            (
              SELECT JSON_AGG(
                JSON_BUILD_OBJECT('size', s.size, 'stock', s.stock, 'price', s.price, 'compare_at_price', s.compare_at_price)
                ORDER BY s.size
              )
              FROM (
                SELECT v.size, SUM(v.stock_quantity) AS stock, MIN(v.price) AS price, (array_agg(v.compare_at_price ORDER BY v.price ASC))[1] AS compare_at_price
                FROM product_variants v
                WHERE v.product_id = p.id AND v.is_active = true
                GROUP BY v.size
              ) s
            ) AS sizes,

            COALESCE(
              (
                SELECT JSON_AGG(
                  JSON_BUILD_OBJECT(
                    'public_id', pi.public_id,
                    'alt_text', pi.alt_text,
                    'sort_order', pi.sort_order
                  )
                  ORDER BY pi.sort_order
                )
                FROM product_images pi
                WHERE pi.product_id = p.id
              ),
              '[]'
            ) AS images

          FROM products p

          WHERE p.status = 'ACTIVE'

          ORDER BY p.created_at DESC

          LIMIT 8`)) as Array<{
      id: string;
      name: string;
      slug: string;
      short_description: string | null;
      details: string[] | null;
      story: string | null;
      material: string | null;
      fit: string | null;
      care_instructions: string | string[] | null;
      is_featured: boolean;
      price: string | null;
      compare_at_price: string | null;
      currency: string | null;
      total_stock: number | null;
      colors: Array<{ name: string; hex: string | null }> | null;
      sizes: Array<{
        size: string;
        stock: number;
        price: string;
        compare_at_price: string | null;
      }> | null;
      images: Array<Images> | null;
    }>;

    const productsWithUrls = products?.map(product => ({
      ...product,
      details: product.details ?? [],
      careInstructions: normalizeCareInstructions(product.care_instructions),
      colors: product.colors ?? [],
      sizes: (product.sizes ?? []).map(
        (s: {
          size: string;
          stock: number;
          price?: string;
          compare_at_price?: string | null;
        }) => ({
          size: s.size,
          stock: Number(s.stock ?? 0),
          price: String(s.price ?? product.price),
          compareAtPrice: (s.compare_at_price ?? null) as string | null,
        })
      ),
      total_stock: Number(product.total_stock ?? 0),
      images: (product.images ?? []).map(image => ({
        ...image,
        url: getPublicUrl(image.public_id),
      })),
    }));

    return NextResponse.json({ products: productsWithUrls }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch products' },
      { status: 500 }
    );
  }
}
