// Deterministic value noise for terrain generation.
//
// LEAF MODULE: imports nothing. terrain.js, scatter.js and landmarks.js all
// draw from here so a single seed constant governs the whole mountain.
//
// The old hash was `Math.sin(x * 127.1 + y * 311.7) * 43758.5453` — the GLSL
// idiom, transliterated. In GLSL that is fine; in JS `Math.sin` is one of the
// slowest things you can put in a hot loop, and the terrain build calls the
// hash roughly sixty times per grid point. At 641 601 grid points that is
// 38 million sines. The integer hash below is the same quality of randomness
// for about a fifth of the cost.

const SEED = 0x9e3779b9;

// 32-bit integer avalanche (murmur3 finalizer, seeded). Deterministic across
// engines because every step stays inside int32 via Math.imul.
function hashi(ix, iy) {
  let h = SEED ^ Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Float-friendly variant for scatter loops, which key off arbitrary constants
// (`rand2(i, 7.7)` vs `rand2(i, 7.1)`) and would collide if the arguments were
// simply truncated to int.
export function rand2(a, b) {
  return hashi((a * 1013.7) | 0, (b * 1409.3) | 0);
}

export function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hashi(xi, yi), b = hashi(xi + 1, yi);
  const c = hashi(xi, yi + 1), d = hashi(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Three octaves, same weights the terrain has always used.
export function fbm(x, y) {
  return vnoise(x, y) * 0.55 + vnoise(x * 2.7, y * 2.7) * 0.28 + vnoise(x * 6.1, y * 6.1) * 0.17;
}

// Ridged multifractal. `1 - |2n - 1|` folds the noise about its midline so the
// maxima become creases instead of domes; squaring sharpens them, and carrying
// the previous octave forward as a weight means fine ridges only appear where a
// coarse ridge already runs. That last term is what separates a mountain range
// from a field of bumps — without it every octave crests independently and the
// result is noise, not ridgelines.
export function ridged(x, y, octaves = 5) {
  let sum = 0, norm = 0, amp = 0.5, freq = 1, prev = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(vnoise(x * freq, y * freq) * 2 - 1);
    n *= n;
    sum += n * amp * prev;
    norm += amp;
    prev = n;
    freq *= 2.03;   // not exactly 2: integer lattice frequencies align their
    amp *= 0.5;     // cell edges and print a visible grid into the terrain
  }
  return sum / norm;
}

// Domain warping: displace the sample point by a low-frequency noise field.
// Costs two extra fbm calls and is the single cheapest way to turn round blobs
// into swept, directional landforms. Writes into `out` to stay allocation-free
// inside the grid loop.
export function warp(x, y, amp, freq, out) {
  out[0] = x + (fbm(x * freq + 5.2, y * freq + 1.3) - 0.5) * 2 * amp;
  out[1] = y + (fbm(x * freq - 3.7, y * freq + 9.1) - 0.5) * 2 * amp;
  return out;
}
