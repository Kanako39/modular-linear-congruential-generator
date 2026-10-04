/**
 * Core implementation of a modular Linear Congruential Generator (LCG).
 *
 * An LCG produces a sequence of integers via the recurrence
 *
 *     X[n+1] = (a * X[n] + c) mod m
 *
 * where m is the modulus, a the multiplier, c the increment, and X[0] the
 * seed. The generator is deterministic and, for well-chosen parameters, has a
 * full period of m when Hull–Dobell conditions hold.
 *
 * Design note on Number vs BigInt: all parameters must be safe integers
 * (|value| <= 2^53 - 1). We reject anything larger rather than silently
 * coercing to a float and losing low-order bits, which would corrupt the
 * sequence. For the common parametrisations (glibc, Java.util.Random, MMIX)
 * this is sufficient; for cryptographic-strength moduli the caller should use
 * a BigInt-based library instead.
 */

/**
 * Largest integer n such that n and n+1 are both exactly representable as a
 * JavaScript Number. Used as the upper bound for accepted parameters.
 */
export const MAX_SAFE_JS_INTEGER = Number.MAX_SAFE_INTEGER; // 2^53 - 1

const TWO_TO_53 = 2n ** 53n;

/**
 * Throws a TypeError when a parameter is out of range or not an integer.
 *
 * @param {number} value - the candidate parameter
 * @param {string} name - human-readable name for the error message
 * @param {number} lower - inclusive lower bound (may be 0)
 * @throws {TypeError} when value is not a safe integer in [lower, MAX_SAFE_JS_INTEGER]
 */
