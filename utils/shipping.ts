/**
 * Shiprocket serviceability adapter.
 *
 * Auth: Shiprocket's v1/external API expects `Authorization: Bearer <token>`.
 * Dashboard-generated tokens (SHIPROCKET_API) expire; if they do, we can
 * transparently re-login when SHIPROCKET_EMAIL + SHIPROCKET_PASSWORD are set.
 *
 * Results are cached in-memory (TTL 24h, bounded size) so repeat lookups are
 * instant and we don't burn Shiprocket's request quota.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SHIPROCKET_BASE = 'https://apiv2.shiprocket.in/v1/external';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const REQUEST_TIMEOUT_MS = 8000;

// Fallback pickup location (seller's warehouse PIN). Override via env.
const DEFAULT_PICKUP_PIN = process.env.SHIPROCKET_PICKUP_PINCODE ?? '560001';
const DEFAULT_WEIGHT_KG = 0.5;

export type PinCheckResult = {
  serviceable: boolean;
  etaDays: number | null;
  estimatedDelivery: string | null;
  /** Cheapest available courier's freight charge (₹). Null when unknown. */
  freightCharge: number | null;
  cod: boolean | null;
};

type CacheEntry = { result: PinCheckResult; expiresAt: number };
const cache = new Map<string, CacheEntry>();

// Bearer token obtained by re-login (when dashboard token goes stale).
let bearerOverride: string | null = null;
let bearerExpiresAt = 0;
let loginPromise: Promise<string | null> | null = null;
// Back-off after failed logins so we never hammer the auth endpoint and get
// the API user blocked for "too many failed login attempts". Escalates
// exponentially (10m → 20m → 40m → capped 60m) on consecutive failures.
let loginBackoffUntil = 0;
let loginFailureStreak = 0;
const LOGIN_BACKOFF_MS = 10 * 60 * 1000;
const LOGIN_BACKOFF_CAP_MS = 60 * 60 * 1000;

// The token is valid for ~10 days, so it is persisted to disk (gitignored).
// Without this, every dev-server restart / hot-reload would discard the
// in-memory token and log in again — the failed-login spam that triggers
// Shiprocket's temporary account lock.
const TOKEN_CACHE_PATH = join(process.cwd(), '.shiprocket-token.json');
let tokenLoadAttempted = false;

function loadPersistedToken(): void {
  if (tokenLoadAttempted) return;
  tokenLoadAttempted = true;
  // An explicit env token always wins; nothing to load.
  if (process.env.SHIPROCKET_API) return;
  try {
    if (!existsSync(TOKEN_CACHE_PATH)) return;
    const { token, expiresAt } = JSON.parse(
      readFileSync(TOKEN_CACHE_PATH, 'utf8')
    ) as { token?: string; expiresAt?: number };
    if (
      typeof token === 'string' &&
      typeof expiresAt === 'number' &&
      expiresAt > Date.now() + 60_000 // keep a 1-min safety margin
    ) {
      bearerOverride = token;
      bearerExpiresAt = expiresAt;
    }
  } catch {
    // Corrupt/foreign file — ignore and fall through to a fresh login.
  }
}

function persistToken(token: string, expiresAt: number): void {
  try {
    writeFileSync(
      TOKEN_CACHE_PATH,
      JSON.stringify({ token, expiresAt }, null, 2),
      'utf8'
    );
  } catch {
    // Persisting is best-effort; an unwritable FS just means re-login next boot.
  }
}

type CourierCompany = {
  courier_name?: string;
  /** Current API shape. */
  estimated_delivery_days?: string | number;
  etd?: string;
  cod?: number | boolean;
  /** Courier freight charge (₹) for this PIN + weight combination. */
  rate?: string | number;
  freight_charge?: string | number;
  /** Older API shape, kept for compatibility. */
  eta?: string;
  estimated_delivery_date?: string;
  cod_available?: number | boolean;
};

type ServiceabilityResponse = {
  data?: { available_courier_companies?: CourierCompany[] };
};

