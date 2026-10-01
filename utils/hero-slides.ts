/**
 * Homepage hero slides.
 *
 * Most images are served from `public/images` (same origin) so the first paint
 * does not wait on a CDN round trip. The one Cloudinary-hosted slide is
 * whitelisted under `images.remotePatterns` in `next.config.ts`.
 *
 * - `width`/`height` intrinsic, so next/image can reserve space.
 * - `quote` short (~8 word) seasonal line under the title.
 * - `objectPosition` crops the image to fill the frame. Only the vertical axis
 *   matters — the frame is full-bleed, so x is always effectively "center".
 *   Nudge every slide at once with HERO_FOCUS_Y_OFFSET.
 *
 * Copy rules: keep `title` to 7 words or fewer so it wraps to at most two lines
 * and the hero height stays identical across slides. A single `cta` only.
 *
 * Export at 2400px wide, JPEG ~80, under ~300 KB.
 *
 * Caching: public assets get a one-year immutable cache, so bump the filename
 * when swapping an image or visitors keep seeing the old one.
 */
export interface HeroSlide {
  id: string;
  image: string;
  width: number;
  height: number;
  alt: string;
  objectPosition?: string;
  eyebrow: string;
  title: string;
  /** Short seasonal line under the title, kept brief so the hero height holds. */
  quote: string;
  cta: string;
  href: string;
}

/**
 * One set, one order, every screen. Array order IS carousel order, so the
 * slides are simply declared in the sequence they should play:
 *
 *   1. Banner-4   garden path
 *   2. meadow     cosmos flowers
 *   3. Banner-6   veranda
 *   4. Cloudinary seaside promenade
 *   5. Banner-7   garden steps
 *   6. Banner-8   orchard
 *   7. banner-3   wooden fence
 *
 * Previously desktop and mobile ran different subsets, which meant two orderings
 * to keep in sync and a class of first-paint bugs where both sets' active
 * slides could be visible at once. There is no longer a per-breakpoint split,
 * so the component keeps a single index and a single active state.
 */
