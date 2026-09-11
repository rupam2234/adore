"use client";

import { useState, type CSSProperties, type MouseEvent } from "react";
import { formatPrice, type ProductCardData } from "@/utils/product-format";

/**
 * Product card for shop sections.
 *
 * - Always has `p-2` so the hover border (border-transparent → dark) never
 *   causes layout shift.
 * - On hover, the front image smoothly fades out while the back image fades
 *   in with a subtle zoom — a soft pixel-smooth cross-fade, no rotation.
 * - On hover, a panel slides up at the bottom of the image listing available
 *   sizes and a "+ Quick View" button that opens a quick-view modal.
 */
export default function ProductCard({ product }: { product: ProductCardData }) {
  const [front, back] = product.images;
  const [quickViewOpen, setQuickViewOpen] = useState(false);

  return (
    <>
      <div className="group block border-2 border-transparent p-2 transition-colors duration-300 hover:border-[#2B2620]/40">
        <div className="relative aspect-3/4 w-full overflow-hidden">
          <a
            href={`/products/${product.slug}`}
            aria-label={product.name}
            className="absolute inset-0 block"
          >
            {front ? (
              <>
                <img
                  src={front.url}
                  alt={front.alt ?? product.name}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-500 ease-out group-hover:scale-[1.04] group-hover:opacity-0"
                />
                {back && (
                  <img
                    src={back.url}
                    alt={back.alt ?? product.name}
                    loading="lazy"
                    aria-hidden="true"
                    className="absolute inset-0 h-full w-full scale-[1.04] object-cover opacity-0 transition-[opacity,transform] duration-500 ease-out group-hover:scale-100 group-hover:opacity-100"
                  />
                )}
              </>
            ) : (
              // Fallback when a product has no images yet
              <div className="absolute inset-0 bg-[#E7DFCB]" />
            )}
          </a>

          {/* Bottom overlay: sizes + quick view (revealed on hover/focus, desktop only).
              Sits outside the product link so clicking it opens the modal, not the PDP. */}
          <div className="absolute inset-x-0 bottom-0 flex translate-y-full flex-col gap-2 bg-[#FAF8F3]/95 p-3 opacity-0 backdrop-blur-sm transition-[transform,opacity] duration-300 ease-out group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] uppercase tracking-wide text-[#2B2620]/50">
                Size
              </span>
              {product.sizes.length > 0 ? (
                product.sizes.map((s) => (
                  <span
                    key={s.size}
                    className="border border-[#2B2620]/20 px-1.5 py-0.5 text-[11px]"
                  >
                    {s.size}
                  </span>
                ))
              ) : (
                <span className="text-[11px] text-[#2B2620]/50">Sold out</span>
              )}
              {product.totalStock > 0 && product.totalStock <= 5 && (
                <span className="ml-auto text-[11px] text-[#8A5A2B]">
                  Only {product.totalStock} left
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setQuickViewOpen(true)}
              className="rounded-full cursor-pointer bg-[#2B2620] py-1.5 text-xs text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B]"
            >
              + Quick view
            </button>
          </div>
        </div>
        <p className="mt-2 text-sm">{product.name}</p>
        <p className="text-sm text-[#2B2620]/60">
          {formatPrice(product.price, product.currency)}
        </p>
      </div>

      {quickViewOpen && (
        <QuickViewModal
          product={product}
          onClose={() => setQuickViewOpen(false)}
        />
      )}
    </>
  );
}

function QuickViewModal({
  product,
  onClose,
}: {
  product: ProductCardData;
  onClose: () => void;
}) {
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const images = product.images;
  const [activeIndex, setActiveIndex] = useState(0);
  const [zoomStyle, setZoomStyle] = useState<CSSProperties>({});

  const goPrev = () =>
    setActiveIndex((i) => (i - 1 + images.length) % images.length);
  const goNext = () => setActiveIndex((i) => (i + 1) % images.length);

  const activeImage = images[activeIndex] ?? null;

  const handleZoomMove = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setZoomStyle({ transformOrigin: `${x}% ${y}%`, transform: "scale(2)" });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#2B2620]/60 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Quick view: ${product.name}`}
    >
      <div
        className="grid w-full max-w-2xl grid-cols-1 gap-6 bg-[#FAF8F3] p-6 sm:grid-cols-2 sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Image slider + hover zoom */}
        <div className="flex flex-col gap-2">
          <div
            className="relative aspect-3/4 w-full cursor-zoom-in overflow-hidden bg-[#E7DFCB]"
            onMouseMove={handleZoomMove}
            onMouseLeave={() => setZoomStyle({})}
          >
            {activeImage ? (
              <img
                src={activeImage.url}
                alt={activeImage.alt ?? product.name}
                style={zoomStyle}
                className="h-full w-full object-cover transition-transform duration-200 ease-out"
              />
            ) : null}

            {images.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={goPrev}
                  aria-label="Previous image"
                  className="absolute left-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-full bg-[#FAF8F3]/80 px-2.5 py-1 text-sm text-[#2B2620] transition-colors hover:bg-[#FAF8F3]"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  aria-label="Next image"
                  className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-full bg-[#FAF8F3]/80 px-2.5 py-1 text-sm text-[#2B2620] transition-colors hover:bg-[#FAF8F3]"
                >
                  ›
                </button>
              </>
            )}
          </div>

          {images.length > 1 && (
            <div className="flex gap-1.5">
              {images.map((img, i) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setActiveIndex(i)}
                  aria-label={`View image ${i + 1}`}
                  className={`h-14 w-11 overflow-hidden border-2 cursor-pointer transition-colors ${
                    i === activeIndex
                      ? "border-[#2B2620]"
                      : "border-transparent opacity-60 hover:opacity-100"
                  }`}
                >
                  <img
                    src={img.url}
                    alt={img.alt ?? ""}
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between">
            <h3 className="font-serif text-2xl">{product.name}</h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close quick view"
              className="cursor-pointer text-xl leading-none text-[#2B2620]/50 transition-colors hover:text-[#2B2620]"
            >
              ×
            </button>
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
          {product.shortDescription && (
            <p className="text-sm">{product.shortDescription}</p>
          )}
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
                      style={{
                        backgroundColor: color.hex ?? "#E7DFCB",
                      }}
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
                onClick={() => setDetailsOpen((open) => !open)}
                aria-expanded={detailsOpen}
                className="flex w-full cursor-pointer items-center justify-between text-left text-[11px] uppercase tracking-wide text-[#2B2620]/50 transition-colors hover:text-[#2B2620]"
              >
                Details
                <span
                  aria-hidden="true"
                  className={`text-base leading-none transition-transform duration-300 ${
                    detailsOpen ? "rotate-45" : ""
                  }`}
                >
                  +
                </span>
              </button>
              <div
                className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                  detailsOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
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
            <p className="text-sm text-[#2B2620]/70">
              Material: {product.material}
            </p>
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
                    className={`cursor-pointer border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
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
                <span className="text-xs text-[#2B2620]/50">Sold out</span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="mt-auto cursor-pointer rounded-full bg-[#2B2620] px-6 py-3 text-sm text-[#FAF8F3] transition-colors hover:bg-[#5C6B4B] disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!selectedSize}
          >
            {selectedSize ? `Add to bag — ${selectedSize}` : "Select a size"}
          </button>
        </div>
      </div>
    </div>
  );
}
