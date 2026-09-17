# adore

A clothing brand made with love — Next.js (App Router) storefront with cart,
accounts, promo codes, Razorpay payments and automatic Shiprocket fulfilment.

## Getting started

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment

All secrets live in `.env.local` (never committed):

| Variable | Required | Purpose |
| --- | --- | --- |
| `adore_DATABASE_URL` | yes | Neon Postgres connection string (Drizzle over the Neon HTTP driver) |
| `JWT_SECRET` | yes | Signs the access/refresh JWTs used for account & admin sessions |
| `RAZORPAY_API_KEY` | yes | Razorpay **Key Id** (`rzp_live_…` / `rzp_test_…`). Public — sent to Checkout.js |
| `RAZORPAY_API_SECRET` | yes | Razorpay **Key Secret**. Server-side only — signs/verifies orders |
| `SHIPROCKET_EMAIL` / `SHIPROCKET_PASSWORD` | recommended | Shiprocket login; the API re-authenticates itself when a token expires. An API user works too |
| `SHIPROCKET_API` | optional | A pre-generated Shiprocket bearer token (used first if present) |
| `SHIPROCKET_PICKUP_PINCODE` | optional | Warehouse PIN used as the shipment origin (default `560001`) |
| `SHIPROCKET_PICKUP_LOCATION` | optional | Pickup nickname configured in the Shiprocket dashboard (default `Primary`) |
| `CLOUDINARY_URL`, `CLOUDINARY_ASSET_URL` | optional | Product image uploads |

Get the Razorpay keys from **Dashboard → Account & Settings → API Keys** and make
sure the account is activated, otherwise Checkout refuses to open.

## Payments & shipping flow

1. **Cart → Checkout** (`/checkout`) — guests enter name, address, contact and
   an *optional* email; members pick a saved account address (or type a new one
   and tick “save to my account”). The PIN field asks Shiprocket for
   serviceability as soon as it's filled.
2. **`POST /api/checkout`** — re-validates everything server-side, re-verifies the
   PIN is deliverable, computes subtotal/discount/shipping/total itself (client
   numbers are never trusted), creates the `PENDING` order + items and opens a
   Razorpay order for the exact total in paise. Any gateway failure rolls the
   order back.
3. **Razorpay Checkout.js** — opens with the returned order id; the card/UPI
   details never touch this app.
4. **`POST /api/checkout/verify`** — verifies the HMAC signature, fetches the
   payment from Razorpay and checks the captured amount matches the order, then
   flips `PENDING → CONFIRMED` with a single conditional update (so a retried
   callback can never decrement stock twice), decrements stock, empties the bag
   and pushes the order to **Shiprocket** (`/orders/create/adhoc`, prepaid).
5. **`/checkout/success`** — receipt rendered from the stored order snapshot.
   The order number arrives in an httpOnly cookie set by the verify route, so
   order pages are never guessable.

Shiprocket push is best-effort: if the courier API is down the order stays paid
and `CONFIRMED`, the failure is logged, and `shiprocket_order_id` stays empty so
the shipment can be pushed again once the courier is reachable.

## Database

Schema lives in `utils/schema.ts` (Drizzle), applied with one-off scripts:

```bash
node scripts/create-cart-tables.mjs
node scripts/create-account-tables.mjs
node scripts/create-promo-tables.mjs
node scripts/migrate-payments.mjs   # razorpay_* / shiprocket_* columns on orders
```

All scripts use `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`, so
they are safe to re-run. `scripts/test-shiprocket.mjs` smoke-tests the courier
credentials, and `scripts/cart-smoke.mjs` exercises the cart API.

