# Adore

**Adore** is a full-stack e-commerce fashion storefront — storefront, cart, checkout, returns, reviews, and a complete admin panel — built on Next.js 16 (App Router) with a Neon Postgres database.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 16](https://nextjs.org) (App Router, Turbopack), React 19 |
| Language | TypeScript 5 (strict) |
| Styling | Tailwind CSS 4 |
| Database | Neon Postgres (serverless) + Drizzle ORM |
| Payments | Razorpay (REST adapter, HMAC-verified webhooks) |
| Email | Resend (zero-dependency REST) + Vercel Queues for delivery |
| Media | Cloudinary |
| Shipping | Shiprocket (REST adapter, webhook-driven status sync) |
| Auth | JWT access/refresh cookies (`jose`) + `bcryptjs` |
| Rate limiting | Vercel KV (Upstash REST) |
| Hosting | Vercel (Analytics, Cron Jobs, Queues, OIDC) |
| Quality | ESLint 9, Prettier, Husky + lint-staged |

## Features

### Storefront
- Hero carousel with swipe/keyboard navigation, reduced-motion support, and eager LCP loading
- Shop with category filtering and pagination
- Product pages with reviews, fit feedback, and helpfulness voting
- Cart drawer with promo codes (welcome promo on signup)
- Checkout with Razorpay and signature-verified payment confirmation
- Order tracking and a self-service returns flow (with photo evidence and fraud checks)

### Account
- Profile and address management
- Order history with per-order tracking
- Returns status and history

### Admin
- JWT-guarded (middleware) with role checks
- Products (with size charts and Cloudinary image management)
- Categories, promos, order ledger (with cancellation), and returns queue

### Platform
- Email lifecycle driven by a DB-backed queue drained by cron (`/api/cron/drain-emails`)
- Refund reconciliation cron (`/api/cron/reconcile-refunds`)
- Webhooks: Razorpay (payments), Resend (delivery/bounce), Shiprocket (shipment status)
- Shared reads cached with `unstable_cache` + cache tags; per-user/admin reads never cached

## Getting Started

```bash
npm install
npm run dev        # start dev server at http://localhost:3000
```

### Environment Variables

Create a `.env.local` (see `.env.example` values below):

| Variable | Purpose |
|---|---|
| `adore_DATABASE_URL` | Neon Postgres connection string |
| `JWT_SECRET` | Signing key for auth cookies |
| `CLOUDINARY_URL` | Cloudinary credentials (`cloudinary://key:secret@cloud`) |
| `RAZORPAY_API_KEY` / `RAZORPAY_API_SECRET` | Razorpay Orders API credentials |
| `RAZORPAY_WEBHOOK_SECRET` | Verifies Razorpay webhooks |
| `RESEND_API_KEY` | Resend sending key |
| `RESEND_WEBHOOK_SECRET` | Verifies Resend delivery/bounce webhooks |
| `SHIPROCKET_EMAIL` / `SHIPROCKET_PASSWORD` | Shiprocket API login |
| `SHIPROCKET_WEBHOOK_TOKEN` | Verifies Shiprocket webhooks |
| `CRON_SECRET` | Authenticates cron endpoint invocations |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Vercel KV (rate limiting) |

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` / `npm run lint:fix` | ESLint |
| `npm run format` / `npm run format:check` | Prettier |
| `npm run type-check` | TypeScript check (`tsc --noEmit`) |

## Project Structure

```
app/                 # App Router: pages, layouts, API routes
  api/               # Route handlers (auth, cart, checkout, admin, webhooks, cron, …)
  account/           # Customer account area
  admin/             # Admin panel (products, categories, promos, ledger, returns)
  shop/              # Storefront and product pages
components/          # UI components, grouped by domain (account, admin, cart, shop, theme)
utils/               # Server/domain logic: db, schema, auth, orders, returns, email, …
scripts/             # One-off SQL migrations and operational .mjs scripts
public/              # Static assets (favicon.svg, images/)
middleware.ts        # Admin route guard (JWT + role check)
vercel.json          # Cron schedules and queue triggers
```

## Deployment

The app is deployed on Vercel. `vercel.json` registers:

- **Crons** — refund reconciliation (daily 03:00 UTC) and email-queue drain (daily 04:30 UTC)
- **Queue trigger** — `app/api/queues/send-email` consumes the `email` topic (Vercel Queues)

Environment variables are managed in the Vercel project settings; `VERCEL_OIDC_TOKEN` is provisioned automatically by the Vercel CLI.

## Conventions

- Clean, reusable, performant code — see `Agent.md` and the PR template for the checklist
- Comments only on important functions, max two lines
- Promo codes are alphanumeric only (no dashes/special characters)
- Shared reads are cache-tagged; per-user and admin reads stay uncached
- Pre-commit runs Prettier + ESLint on staged files, plus `tsc --noEmit` on TS/TSX
