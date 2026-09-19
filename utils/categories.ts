/** Shared dress/category taxonomy — single source of truth for garment classes. */

export type CategorySlug =
  | 'dress'
  | 'mini-dress'
  | 'midi-dress'
  | 'maxi-dress'
  | 'kurti'
  | 'short-kurti'
  | 'long-kurti'
  | 'ethnic-kurti';

/** Static taxonomy: main classes with their sub-classes (children). */
export type CategoryNode = {
  slug: CategorySlug;
  name: string;
  description: string;
  children?: CategoryNode[];
};

export const CATEGORY_TREE: CategoryNode[] = [
  {
    slug: 'dress',
    name: 'Dress',
    description: 'Easy, breezy dresses for sunny days',
    children: [
      {
        slug: 'mini-dress',
        name: 'Mini Dress',
        description: 'Short, playful hemlines',
      },
      {
        slug: 'midi-dress',
        name: 'Midi Dress',
        description: 'Mid-calf silhouettes',
      },
      {
        slug: 'maxi-dress',
        name: 'Maxi Dress',
        description: 'Flowing floor-length styles',
      },
    ],
  },
  {
    slug: 'kurti',
    name: 'Kurti',
    description: 'Everyday kurtis in breathable fabrics',
    children: [
      {
        slug: 'short-kurti',
        name: 'Short Kurti',
        description: 'Cropped, tunic-length kurtis',
      },
      {
        slug: 'long-kurti',
        name: 'Long Kurti',
        description: 'Full-length kurtis',
      },
      {
        slug: 'ethnic-kurti',
        name: 'Ethnic Kurti',
        description: 'Festive and traditional kurtis',
      },
    ],
  },
];

/** Flat lookup of every known category (main + sub). */
export const ALL_CATEGORIES: CategoryNode[] = CATEGORY_TREE.flatMap(node => [
  { slug: node.slug, name: node.name, description: node.description },
  ...(node.children ?? []),
]);

/** Child slug → parent slug (e.g. "short-kurti" → "kurti"). */
export const CATEGORY_PARENTS: Record<string, CategorySlug> =
  Object.fromEntries(
    CATEGORY_TREE.flatMap(node =>
      (node.children ?? []).map(child => [child.slug, node.slug])
    )
  ) as Record<string, CategorySlug>;

/** Parent slug → child slugs (e.g. "kurti" → ["short-kurti", ...]). */
export const CATEGORY_CHILDREN: Record<CategorySlug, CategorySlug[]> =
  Object.fromEntries(
    CATEGORY_TREE.map(node => [
      node.slug,
      (node.children ?? []).map(child => child.slug),
    ])
  ) as Record<CategorySlug, CategorySlug[]>;

/** DB row shape for a category (includes optional parent link). */
export type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  parentId: string | null;
};

/** Page metadata for a category page (title/description from the taxonomy). */
export function categoryPageMetadata(slug: string): {
  title: string;
  description: string;
} | null {
  const category = ALL_CATEGORIES.find(c => c.slug === slug);
  if (!category) return null;

  const node = CATEGORY_TREE.find(n => n.slug === slug);
  const subs = node?.children ?? [];

  // Parents mention their sub-categories; children mention their parent group.
  const detail =
    subs.length > 0
      ? ` Explore ${subs.map(c => c.name.toLowerCase()).join(', ')}.`
      : CATEGORY_PARENTS[slug]
        ? ` Part of the ${CATEGORY_PARENTS[slug].replace(/-/g, ' ')} collection.`
        : '';

  const base =
    category.description ??
    `Shop ${category.name.toLowerCase()} styles from the Adore collection.`;

  return {
    title: `${category.name} — dresses & kurtis`,
    description: `${/[.!?]$/.test(base) ? base : `${base}.`}${detail}`,
  };
}