function tokenExpiry(jwt: string): number {
  // JWT payload.exp (seconds since epoch) — Shiprocket tokens last ~10 days.
  try {
    const payload = JSON.parse(
      Buffer.from(jwt.split('.')[1]!, 'base64').toString('utf8')
    ) as { exp?: number };
    // Refresh an hour before actual expiry.
    return payload.exp ? (payload.exp - 3600) * 1000 : 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Shared token cache (optional, for serverless deploys)
//
// On Vercel/Netlify the in-memory token dies with every cold start and the
// disk cache doesn't persist, so each new instance would hit Shiprocket's
// login endpoint. Storing the ~10-day token in a shared Redis (e.g. Upstash)
// means the whole deployment — every instance, every visitor — reuses ONE
// token. The token authenticates the merchant account, so it is identical
// for all users; there is no per-user auth here.
//
// Uses Upstash's plain REST API, so no SDK dependency is required. Enable by
// setting UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN. Without them
// the app falls back to memory + disk caching only.
// ---------------------------------------------------------------------------
const REDIS_TOKEN_KEY = 'shiprocket:bearer';
const REDIS_TIMEOUT_MS = 3000;

function redisEnv(): { url: string; token: string } | null {
  // Accepts both Upstash's own variable names and Vercel KV's (Vercel KV is
  // Upstash under the hood — same REST API).
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

async function redisGetToken(): Promise<string | null> {
  const redis = redisEnv();
  if (!redis) return null;
  try {
    const res = await fetch(`${redis.url}/get/${REDIS_TOKEN_KEY}`, {
      headers: { Authorization: `Bearer ${redis.token}` },
      signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
      // Never let a stale shared token sit in any cache layer.
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: string | null };
    return body.result ?? null;
  } catch {
    // Redis down/unreachable → fall through to login; never block the request.
    return null;
  }
}

async function redisSetToken(token: string, expiresAt: number): Promise<void> {
  const redis = redisEnv();
  if (!redis) return;
  const ttlSec = Math.max(60, Math.floor((expiresAt - Date.now()) / 1000));
  try {
    await fetch(
      `${redis.url}/set/${REDIS_TOKEN_KEY}/${encodeURIComponent(token)}?EX=${ttlSec}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${redis.token}` },
        signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
      }
    );
  } catch {
    // Best-effort; the in-memory/disk caches still cover this instance.
  }
}

/**
 * Resolve the bearer token: memory → disk → shared Redis → SHIPROCKET_API env.
 * (Login itself is handled by the 401-retry path, which self-throttles.)
 */
async function authHeader(): Promise<string> {
  if (bearerOverride && Date.now() < bearerExpiresAt) {
    return `Bearer ${bearerOverride}`;
  }
  bearerOverride = null;
  // An explicit env token always wins.
  if (process.env.SHIPROCKET_API) {
    return `Bearer ${process.env.SHIPROCKET_API}`;
  }
  // Dev-friendly on-disk cache (no-ops on serverless).
  loadPersistedToken();
  if (bearerOverride) return `Bearer ${bearerOverride}`;
  // Shared cache across all serverless instances.
  const shared = await redisGetToken();
  if (shared) {
    bearerOverride = shared;
    bearerExpiresAt = tokenExpiry(shared);
    if (Date.now() < bearerExpiresAt) return `Bearer ${shared}`;
    bearerOverride = null;
  }
  return 'Bearer ';
}

async function loginForToken(): Promise<string | null> {
  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;
  if (!email || !password) return null;
  if (Date.now() < loginBackoffUntil) return null;
  let res = await fetch(`${SHIPROCKET_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    // API Users authenticate via a different endpoint than main accounts.
    res = await fetch(`${SHIPROCKET_BASE}/auth/user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }
  if (!res.ok) {
    // Blocked / wrong credentials — back off (escalating) instead of retrying
    // every request. Shiprocket temporarily locks accounts that fail too often.
    loginFailureStreak += 1;
    const backoff = Math.min(
      LOGIN_BACKOFF_MS * 2 ** (loginFailureStreak - 1),
      LOGIN_BACKOFF_CAP_MS
    );
    loginBackoffUntil = Date.now() + backoff;
    console.error(
      `[shipping] Shiprocket login failed (status ${res.status}) — backing off for ${Math.round(backoff / 60000)} min`
    );
    return null;
  }
  const data = (await res.json()) as { token?: string };
  const token = data.token ?? null;
  if (token) {
    bearerOverride = token;
    bearerExpiresAt = tokenExpiry(token);
    loginBackoffUntil = 0;
    loginFailureStreak = 0;
    persistToken(token, bearerExpiresAt);
    // Share the token with every other serverless instance.
    await redisSetToken(token, bearerExpiresAt);
  }
  return token;
}

/** Shiprocket quotes per 0.5 kg slab — round up (min one slab). */
function rateSlabKg(weightKg: number | null | undefined): number {
  const w = weightKg != null && Number.isFinite(weightKg) && weightKg > 0 ? weightKg : DEFAULT_WEIGHT_KG;
  return Math.min(50, Math.max(0.5, Math.ceil(w * 2) / 2));
}

async function fetchServiceability(
  pin: string,
  weightKg: number | null
): Promise<Response> {
  const url =
    `${SHIPROCKET_BASE}/courier/serviceability/?` +
    new URLSearchParams({
      pickup_postcode: DEFAULT_PICKUP_PIN,
      delivery_postcode: pin,
      cod: '1',
      // The API expects `weight` (kg) — `order_weight` is rejected with
      // 400 "Weight Required".
      weight: String(rateSlabKg(weightKg)),
    });
  return fetch(url, {
    headers: { Authorization: await authHeader() },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/**
 * Authenticated POST with the standard stale-token retry.
 *
 * Every Shiprocket mutation (forward order, RMA, pickup request) goes through
 * here so the 401 → re-login → retry dance exists in exactly one place. That
 * matters more than it looks: the token lives ~10 days, and a missed renewal in
 * one endpoint would mean refunds silently failing while the rest of the
 * checkout works fine.
 */
async function shiprocketPost(
  path: string,
  payload: Record<string, unknown>
): Promise<Response> {
  const send = (auth: string) =>
    fetch(`${SHIPROCKET_BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

  let res = await send(await authHeader());

  // Stale/expired/invalidated token → try email/password re-login once.
  // loginForToken() self-throttles via the back-off, so this is safe to
  // attempt on every 401 without risking a lock-out.
  if (res.status === 401) {
    bearerOverride = null;
    loginPromise = loginPromise ?? loginForToken();
    bearerOverride = await loginPromise;
    loginPromise = null;
    if (bearerOverride) res = await send(`Bearer ${bearerOverride}`);
  }
  return res;
}

/** Authenticated GET, with the same single re-login retry as shiprocketPost. */
async function shiprocketGet(path: string): Promise<Response> {
  const send = (auth: string) =>
    fetch(`${SHIPROCKET_BASE}${path}`, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

  let res = await send(await authHeader());
  if (res.status === 401) {
    bearerOverride = null;
    loginPromise = loginPromise ?? loginForToken();
    bearerOverride = await loginPromise;
    loginPromise = null;
    if (bearerOverride) res = await send(`Bearer ${bearerOverride}`);
  }
  return res;
}

async function checkWithShiprocket(
  pin: string,
  weightKg: number | null
): Promise<PinCheckResult> {
  let res = await fetchServiceability(pin, weightKg);

  // Stale/expired/invalidated token → try email/password re-login once.
  // loginForToken() self-throttles via the back-off, so this is safe to
  // attempt on every 401 without risking a lock-out.
  if (res.status === 401) {
    bearerOverride = null;
    loginPromise = loginPromise ?? loginForToken();
    bearerOverride = await loginPromise;
    loginPromise = null;
    if (bearerOverride) res = await fetchServiceability(pin, weightKg);
  }

  if (res.status === 401 || res.status === 403) {
    throw new ShippingUnavailableError('Shiprocket rejected credentials');
  }
  if (res.status === 429) {
    throw new ShippingUnavailableError('Rate limited by shipping provider');
  }
  if (!res.ok) {
    throw new ShippingUnavailableError(
      `Shipping provider error (${res.status})`
    );
  }

  const body = (await res.json()) as ServiceabilityResponse;
  const couriers = body.data?.available_courier_companies ?? [];

  if (couriers.length === 0) {
    return {
      serviceable: false,
      etaDays: null,
      estimatedDelivery: null,
      freightCharge: null,
      cod: null,
    };
  }

  // Fastest courier = the best promise we can make the customer.
  // Cheapest courier = the shipping rate we charge (freightCharge).
  let etaDays: number | null = null;
  let estimatedDelivery: string | null = null;
  let freightCharge: number | null = null;
  let cod = false;
  for (const c of couriers) {
    const etaNum = Number(c.estimated_delivery_days ?? c.eta);
    if (Number.isFinite(etaNum) && (etaDays === null || etaNum < etaDays)) {
      etaDays = etaNum;
      estimatedDelivery =
        c.etd ?? c.estimated_delivery_date ?? estimatedDelivery;
    }
    // Prefer `rate`, fall back to `freight_charge` (older API shape).
    const rate = Number(c.rate ?? c.freight_charge);
    if (Number.isFinite(rate) && rate > 0) {
      freightCharge =
        freightCharge === null ? rate : Math.min(freightCharge, rate);
    }
    if (
      c.cod === 1 ||
      c.cod === true ||
      c.cod_available === 1 ||
      c.cod_available === true
    ) {
      cod = true;
    }
  }

  return { serviceable: true, etaDays, estimatedDelivery, freightCharge, cod };
}

export class ShippingUnavailableError extends Error {}

export async function checkPinServiceability(
  rawPin: string,
  weightKg?: number | null
): Promise<PinCheckResult> {
  const pin = rawPin.trim();
  if (!/^\d{6}$/.test(pin)) {
    throw new ShippingUnavailableError('PIN must be a 6-digit number');
  }

  // The quoted rate depends on the (slab-rounded) weight, so the cache key
  // includes it — same PIN at a different weight is a different quote.
  const slab = rateSlabKg(weightKg);
  const cacheKey = `${pin}:${slab}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.result;

  const result = await checkWithShiprocket(pin, slab);

  // Bounded cache — evict the oldest entry when full.
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

// ---------------------------------------------------------------------------
// Order forwarding — push a paid order into Shiprocket automatically.
// ---------------------------------------------------------------------------

export class ShiprocketOrderError extends Error {}

export type ShiprocketOrderInput = {
  orderNumber: string;
  customerName: string;
  phone: string;
  email: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  items: Array<{
    name: string;
    sku: string;
    units: number;
    sellingPrice: number;
    /** Packed weight per unit (grams); null → the 400g estimate applies. */
    weightGrams?: number | null;
  }>;
  subTotal: number;
  discount: number;
};

export type ShiprocketOrderResult = {
  shiprocketOrderId: string;
  shipmentId: string | null;
};

// Seller warehouse pickup location name configured in the Shiprocket dashboard.
const PICKUP_LOCATION = process.env.SHIPROCKET_PICKUP_LOCATION ?? 'Primary';
// Rough parcel dimensions (cm / g) — good enough for rate estimates.
const PARCEL_LENGTH_CM = 30;
const PARCEL_BREADTH_CM = 24;
const PARCEL_HEIGHT_CM = 6;
const PARCEL_WEIGHT_G_PER_UNIT = 400;

function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/);
  return { first: parts[0] ?? 'Customer', last: parts.slice(1).join(' ') };
}

/**
 * Create a (prepaid) order in Shiprocket for fulfilment. Uses the same bearer
 * auth as serviceability, with one transparent re-login on a stale token.
 */
export async function createShiprocketOrder(
  input: ShiprocketOrderInput
): Promise<ShiprocketOrderResult> {
  const { first, last } = splitName(input.customerName);
  const payload = {
    order_id: input.orderNumber,
    order_date: new Date().toISOString().slice(0, 19).replace('T', ' '),
    pickup_location: PICKUP_LOCATION,
    billing_customer_name: first,
    billing_last_name: last,
    billing_address: input.addressLine1,
    billing_address_2: input.addressLine2 ?? '',
    billing_city: input.city,
    billing_pincode: input.postalCode,
    billing_state: input.state,
    billing_country: input.country || 'India',
    billing_email: input.email,
    billing_phone: input.phone.replace(/\D/g, '').slice(-10),
    shipping_is_billing: true,
    order_items: input.items.map(item => ({
      name: item.name,
      sku: item.sku,
      units: item.units,
      selling_price: item.sellingPrice,
      discount: '',
    })),
    payment_method: 'Prepaid',
    sub_total: input.subTotal,
    total_discount: input.discount,
    length: PARCEL_LENGTH_CM,
    breadth: PARCEL_BREADTH_CM,
    height: PARCEL_HEIGHT_CM,
    // Real per-product weights when the admin set them; 400g estimate otherwise.
    weight: input.items.reduce(
      (sum, i) =>
        sum +
        (i.weightGrams != null && i.weightGrams > 0
          ? i.weightGrams
          : PARCEL_WEIGHT_G_PER_UNIT) * i.units,
      0
    ),
  };

  const res = await shiprocketPost('/orders/create/adhoc', payload);

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new ShiprocketOrderError(
      `Shiprocket order creation failed (${res.status}) ${detail.slice(0, 200)}`
    );
  }

  const body = (await res.json()) as {
    order_id?: number | string;
    shipment_id?: number | string;
  };
  return {
    shiprocketOrderId: String(body.order_id ?? ''),
    shipmentId: body.shipment_id != null ? String(body.shipment_id) : null,
  };
}

// ---------------------------------------------------------------------------
// Reverse logistics — RMA and pickup scheduling
//
// A return is a second shipment in the opposite direction. Shiprocket models it
// as an RMA ("Return Merchandise Authorisation") attached to the original AWB,
// which is what lets a customer drop the parcel at a pickup point instead of
// packing it and paying postage themselves.
//
// The pickup request is what actually books a rider; creating the RMA alone
// only registers the intent. Both are required, in that order.
// ---------------------------------------------------------------------------

export class ShiprocketReturnError extends Error {
  /** Machine-readable reason, safe to branch on in the state machine. */
  code:
    | 'NOT_FOUND'
    | 'NOT_DELIVERED'
    | 'ALREADY_RMA'
    | 'PICKUP_UNAVAILABLE'
    | 'PICKUP_EXISTS'
    | 'GATEWAY_ERROR';
  constructor(code: ShiprocketReturnError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export type CreateRmaInput = {
  /** The original Shiprocket AWB the item shipped on. */
  awb: string;
  /** Our human-readable order number. */
  orderId: string;
  /** Collected FROM the customer. */
  pickup: RmaAddress;
  /** Delivered TO our warehouse. */
  shipping: RmaAddress;
  /** Free-text; shows on the customer's dashboard. */
  returnReason: string;
  /** Our internal return-request id, echoed for reconciliation. */
  requestId: string;
  items: Array<{ name: string; sku: string; units: number; sellingPrice: number }>;
  /** Packed dimensions/weight for the return parcel. */
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
  weightKg: number;
};

export type RmaAddress = {
  fullName: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  pincode: string;
  country?: string;
};

/**
 * Create the RETURN order — the first half of reverse logistics.
 *
 * ENDPOINT, CORRECTED AGAINST THE LIVE API
 * The v1/external catalogue documents `POST /orders/create/return`. An earlier
 * version of this adapter posted to `/orders/create/rma`, which does not exist —
 * it returns `{"message":"404 Not Found"}`. Every return would therefore have
 * failed at the first step. utils/shipping-returns.test.ts pins the corrected
 * path; re-verify against the live API after changing it.
 *
 * The body is a FULL order payload, not a thin `{awb, reason}`: the return
 * parcel needs both endpoints (pickup = customer, shipping = our warehouse),
 * line items, and dimensions for the courier to rate it. Omitting any of them
 * returns 422 with the field list.
 *
 * Returns the Shiprocket `shipment_id`, which is what the pickup call keys on.
 */
export async function createReturnOrder(
  input: CreateRmaInput
): Promise<{ shipmentId: string; returnOrderId: string | null }> {
  const addr = (a: RmaAddress) => ({
    customer_name: a.fullName,
    email: a.email,
    phone: a.phone.replace(/\D/g, '').slice(-10),
    address: [a.addressLine1, a.addressLine2].filter(Boolean).join(', '),
    city: a.city,
    state: a.state,
    country: a.country ?? 'India',
    pincode: a.pincode,
  });

  const payload = {
    order_id: input.orderId,
    order_date: new Date().toISOString().slice(0, 19).replace('T', ' '),
    // A return parcel moves to us already paid for — we booked the pickup.
    payment_method: 'Prepaid',
    pickup_location: PICKUP_LOCATION,
    pickup_customer_name: input.pickup.fullName,
    pickup_address: addr(input.pickup).address,
    pickup_address_2: input.pickup.addressLine2 ?? '',
    pickup_city: input.pickup.city,
    pickup_state: input.pickup.state,
    pickup_country: input.pickup.country ?? 'India',
    pickup_pincode: input.pickup.pincode,
    pickup_phone: input.pickup.phone.replace(/\D/g, '').slice(-10),
    pickup_email: input.pickup.email,

    shipping_customer_name: input.shipping.fullName,
    shipping_address: addr(input.shipping).address,
    shipping_address_2: input.shipping.addressLine2 ?? '',
    shipping_city: input.shipping.city,
    shipping_state: input.shipping.state,
    shipping_country: input.shipping.country ?? 'India',
    shipping_pincode: input.shipping.pincode,
    shipping_phone: input.shipping.phone.replace(/\D/g, '').slice(-10),

    return_reason: input.returnReason,
    remarks: `return_request_id=${input.requestId}`,
    order_items: input.items.map(i => ({
      name: i.name,
      sku: i.sku,
      units: i.units,
      selling_price: i.sellingPrice,
      discount: 0,
    })),
    sub_total: input.items.reduce((s, i) => s + i.sellingPrice * i.units, 0),
    length: input.lengthCm,
    breadth: input.breadthCm,
    height: input.heightCm,
    weight: input.weightKg,
  };

  const res = await shiprocketPost('/orders/create/return', payload);
  const body = (await res.json().catch(() => ({}))) as {
    message?: string;
    errors?: Record<string, string[]>;
    data?: {
      shipment_id?: number | string;
      id?: number | string;
      return_order_id?: number | string;
    };
  };

  if (!res.ok) {
    const detail = JSON.stringify(body.errors ?? body.message ?? '').toLowerCase();
    if (detail.includes('already') || detail.includes('rma')) {
      return { shipmentId: '', returnOrderId: null }; // alreadyExisted
    }
    if (detail.includes('delivered')) {
      throw new ShiprocketReturnError(
        'NOT_DELIVERED',
        'The courier has not marked this shipment as delivered yet.'
      );
    }
    if (res.status === 404) {
      throw new ShiprocketReturnError(
        'NOT_FOUND',
        'The courier has no record of this shipment.'
      );
    }
    throw new ShiprocketReturnError(
      'GATEWAY_ERROR',
      'The courier could not start the return. Please try again shortly.'
    );
  }

  const shipmentId = body.data?.shipment_id;
  if (shipmentId == null) {
    throw new ShiprocketReturnError(
      'GATEWAY_ERROR',
      'The courier accepted the return but returned no shipment reference.'
    );
  }
  return {
    shipmentId: String(shipmentId),
    returnOrderId: body.data?.return_order_id != null ? String(body.data.return_order_id) : null,
  };
}

export type SchedulePickupInput = {
  /**
   * Shiprocket's `shipment_id` for the RETURN order created by
   * `createReturnOrder` — NOT an rma_id. Verified against the live API: the
   * endpoint answers `{"message":"shipment_id is required"}`.
   */
  shipmentId: string;
  /** Optional; lets an admin override the courier pickup location. */
  pickupLocationId?: number;
};

/**
 * Book the reverse pickup.
 *
 * ENDPOINT, CORRECTED AGAINST THE LIVE API
 * The previous implementation posted to `/orders/fetch_pickup_details`, which
 * does not exist (404). The documented endpoint is
 * `POST /courier/generate/pickup`, and it keys on the RETURN shipment id.
 *
 * The address and contact details come from the return order we just created,
 * so they are not repeated here — which also removes a whole class of bug where
 * the rider was sent to a different address than the parcel was booked with.
 *
 * This is the step that costs us money (a rider is allocated), so it stays
 * separate from `createReturnOrder`. A crash between them leaves a return order
 * with no rider — recoverable and cheap. The reverse would leave a rider booked
 * against nothing.
 *
 * `PICKUP_UNAVAILABLE` is a NORMAL outcome, not an error: large parts of India
 * are outside reverse-pickup coverage, which is exactly why the published policy
 * offers a self-ship fallback with reimbursement.
 */
export async function scheduleReversePickup(
  input: SchedulePickupInput
): Promise<{ pickupId: string; alreadyScheduled: boolean }> {
  const res = await shiprocketPost('/courier/generate/pickup', {
    shipment_id: input.shipmentId,
    ...(input.pickupLocationId
      ? { pickup_location_id: input.pickupLocationId }
      : {}),
  });

  const body = (await res.json().catch(() => ({}))) as {
    message?: string;
    success?: boolean;
    data?: {
      pickup_id?: number | string;
      request_id?: number | string;
    };
  };

  if (!res.ok || body.success === false) {
    const detail = String(body.message ?? '').toLowerCase();
    if (detail.includes('already')) {
      return { pickupId: '', alreadyScheduled: true };
    }
    if (
      detail.includes('serviceable') ||
      detail.includes('not serviceable') ||
      detail.includes('unserviceable') ||
      detail.includes('not available')
    ) {
      throw new ShiprocketReturnError(
        'PICKUP_UNAVAILABLE',
        'Reverse pickup is not available at this PIN code.'
      );
    }
    throw new ShiprocketReturnError(
      'GATEWAY_ERROR',
      'We could not book the pickup. Please try again shortly.'
    );
  }

  const pickupId = body.data?.pickup_id ?? body.data?.request_id;
  if (pickupId == null) {
    throw new ShiprocketReturnError(
      'GATEWAY_ERROR',
      'The courier accepted the pickup but returned no reference.'
    );
  }
  return { pickupId: String(pickupId), alreadyScheduled: false };
}

export type ReturnTrackingStatus =
  | 'PICKUP_SCHEDULED'
  | 'PICKUP_FAILED'
  | 'IN_TRANSIT'
  | 'RECEIVED';

/**
 * Map Shiprocket's return-leg vocabulary onto our state machine.
 *
 * ONE mapper, three call sites. It serves the tracking API response, the
 * inbound webhook payload, and anything added later. That consolidation is the
 * point: when the two API shapes disagreed, the API path and the webhook path
 * could advance a customer's return differently from the same physical event —
 * the webhook silently missing statuses the API knew about. Unknown values
 * return null on purpose, so a parcel we know nothing about is left alone rather
 * than appearing to move; defaulting to IN_TRANSIT would also treat every future
 * status as progress.
 *
 * Aliases from BOTH surfaces are listed, including the space-separated spellings
 * the tracking API returns alongside the underscore-separated webhook ones.
 */
export function mapReturnStatus(
  raw: string | null | undefined
): ReturnTrackingStatus | null {
  switch ((raw ?? '').trim().toUpperCase()) {
    case 'PICKUP_SCHEDULED':
    case 'PICKUP REQUESTED':
    case 'PICKUP_CONFIRMED':
      return 'PICKUP_SCHEDULED';

    case 'PICKUP_FAILED':
    case 'PICKUP CANCELLED':
    case 'CANCELLED':
    case 'CANCELLED_BY_SELLER':
    case 'RTO_INITIATED':
      return 'PICKUP_FAILED';

    case 'IN_TRANSIT':
    case 'SHIPPED':
    case 'PICKED_UP':
    case 'RMA_IN_TRANSIT':
      return 'IN_TRANSIT';

    // Only ever reached on the RETURN leg — this function is never applied to a
    // forward shipment, where "DELIVERED" means something entirely different.
    case 'DELIVERED':
    case 'DELIVERED_RTO':
    case 'RMA_DELIVERED':
    case 'RMA_RECEIVED':
      return 'RECEIVED';

    default:
      return null;
  }
}

/**
 * Read the live status of the return leg.
 *
 * ENDPOINT, CORRECTED AGAINST THE LIVE API
 * There is no `/orders/track/rma`. The documented endpoint is
 * `GET /orders/processing/return`, which returns `{ data: [...], meta: {...} }`.
 *
 * Only ever moves FORWARD, and only within the goods-moving states. A courier
 * status that goes backwards (a re-scan, a mis-keyed event) must not drag a
 * customer's parcel out of "received" and back into "in transit" — that would
 * make a refund that has already been paid look outstanding in the UI.
 *
 * We deliberately interpret only the handful of states the workflow acts on —
 * anything unknown returns null and the caller leaves the row alone, rather than
 * guessing and moving a customer's return forward on a misread.
 */
export async function fetchReturnTracking(
  shipmentId: string
): Promise<{ status: ReturnTrackingStatus; awb: string | null } | null> {
  const res = await shiprocketGet(
    `/orders/processing/return?return_status=ALL&per_page=100`
  );
  if (!res.ok) return null;

  const body = (await res.json().catch(() => ({}))) as {
    data?: Array<{
      shipment_id?: number | string;
      awb?: string;
      return_status?: string;
      status?: string;
    }>;
  };

  const row = (body.data ?? []).find(
    r => String(r.shipment_id ?? '') === String(shipmentId)
  );
  if (!row) return null;

  const mapped = mapReturnStatus(
    String(row.return_status ?? row.status ?? '').toUpperCase()
  );
  if (!mapped) return null;

  return { status: mapped, awb: row.awb ?? null };
}

