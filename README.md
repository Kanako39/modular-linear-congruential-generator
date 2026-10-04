# Modular Linear Congruential Generator

A small, dependency-free TypeScript-flavoured ESM library implementing a Linear Congruential Generator (LCG) with user-configurable modulus, multiplier, increment, and seed. The generator is deterministic and integer-valued; every value drawn lies in `[0, modulus)`.

## Usage

```js
import { LCG, validateParameters } from './src/index.js';

// glibc parameters, full period 2^31
const g = new LCG({
  modulus: 2 ** 31,
  multiplier: 1103515245,
  increment: 12345,
  seed: 1,
});

validateParameters(g.modulus, g.multiplier, g.increment, 1); // throws on bad input

console.log(g.next());        // 1103527590
console.log(g.take(4));       // four successive values
console.log(g.getState());    // current state, no advance
console.log(g.hasFullPeriod()); // true — Hull–Dobell holds
```

## Why this exists

The brief asks for a configurable LCG with no third-party dependencies. That rules out pulling in a random library, and it also rules out `crypto`-grade primitives. The trade-off taken here is exactness over reach: parameters are confined to JavaScript safe integers (`|value| <= 2^53 - 1`), and the recurrence is evaluated with `BigInt` internally so that no low-order bits are lost to floating-point rounding. This covers the classic textbook parametrisations (glibc, Java `util.Random`, MMIX) exactly. For moduli above `2^53` the caller should reach for a BigInt-native library; this one will refuse the parameters rather than silently corrupt the sequence.

## Exported names

- `LCG` — the generator class. Constructor takes `{ modulus, multiplier, increment, seed }`. Methods: `next()`, `getState()`, `setState(state)`, `take(count)`, `hasFullPeriod()`, `computePeriod()`. Read-only fields: `modulus`, `multiplier`, `increment`.
- `validateParameters(modulus, multiplier, increment, seed)` — throws `TypeError` on invalid input; returns nothing otherwise.
- `MAX_SAFE_JS_INTEGER` — the upper bound (`2^53 - 1`) the library accepts for any parameter.

## The awkward edge

`hasFullPeriod()` checks the Hull–Dobell conditions, which require factoring the modulus. Factorisation is `O(sqrt(m))`, so for `m` near `2^53` this call can take a noticeable amount of time — it is meant for offline validation, not per-draw use. `computePeriod()` is worse: it is `O(period)`, which for full-period parameters means `O(modulus)` steps. It exists for testing small parameter sets; do not call it on large-modulus generators.
