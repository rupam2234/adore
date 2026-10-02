/**
 * Unit tests for the admin product VALIDATION layer.
 *
 * Run: node --test utils/admin-schema.test.ts
 *
 * Same convention as returns.test.ts / returns-state.test.ts — node:test, no
 * framework, no database.
 *
 * The colour-swatch cases exist because of a real production failure: the
 * swatch input is free text, but the database constrains it with
 *   CHECK (color_hex IS NULL OR color_hex ~ '^#[0-9A-Fa-f]{6}$')
 * Nothing validated the format in app code, so a malformed swatch sailed past
 * the 422 checkpoint, the product row committed, and the variant INSERT died —
 * surfacing as a bare "Failed to create product" 500 with an orphaned DRAFT
 * product left behind. These tests pin the normalisation that closes that gap.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeHex,
  validateProductPayload,
  buildSku,
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

// ---------------------------------------------------------------------------
// normalizeHex
// ---------------------------------------------------------------------------

test('canonical 6-digit hex passes through, uppercased', () => {
  assert.equal(normalizeHex('#DAC9C1'), '#DAC9C1');
  assert.equal(normalizeHex('#dac9c1'), '#DAC9C1');
});

test('a missing # is supplied', () => {
  // Users paste from Figma/colour pickers that omit the hash.
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
  assert.equal(normalizeHex(''), null);
  assert.equal(normalizeHex('   '), null);
  assert.equal(normalizeHex(null), null);
  assert.equal(normalizeHex(undefined), null);
});

test('unsalvageable values return undefined so they can be reported', () => {
  assert.equal(normalizeHex('#GGG'), undefined);
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

test('every normalised swatch satisfies the live DB regex', () => {
  // Mirrors product_variants.valid_color_hex. If this ever diverges from the
  // constraint, an INSERT will fail at runtime with an opaque 500 again.
  const dbRegex = /^#[0-9A-Fa-f]{6}$/;
  for (const input of ['#DAC9C1', '#dac9c1', 'dac9c1', '#fff', '#D9C', '  #DAC9C1  ']) {
    const out = normalizeHex(input);
    assert.notEqual(out, undefined, `${input} should be valid`);
    assert.match(out as string, dbRegex, `${input} -> ${out} must match DB regex`);
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

// ---------------------------------------------------------------------------
// SKU derivation
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

test('the slug is derived from the name when blank', () => {
  const result = validateProductPayload(payload({ slug: '' }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.slug, 'jonaki-short-kurti');
});
  }
});
  assert.equal(normalizeHex('#12345'), undefined);
  assert.equal(normalizeHex('#1234567'), undefined);
  // 8-digit hex carries an alpha channel the DB regex rejects.
  assert.equal(normalizeHex('#DAC9C1FF'), undefined);
  assert.equal(normalizeHex('blue'), undefined);
});