/**
 * Unit tests for the admin product VALIDATION layer.
 *
 * Run: node --test utils/admin-schema.test.ts
 *
 * Same convention as returns.test.ts / returns-state.test.ts — node:test, no
 * framework, no database.
 *
 * These tests exist because two production failures shared one root cause: the
 * database enforces constraints that nothing in utils/admin-schema.ts mirrors.
 *
 *  1. products.color_hex is CHECK-constrained to '^#[0-9A-Fa-f]{6}$'. The swatch
 *     input is free text, so a malformed value passed validation, committed the
 *     product row, then killed the variant INSERT.
 *  2. products.fit was varchar(50). Real prose ("Relaxed fit. Three-quarter bell
 *     sleeves. Side slits at the hem.", 63 chars) overflowed it → SQLSTATE 22001.
 *
 * In both cases the user saw a bare "Failed to create product" 500. The column
 * limits are now mirrored in validateProductPayload() (PRODUCT_FIELD_LIMITS), so
 * the failures land at the 422 checkpoint with a per-field message instead.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeHex,
  validateProductPayload,
  buildSku,
  PRODUCT_FIELD_LIMITS,
} from './admin-schema.ts';

/** Minimal valid payload; spread and override per test. */
function payload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Jonaki Short Kurti',
    slug: '',
    variants: [
      { color: 'Dusty Rose', colorHex: '#DAC9C1', size: 'M', price: '2499' },
    ],
    ...overrides,
  };
}

/** True when any error is keyed to `field`, or its message names the field. */
function reportsField(errors: Record<string, string>, field: string): boolean {
  return Object.entries(errors).some(
    ([key, msg]) => key === field || msg.includes(field)
  );
}

// ---------------------------------------------------------------------------
// normalizeHex — the colour swatch
// ---------------------------------------------------------------------------

test('canonical 6-digit hex passes through, uppercased', () => {
  assert.equal(normalizeHex('#DAC9C1'), '#DAC9C1');
  assert.equal(normalizeHex('#dac9c1'), '#DAC9C1');
});

test('a missing # is supplied', () => {
  // Colour pickers and Figma exports routinely omit the hash.
  assert.equal(normalizeHex('dac9c1'), '#DAC9C1');
});

test('3-digit shorthand is expanded, matching CSS semantics', () => {
  assert.equal(normalizeHex('#fff'), '#FFFFFF');
  assert.equal(normalizeHex('#abc'), '#AABBCC');
  assert.equal(normalizeHex('#D9C'), '#DD99CC');
});

test('surrounding and interior whitespace is stripped', () => {
  assert.equal(normalizeHex('  #DAC9C1  '), '#DAC9C1');
  assert.equal(normalizeHex('#DA C9 C1'), '#DAC9C1');
});

test('blank input means unset, not invalid', () => {
  // optionalStr() maps '' to NULL too, so a blank field is never a DB error.
  assert.equal(normalizeHex(''), null);
  assert.equal(normalizeHex('   '), null);
  assert.equal(normalizeHex(null), null);
  assert.equal(normalizeHex(undefined), null);
});

test('unsalvageable values return undefined so they can be reported', () => {
  assert.equal(normalizeHex('#GGG'), undefined);
  assert.equal(normalizeHex('#12345'), undefined);
  assert.equal(normalizeHex('#1234567'), undefined);
  // 8-digit hex carries an alpha channel the DB regex rejects.
  assert.equal(normalizeHex('#DAC9C1FF'), undefined);
  assert.equal(normalizeHex('blue'), undefined);
});

test('every normalised swatch satisfies the live DB regex', () => {
  // Mirrors product_variants.valid_color_hex. If this ever diverges from the
  // constraint, an INSERT will fail at runtime with an opaque 500 again.
  const dbRegex = /^#[0-9A-Fa-f]{6}$/;
  for (const input of ['#DAC9C1', '#dac9c1', 'dac9c1', '#fff', '#D9C', '  #DAC9C1  ']) {
    const out = normalizeHex(input);
    assert.notEqual(out, undefined, `${input} should be valid`);
    assert.match(out as string, dbRegex, `${input} -> ${out} must match DB regex`);
  }
});
// ---------------------------------------------------------------------------
// validateProductPayload — swatch handling
// ---------------------------------------------------------------------------

