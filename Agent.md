# Agent Rules

1. Clean code
2. Reuse functions
3. Performant code
4. Max comment line 2 and only comment over important functions
5. **Promo codes must NOT contain dashes or special characters** — use alphanumeric only (e.g., `WELCOME10ABC123`, not `WELCOME10-ABC123`). This applies to all generated codes, welcome codes, and admin-created promo codes.
6. Reduce N+1 queries and request to server are my top priority
7. **Cache shared reads to avoid DB hits** — public/shared query results get wrapped in `unstable_cache` with cache tags + a `revalidate` TTL (see utils/products.ts `SHOP_*` tags) so repeat views never re-run the query. Never cache per-user or admin-operations reads (account pages, ledger, returns queue, promos): there, freshness is the feature.