function assertIntegerParameter(value, name, lower) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer; got ${typeof value === 'number' ? value : typeof value}`);
  }
  if (value < lower || value > MAX_SAFE_JS_INTEGER) {
    throw new TypeError(`${name} must be in [${lower}, ${MAX_SAFE_JS_INTEGER}]; got ${value}`);
  }
}

/**
 * Validates LCG parameters without constructing a generator.
 *
 * Kept separate from the constructor so callers can pre-flight user-supplied
 * parameters (e.g. from a config file) and surface errors before any state is
 * allocated.
 *
 * @param {number} modulus
 * @param {number} multiplier
 * @param {number} increment
 * @param {number} seed
 * @throws {TypeError} if any value is not a safe integer in its valid range
 * @throws {TypeError} if modulus <= 0
 * @throws {TypeError} if 0 <= multiplier < modulus is violated
 * @throws {TypeError} if 0 <= increment < modulus is violated
 * @throws {TypeError} if 0 <= seed < modulus is violated
 */
export function validateParameters(modulus, multiplier, increment, seed) {
  assertIntegerParameter(modulus, 'modulus', 0);
  if (modulus === 0) {
    throw new TypeError('modulus must be positive; got 0');
  }
  assertIntegerParameter(multiplier, 'multiplier', 0);
  assertIntegerParameter(increment, 'increment', 0);
  assertIntegerParameter(seed, 'seed', 0);
  if (multiplier >= modulus) {
    throw new TypeError(`multiplier must satisfy 0 <= multiplier < modulus; got multiplier=${multiplier}, modulus=${modulus}`);
  }
  if (increment >= modulus) {
    throw new TypeError(`increment must satisfy 0 <= increment < modulus; got increment=${increment}, modulus=${modulus}`);
  }
  if (seed >= modulus) {
    throw new TypeError(`seed must satisfy 0 <= seed < modulus; got seed=${seed}, modulus=${modulus}`);
  }
}

/**
 * Tests divisibility using BigInt to avoid floating-point rounding in the
 * modulo operator on large numbers.
 *
 * @param {bigint} big - dividend
 * @param {number} small - small integer divisor
 * @returns {boolean} true iff `big` is divisible by `small`
 */
function divisibleBySmall(big, small) {
  if (small === 1) return true;
  if (small === 2) return (big & 1n) === 0n;
  if (small === 4) return (big & 3n) === 0n;
  return big % BigInt(small) === 0n;
}

/**
 * Computes the greatest common divisor of two non-negative integers using
 * the binary algorithm. BigInt is used because the inputs may exceed 2^53.
 *
 * @param {bigint} a
 * @param {bigint} b
 * @returns {bigint}
 */
function gcd(a, b) {
  if (a === 0n) return b;
  if (b === 0n) return a;
  let shift = 0n;
  while (((a | b) & 1n) === 0n) {
    a >>= 1n;
    b >>= 1n;
    shift += 1n;
  }
  while ((a & 1n) === 0n) a >>= 1n;
  do {
    while ((b & 1n) === 0n) b >>= 1n;
    if (a > b) {
      const tmp = a;
      a = b;
      b = tmp;
    }
    b -= a;
  } while (b !== 0n);
  return a << shift;
}

/**
 * Computes the number of distinct prime factors of n (with multiplicity).
 * Used for a partial Hull–Dobell check — see {@link LCG#hasFullPeriod}.
 *
 * @param {bigint} n - value to factorise (n >= 1)
 * @returns {number} count of prime factors counted with multiplicity
 */
function countPrimeFactors(n) {
  let count = 0;
  let x = n;
  for (let p = 2n; p * p <= x; p += 1n) {
    while (x % p === 0n) {
      count += 1;
      x /= p;
    }
  }
  if (x > 1n) count += 1;
  return count;
}

/**
 * Returns the distinct prime factors of n.
 *
 * @param {bigint} n - value to factorise (n >= 1)
 * @returns {bigint[]} array of distinct primes dividing n
 */
function distinctPrimeFactors(n) {
  const factors = [];
  let x = n;
  for (let p = 2n; p * p <= x; p += 1n) {
    if (x % p === 0n) {
      factors.push(p);
      while (x % p === 0n) x /= p;
    }
  }
  if (x > 1n) factors.push(x);
  return factors;
}

/**
 * Computes a^e mod m using right-to-left binary exponentiation.
 *
 * @param {bigint} a - base
 * @param {bigint} e - exponent (e >= 0)
 * @param {bigint} m - modulus (m > 0)
 * @returns {bigint} a^e mod m
 */
function modPow(a, e, m) {
  let result = 1n % m;
  let base = ((a % m) + m) % m;
  let exp = e;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % m;
    base = (base * base) % m;
    exp >>= 1n;
  }
  return result;
}

/**
 * A deterministic pseudorandom integer generator using the linear congruential
 * recurrence X[n+1] = (a * X[n] + c) mod m.
 *
 * The arithmetic is performed with BigInt internally so that the full
 * 2^53 parameter space is exact; results are narrowed back to Number on
 * output, which is safe because modulus <= 2^53 - 1.
 */
export class LCG {
  #modulusBig;
  #multiplierBig;
  #incrementBig;
  #stateBig;

  /**
   * @param {object} params
   * @param {number} params.modulus - m, must be a positive safe integer
   * @param {number} params.multiplier - a, must satisfy 0 <= a < m
   * @param {number} params.increment - c, must satisfy 0 <= c < m
   * @param {number} params.seed - X[0], must satisfy 0 <= seed < m
   */
  constructor({ modulus, multiplier, increment, seed }) {
    validateParameters(modulus, multiplier, increment, seed);
    this.#modulusBig = BigInt(modulus);
    this.#multiplierBig = BigInt(multiplier);
    this.#incrementBig = BigInt(increment);
    this.#stateBig = BigInt(seed);
    // Store the original Number parameters for introspection.
    this.modulus = modulus;
    this.multiplier = multiplier;
    this.increment = increment;
  }

  /**
   * Advances the generator one step and returns the new state as a Number.
   *
   * @returns {number} the next value X[n+1], in [0, modulus)
   */
  next() {
    this.#stateBig = (this.#multiplierBig * this.#stateBig + this.#incrementBig) % this.#modulusBig;
    return Number(this.#stateBig);
  }

  /**
   * Returns the current state without advancing the generator.
   *
   * Useful for snapshotting and restoring sequences. The returned value is
   * the state *after* the most recent `next()` call, or the seed if `next()`
   * has not yet been called.
   *
   * @returns {number} the current state in [0, modulus)
   */
  getState() {
    return Number(this.#stateBig);
  }

  /**
   * Restores the generator state to a previously snapshot value.
   *
   * @param {number} state - value in [0, modulus), typically from getState()
   * @throws {TypeError} if state is out of range
   */
  setState(state) {
    assertIntegerParameter(state, 'state', 0);
    if (state >= this.modulus) {
      throw new TypeError(`state must satisfy 0 <= state < modulus; got state=${state}, modulus=${this.modulus}`);
    }
    this.#stateBig = BigInt(state);
  }

  /**
   * Produces an array of `count` successive values, advancing the generator.
   *
   * @param {number} count - non-negative number of values to draw
   * @returns {number[]} array of length `count`
   * @throws {TypeError} if count is negative or not an integer
   */
  take(count) {
    if (typeof count !== 'number' || !Number.isInteger(count)) {
      throw new TypeError(`count must be an integer; got ${typeof count === 'number' ? count : typeof count}`);
    }
    if (count < 0) {
      throw new TypeError(`count must be non-negative; got ${count}`);
    }
    const out = new Array(count);
    for (let i = 0; i < count; i++) out[i] = this.next();
    return out;
  }

  /**
   * Reports whether the configured parameters satisfy the Hull–Dobell
   * conditions for a full period of length m.
   *
   * The conditions (for c != 0) are:
   *   1. c and m are coprime,
   *   2. (a - 1) is divisible by every prime factor of m,
   *   3. if 4 divides m, then 4 divides (a - 1).
   *
   * Because m can be up to 2^53 - 1, factorisation is the expensive step.
   * The check is O(sqrt(m)) which is acceptable for offline validation but
   * not something to call in a hot loop.
   *
   * @returns {boolean}
   */
  hasFullPeriod() {
    const m = this.#modulusBig;
    const a = this.#multiplierBig;
    const c = this.#incrementBig;

    if (c === 0n) {
      // Multiplicative LCG — different (shorter) period theory; we report
      // false rather than implement it, because the caller's expectation of
      // "full period" for c != 0 is m, not m - 1.
      return false;
    }

    // Condition 1: gcd(c, m) == 1.
    if (gcd(c, m) !== 1n) return false;

    // Condition 2: (a - 1) divisible by every prime factor of m.
    const aMinusOne = a - 1n;
    for (const p of distinctPrimeFactors(m)) {
      if (aMinusOne % p !== 0n) return false;
    }

    // Condition 3: if 4 | m then 4 | (a - 1).
    if (divisibleBySmall(m, 4) && !divisibleBySmall(aMinusOne, 4)) {
      return false;
    }

    return true;
  }

  /**
   * Computes the period length by iterating until the state returns to its
   * initial value. For full-period parameters this equals `modulus`.
   *
   * This is an O(period) operation; do not call it on large-modulus
   * generators unless you are willing to wait. It exists primarily for
   * testing small parameter sets.
   *
   * @returns {number} the period as a safe integer
   */
  computePeriod() {
    const initial = this.#stateBig;
    let steps = 0n;
    // Always advance at least once so that a fixed point (period 1) is
    // detected correctly.
    do {
      this.#stateBig = (this.#multiplierBig * this.#stateBig + this.#incrementBig) % this.#modulusBig;
      steps += 1n;
      if (steps > this.#modulusBig) {
        // Safety valve: for c != 0 with non-Hull–Dobell params the period is
        // at most m, so exceeding m means we've looped without hitting the
        // initial state — which shouldn't happen for a valid LCG, but we
        // guard against an infinite loop on degenerate input.
        break;
      }
    } while (this.#stateBig !== initial);
    return Number(steps);
  }
}
