'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  HERO_SLIDES,
  HERO_AUTOPLAY_MS,
  type HeroSlide,
} from '@/utils/hero-slides';

/**
 * Full-width homepage hero with an auto-advancing carousel.
 *
 * - One layout at every breakpoint (the previous mobile hero): edge-to-edge
 *   image, centred copy, bottom gradient scrim for text legibility.
 * - Slides live in `utils/hero-slides.ts`; a single-slide list renders as a
 *   plain hero with no arrows or dots.
 * - Images come from next/image so they are responsive, lazy after the first,
 *   and served with a long-lived immutable cache header.
 * - Accessibility: arrows/dots are real buttons with labels, the region is
 *   arrow-key navigable and marked aria-roledescription="carousel", and
 *   auto-advance is switched off entirely under prefers-reduced-motion.
 */
export default function HeroCarousel({
  slides = HERO_SLIDES,
}: {
  slides?: HeroSlide[];
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const count = slides.length;
  // Guard against out-of-range when the slide list shrinks (e.g. hot reload).
  const active = count > 0 ? Math.min(index, count - 1) : 0;

  const goTo = useCallback(
    (nextIndex: number) => {
      if (count === 0) return;
      setIndex(((nextIndex % count) + count) % count);
    },
    [count]
  );

  const next = useCallback(() => goTo(active + 1), [active, goTo]);
  const prev = useCallback(() => goTo(active - 1), [active, goTo]);

  // Auto-advance. Re-created whenever the active slide changes so the timer
  // restarts after a manual advance, and suspended on hover/focus.
  useEffect(() => {
    if (count < 2 || paused) return;

    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    const id = window.setInterval(() => {
      setIndex(i => (i + 1) % count);
    }, HERO_AUTOPLAY_MS);

    return () => window.clearInterval(id);
  }, [active, count, paused]);

  // Touch swipe — horizontal intent only, so vertical scrolling still works.
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const startX = touchStartX.current;
    const startY = touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    if (startX === null || startY === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) next();
    else prev();
  };

  if (count === 0) return null;

  // Desktop hero fills the viewport minus the sticky header (~82px, so 5.5rem
  // clears it) rather than using a plain vh fraction. A 4:3 source at 1920px
  // wide renders 1440px tall, so this reveals ~69% of the image's height —
  // up from ~64% at the original 85vh, which cut the dress off at the hem.
  //
  // This is the ceiling for these sources: to reveal more without side bars
  // the image would have to shrink below full-bleed width, and the frame is
  // full-bleed by design. Re-exporting the banners at ~2400x1200 (2:1) is what
  // actually buys more of the dress — at that ratio a full-bleed render is
  // 960px tall and the whole frame fits with room to spare.
  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured collections"
      className="relative h-[75vh] min-h-105 w-full overflow-hidden bg-[#E7DFCB] sm:h-[80vh] lg:h-[calc(100dvh-5.5rem)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onKeyDown={e => {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          next();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          prev();
        }
      }}
    >
      {/* Slides — every slide stays mounted so the cross-fade has both layers
          and the browser never has to decode an image mid-transition.
          `duration-700` is a real step on Tailwind's scale (750ms). An earlier
          `duration-900` generated no CSS at all, so the fade snapped instantly
          and read as a flicker. */}
      {slides.map((slide, i) => (
        <div
          key={slide.id}
          role="group"
          aria-roledescription="slide"
          aria-label={`${i + 1} of ${count}`}
          aria-hidden={i !== active}
          className={`absolute inset-0 transition-opacity duration-700 ease-out motion-reduce:transition-none ${
            i === active ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <Image
            src={slide.image}
            alt={slide.alt}
            fill
            // Every hero slide is eager: they all sit in the first viewport and
            // there are only a few, so lazy-loading them caused a visible blank
            // frame on advance. The first stays `priority` for the LCP element.
            priority
            loading="eager"
            sizes="100vw"
            style={{ objectPosition: slide.objectPosition ?? 'center' }}
            className="object-cover"
          />
        </div>
      ))}

      {/* Scrim — directional, following the copy. On mobile the text is centred,
          so the weight sits along the bottom; from `sm` up the copy moves to
          the bottom-left corner, so the gradient rotates to run from that
          corner and clears to fully transparent at the top-right. That keeps
          the subject (centre-frame) and the upper image at full brightness. */}
      <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-[#2B2620]/70 via-[#2B2620]/45 to-[#2B2620]/10 sm:bg-linear-to-tr sm:from-[#2B2620]/85 sm:via-[#2B2620]/40 sm:to-transparent" />

      {/* Copy — centred on mobile (subject is centre-frame and there is no room
          to spare), anchored bottom-left from `sm` up. Weight (600 Playfair)
          carries the hierarchy with no panel, border or fill; text-shadow keeps
          it legible over busy areas without dimming the image behind it.
          The min-height holds the centred mobile block steady between slides. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 py-16 text-center sm:items-start sm:justify-end sm:px-12 sm:pb-14 sm:pt-24 sm:text-left">
        {/* Fixed measure at every breakpoint so the line count — and therefore
            the block height — barely changes as the copy swaps. */}
        <div className="flex w-full max-w-3xl flex-col items-center justify-center sm:min-h-0 sm:max-w-md sm:items-start">
          <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-[#E7DFCB]/80 [text-shadow:0_1px_10px_rgba(43,38,32,0.55)] sm:text-xs">
            {slides[active].eyebrow}
          </p>
          <h1 className="mt-3 w-full font-serif text-2xl font-semibold leading-tight text-[#FAF8F3] [text-shadow:0_2px_18px_rgba(43,38,32,0.6)] sm:mt-4 sm:text-3xl lg:text-4xl">
            {slides[active].title}
          </h1>
          {/* No max-width here — the parent block sets the measure, so the line
              count stays stable as the copy changes between slides. */}
          <p className="mt-3 text-xs font-medium italic leading-relaxed text-[#FAF8F3]/75 [text-shadow:0_1px_12px_rgba(43,38,32,0.6)] sm:mt-4 sm:max-w-sm sm:text-sm">
            {slides[active].quote}
          </p>
          {/* One primary action only — no secondary pill, so the hero stays
              unambiguous about where it wants the visitor to go. */}
          <div className="mt-6 flex justify-center sm:mt-7 sm:justify-start">
            <a
              href={slides[active].href}
              className="rounded-full bg-[#FAF8F3] px-6 py-2.5 text-xs font-medium text-[#2B2620] transition-colors hover:bg-[#DDBBA4] sm:px-8 sm:py-3 sm:text-sm"
            >
              {slides[active].cta}
            </a>
          </div>
        </div>
      </div>
      {/* Arrows — pointer devices only; touch users swipe and keyboard users
          use the arrow keys, plus everyone has the dots. */}
      {count > 1 && (
        <>
          <button
            type="button"
            onClick={prev}
            aria-label="Previous slide"
            className="absolute top-1/2 left-3 hidden -translate-y-1/2 cursor-pointer rounded-full border border-[#FAF8F3]/30 bg-[#2B2620]/55 p-2 text-[#FAF8F3] transition-colors hover:bg-[#2B2620]/75 lg:block"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Next slide"
            className="absolute top-1/2 right-3 hidden -translate-y-1/2 cursor-pointer rounded-full border border-[#FAF8F3]/30 bg-[#2B2620]/55 p-2 text-[#FAF8F3] transition-colors hover:bg-[#2B2620]/75 lg:block"
          >
            <ChevronRight className="h-5 w-5" strokeWidth={1.5} />
          </button>
        </>
      )}

      {/* Dots. An earlier auto-advance progress bar sat below these as a
          1px track; once its fill completed the empty track stayed on screen
          and read as a stray horizontal line under the pills, so it is gone.
          The active pill's own width carries the position cue.
          Centred under the mobile copy, but pushed to the bottom-right from
          `sm` up so they never collide with the bottom-left text block. */}
      {count > 1 && (
        <div className="absolute inset-x-0 bottom-6 flex items-center justify-center sm:inset-x-auto sm:right-12 sm:bottom-10 sm:justify-end">
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Go to slide ${i + 1}: ${slide.title}`}
              aria-current={i === active}
              className={`mx-1 h-1.5 rounded-full transition-all duration-300 ${
                i === active
                  ? 'w-8 bg-[#FAF8F3]'
                  : 'w-1.5 cursor-pointer bg-[#FAF8F3]/45 hover:bg-[#FAF8F3]/75'
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
