"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export type AdminImage = {
  id: string;
  publicId: string;
  /** Delivery URL built from public_id (same as the storefront) — always fresh. */
  url: string;
  /** Legacy stored URL, only used as an onError fallback. */
  secureUrl: string;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
};

/**
 * Image manager for the admin edit page.
 * Flow: product must exist first (created as DRAFT by the form) → images
 * upload against its id. Each file uploads separately with per-file retry
 * so one bad file never blocks the batch.
 */
export function ImageManager({
  productId,
  images: initialImages,
}: {
  productId: string;
  images: AdminImage[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState(initialImages);
  const [failed, setFailed] = useState<string[]>([]); // file names to retry
  const [busy, setBusy] = useState(false);

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    setFailed([]);

    const done: string[] = [];
    const errors: string[] = [];

    for (const file of files) {
      try {
        const body = new FormData();
        body.set("product_id", productId);
        body.set("file", file);
        const res = await fetch("/api/upload", { method: "POST", body });
        if (!res.ok) throw new Error();
        done.push(file.name);
      } catch {
        errors.push(file.name);
      }
    }

    setFailed(errors);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    if (done.length > 0) router.refresh();
  }

  async function handlePick() {
    const files = Array.from(inputRef.current?.files ?? []);
    await uploadFiles(files);
  }

  async function handleDelete(imageId: string) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/products/${productId}/images?image_id=${imageId}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        setImages((imgs) => imgs.filter((i) => i.id !== imageId));
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleMakePrimary(imageId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/products/${productId}/images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_id: imageId }),
      });
      if (res.ok) {
        setImages((imgs) =>
          imgs.map((i) => ({ ...i, isPrimary: i.id === imageId })),
        );
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border border-[#2B2620]/10 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg">Images</h2>
        <label className="cursor-pointer rounded-full border border-[#2B2620] px-4 py-2 text-xs transition-colors hover:bg-[#2B2620] hover:text-[#FAF8F3]">
          + Upload
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handlePick}
            disabled={busy}
          />
        </label>
      </div>

      {failed.length > 0 && (
        <p className="mt-3 border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Failed: {failed.join(", ")} — press Upload again to retry these files.
        </p>
      )}

      {images.length === 0 && failed.length === 0 && (
        <p className="mt-4 text-sm text-[#2B2620]/50">
          No images yet. Products need at least one image before activation.
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {images.map((img) => (
          <div key={img.id} className="group relative overflow-hidden border border-[#2B2620]/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.url}
              alt={img.altText ?? "Product image"}
              loading="lazy"
              className="aspect-3/4 w-full object-cover"
              onError={(event) => {
                // Fallback to the stored URL if the freshly built one 404s.
                const target = event.currentTarget;
                if (target.src !== img.secureUrl) target.src = img.secureUrl;
              }}
            />
            {img.isPrimary && (
              <span className="absolute left-2 top-2 bg-[#FAF8F3]/95 px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-[#2B2620]">
                Primary
              </span>
            )}
            <div className="absolute inset-x-2 bottom-2 flex gap-1.5 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-within:opacity-100">
              {!img.isPrimary && (
                <button
                  type="button"
                  onClick={() => void handleMakePrimary(img.id)}
                  disabled={busy}
                  className="flex-1 cursor-pointer bg-[#FAF8F3]/95 px-2 py-1 text-[10px] uppercase tracking-wide transition-colors hover:bg-[#5C6B4B] hover:text-[#FAF8F3]"
                >
                  Make primary
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleDelete(img.id)}
                disabled={busy}
                className="cursor-pointer bg-[#2B2620]/90 px-2 py-1 text-[10px] uppercase tracking-wide text-[#FAF8F3] transition-colors hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}