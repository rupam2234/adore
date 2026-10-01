/**
 * Homepage hero slides.
 *
 * Images are served from `public/images` (same origin) rather than Cloudinary
 * so the first paint of the hero does not depend on a third-party round trip.
 *
 * - `image`      path under /public
 * - `width`      intrinsic width — required so next/image can reserve space
 * - `height`     intrinsic height
 * - `href`/`cta` the single call to action
 * - `quote`      short (~8 word) seasonal line shown under the title
 * - `objectPosition` CSS value used when the image is cropped to fill
 *
 * Copy rules: keep `title` to 7 words or fewer so it wraps to at most two
 * lines and the hero block height stays identical across slides. A single
 * `cta` only — no secondary button.
 *
 * Recommended export size: 2400px wide (2x for the widest desktop viewport),
 * JPEG quality ~80, under ~300 KB each.
 *
 * IMPORTANT (caching): public assets are served with a one-year immutable
 * cache, so always bump the filename when you swap an image
 * (banner-autumn.jpg → banner-winter.jpg) or visitors will keep the old one.
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
  /**
   * Short seasonal line (about 8 words) rendered under the title in italics.
   * Kept deliberately brief so the hero stays scannable and the line count —
   * and therefore the block height — barely changes between slides.
   */
  quote: string;
  cta: string;
  href: string;
}

export const HERO_SLIDES: HeroSlide[] = [
  {
    id: 'autumn',
    image: '/images/banner-1.jpeg',
    width: 2000,
    height: 1500,
    alt: 'A model wearing a white polka-dot dress, standing on a gravel riverbed in a green woodland',
    // Woodland riverbed. 2000x1500, the tallest frame. The desktop hero reveals
    // ~69% of the image's height, so this sits just above true centre: enough
    // to keep her head off the top edge while the skirt stays in frame.
    objectPosition: 'center 44%',
    eyebrow: 'The beauty of keeping',
    // Titles are capped at 7 words so they stay on one or two lines at every
    // breakpoint and the block height never changes between slides.
    title: 'Clothes that become more yours',
    quote: 'Warm light, cool mornings, and cloth that breathes.',
    cta: 'Explore the collection',
    href: '#shop',
  },
  {
    // Flower meadow. 2000x1470, a shade shorter than the hero's crop window, so it
    // needs a touch more upward bias than the riverbed frame.
    id: 'meadow',
    image: '/images/banner-2-meadow.jpeg',
    width: 2000,
    height: 1470,
    alt: 'A model in a white polka-dot dress standing among pink and white cosmos flowers on a hillside',
    objectPosition: 'center 40%',
    eyebrow: 'Autumn layers',
    title: 'Winter, in the softest form',
    quote: 'Monsoon leaves, festive evenings draw closer.',
    cta: 'Explore the collection',
    href: '#shop',
  },
  {
    // Wooden fence. 2000x1489. The tightest crop of the three and her face sits
    // highest in the frame, so this keeps the strongest upward bias of the set.
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
export const HERO_AUTOPLAY_MS = 6000;