test('a malformed swatch fails validation with a per-field message', () => {
  const result = validateProductPayload(
    payload({
      variants: [
        { color: 'Dusty Rose', colorHex: '#DAC9C1FF', size: 'M', price: '2499' },
      ],
    })
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(
    result.errors['variants.0.colorHex'],
    'expected a colorHex field error so the form can highlight the swatch input'
  );
});

test('a swatch lacking a # is normalised, not rejected', () => {
  const result = validateProductPayload(
    payload({
      variants: [{ color: 'Dusty Rose', colorHex: 'dac9c1', size: 'M', price: '2499' }],
    })
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.variants[0].colorHex, '#DAC9C1');
});

test('a blank swatch is preserved as null', () => {
  const result = validateProductPayload(
    payload({
      variants: [{ color: 'Dusty Rose', colorHex: '', size: 'M', price: '2499' }],
    })
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.variants[0].colorHex, null);
});
// ---------------------------------------------------------------------------
// Postgres varchar limits
//
// These limits exist ONLY in the database — Drizzle's text() helper carries no
// length — so exceeding them aborted the INSERT with SQLSTATE 22001 and a bare
// 500, after the product row had already committed. products.fit was varchar(50)
// and has since been widened to text (scripts/add-product-text-limits.sql);
// name/slug/material still carry real limits.
// ---------------------------------------------------------------------------

test('an over-long material is rejected with a field message', () => {
  const result = validateProductPayload(
    payload({ material: 'x'.repeat(PRODUCT_FIELD_LIMITS.material + 1) })
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(reportsField(result.errors, 'material'));
});

test('material at exactly its limit is accepted', () => {
  // Guards the comparison itself: an off-by-one would reject valid copy.
  const result = validateProductPayload(
    payload({ material: 'x'.repeat(PRODUCT_FIELD_LIMITS.material) })
  );
  assert.equal(result.ok, true);
});

test('an over-long name is rejected', () => {
  const result = validateProductPayload(payload({ name: 'n'.repeat(121) }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(reportsField(result.errors, 'name'));
});

test('an over-long slug is rejected', () => {
  const result = validateProductPayload(payload({ name: 'a'.repeat(400) }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(reportsField(result.errors, 'slug'));
});

test('the 63-char fit prose that broke production now validates', () => {
  // Regression guard: this exact string failed with "value too long for type
  // character varying(50)" and produced the original bug report.
  const fit = 'Relaxed fit. Three-quarter bell sleeves. Side slits at the hem.';
  const result = validateProductPayload(payload({ fit }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.fit, fit);
});

test('long prose fields are not length-capped in app code', () => {
  // short_description / story / care_instructions are unlimited `text` in the DB.
  // Truncating them here would silently lose copy.
  const result = validateProductPayload(
    payload({
      shortDescription: 'a'.repeat(600),
      story: 'b'.repeat(600),
      careInstructions: 'c'.repeat(600),
    })
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.story?.length, 600);
});

// ---------------------------------------------------------------------------
// Pre-existing validation behaviour (regression guard)
// ---------------------------------------------------------------------------

test('a valid product payload passes', () => {
  const result = validateProductPayload(payload());
  assert.equal(result.ok, true);
});

test('duplicate colour/size is rejected', () => {
  const result = validateProductPayload(
    payload({
      variants: [
        { color: 'Dusty Rose', colorHex: '#DAC9C1', size: 'M', price: '2499' },
        { color: 'Dusty Rose', colorHex: '#DAC9C1', size: 'M', price: '2999' },
      ],
    })
  );
  assert.equal(result.ok, false);
});

test('at least one variant is required', () => {
  const result = validateProductPayload(payload({ variants: [] }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.variants);
});

test('the slug is derived from the name when blank', () => {
  const result = validateProductPayload(payload({ slug: '' }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.slug, 'jonaki-short-kurti');
});

// ---------------------------------------------------------------------------
// SKU derivation
//
// sku is UNIQUE GLOBALLY (product_variants_sku_key), so its shape matters:
// a collision is a hard INSERT failure, not a soft duplicate.
// ---------------------------------------------------------------------------

test('a multi-word colour yields a clean, stable SKU', () => {
  assert.equal(
    buildSku('jonaki-short-kurti', {
      color: 'Dusty Rose',
      colorHex: '#DAC9C1',
      size: 'M',
      price: 2499,
      compareAtPrice: null,
      stock: 0,
    }),
    'jonaki-short-kurti-dusty-rose-m'
  );
});

test('the SKU is lowercase and hyphen-separated regardless of input case', () => {
  assert.equal(
    buildSku('Jonaki-Short-Kurti', {
      color: 'DUSTY ROSE',
      colorHex: '#DAC9C1',
      size: 'M',
      price: 2499,
      compareAtPrice: null,
      stock: 0,
    }),
    'jonaki-short-kurti-dusty-rose-m'
  );
});