"use client";

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type WheelEvent,
} from "react";
import { formatPrice, type ProductCardData } from "@/utils/product-format";

/**
 * Product detail view (product page).
 *
 * - Full width; images in a strict 2-column grid (no hero span).
 * - Clicking an image opens a full page viewer: < previous / next > navigation
 *   with zooming (click zooms at the clicked point, scroll wheel also zooms).
 * - Escape / ← / → keys work; body scroll is locked while the viewer is open.
 * - Info column is sticky on desktop.
 */
export default function ProductDetail({
  product,
}: {
  product: ProductCardData;
}) {
  const images = product.images;
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [openSection, setOpenSection] = useState<"details" | null>(null);
  const [qty, setQty] = useState(1);

  // Full page image viewer state
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [zoomStyle, setZoomStyle] = useState<CSSProperties>({});
  const [wheelZoom, setWheelZoom] = useState(1);
  const isZoomed = Object.keys(zoomStyle).length > 0 || wheelZoom !== 1;

  const openViewer = (i: number) => {
    setViewerIndex(i);
    setZoomStyle({});
    setWheelZoom(1);
  };

  const closeViewer = useCallback(() => setViewerIndex(null), []);

  const stepViewer = useCallback(
    (dir: 1 | -1) => {
      if (viewerIndex === null) return;
      setViewerIndex((viewerIndex + dir + images.length) % images.length);
      setZoomStyle({});
      setWheelZoom(1);
    },
    [viewerIndex, images.length],
  );

  // Click-to-zoom: zooms at the clicked point (1x → 2.5x → 5x → reset)
  const handleViewerClick = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setZoomStyle((prev) => {
      const scale = Number(
        prev.transform?.match(/scale\((\d+(?:\.\d+)?)\)/)?.[1] ?? 1,
      );
      const next = scale === 1 ? 2.5 : scale === 2.5 ? 5 : 1;
      return next === 1
        ? {}
        : { transformOrigin: `${x}% ${y}%`, transform: `scale(${next})` };
    });
    setWheelZoom(1);
  };

  // Scroll wheel zoom inside the viewer
  const handleViewerWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (!e.deltaY) return;
    setWheelZoom((prev) => {
      const next = Math.min(Math.max(prev - Math.sign(e.deltaY) * 0.5, 1), 5);
      return next;
    });
    setZoomStyle({});
  };

  // Keyboard: Escape closes, arrows navigate
  const handleViewerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") closeViewer();
    if (e.key === "ArrowRight") stepViewer(1);
    if (e.key === "ArrowLeft") stepViewer(-1);
  };

  // Lock body scroll while the viewer is open
  useEffect(() => {
    if (viewerIndex === null) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [viewerIndex]);

  return (
    <div className="grid w-full grid-cols-1 gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-12">
      {/* Gallery — strict 2-column image grid, click to open the viewer */}
      <div className="grid w-full grid-cols-2 gap-2">
        {images.length > 0 ? (
          images.map((img, i) => (
            <div
              key={img.id}
              className="aspect-3/4 w-full overflow-hidden bg-[#E7DFCB]"
            >
              <img
                src={img.url}
                alt={img.alt ?? product.name}
                onClick={() => openViewer(i)}
                className="h-full w-full cursor-pointer object-cover"
              />
            </div>
          ))
        ) : (
          <div className="col-span-2 aspect-3/4 w-full bg-[#E7DFCB]" />
        )}
      </div>

      {/* Full page image viewer: < prev / next > + zoom */}
      {viewerIndex !== null && images[viewerIndex] && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Image ${viewerIndex + 1} of ${images.length}`}
          tabIndex={-1}
          onKeyDown={handleViewerKeyDown}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#FAF8F3]"
        >
          <div
            className="relative flex h-[85vh] w-full items-center justify-center overflow-hidden"
            onClick={handleViewerClick}
            onWheel={handleViewerWheel}
          >
            <img
              key={images[viewerIndex].id}
              src={images[viewerIndex].url}
              alt={images[viewerIndex].alt ?? product.name}
              style={{
                ...zoomStyle,
                transform:
                  `${zoomStyle.transform ?? ""} scale(${wheelZoom})`.trim(),
              }}
              className={`max-h-full w-auto object-contain transition-transform duration-200 ease-out ${
                isZoomed ? "cursor-zoom-out" : "cursor-zoom-in"
              }`}
            />
          </div>

          {/* Previous / next */}
          {images.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => stepViewer(-1)}
                aria-label="Previous image"
                className="absolute left-4 top-1/2 -translate-y-1/2 cursor-pointer rounded-full border border-[#2B2620]/20 bg-[#FAF8F3] px-3 py-2 text-lg text-[#2B2620] transition-colors hover:bg-[#2B2620] hover:text-[#FAF8F3]"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => stepViewer(1)}
                aria-label="Next image"
                className="absolute right-4 top-1/2 -translate-y-1/2 cursor-pointer rounded-full border border-[#2B2620]/20 bg-[#FAF8F3] px-3 py-2 text-lg text-[#2B2620] transition-colors hover:bg-[#2B2620] hover:text-[#FAF8F3]"
              >
                ›
              </button>
            </>
          )}

          {/* Top bar: position + close */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 py-3">
            <p className="text-xs text-[#2B2620]/50">
              {viewerIndex + 1} / {images.length}
              {isZoomed && " · zoomed"}
            </p>
            <button
              type="button"
              onClick={closeViewer}
              aria-label="Close viewer"
              className="cursor-pointer rounded-full border border-[#2B2620]/20 bg-[#FAF8F3] px-3 py-1.5 text-sm text-[#2B2620] transition-colors hover:bg-[#2B2620] hover:text-[#FAF8F3]"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Info — sticky on desktop */}
      <div className="flex flex-col gap-4 lg:sticky lg:top-15 lg:self-start">
        <div>
          <h1 className="font-serif text-3xl">{product.name}</h1>
          {product.shortDescription && (
            <p className="mt-2 text-sm text-[#2B2620]/60">
              {product.shortDescription}
            </p>
          )}
        </div>

        <p className="text-sm text-[#2B2620]/60">
          {product.compareAtPrice &&
          Number(product.compareAtPrice) > Number(product.price) ? (
            <>
              <span className="mr-2 text-[#2B2620]/40 line-through">
                {formatPrice(product.compareAtPrice, product.currency)}
              </span>
              <span className="text-[#A45A4B]">
                {formatPrice(product.price, product.currency)}
              </span>
            </>
          ) : (
            formatPrice(product.price, product.currency)
          )}
        </p>

        {product.colors.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] uppercase tracking-wide text-[#2B2620]/50">
              Colour
            </p>
            <div className="flex flex-wrap gap-2">
              {product.colors.map((color) => (
                <button
                  key={color.name}
                  type="button"
                  onClick={() => setSelectedColor(color.name)}
                  title={color.name}
                  aria-label={`Colour: ${color.name}`}
                  className={`cursor-pointer rounded-full border-2 p-0.5 transition-colors ${
                    selectedColor === color.name
                      ? "border-[#2B2620]"
                      : "border-transparent hover:border-[#2B2620]/40"
                  }`}
                >
                  <span
                    className="block h-6 w-6 rounded-full border border-[#2B2620]/10"
                    style={{ backgroundColor: color.hex ?? "#E7DFCB" }}
                  />
                </button>
              ))}
            </div>
            {selectedColor && (
              <p className="mt-1.5 text-xs text-[#2B2620]/60">
                {selectedColor}
              </p>
            )}
          </div>
        )}

        {product.details.length > 0 && (
          <div className="border-b border-[#2B2620]/10 pb-4">
            <button
              type="button"
              onClick={() =>
                setOpenSection((s) => (s === "details" ? null : "details"))
              }
              aria-expanded={openSection === "details"}
              className="flex w-full cursor-pointer items-center justify-between text-left text-[11px] uppercase tracking-wide text-[#2B2620]/50 transition-colors hover:text-[#2B2620]"
            >
              Details
              <span
                aria-hidden="true"
                className={`text-base leading-none transition-transform duration-300 ${
                  openSection === "details" ? "rotate-45" : ""
                }`}
              >
                +
              </span>
            </button>
            <div
              className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                openSection === "details"
                  ? "grid-rows-[1fr]"
                  : "grid-rows-[0fr]"
              }`}
            >
              <ul className="list-disc space-y-1 overflow-hidden pl-4 pt-3 text-sm">
                {product.details.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {product.material && (
          <div className="border-b border-[#2B2620]/10 pb-4">
            <p className="text-[11px] uppercase tracking-wide text-[#2B2620]/50">
              Material:
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-[#2B2620]/70">
              {product.material}
            </p>
          </div>
        )}

        {product.careInstructions && (
          <div className="border-b border-[#2B2620]/10 pb-4">
            <p className="text-[11px] uppercase tracking-wide text-[#2B2620]/50">
              Cloth care:
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-[#2B2620]/70">
              {product.careInstructions}
            </p>
          </div>
        )}

        <div>
          <p className="mb-2 text-[11px] uppercase tracking-wide text-[#2B2620]/50">
            Size
          </p>
          <div className="flex flex-wrap gap-1.5">
            {product.sizes.length > 0 ? (
              product.sizes.map((s) => (
                <button
                  key={s.size}
                  type="button"
                  onClick={() => setSelectedSize(s.size)}
                  disabled={s.stock <= 0}
                  className={`cursor-pointer border px-4 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    selectedSize === s.size
                      ? "border-[#2B2620] bg-[#2B2620] text-[#FAF8F3]"
                      : "border-[#2B2620]/20 hover:border-[#2B2620]"
                  }`}
                >
                  {s.size}
                  {s.stock > 0 && s.stock <= 3 && (
                    <span className="ml-1 text-[10px] opacity-60">
                      {s.stock} left
                    </span>
                  )}
                </button>
              ))
            ) : (
              <span className="text-sm text-[#2B2620]/50">Sold out</span>
            )}
          </div>
        </div>

        {/* Quantity + add to basket */}
        <div className="mt-2 flex items-stretch gap-2">
          <div className="flex items-center border border-[#2B2620]/20">
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(q - 1, 1))}
              aria-label="Decrease quantity"
              disabled={qty <= 1}
              className="cursor-pointer px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
            >
              −
            </button>
            <span className="min-w-8 text-center text-sm">{qty}</span>
            <button
              type="button"
              onClick={() => setQty((q) => Math.min(q + 1, 9))}
              aria-label="Increase quantity"
              className="cursor-pointer px-3 py-2 text-sm"
            >
              +
            </button>
          </div>
          <button
            type="button"
            className="flex-1 cursor-pointer rounded-full bg-[#2B2620] px-6 py-3 text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B] disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!selectedSize || product.totalStock <= 0}
          >
            {product.totalStock <= 0
              ? "Sold out"
              : selectedSize
                ? `Add to basket — ${selectedSize}`
                : "Select a size"}
          </button>
        </div>
      </div>
    </div>
  );
}
