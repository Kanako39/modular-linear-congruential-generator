/**
 * Modular Linear Congruential Generator — ESM entry point.
 *
 * Re-exports the public API of the library. Keeping the entry point thin lets
 * consumers import a single bare specifier (`./src/index.js`) while the
 * implementation stays split for testability.
 */

export { LCG, validateParameters, MAX_SAFE_JS_INTEGER } from './core.js';
