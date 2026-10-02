/**
 * Tests for the Shiprocket reverse-logistics adapter.
 *
 * Run: node --test utils/shipping-returns.test.ts
 *
 * WHY THIS FILE EXISTS
 * The first version of utils/shipping.ts was written from intuition and shipped
 * three endpoints that DO NOT EXIST. Verified against the live API on 2026-10-02:
 *
 *   POST /orders/create/rma          -> 404   (real: /orders/create/return)
 *   POST /orders/fetch_pickup_details-> 404   (real: /courier/generate/pickup)
 *   POST /orders/track/rma           -> 404   (real: GET /orders/processing/return)
 *
 * Every return would have failed at the first call. None of it type-checked, none
 * of it was unit-tested, and all of it would have been found the first time a
 * real customer pressed "Book pickup".
 *
 * These tests cannot hit the network, so they assert the contract that a unit
 * test CAN check: that each adapter targets the documented path, and that the
 * pickup is keyed on a return SHIPMENT id rather than an rma_id. The live
 * verification lives in scripts/probe-shiprocket.mjs, which asserts the paths are
 * actually routed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./shipping.ts', import.meta.url), 'utf8');

/** Extract the path literal passed to shiprocketPost/Get inside a function. */
function pathUsedIn(fnName: string): string | null {
  // Isolate the function body, then pull the first quoted path out of it.
  const start = src.indexOf(`export async function ${fnName}`);
  assert.ok(start > -1, `${fnName} not found`);
  const body = src.slice(start, src.indexOf('\n}', start));
  // Accepts 'single' or `template` quotes, and tolerates the argument being on
  // its own line — all three shapes appear in this file.
  const match = body.match(/shiprocket(?:Post|Get)\(\s*['`]([^'`]+)['`]/);
  return match ? match[1] : null;
}

test('createReturnOrder targets the documented endpoint', () => {
  // /orders/create/rma returns 404 on the live API.
  assert.equal(pathUsedIn('createReturnOrder'), '/orders/create/return');
});

test('scheduleReversePickup targets the documented endpoint', () => {
  // /orders/fetch_pickup_details returns 404 on the live API.
  assert.equal(pathUsedIn('scheduleReversePickup'), '/courier/generate/pickup');
});

test('fetchReturnTracking uses the documented GET endpoint', () => {
  // /orders/track/rma returns 404 on the live API.
  assert.equal(
    pathUsedIn('fetchReturnTracking'),
    '/orders/processing/return?return_status=ALL&per_page=100'
  );
});

test('no dead endpoint paths remain in the adapter', () => {
  for (const dead of [
    '/orders/create/rma',
    '/orders/fetch_pickup_details',
    '/orders/track/rma',
  ]) {
    assert.ok(
      !src.includes(`'${dead}'`),
      `${dead} is not a real Shiprocket endpoint and must not be called`
    );
  }
});

test('the pickup is keyed on a return shipment id, not an rma_id', () => {
  // The live endpoint answers {"message":"shipment_id is required"}.
  assert.ok(
    src.includes('shipment_id: input.shipmentId'),
    'pickup must send shipment_id'
  );
  assert.ok(
    !src.includes('rma_id: input.rmaId'),
    'pickup must not send rma_id'
  );
});

test('the return order carries both endpoints, as the API requires', () => {
  // /orders/create/return returns 422 listing every missing field. A thin
  // payload would be rejected at the one moment a customer is waiting.
  for (const field of [
    'pickup_customer_name',
    'pickup_address',
    'pickup_pincode',
    'pickup_phone',
    'shipping_customer_name',
    'shipping_address',
    'shipping_pincode',
    'order_items',
    'sub_total',
    'weight',
  ]) {
    assert.ok(
      src.includes(field),
      `return order payload must include ${field} (422 otherwise)`
    );
  }
});