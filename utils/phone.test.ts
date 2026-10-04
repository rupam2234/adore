/**
 * Unit tests for phone normalisation.
 *
 * Run: node --test utils/phone.test.ts
 *
 * The one-account-per-phone guarantee is a unique index, and a unique index
 * compares bytes. That makes normalisePhone load-bearing rather than cosmetic:
 * if '9876543210' and '+91 98765 43210' normalise differently, the same person
 * can register two accounts and the abuse this feature exists to prevent walks
 * straight through it. These tests are the assertion that they do not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isCanonicalPhone, normalisePhone } from './phone.ts';

test('accepts a plain 10-digit number', () => {
  assert.equal(normalisePhone('9876543210'), '9876543210');
});

test('strips the separators people actually type', () => {
  const expected = '9876543210';
  for (const input of [
    '98765 43210',
    '98765-43210',
    '(98765) 43210',
    '987 654 3210',
    '+91 98765 43210',
    '+91-98765-43210',
    '091 98765 43210',
    '  98765 43210  ',
  ]) {
    assert.equal(normalisePhone(input), expected, `failed for ${input}`);
  }
});

test('every spelling of one number collapses to one value', () => {
  // This is the property the unique index depends on.
  const spellings = [
    '9876543210',
    '+91 9876543210',
    '91-9876543210',
    '09876543210',
    '(098765) 43210',
  ];
  const normalised = new Set(spellings.map(s => normalisePhone(s)));
  assert.equal(normalised.size, 1);
});

test('different numbers stay different', () => {
  assert.notEqual(normalisePhone('9876543210'), normalisePhone('9876543211'));
});

test('rejects too-short input', () => {
  for (const input of ['987654321', '12345', '9']) {
    assert.equal(normalisePhone(input), null, `should reject ${input}`);
  }
});

test('rejects letters and junk', () => {
  for (const input of [
    'not a phone',
    '98765abcde',
    'call me maybe',
    '9876543210 ext 5',
    '+91-98765-43210/2',
  ]) {
    assert.equal(normalisePhone(input), null, `should reject ${input}`);
  }
});

test('rejects empty and non-string input', () => {
  for (const input of ['', '   ', null, undefined, 9876543210, {}, []]) {
    assert.equal(normalisePhone(input), null);
  }
});

test('rejects absurdly long digit runs', () => {
  // The ceiling is what stops a long junk string from being truncated onto a
  // real number and inheriting its discount.
  assert.equal(normalisePhone('98765432109999999999999'), null);
  assert.equal(normalisePhone('9999999999999999999999'), null);
});

test('accepts the longest legitimate international form', () => {
  // 13 digits is the documented ceiling and must still normalise.
  assert.equal(normalisePhone('+91 98765 43210'), '9876543210');
});

test('isCanonicalPhone identifies already-normalised values', () => {
  assert.equal(isCanonicalPhone('9876543210'), true);
  assert.equal(isCanonicalPhone('+91 9876543210'), false);
  assert.equal(isCanonicalPhone(''), false);
  assert.equal(isCanonicalPhone(null), false);
});