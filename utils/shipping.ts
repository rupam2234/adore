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

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SHIPROCKET_BASE = "https://apiv2.shiprocket.in/v1/external";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const REQUEST_TIMEOUT_MS = 8000;

// Fallback pickup location (seller's warehouse PIN). Override via env.
const DEFAULT_PICKUP_PIN = process.env.SHIPROCKET_PICKUP_PINCODE ?? "560001";
const DEFAULT_WEIGHT_KG = 0.5;

export type PinCheckResult = {
  serviceable: boolean;
  etaDays: number | null;
  estimatedDelivery: string | null;
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
const TOKEN_CACHE_PATH = join(process.cwd(), ".shiprocket-token.json");
let tokenLoadAttempted = false;

function loadPersistedToken(): void {
  if (tokenLoadAttempted) return;
  tokenLoadAttempted = true;
  // An explicit env token always wins; nothing to load.
  if (process.env.SHIPROCKET_API) return;
  try {
    if (!existsSync(TOKEN_CACHE_PATH)) return;
    const { token, expiresAt } = JSON.parse(
      readFileSync(TOKEN_CACHE_PATH, "utf8"),
    ) as { token?: string; expiresAt?: number };
    if (
      typeof token === "string" &&
      typeof expiresAt === "number" &&
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
      "utf8",
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
      Buffer.from(jwt.split(".")[1]!, "base64").toString("utf8"),
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
const REDIS_TOKEN_KEY = "shiprocket:bearer";
const REDIS_TIMEOUT_MS = 3000;

function redisEnv(): { url: string; token: string } | null {
  // Accepts both Upstash's own variable names and Vercel KV's (Vercel KV is
  // Upstash under the hood — same REST API).
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

async function redisGetToken(): Promise<string | null> {
  const redis = redisEnv();
  if (!redis) return null;
  try {
    const res = await fetch(`${redis.url}/get/${REDIS_TOKEN_KEY}`, {
      headers: { Authorization: `Bearer ${redis.token}` },
      signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
      // Never let a stale shared token sit in any cache layer.
      cache: "no-store",
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
        method: "POST",
        headers: { Authorization: `Bearer ${redis.token}` },
        signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
      },
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
  return "Bearer ";
}

async function loginForToken(): Promise<string | null> {
  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;
  if (!email || !password) return null;
  if (Date.now() < loginBackoffUntil) return null;
  let res = await fetch(`${SHIPROCKET_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    // API Users authenticate via a different endpoint than main accounts.
    res = await fetch(`${SHIPROCKET_BASE}/auth/user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }
  if (!res.ok) {
    // Blocked / wrong credentials — back off (escalating) instead of retrying
    // every request. Shiprocket temporarily locks accounts that fail too often.
    loginFailureStreak += 1;
    const backoff = Math.min(LOGIN_BACKOFF_MS * 2 ** (loginFailureStreak - 1), LOGIN_BACKOFF_CAP_MS);
    loginBackoffUntil = Date.now() + backoff;
    console.error(
      `[shipping] Shiprocket login failed (status ${res.status}) — backing off for ${Math.round(backoff / 60000)} min`,
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

async function fetchServiceability(pin: string): Promise<Response> {
  const url =
    `${SHIPROCKET_BASE}/courier/serviceability/?` +
    new URLSearchParams({
      pickup_postcode: DEFAULT_PICKUP_PIN,
      delivery_postcode: pin,
      cod: "1",
      // The API expects `weight` (kg) — `order_weight` is rejected with
      // 400 "Weight Required".
      weight: String(DEFAULT_WEIGHT_KG),
    });
  return fetch(url, {
    headers: { Authorization: await authHeader() },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function checkWithShiprocket(pin: string): Promise<PinCheckResult> {
  let res = await fetchServiceability(pin);

  // Stale/expired/invalidated token → try email/password re-login once.
  // loginForToken() self-throttles via the back-off, so this is safe to
  // attempt on every 401 without risking a lock-out.
  if (res.status === 401) {
    bearerOverride = null;
    loginPromise = loginPromise ?? loginForToken();
    bearerOverride = await loginPromise;
    loginPromise = null;
    if (bearerOverride) res = await fetchServiceability(pin);
  }

  if (res.status === 401 || res.status === 403) {
    throw new ShippingUnavailableError("Shiprocket rejected credentials");
  }
  if (res.status === 429) {
    throw new ShippingUnavailableError("Rate limited by shipping provider");
  }
  if (!res.ok) {
    throw new ShippingUnavailableError(
      `Shipping provider error (${res.status})`,
    );
  }

  const body = (await res.json()) as ServiceabilityResponse;
  const couriers = body.data?.available_courier_companies ?? [];

  if (couriers.length === 0) {
    return { serviceable: false, etaDays: null, estimatedDelivery: null, cod: null };
  }

  // Fastest courier = the best promise we can make the customer.
  let etaDays: number | null = null;
  let estimatedDelivery: string | null = null;
  let cod = false;
  for (const c of couriers) {
    const etaNum = Number(c.estimated_delivery_days ?? c.eta);
    if (Number.isFinite(etaNum) && (etaDays === null || etaNum < etaDays)) {
      etaDays = etaNum;
      estimatedDelivery = (c.etd ?? c.estimated_delivery_date) ?? estimatedDelivery;
    }
    if (
      c.cod === 1 || c.cod === true ||
      c.cod_available === 1 || c.cod_available === true
    ) {
      cod = true;
    }
  }

  return { serviceable: true, etaDays, estimatedDelivery, cod };
}

export class ShippingUnavailableError extends Error {}

export async function checkPinServiceability(
  rawPin: string,
): Promise<PinCheckResult> {
  const pin = rawPin.trim();
  if (!/^\d{6}$/.test(pin)) {
    throw new ShippingUnavailableError("PIN must be a 6-digit number");
  }

  const hit = cache.get(pin);
  if (hit && hit.expiresAt > Date.now()) return hit.result;

  const result = await checkWithShiprocket(pin);

  // Bounded cache — evict the oldest entry when full.
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(pin, { result, expiresAt: Date.now() + CACHE_TTL_MS });
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
  items: Array<{ name: string; sku: string; units: number; sellingPrice: number }>;
  subTotal: number;
  discount: number;
};

export type ShiprocketOrderResult = {
  shiprocketOrderId: string;
  shipmentId: string | null;
};

// Seller warehouse pickup location name configured in the Shiprocket dashboard.
const PICKUP_LOCATION = process.env.SHIPROCKET_PICKUP_LOCATION ?? "Primary";
// Rough parcel dimensions (cm / g) — good enough for rate estimates.
const PARCEL_LENGTH_CM = 30;
const PARCEL_BREADTH_CM = 24;
const PARCEL_HEIGHT_CM = 6;
const PARCEL_WEIGHT_G_PER_UNIT = 400;

function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/);
  return { first: parts[0] ?? "Customer", last: parts.slice(1).join(" ") };
}

/**
 * Create a (prepaid) order in Shiprocket for fulfilment. Uses the same bearer
 * auth as serviceability, with one transparent re-login on a stale token.
 */
export async function createShiprocketOrder(
  input: ShiprocketOrderInput,
): Promise<ShiprocketOrderResult> {
  const { first, last } = splitName(input.customerName);
  const totalUnits = input.items.reduce((sum, i) => sum + i.units, 0);
  const payload = {
    order_id: input.orderNumber,
    order_date: new Date().toISOString().slice(0, 19).replace("T", " "),
    pickup_location: PICKUP_LOCATION,
    billing_customer_name: first,
    billing_last_name: last,
    billing_address: input.addressLine1,
    billing_address_2: input.addressLine2 ?? "",
    billing_city: input.city,
    billing_pincode: input.postalCode,
    billing_state: input.state,
    billing_country: input.country || "India",
    billing_email: input.email,
    billing_phone: input.phone.replace(/\D/g, "").slice(-10),
    shipping_is_billing: true,
    order_items: input.items.map((item) => ({
      name: item.name,
      sku: item.sku,
      units: item.units,
      selling_price: item.sellingPrice,
      discount: "",
    })),
    payment_method: "Prepaid",
    sub_total: input.subTotal,
    total_discount: input.discount,
    length: PARCEL_LENGTH_CM,
    breadth: PARCEL_BREADTH_CM,
    height: PARCEL_HEIGHT_CM,
    weight: PARCEL_WEIGHT_G_PER_UNIT * Math.max(1, totalUnits),
  };

  const bearer = await authHeader();
  const createOnce = (auth: string) =>
    fetch(`${SHIPROCKET_BASE}/orders/create/adhoc`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

  let res = await createOnce(bearer);

  // Stale/expired/invalidated token → try email/password re-login once.
  // loginForToken() self-throttles via the back-off, so this is safe to
  // attempt on every 401 without risking a lock-out.
  if (res.status === 401) {
    bearerOverride = null;
    loginPromise = loginPromise ?? loginForToken();
    bearerOverride = await loginPromise;
    loginPromise = null;
    if (bearerOverride) res = await createOnce(`Bearer ${bearerOverride}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ShiprocketOrderError(
      `Shiprocket order creation failed (${res.status}) ${detail.slice(0, 200)}`,
    );
  }

  const body = (await res.json()) as {
    order_id?: number | string;
    shipment_id?: number | string;
  };
  return {
    shiprocketOrderId: String(body.order_id ?? ""),
    shipmentId: body.shipment_id != null ? String(body.shipment_id) : null,
  };
}
