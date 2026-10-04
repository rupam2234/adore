/**
 * Unit tests for the random-selection helpers.
 *
 * Run: node --test utils/random.test.ts
 *
 * These matter because the property that is easy to get wrong is not "returns
 * N items" — it is "returns N DISTINCT items". A naive implementation that
 * draws with replacement passes every count-based assertion while showing the
 * same product twice on a four-card row.
 *
 * Every test injects a deterministic `rng` instead of using Math.random, so the
 * suite cannot flake and a failure is always reproducible.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sampleWithoutReplacement, type Rng } from './random.ts';

/**
 * Deterministic pseudo-RNG (mulberry32). Same seed → same sequence, forever.
 * Keeps assertions about ORDER exact while still exercising the real algorithm.
 */
function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOL = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

/* --- The core guarantee: distinct items ------------------------------------ */

test('returns exactly the requested count', () => {
  for (let seed = 0; seed < 200; seed++) {
    assert.equal(sampleWithoutReplacement(POOL, 4, seeded(seed)).length, 4);
  }
});

test('never repeats an item', () => {
  // The whole point. 500 trials across different seeds, because a
  // with-replacement bug shows up intermittently rather than every time.
  for (let seed = 0; seed < 500; seed++) {
    const picked = sampleWithoutReplacement(POOL, 4, seeded(seed));
    assert.equal(new Set(picked).size, picked.length, `duplicate in seed ${seed}`);
  }
});

test('picking more than the pool contains returns everything, once each', () => {
  const picked = sampleWithoutReplacement(POOL, 20, seeded(7));
  assert.equal(picked.length, POOL.length);
  assert.deepEqual([...picked].sort(), [...POOL].sort());
});

/* --- Degenerate inputs ------------------------------------------------------ */

test('zero or negative counts return nothing', () => {
  assert.deepEqual(sampleWithoutReplacement(POOL, 0, seeded(1)), []);
  assert.deepEqual(sampleWithoutReplacement(POOL, -5, seeded(1)), []);
});

test('an empty pool returns an empty array', () => {
  assert.deepEqual(sampleWithoutReplacement([], 4, seeded(1)), []);
});

test('a single-item pool returns that item', () => {
  assert.deepEqual(sampleWithoutReplacement(['only'], 4, seeded(1)), ['only']);
});

test('count equal to length is a full shuffle, still no repeats', () => {
  const picked = sampleWithoutReplacement(POOL, POOL.length, seeded(3));
  assert.deepEqual([...picked].sort(), [...POOL].sort());
});

/* --- Purity ----------------------------------------------------------------- */

test('the input array is never mutated', () => {
  const input = [...POOL];
  sampleWithoutReplacement(input, 4, seeded(11));
  assert.deepEqual(input, POOL, 'input was reordered');
});

test('a constant rng at either extreme does not hang or duplicate', () => {
  // Guards randomInt against the two degenerate inputs. A rng pinned to exactly
  // 0 must map to index 0 rather than spinning in the rejection loop forever,
  // and one pinned just under 1 must still land inside the array rather than
  // indexing past the end. Either failure would hang or throw, not fail softly.
  for (const edge of [() => 0, () => 0.999999999]) {
    const picked = sampleWithoutReplacement(POOL, 4, edge);
    assert.equal(picked.length, 4);
    assert.equal(new Set(picked).size, 4);
  }
});