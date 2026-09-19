'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

export type AdminImage = {
  id: string;
  publicId: string;
  url: string;
  secureUrl: string;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
};

interface UploadProgress {
  fileName: string;
  progress: number;
  status: 'uploading' | 'done' | 'error';
}

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
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [busy, setBusy] = useState(false);

  function uploadFileWithProgress(file: File): Promise<boolean> {
    return new Promise(resolve => {
      const body = new FormData();
      body.set('product_id', productId);
      body.set('file', file);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');

      xhr.upload.onprogress = e => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setUploads(prev =>
            prev.map(u =>
              u.fileName === file.name ? { ...u, progress: pct } : u
            )
          );
        }
      };

      xhr.onload = () => {
        const ok = xhr.status >= 200 && xhr.status < 300;
        setUploads(prev =>
          prev.map(u =>
            u.fileName === file.name
              ? { ...u, progress: 100, status: ok ? 'done' : 'error' }
              : u
          )
        );
        resolve(ok);
      };

      xhr.onerror = () => {
        setUploads(prev =>
          prev.map(u =>
            u.fileName === file.name ? { ...u, status: 'error' } : u
          )
        );
        resolve(false);
      };

      xhr.send(body);
    });
  }

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    setUploads(
      files.map(f => ({
        fileName: f.name,
        progress: 0,
        status: 'uploading' as const,
      }))
    );

    let anySuccess = false;
    for (const file of files) {
      const ok = await uploadFileWithProgress(file);
      if (ok) anySuccess = true;
    }

    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
    if (anySuccess) router.refresh();

    // Clear progress after a delay
    setTimeout(() => setUploads([]), 3000);
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
        { method: 'DELETE' }
      );
      if (res.ok) {
        setImages(imgs => imgs.filter(i => i.id !== imageId));
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
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_id: imageId }),
      });
      if (res.ok) {
        setImages(imgs =>
          imgs.map(i => ({ ...i, isPrimary: i.id === imageId }))
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
        <h2 className="text-lg font-semibold">Images</h2>
        <label className="cursor-pointer rounded-full border border-[#2B2620] px-4 py-2 text-xs transition-colors hover:bg-[#2B2620] hover:text-[#FAF8F3] disabled:opacity-50">
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

      {uploads.length > 0 && (
        <div className="mt-4 space-y-2">
          {uploads.map(u => (
            <div key={u.fileName} className="flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden bg-[#2B2620]/10">
                <div
                  className={`h-full transition-all duration-300 ${
                    u.status === 'error'
                      ? 'bg-red-500'
                      : u.status === 'done'
                        ? 'bg-green-500'
                        : 'bg-[#5C6B4B]'
                  }`}
                  style={{ width: `${u.progress}%` }}
                />
              </div>
              <span className="w-28 truncate text-xs text-[#2B2620]/60">
                {u.fileName}
              </span>
              <span className="w-16 text-right text-xs">
                {u.status === 'error' ? (
                  <span className="text-red-600">Failed</span>
                ) : u.status === 'done' ? (
                  <span className="text-green-600">Done</span>
                ) : (
                  <span className="text-[#2B2620]/50">{u.progress}%</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {images.length === 0 && uploads.length === 0 && (
        <p className="mt-4 text-sm text-[#2B2620]/50">
          No images yet. Products need at least one image before activation.
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {images.map(img => (
          <div
            key={img.id}
            className="group relative overflow-hidden border border-[#2B2620]/10"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.url}
              alt={img.altText ?? 'Product image'}
              loading="lazy"
              className="aspect-3/4 w-full object-cover"
              onError={event => {
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
