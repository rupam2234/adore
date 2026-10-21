# Agent Guidelines — Adore, Wear Love

## Brand Voice & Copy

**Tone:** Natural, conversational, grounded. Write like a founder talking to a friend, not a marketing deck.

**Avoid:**

- Em dashes (—) — use commas instead
- Overused "creative" words: _timeless, effortless, cherished, curated, elevated, sanctuary, journey, embrace, discover, unveil, essence, tapestry_
- Abstract lists: "inspired by everyday life, changing seasons, cherished moments, vintage charm, and effortless elegance"
- Phrases that sound like a brand manifesto: "more than just a clothing brand," "expressing yourself without words"

**Prefer:**

- Concrete details: "busy Tuesday," "limited runs," "shapes that don't fight your body"
- Active voice: "We make," "We're not here to sell you more"
- Specificity over abstraction: "fabric we love" vs "curated fabrics"
- Honest constraints: "Nothing trendy. Nothing disposable."

**Example rewrite:**

| Before                                                                                                                                                                                                                  | After                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Adore was created with an idea to make fashion feel personal, modest, meaningful, and timeless. Inspired by the beauty of everyday life, changing seasons, cherished moments, vintage charm, and effortless elegance." | "Adore started with a simple idea: clothes should feel like you. Not a version of you for a special occasion, just you. Comfortable, confident, and built to last." |

---

## Code Conventions

1. Clean, reusable, performant code
2. Comments only on important functions, max two lines
3. **Promo codes must NOT contain dashes or special characters** — use alphanumeric only (e.g., `WELCOME10ABC123`, not `WELCOME10-ABC123`). This applies to all generated codes, welcome codes, and admin-created promo codes.
4. Reduce N+1 queries — server requests are top priority
5. **Cache shared reads to avoid DB hits** — public/shared query results get wrapped in `unstable_cache` with cache tags + a `revalidate` TTL (see utils/products.ts `SHOP_*` tags) so repeat views never re-run the query. Never cache per-user or admin-operations reads (account pages, ledger, returns queue, promos): there, freshness is the feature.
6. Server actions preferred over API routes for mutations
7. `unstable_cache` with tags for shared reads; never cache per-user/admin reads
8. Always test for issues using npm run build after all changes

---

## PR Checklist

- [ ] `npm run lint` passes
- [ ] `npm run type-check` passes
- [ ] `npm run format:check` passes
- [ ] No em dashes in copy
- [ ] No overused marketing words (see list above)
- [ ] Copy reads like a person talking, not a brand
- [ ] New env vars documented in `.env.example`
- [ ] DB migrations in `scripts/` with IF NOT EXISTS guards
