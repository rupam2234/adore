import { cloudinary, pool } from "@/utils";
import { isAdminRequest } from "@/utils/admin-auth";
import { NextResponse } from "next/server";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

export async function POST(request: Request) {
    if (!isAdminRequest(request)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
        const formData = await request.formData();

        const productId = formData.get("product_id");
        if (typeof productId !== "string" || productId.length === 0) {
            return NextResponse.json({ error: "product_id is required" }, { status: 400 });
        }

        const products = await pool`SELECT id, slug FROM products WHERE id = ${productId}`;
        if (products.length === 0) {
            return NextResponse.json({ error: "Product not found" }, { status: 404 });
        }
        const slug = products[0].slug as string;

        const files = formData.getAll("file").filter((f): f is File => f instanceof File);
        if (files.length === 0) {
            return NextResponse.json({ error: "file is required" }, { status: 400 });
        }

        const makePrimary = formData.get("is_primary") === "true";

        const existing = await pool`
            SELECT COALESCE(MAX(sort_order), 0) AS max_sort, COUNT(*) AS count
            FROM product_images WHERE product_id = ${productId}
        `;
        let nextSort = Number(existing[0].max_sort) + 1;
        const hasImages = Number(existing[0].count) > 0;

        if (makePrimary && hasImages) {
            await pool`UPDATE product_images SET is_primary = false WHERE product_id = ${productId}`;
        }

        const inserted = [];
        for (const [index, file] of files.entries()) {
            if (!ALLOWED_TYPES.has(file.type)) {
                return NextResponse.json({ error: `Unsupported file type: ${file.type || file.name}` }, { status: 415 });
            }
            if (file.size > MAX_FILE_BYTES) {
                return NextResponse.json({ error: `${file.name} is larger than 10 MB` }, { status: 413 });
            }
            const buffer = Buffer.from(await file.arrayBuffer());
            const result = await cloudinary.uploader.upload(
                `data:${file.type};base64,${buffer.toString("base64")}`,
                { folder: `adore/products/${slug}`, use_filename: true, unique_filename: true, overwrite: false }
            );

            const altText =
                (formData.get("alt_text") as string) ||
                file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
            const isPrimary = !hasImages && index === 0;

            const rows = await pool`
                INSERT INTO product_images
                    (product_id, public_id, secure_url, alt_text, width, height, sort_order, is_primary)
                VALUES
                    (${productId}, ${result.public_id}, ${result.secure_url}, ${altText},
                     ${result.width}, ${result.height}, ${nextSort}, ${isPrimary})
                RETURNING id, public_id, secure_url, alt_text, width, height, sort_order, is_primary
            `;
            inserted.push(rows[0]);
            nextSort++;
        }

        return NextResponse.json({ images: inserted }, { status: 201 });
    } catch (error) {
        console.error("upload failed:", error);
        return NextResponse.json({ error: "Failed to upload image" }, { status: 500 });
    }
}