/**
 * Tests for the modular LCG core.
 *
 * Run with: node --test
 *
 * Every assertion here corresponds to behaviour the implementation claims to
 * support. Parameters chosen for the sequence-correctness checks come from
 * published, well-known LCGs so the expected values can be derived by hand.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { LCG, validateParameters, MAX_SAFE_JS_INTEGER } from '../src/index.js';

// --- glibc LCG parameters (well-known, for sequence checks) ----------------
// m = 2^31, a = 1103515245, c = 12345. Hull–Dobell holds, period = 2^31.
const GLIBC = { modulus: 2 ** 31, multiplier: 1103515245, increment: 12345 };

// Minimal full-period LCG: m = 8, a = 5, c = 3, seed = 0. Period = 8.
// Hand-derived sequence: 3, 2, 5, 4, 7, 6, 1, 0, then repeats.
const MINIMAL = { modulus: 8, multiplier: 5, increment: 3, seed: 0 };

describe('validateParameters', () => {
  it('accepts the minimal full-period parameters', () => {
    assert.doesNotThrow(() => validateParameters(8, 5, 3, 0));
  });

  it('rejects a zero modulus', () => {
    assert.throws(
      () => validateParameters(0, 0, 0, 0),
      /modulus must be positive/,
    );
  });

  it('rejects multiplier >= modulus', () => {
    assert.throws(
      () => validateParameters(8, 8, 0, 0),
      /multiplier must satisfy/,
    );
  });

  it('rejects increment >= modulus', () => {
    assert.throws(
      () => validateParameters(8, 1, 8, 0),
      /increment must satisfy/,
    );
  });

  it('rejects seed >= modulus', () => {
    assert.throws(
      () => validateParameters(8, 1, 0, 8),
      /seed must satisfy/,
    );
  });

  it('rejects non-integer parameters', () => {
    assert.throws(() => validateParameters(8.5, 1, 0, 0), /must be an integer/);
    assert.throws(() => validateParameters(8, 1.5, 0, 0), /must be an integer/);
    assert.throws(() => validateParameters('8', 1, 0, 0), /must be an integer/);
    assert.throws(() => validateParameters(8, 1, 0, null), /must be an integer/);
  });

  it('rejects parameters exceeding MAX_SAFE_INTEGER', () => {
    const too = MAX_SAFE_JS_INTEGER + 2; // exceeds the accepted range
    assert.throws(() => validateParameters(too, 0, 0, 0), /must be in/);
  });
});

describe('LCG construction', () => {
  it('stores the original numeric parameters', () => {
    const g = new LCG(MINIMAL);
    assert.equal(g.modulus, 8);
    assert.equal(g.multiplier, 5);
    assert.equal(g.increment, 3);
  });

  it('does not mutate the passed-in object', () => {
    const params = { ...MINIMAL };
    const g = new LCG(params); // eslint-disable-line no-unused-vars
    assert.deepEqual(params, MINIMAL);
  });
});

describe('LCG.next sequence', () => {
  it('produces the hand-derived minimal sequence for m=8 a=5 c=3', () => {
    const g = new LCG(MINIMAL);
    const expected = [3, 2, 5, 4, 7, 6, 1, 0];
    const actual = [];
    for (let i = 0; i < 8; i++) actual.push(g.next());
    assert.deepEqual(actual, expected);
  });

  it('repeats after one full period for the minimal LCG', () => {
    const g = new LCG(MINIMAL);
    const first = g.next();
    for (let i = 0; i < 7; i++) g.next(); // 8 steps total → back to seed
    assert.equal(g.next(), first); // 9th step == 1st step
  });

  it('matches a glibc LCG step computed by hand', () => {
    // seed = 1 → next = (1103515245 * 1 + 12345) mod 2^31 = 1103527590.
    const g = new LCG({ ...GLIBC, seed: 1 });
    assert.equal(g.next(), 1103527590);
  });

  it('keeps results within [0, modulus) for a long run', () => {
    const g = new LCG({ ...GLIBC, seed: 42 });
    let prev = 42;
    for (let i = 0; i < 1000; i++) {
      const v = g.next();
      assert.ok(v >= 0 && v < GLIBC.modulus, `out of range at step ${i}: ${v}`);
      assert.notEqual(v, prev); // sanity: not stuck
      prev = v;
    }
  });
});

describe('LCG state', () => {
  it('getState returns the seed before any next() call', () => {
    const g = new LCG(MINIMAL);
    assert.equal(g.getState(), 0);
  });

  it('getState reflects the most recent next() result', () => {
    const g = new LCG(MINIMAL);
    const v = g.next();
    assert.equal(g.getState(), v);
  });

  it('setState restores a previous state and resumes the sequence', () => {
    const g = new LCG({ ...GLIBC, seed: 7 });
    const snap = g.getState();
    const a = g.next();
    const b = g.next();
    g.setState(snap);
    assert.equal(g.next(), a);
    assert.equal(g.next(), b);
  });

  it('setState rejects out-of-range state values', () => {
    const g = new LCG(MINIMAL);
    assert.throws(() => g.setState(8), /state must satisfy/);
    assert.throws(() => g.setState(-1), /must be an integer|must be in/);
    assert.throws(() => g.setState(1.5), /must be an integer/);
  });
});

describe('LCG.take', () => {
  it('returns an array of the requested length', () => {
    const g = new LCG(MINIMAL);
    const out = g.take(4);
    assert.equal(out.length, 4);
    assert.deepEqual(out, [3, 2, 5, 4]);
  });

  it('returns an empty array for count = 0', () => {
    const g = new LCG(MINIMAL);
    assert.deepEqual(g.take(0), []);
  });

  it('rejects negative count', () => {
    const g = new LCG(MINIMAL);
    assert.throws(() => g.take(-1), /count must be non-negative/);
  });

  it('rejects non-integer count', () => {
    const g = new LCG(MINIMAL);
    assert.throws(() => g.take(2.5), /count must be an integer/);
  });
});

describe('LCG.hasFullPeriod', () => {
  it('returns true for the minimal Hull–Dobell parameters', () => {
    const g = new LCG(MINIMAL);
    assert.equal(g.hasFullPeriod(), true);
  });

  it('returns true for the glibc parameters', () => {
    const g = new LCG({ ...GLIBC, seed: 0 });
    assert.equal(g.hasFullPeriod(), true);
  });

  it('returns false when c shares a factor with m', () => {
    // m = 8, a = 5, c = 2 (gcd(2,8)=2 ≠ 1) → condition 1 fails.
    const g = new LCG({ modulus: 8, multiplier: 5, increment: 2, seed: 0 });
    assert.equal(g.hasFullPeriod(), false);
  });

  it('returns false when (a-1) is not divisible by a prime factor of m', () => {
    // m = 9 (prime factor 3), a = 3 → a-1 = 2, not divisible by 3.
    const g = new LCG({ modulus: 9, multiplier: 3, increment: 1, seed: 0 });
    assert.equal(g.hasFullPeriod(), false);
  });

  it('returns false for multiplicative LCGs (c = 0)', () => {
    const g = new LCG({ modulus: 8, multiplier: 5, increment: 0, seed: 1 });
    assert.equal(g.hasFullPeriod(), false);
  });
});

describe('LCG.computePeriod', () => {
  it('returns modulus for the minimal full-period LCG', () => {
    const g = new LCG(MINIMAL);
    assert.equal(g.computePeriod(), 8);
  });

  it('returns a value less than modulus for non-Hull–Dobell parameters', () => {
    // m = 8, a = 5, c = 2: gcd(2,8)=2, so the period is m/gcd(c,m) = 4
    // when a-1 is divisible by all prime factors of m (here a-1=4, prime
    // factor of m is 2; 4 is divisible by 2). With 4|m and 4|(a-1), the
    // period is m / gcd(c, m) = 8/2 = 4.
    const g = new LCG({ modulus: 8, multiplier: 5, increment: 2, seed: 0 });
    assert.equal(g.computePeriod(), 4);
  });

  it('detects a fixed point (period 1) when a=1, c=0', () => {
    // X[n+1] = X[n] for all n → period is 1.
    const g = new LCG({ modulus: 8, multiplier: 1, increment: 0, seed: 3 });
    assert.equal(g.computePeriod(), 1);
  });
});
