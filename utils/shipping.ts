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
// the API user blocked for "too many failed login attempts".
let loginBackoffUntil = 0;
const LOGIN_BACKOFF_MS = 10 * 60 * 1000;

type CourierCompany = {
  courier_name?: string;
  eta?: string;
  estimated_delivery_date?: string;
  cod_available?: number | boolean;
};

type ServiceabilityResponse = {
  data?: { available_courier_companies?: CourierCompany[] };
};

function authHeader(): string {
  if (bearerOverride && Date.now() < bearerExpiresAt) {
    return `Bearer ${bearerOverride}`;
  }
  bearerOverride = null;
  return `Bearer ${process.env.SHIPROCKET_API ?? ""}`;
}

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
    // Blocked / wrong credentials — back off instead of retrying every request.
    loginBackoffUntil = Date.now() + LOGIN_BACKOFF_MS;
    return null;
  }
  const data = (await res.json()) as { token?: string };
  const token = data.token ?? null;
  if (token) {
    bearerOverride = token;
    bearerExpiresAt = tokenExpiry(token);
    loginBackoffUntil = 0;
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
      order_weight: String(DEFAULT_WEIGHT_KG),
    });
  return fetch(url, {
    headers: { Authorization: authHeader() },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function checkWithShiprocket(pin: string): Promise<PinCheckResult> {
  let res = await fetchServiceability(pin);

  // Stale/expired dashboard token → try email/password re-login once.
  if (res.status === 401 && !bearerOverride) {
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
    const etaNum = Number(c.eta);
    if (Number.isFinite(etaNum) && (etaDays === null || etaNum < etaDays)) {
      etaDays = etaNum;
      estimatedDelivery = c.estimated_delivery_date ?? estimatedDelivery;
    }
    if (c.cod_available === 1 || c.cod_available === true) cod = true;
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
