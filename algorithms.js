// The carriers of the DX7's 32 algorithms, operators numbered 1 to 6 as on
// the panel: CARRIERS[a - 1] for algorithm a. Every other operator is a
// modulator. Taken from the Python core's algorithm table
// (src/dx7/engine.py, ALGORITHMS), not from memory;
// tests/test_app_algorithms.py checks that the two agree for all 32. Pure.

export const CARRIERS = Object.freeze([
  [1, 3], [1, 3], [1, 4], [1, 4], [1, 3, 5], [1, 3, 5], [1, 3], [1, 3],
  [1, 3], [1, 4], [1, 4], [1, 3], [1, 3], [1, 3], [1, 3], [1],
  [1], [1], [1, 4, 5], [1, 2, 4], [1, 2, 4, 5], [1, 3, 4, 5], [1, 2, 4, 5], [1, 2, 3, 4, 5],
  [1, 2, 3, 4, 5], [1, 2, 4], [1, 2, 4], [1, 3, 6], [1, 2, 3, 5], [1, 2, 3, 6], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6],
].map((carriers) => Object.freeze(carriers)));