export const HERO_SLIDES: HeroSlide[] = [
  {
    // Banner 4 — opens the carousel. 1999x1167, the widest of the set, so the
    // least height is cropped away and the garden path reads left-to-right.
    id: 'garden',
    image: '/images/Banner-4.jpg',
    width: 1999,
    height: 1167,
    alt: 'A model in a white polka-dot dress walking along a gravel garden path with a green hillside behind her',
    // She spans the full height of the frame, so keep this near centre —
    // bias much either way and either her head or the hem leaves the frame.
    objectPosition: 'center 65%',
    eyebrow: 'Everyday, elevated',
    title: 'Made for where the day takes you',
    quote: 'Garden paths, open air, and cloth that moves.',
    cta: 'Explore the collection',
    href: '#shop',
  },
  {
    // Flower meadow — 2000x1470, slightly shorter, so a touch more upward bias.
    id: 'meadow',
    image: '/images/banner-2-meadow.jpeg',
    width: 2000,
    height: 1470,
    alt: 'A model in a white polka-dot dress standing among pink and white cosmos flowers on a hillside',
    objectPosition: 'center 40%',
    eyebrow: 'Summer blooms',
    title: 'Dresses for the long days',
    quote: 'Cosmos in the breeze, and no hurry at all.',
    cta: 'Explore the collection',
    href: '#shop',
  },
  {
    // Banner 6 — veranda. 2000x1218, another wide frame, so the crop is mild.
    // She stands centre-right, clear of the bottom-left copy block.
    id: 'veranda',
    image: '/images/Banner-6.jpeg',
    width: 2000,
    height: 1218,
    alt: 'A model in a white floral dress standing on a wooden veranda lined with potted plants',
    objectPosition: 'center 30%',
    eyebrow: 'Porch evenings',
    title: 'The quiet luxury of staying in',
    quote: 'Tea on the veranda, and a slow afternoon.',
    cta: 'Explore the collection',
    href: '#shop',
  },
  {
    // Seaside promenade — the only remote slide, served by Cloudinary. 1947x1352.
    // The `_a` param is Cloudinary's delivery token and must stay on the URL.
    // She is centre-right and fairly small in frame, so hold near the middle.
    id: 'promenade',
    image:
      'https://res.cloudinary.com/ejxjvxmb/image/upload/view-5?_a=BAMAAARk0',
    width: 1947,
    height: 1352,
    alt: 'A model in a teal dress and straw hat standing on a seaside promenade lined with sea trees',
    objectPosition: 'center 100%',
    eyebrow: 'Coastal days',
    title: 'Where the sea meets the day',
    quote: 'Sea air, long walks, and the tide coming in.',
    cta: 'Explore the collection',
    href: '#shop',
  },
  {
    // Banner 7 — garden steps. 2000x1307. She is seated and centre-left, and
    // her face sits high in frame, so bias upward to keep it visible.
    id: 'garden-steps',
    image: '/images/Banner-7.jpeg',
    width: 2000,
    height: 1307,
    alt: 'A model in a mint green floral dress sitting on garden steps in front of a wooden railing',
    objectPosition: 'center 45%',
    eyebrow: 'Afternoons outside',
    title: 'Nothing to do, nowhere to be',
    quote: 'Sun on the steps, and a whole afternoon ahead.',
    cta: 'Explore the collection',
    href: '#shop',
  },
  {
    // Banner 8 — orchard. 2000x1281. She stands centre-right reaching for
    // fruit, so hold near the middle to keep the raised arm in frame.
    id: 'orchard',
    image: '/images/Banner-8.jpeg',
    width: 2000,
    height: 1281,
    alt: 'A model in a white polka-dot dress carrying a wicker basket under a fruit tree',
    objectPosition: 'center 40%',
    eyebrow: 'Picked fresh',
    title: 'Clothes that roam with you',
    quote: 'Orchard walks, wicker baskets, and open hills.',
    cta: 'Explore the collection',
    href: '#shop',
  },
  {
    // Wooden fence — tightest crop of the set, face highest in frame.
    id: 'fence',
    image: '/images/banner-3-fence.jpeg',
    width: 2000,
    height: 1489,
    alt: 'A model in a white polka-dot dress leaning against a weathered wooden fence in dappled sunlight',
    objectPosition: 'center 30%',
    eyebrow: 'Made by hand',
    title: 'Slow cloth, made to last',
    quote: 'Handloom quiet, handloom warm, handloom ours.',
    cta: 'Explore the collection',
    href: '#shop',
  },
];

/** Milliseconds each slide stays on screen before auto-advancing. */
export const HERO_AUTOPLAY_MS = 3000;

/**
 * Global vertical framing offset in percentage points, applied on top of every
 * slide's own `objectPosition`. The single dial for moving the homepage images
 * up or down.
 *
 * The axis is inverted: negative moves the picture DOWN the frame. Roughly ±10
 * is the practical limit — past that `object-cover` runs out of image and the
 * opposite edge shows empty space.
 */
export const HERO_FOCUS_Y_OFFSET: number = -6;

/** object-position keywords mapped to the percentage they resolve to. */
const FOCUS_KEYWORDS: Record<string, number> = {
  top: 0,
  center: 50,
  bottom: 100,
};

/**
 * Applies HERO_FOCUS_Y_OFFSET to a slide's `objectPosition`, clamped to 0–100.
 * A value the offset cannot be applied to (a px/rem length, a `calc()`) is
 * returned untouched, so it degrades to "no offset" rather than breaking layout.
 */
export function resolveObjectPosition(position?: string): string {
  const base = (position ?? 'center').trim();
  if (HERO_FOCUS_Y_OFFSET === 0) return base;

  const parts = base.split(/\s+/);
  // A lone value is the horizontal axis; y stays at its initial `center`.
  const x = parts[0];
  const y = parts.length > 1 ? parts[1] : 'center';

  let percent: number | undefined;
  if (y.endsWith('%')) {
    percent = Number.parseFloat(y);
  } else if (y in FOCUS_KEYWORDS) {
    percent = FOCUS_KEYWORDS[y];
  }
  if (percent === undefined || Number.isNaN(percent)) return base;

  const shifted = Math.min(100, Math.max(0, percent + HERO_FOCUS_Y_OFFSET));
  return `${x} ${shifted}%`;
}
