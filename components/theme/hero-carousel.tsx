'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  HERO_SLIDES,
  HERO_AUTOPLAY_MS,
  resolveObjectPosition,
  type HeroSlide,
} from '@/utils/hero-slides';

const HERO_CRITICAL_CSS = `
[data-hero]{position:relative;width:100%;height:75vh;min-height:26.25rem;overflow:hidden;background:#E7DFCB}
@media (min-width:40rem){[data-hero]{height:80vh}}
@media (min-width:64rem){[data-hero]{height:calc(100vh - 5.5rem)}}
[data-hero-slide]{position:absolute;inset:0;opacity:0}
[data-hero-active]{opacity:1}
`;

export default function HeroCarousel({
  slides = HERO_SLIDES,
}: {
  slides?: HeroSlide[];
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const keyboardFocus = useRef(false);

  const count = slides.length;
  const active = count > 0 ? slides[index % count] : undefined;
  const goTo = useCallback(
    (nextIndex: number) => {
      if (count === 0) return;
      setIndex(((nextIndex % count) + count) % count);
    },
    [count]
  );

  const step = useCallback(
    (delta: number) => {
      if (count === 0) return;
      setIndex(i => (((i + delta) % count) + count) % count);
    },
    [count]
  );

  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);

  useEffect(() => {
    if (count < 2 || paused) return;

    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      if (process.env.NODE_ENV !== 'production') {
        console.info(
          `[hero] autoplay off: prefers-reduced-motion is reduce (${HERO_AUTOPLAY_MS}ms timer not started)`
        );
      }
      return;
    }

    const id = window.setInterval(() => step(1), HERO_AUTOPLAY_MS);

    return () => window.clearInterval(id);
  }, [index, count, paused, step]);

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

  // Desktop hero fills the viewport minus the sticky header (5.5rem clears its
  // ~82px). All three heights use `vh`, never `dvh`/`svh`: dynamic units track
  // the mobile browser toolbar, so a collapsing URL bar resized this box and
  // rescaled the cover image — a literal zoom on every scroll.
  return (
    <>
      {/* Ahead of the section itself, so the hero's size and the slide
          visibility are already correct when the section is parsed. */}
      <style>{HERO_CRITICAL_CSS}</style>
      <section
        aria-roledescription="carousel"
        aria-label="Featured collections"
        data-hero=""
        className="relative h-[75vh] min-h-105 w-full overflow-hidden bg-[#E7DFCB] sm:h-[80vh] lg:h-[calc(100vh-5.5rem)]"
        // No hover-pause: the hero fills the viewport from `lg` up, so the
        // cursor is almost always inside it and pausing on hover meant
        // autoplay effectively never ran on desktop. Keyboard focus still
        // pauses, so keyboard and screen-reader users are not surprised.
        onPointerDown={() => {
          keyboardFocus.current = false;
        }}
        onFocusCapture={() => {
          if (keyboardFocus.current) setPaused(true);
        }}
        onBlurCapture={() => {
          if (keyboardFocus.current) setPaused(false);
        }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onKeyDown={e => {
          if (e.key === 'Tab') keyboardFocus.current = true;
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            next();
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            prev();
          }
        }}
      >
        {/* Every slide stays mounted so the cross-fade always has both layers and
            the browser never decodes an image mid-transition. Which one is
            visible is driven by the data attributes above, not by classes, so it
            is correct on the very first paint. */}
        {slides.map(slide => {
          const position = slides.indexOf(slide) + 1;
          // Exactly one slide is active, at every width. There is no
          // per-breakpoint pair to keep in step any more, so a slide can never
          // end up painted on top of another one.
          const isActive = active?.id === slide.id;
          return (
            <div
              key={slide.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${position} of ${count}`}
              aria-hidden={!isActive}
              data-hero-slide=""
              data-hero-active={isActive ? '' : undefined}
              className={`absolute inset-0 transition-opacity duration-700 ease-out motion-reduce:transition-none ${
                isActive ? '' : 'pointer-events-none'
              }`}
            >
              <Image
                src={slide.image}
                alt={slide.alt}
                fill
                // Eager: these sit in the first viewport, and lazy-loading them
                // caused a visible blank frame on advance. Only the opener is
                // `priority`, so one image holds the LCP hint rather than all
                // six competing for it.
                priority={position === 1}
                loading="eager"
                sizes="100vw"
                style={{
                  objectPosition: resolveObjectPosition(slide.objectPosition),
                }}
                className="object-cover"
              />
            </div>
          );
        })}

        {/* Bottom gradient scrim for text legibility. Mobile copy is centred so
          the weight sits along the bottom; from `sm` up it moves bottom-left,
          so the gradient rotates to run from that corner. */}
        <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-[#2B2620]/70 via-[#2B2620]/45 to-[#2B2620]/10 sm:bg-linear-to-tr sm:from-[#2B2620]/85 sm:via-[#2B2620]/40 sm:to-transparent" />

        {/* Copy — centred on mobile, anchored bottom-left from `sm` up. One
          block, because every screen now shows the same slide in the same
          position; the old per-breakpoint pair existed only to render two
          different sets' copy. */}
        {active && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 py-16 text-center sm:items-start sm:justify-end sm:px-12 sm:pb-14 sm:pt-24 sm:text-left">
            <HeroCopy slide={active} />
          </div>
        )}

        {/* Arrows — pointer devices only; touch swipes, keyboard uses arrow keys. */}
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

        {/* Dots — one row for the one set. Centred under the mobile copy,
          bottom-right from `sm` up so they clear the bottom-left text block. */}
        {count > 1 && (
          <div className="absolute inset-x-0 bottom-6 flex items-center justify-center sm:inset-x-auto sm:right-12 sm:bottom-10 sm:justify-end">
            {slides.map((slide, i) => (
              <Dot
                key={slide.id}
                slide={slide}
                position={i + 1}
                isActive={active?.id === slide.id}
                onSelect={() => goTo(i)}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/** One carousel position pill. The active pill's own width is the cue. */
function Dot({
  slide,
  position,
  isActive,
  onSelect,
}: {
  slide: HeroSlide;
  position: number;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`Go to slide ${position}: ${slide.title}`}
      aria-current={isActive}
      className={`mx-1 h-1.5 rounded-full transition-all duration-300 ${
        isActive
          ? 'w-8 bg-[#FAF8F3]'
          : 'w-1.5 cursor-pointer bg-[#FAF8F3]/45 hover:bg-[#FAF8F3]/75'
      }`}
    />
  );
}

/**
 * Hero copy block, split out because it renders once per breakpoint — the two
 * slide sets can be showing different slides, so each needs its own copy.
 *
 * The fixed measure holds the line count stable as the copy changes. No panel
 * or fill; text-shadow keeps it legible without dimming the image behind it.
 */
function HeroCopy({ slide }: { slide: HeroSlide }) {
  return (
    <div className="flex w-full max-w-3xl flex-col items-center justify-center sm:min-h-0 sm:max-w-2xl sm:items-start">
      <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-[#E7DFCB]/80 [text-shadow:0_1px_10px_rgba(43,38,32,0.55)] sm:text-xs">
        {slide.eyebrow}
      </p>
      <h1 className="mt-3 w-full font-serif text-[26px] font-semibold leading-[1.12] tracking-[-0.01em] text-[#FAF8F3] [text-shadow:0_2px_18px_rgba(43,38,32,0.7)] sm:mt-4 sm:text-[34px] lg:text-[42px]">
        {slide.title}
      </h1>
      <p className="mt-3 max-w-md text-sm font-medium italic leading-relaxed text-[#FAF8F3]/90 [text-shadow:0_1px_12px_rgba(43,38,32,0.75)] sm:mt-5 sm:max-w-lg sm:text-base sm:leading-relaxed">
        {slide.quote}
      </p>
      {/* One primary action only — no secondary pill. */}
      <div className="mt-6 flex justify-center sm:mt-7 sm:justify-start">
        <a
          href={slide.href}
          className="rounded-full bg-[#FAF8F3] px-6 py-2.5 text-xs font-medium text-[#2B2620] transition-colors hover:bg-[#DDBBA4] sm:px-8 sm:py-3 sm:text-sm"
        >
          {slide.cta}
        </a>
      </div>
    </div>
  );
}
