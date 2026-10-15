// retry-shiprocket.mjs — retry Shiprocket push for a specific order
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

let url = process.env.adore_DATABASE_URL;
if (!url) {
  const env = readFileSync('.env.local', 'utf8');
  const line = env
    .split('\n')
    .find(l => l.trim().startsWith('adore_DATABASE_URL='));
  url = line
    ?.split('=')[1]
    ?.replace(/^["']|["']$/g, '');
}
if (!url) throw new Error('adore_DATABASE_URL not found');

// Load other env vars from .env.local
{
  const env = readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    value = value.replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

const sql = neon(url);

const SHIPROCKET_BASE = 'https://apiv2.shiprocket.in/v1/external';
const PARCEL_LENGTH_CM = 30;
const PARCEL_BREADTH_CM = 24;
const PARCEL_HEIGHT_CM = 6;
const PARCEL_WEIGHT_G_PER_UNIT = 400;
const PICKUP_LOCATION = process.env.SHIPROCKET_PICKUP_LOCATION ?? 'home';

let shiprocketToken = null;
let tokenExpiry = 0;

async function getShiprocketToken() {
  const now = Date.now();
  if (shiprocketToken && now < tokenExpiry - 60_000) return shiprocketToken;

  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;
  if (!email || !password) throw new Error('Shiprocket credentials not configured');

  const res = await fetch(`${SHIPROCKET_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Shiprocket login failed (${res.status}) ${detail.slice(0, 200)}`);
  }

  const body = (await res.json());
  shiprocketToken = body.token ?? '';
  tokenExpiry = now + (body.expires_in ?? 86400) * 1000;
  return shiprocketToken;
}

async function shiprocketPost(path, payload) {
  const token = await getShiprocketToken();
  return fetch(`${SHIPROCKET_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  return { first: parts[0] ?? 'Customer', last: parts.slice(1).join(' ') };
}

async function createShiprocketOrder(input) {
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
    // Shiprocket's weight is in KG; stored values are grams.
    weight:
      input.items.reduce(
        (sum, i) =>
          sum +
          (i.weightGrams != null && i.weightGrams > 0
            ? i.weightGrams
            : PARCEL_WEIGHT_G_PER_UNIT) *
          i.units,
        0
      ) / 1000,
  };

  const res = await shiprocketPost('/orders/create/adhoc', payload);

  console.log('Shiprocket response status:', res.status);

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Shiprocket order creation failed (${res.status}) ${detail.slice(0, 200)}`);
  }

  const body = (await res.json());
  console.log('Shiprocket response body:', JSON.stringify(body, null, 2));
  return {
    shiprocketOrderId: String(body.order_id ?? ''),
    shipmentId: body.shipment_id != null ? String(body.shipment_id) : null,
  };
}

async function main() {
  const orderId = 'c9c15000-655c-4645-885b-25764a7fe55d';
  const orderNumber = 'AD-MV9KCS49B3HX';

  console.log(`Retrying Shiprocket push for order ${orderNumber}...`);

  try {
    const orderRows = await sql`
      SELECT * FROM orders WHERE id = ${orderId} LIMIT 1
    `;
    if (!orderRows.length) {
      console.log('Order not found');
      return;
    }
    const order = orderRows[0];
    console.log('Order:', order.order_number, order.status, order.total_amount);

    const customerRows = await sql`
      SELECT * FROM customers WHERE id = ${order.customer_id} LIMIT 1
    `;
    const customer = customerRows[0];
    if (!customer) {
      console.log('Customer not found');
      return;
    }
    console.log('Customer:', customer.email);

    const items = await sql`
      SELECT * FROM order_items WHERE order_id = ${orderId}
    `;
    console.log('Items:', items.length);

    const productIds = items.map(i => i.product_id);
    const weightRows = productIds.length
      ? await sql.query(
          `SELECT id, weight_grams FROM products WHERE id = ANY($1)`,
          [productIds]
        )
      : [];
    const weightById = new Map(weightRows.map(w => [w.id, w.weight_grams]));

    const snap = order.shipping_address_snapshot ?? {};
    const customerName =
      snap.fullName ||
      [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') ||
      customer?.email ||
      'Customer';

    const shiprocketInput = {
      orderNumber: order.order_number,
      customerName,
      phone: snap.phone || customer?.phone || '',
      email: customer?.email ?? '',
      addressLine1: snap.addressLine1 ?? '',
      addressLine2: snap.addressLine2 ?? null,
      city: snap.city ?? '',
      state: snap.state ?? '',
      postalCode: snap.postalCode ?? '',
      country: snap.country || 'India',
      items: items.map(item => ({
        name: item.product_name,
        sku: item.sku,
        units: item.quantity,
        sellingPrice: Number(item.unit_price),
        weightGrams: weightById.get(item.product_id) ?? null,
      })),
      subTotal: Number(order.subtotal),
      discount: Number(order.discount_amount),
    };

    console.log('Creating Shiprocket order...');

    const result = await createShiprocketOrder(shiprocketInput);

    if (result.shiprocketOrderId) {
      console.log(`Success! Shiprocket Order ID: ${result.shiprocketOrderId}`);

      await sql`
        UPDATE orders
        SET shiprocket_order_id = ${result.shiprocketOrderId}, updated_at = NOW()
        WHERE id = ${orderId}
      `;
      console.log('Database updated');
    } else {
      console.log('Failed - no Shiprocket order ID returned');
    }
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err);
  }
}

main();