<!--
  RAW DESIGN SPEC — 3D art direction + post-processing

  Provenance: written by an independent design agent against commit 3602969, then
  reviewed by two critics (see critique-feasibility.md / critique-coherence.md).

  THIS DOCUMENT IS NOT THE PLAN. Where it disagrees with docs/design/README.md or
  the approved v4 plan, THE PLAN WINS. Six specs were written blind to each other and
  four of them rewrite the same files incompatibly; the conflicts are resolved in the
  plan, not here. Read this for the reasoning and the raw values, not for the decisions.

  NOTE: this spec's BRAND block and its post/tone-mapping pipeline are SUPERSEDED (plan B1, B7, B8, B9).
-->

# WORKSTREAM 3: 3D ART DIRECTION + POST-PROCESSING — IMPLEMENTATION SPEC

## 0. New files (exact paths + exported API)

| Path | Exports | Imports |
|---|---|---|
| `src/art/palette.js` | `BAND_KEYS`, `BAND_EDGES01`, `BAND_BLEND01`, `WORLD`, `BAND_LIST`, `OBJ`, `BRAND`, `bandFloat01(alt01)`, `bandColor(prop, bf, out)`, `bandNum(prop, bf)` | `three` only — **leaf module, imports nothing from `src/`** |
| `src/art/mood.js` | `class Mood` | `three`, `./palette.js` |
| `src/art/shaders.js` | `addRim(material, opts)`, `addEmissiveFloor(material, amt)`, `hdr(hex, gain)` | `three` |
| `src/art/instanced.js` | `class InstancedPool` | `three` |
| `src/fx/post.js` | `class Post` | `three`, `three/addons/postprocessing/*`, `./art/palette.js` |

`palette.js` **must not import `world/terrain.js`**. `terrain.js` imports `palette.js`. If you reverse it you get a TDZ `ReferenceError` on `PEAK` (imports hoist above `const PEAK = 170` at terrain.js:3) and boot dies — which `scripts/verify.mjs` catches as a `pageerror`.

---

# A) `src/art/palette.js` — central palette

## A.1 The colour logic (state it in the file header)

Three independent axes, all keyed to altitude:

1. **Value ramps monotonically up**: terrain lightness `L` 40% → 32% → 46% → 74% → 90%. Wait — band 1 (forest) *dips* deliberately: the pine band is the darkest ring on the mountain, so the eye reads meadow → dark collar → warm cliff → bright ice → white summit as four distinct steps, not a fade. Above band 1, `L` is strictly monotonic.
2. **Saturation falls monotonically**: terrain `S` 52% → 44% → 24% → 34%(ice hue only) → 16%. The world de-chromas as you climb, so the *fixed* accent set (gold beacon `#ffd166`, red mushroom, cyan crystal) gains contrast exactly where readability gets hard.
3. **Hue is a deliberate non-monotonic arc**: 96° → 132° → **34°** → 198° → 214°. The warm ochre at Windy Cliffs is the intentional temperature break. Without it the whole mountain is one green→blue ramp and the middle third has no identity; with it, entering The Frozen Face reads as a *temperature drop*, not a fade.

Lighting follows a fourth, strictly monotonic axis: **sun colour warm→cold** (`hsl(38,78%,72%)` → `hsl(218,30%,78%)`) and **sun intensity 2.30 → 1.50**. Every one of these numbers is also load-bearing for the bloom threshold — see §D.3.

## A.2 The module

```js
// src/art/palette.js
import * as THREE from 'three';

// Band edges as fractions of PEAK. SINGLE SOURCE OF TRUTH — world/terrain.js
// builds ZONES from this array (see §B.1). Never retype these numbers.
export const BAND_KEYS   = ['meadow', 'forest', 'cliffs', 'frozen', 'summit'];
export const BAND_EDGES01 = [0.12, 0.35, 0.60, 0.85];
export const BAND_BLEND01 = 0.045;              // ±7.65 m at PEAK=170

export const WORLD = {
  meadow: {
    terrainA: 0x5b9b31, terrainB: 0xa2ce3b, rock: 0x897258, rockDark: 0x5f5145,
    veg: 0x287132, vegLight: 0x51a333, trail: 0x8c6736,
    wood: 0x9c683a, metal: 0x555d6d, accent: 0xfabd42,
    fog: 0xf1e2c6, fogNear: 110, fogFar: 640,
    skyTop: 0x3e94e0, skyHorizon: 0xf5e7cc, stars: 0.0, cloudBand: 0.55,
    sun: 0xefc680, sunI: 2.30,
    hemiSky: 0xa5cde9, hemiGround: 0x6e964a, hemiI: 1.05,
    grade: { sat: 1.18, gainR: 1.05, gainB: 0.95 },
  },
  forest: {
    terrainA: 0x2e763c, terrainB: 0x4e9c3a, rock: 0x786654, rockDark: 0x574b42,
    veg: 0x224f38, vegLight: 0x327b3c, trail: 0x7b5932,
    wood: 0x825735, metal: 0x4c5361, accent: 0xf7ac3b,
    fog: 0xbedee4, fogNear: 95, fogFar: 560,
    skyTop: 0x3185d8, skyHorizon: 0xc1e0eb, stars: 0.0, cloudBand: 0.70,
    sun: 0xe8d19c, sunI: 2.20,
    hemiSky: 0xa0c6e4, hemiGround: 0x406d46, hemiI: 1.00,
    grade: { sat: 1.14, gainR: 1.03, gainB: 0.97 },
  },
  cliffs: {
    terrainA: 0x917959, terrainB: 0xb0886d, rock: 0x6a5a4d, rockDark: 0x3c4049,
    veg: 0x536a44, vegLight: 0x6d874f, trail: 0x684b31,
    wood: 0x865a3c, metal: 0x464f5d, accent: 0xf49434,
    fog: 0xb5c8d9, fogNear: 80, fogFar: 480,
    skyTop: 0x2f6cbc, skyHorizon: 0xb2cadc, stars: 0.0, cloudBand: 0.85,
    sun: 0xe5dbbd, sunI: 2.05,
    hemiSky: 0x95b8da, hemiGround: 0x786654, hemiI: 0.96,
    grade: { sat: 1.08, gainR: 1.01, gainB: 1.00 },
  },
  frozen: {
    terrainA: 0xa6c6d3, terrainB: 0xdae0e7, rock: 0x586274, rockDark: 0x3c4453,
    veg: 0x31544d, vegLight: 0x4e7471, trail: 0xae8a5b,
    wood: 0x6a5344, metal: 0x404959, accent: 0x47d8f5,
    fog: 0xadbfcd, fogNear: 55, fogFar: 360,
    skyTop: 0x34558d, skyHorizon: 0x9fb3c6, stars: 0.25, cloudBand: 0.95,
    sun: 0xd2dde5, sunI: 1.80,
    hemiSky: 0x89a6c8, hemiGround: 0x8da1b0, hemiI: 0.92,
    grade: { sat: 1.00, gainR: 0.99, gainB: 1.03 },
  },
  summit: {
    terrainA: 0xe1e5ea, terrainB: 0xf4f4f6, rock: 0x424857, rockDark: 0x2a2e3c,
    veg: 0x3f5a58, vegLight: 0x5c7a7a, trail: 0xb49474,
    wood: 0x5a493f, metal: 0x363e4e, accent: 0xa465ec,
    fog: 0x6f7d9b, fogNear: 30, fogFar: 230,
    skyTop: 0x1b1f37, skyHorizon: 0x5e6f8d, stars: 1.0, cloudBand: 0.35,
    sun: 0xb6c2d8, sunI: 1.50,
    hemiSky: 0x53618d, hemiGround: 0x818c9c, hemiI: 0.88,
    grade: { sat: 0.92, gainR: 0.97, gainB: 1.06 },
  },
};
export const BAND_LIST = BAND_KEYS.map((k) => WORLD[k]);
```

**Trail readability note (feeds §F):** `frozen.trail = 0xae8a5b` and `summit.trail = 0xb49474` are the *only warm hues in a cold band*. That is the whole readability mechanism — the trail is legible against snow because it is the only thing with chroma, not because it is darker.

## A.3 Shared object palette (band-independent)

```js
export const OBJ = {
  // --- Fake-logistics livery. Matches the HUD brand palette exactly. ---
  liveryBody:   0xe4622e,  // gondola cabin, hut roofs, station roofs
  liveryTrim:   0xf5ecd7,  // paper white — same hex as #slip paper in index.html
  liveryGold:   0xffd166,  // == HUD --gold. NEVER retype this literal elsewhere.
  liveryInk:    0x0b1530,  // == HUD bg. Chevrons, hazard stripes, cable.
  crateWood:    0xb5814a,
  crateBand:    0xf5ecd7,
  parcelWood:   0xa9743f,
  parcelGold:   0xffd166,
  cable:        0x232838,
  pylon:        0x3a4258,

  // --- Props ---
  mushroomCap:  0xe8443f,  // was 0xff5d5d — pushed darker/redder so it does NOT
                           // approach the bloom threshold and stays readable
                           // against both the meadow green and summit white
  mushroomDot:  0xfff4e2,
  mushroomStem: 0xf2e7cf,
  geyserRim:    0x9a8f7c,
  seesawPlank:  0xa9743f,
  elevatorDeck: 0x8fd0e8,

  // --- Emissive sources (see §D.3 for the intensity table) ---
  emLantern:    0xffb43a,
  emCrystal:    0x47d8f5,
  emBeacon:     0xffd166,
  emElevator:   0x47d8f5,
  emPotion:     0xb64fc8,
  emAnvilEye:   0xff2222,

  // --- Hazard language (see §F.3). Shared by boulder/snowball/icicle/roller. ---
  hazardRock:   0x4d5468,  // darker + bluer than any band `rock`
  hazardIce:    0xbfe6ff,
  hazardRim:    0xff7a3d,  // rim colour applied to EVERY dynamic hazard
  hazardEmFloor: 0.10,     // emissive floor so a hazard never reads as a black blob

  // --- Character ---
  charCap:      0xb7a894,
  charPants:    0x8d8577,
  charChute:    0xc98b4e,
  charChuteTape:0x8a5a2b,
  charRim:      0xdce9ff,
};

// UI-facing accents that MUST equal index.html's inline <style>.
// If either side changes, both change.
export const BRAND = {
  ink: 0x0b1530, gold: 0xffd166, text: 0xeaf2ff,
  blue1: 0xa8c4ea, blue2: 0x8fb0dd, blue3: 0xbcd3f5,
  good: 0x45d17a, warn: 0xffb347, bad: 0xff4d6d,
  paper: 0xf5ecd7, paperInk: 0x3a2c18,
};
```

## A.4 Band interpolation helpers

```js
const _a = new THREE.Color(), _b = new THREE.Color();

// alt01 = clamp(y / PEAK, 0, 1). Returns a CONTINUOUS band index 0..4.
export function bandFloat01(alt01) {
  let bf = 0;
  for (let i = 0; i < BAND_EDGES01.length; i++) {
    bf += THREE.MathUtils.smoothstep(alt01, BAND_EDGES01[i] - BAND_BLEND01, BAND_EDGES01[i] + BAND_BLEND01);
  }
  return bf;
}

export function bandColor(prop, bf, out = new THREE.Color()) {
  const i = Math.min(Math.floor(bf), BAND_LIST.length - 1);
  const k = bf - i;
  _a.setHex(BAND_LIST[i][prop]);
  if (k <= 0 || i + 1 >= BAND_LIST.length) return out.copy(_a);
  _b.setHex(BAND_LIST[i + 1][prop]);
  return out.copy(_a).lerp(_b, k);       // lerp happens in LINEAR working space — correct
}

export function bandNum(prop, bf) {
  const i = Math.min(Math.floor(bf), BAND_LIST.length - 1);
  const k = bf - i;
  const a = BAND_LIST[i][prop];
  if (k <= 0 || i + 1 >= BAND_LIST.length) return a;
  return a + (BAND_LIST[i + 1][prop] - a) * k;
}
```

Blend half-width `0.045 * PEAK = 7.65 m`. Band spacing is `≥ 0.23 * PEAK = 39 m`, so blend windows never overlap and `bandFloat01` is monotonic — `Math.floor(bf)` is always the correct lower band.

---

# B) Fixing the band mismatch (terrain.js)

## B.1 `ZONES` derives from the palette — terrain.js:8-14 replaced

```js
// terrain.js:1-2 — add
import { BAND_KEYS, BAND_EDGES01, WORLD, bandFloat01, bandColor } from '../art/palette.js';

// terrain.js:8-14 REPLACED
const ZONE_NAMES = ['Sunny Meadows', 'Pinewood Ledges', 'Windy Cliffs', 'The Frozen Face', 'Storm Summit'];
export const ZONES = BAND_KEYS.map((key, i) => ({
  name: ZONE_NAMES[i],
  key,
  y0: i === 0 ? -5 : PEAK * BAND_EDGES01[i - 1],
  y1: i === BAND_KEYS.length - 1 ? Infinity : PEAK * BAND_EDGES01[i],
}));
```

`zoneAt()` (terrain.js:16-19) is unchanged. Everything that consumes `zone.key` (director.js:81/168, controller.js:206/292/299, deliveries.js:230) is unchanged. Zone *names* stay in terrain.js so the i18n workstream owns them.

## B.2 Vertex colours — terrain.js:179-234 replaced

Delete the 10 `new THREE.Color(0x…)` constants at terrain.js:180-189 entirely.

```js
// ---- Pass 2: colours, band-driven, slope- and curvature-aware ----
const col   = new THREE.Color();
const cRock = new THREE.Color();
const cVar  = new THREE.Color();
const cTrail= new THREE.Color();
const W = SEGMENTS + 1;
const cell = SIZE / SEGMENTS;
const JITTER_M = 4.5;   // was ±5 via `*10`; now explicit and slightly tighter

const FLOWERS = [0xffd166, 0xff7bac, 0xfff4e2];
const cFlower = FLOWERS.map((h) => new THREE.Color(h));

for (let i = 0; i < count; i++) {
  const x = pos.getX(i), z = pos.getZ(i);
  const h = this.grid[i];
  const gx = i % W, gz = (i / W) | 0;
  const hx0 = this.grid[gz * W + Math.max(gx - 1, 0)], hx1 = this.grid[gz * W + Math.min(gx + 1, W - 1)];
  const hz0 = this.grid[Math.max(gz - 1, 0) * W + gx], hz1 = this.grid[Math.min(gz + 1, W - 1) * W + gx];
  const slope = Math.hypot(hx1 - hx0, hz1 - hz0) / (2 * cell);
  const lap   = (hx0 + hx1 + hz0 + hz1 - 4 * h) / cell;
  const pathMix = pathMixArr[i];

  // === THE FIX ===
  // Band index is derived from the SAME edges gameplay uses (ZONES), with a
  // 15.3 m crossfade and a zero-mean noise jitter that dithers the contour so
  // the transition never reads as a perfect ring. Mean boundary == gameplay
  // boundary, which is what was broken before (16/52/96/136 vs 20.4/59.5/102/144.5).
  const jitter = (fbm(x * 0.08, z * 0.08) - 0.5) * 2 * JITTER_M;
  const bf = bandFloat01(THREE.MathUtils.clamp((h + jitter) / PEAK, 0, 1));

  bandColor('terrainA', bf, col);
  bandColor('terrainB', bf, cVar);
  col.lerp(cVar, fbm(x * 0.11 + bf * 3.7, z * 0.11));

  // Flowers only in the lower half of the meadow band.
  if (bf < 0.55 && slope < 0.5) {
    const f = hash2(Math.round(x * 2.1), Math.round(z * 2.1));
    if (f > 0.965) col.lerp(cFlower[(f * 977) % 3 | 0], 0.85 * (1 - bf / 0.55));
  }

  // Steep faces expose the BAND's own rock, not one global grey.
  if (bf > 0.22) {
    bandColor('rockDark', bf, cRock);
    const rockK = THREE.MathUtils.smoothstep(slope, 0.85, 1.7);
    col.lerp(cRock, rockK * 0.85 * Math.min(bf / 0.6, 1));
  }

  // Crevice shading: unchanged.
  const shade = THREE.MathUtils.clamp(1 + lap * 0.05 - Math.max(slope - 1.6, 0) * 0.12, 0.72, 1.12);
  col.multiplyScalar(shade);

  // Trail: band-coloured, plus a darker kerb line at the blend edge so the
  // road has a visible border against snow (see §F.2).
  if (pathMix > 0.30) {
    bandColor('trail', bf, cTrail);
    const core = Math.min((pathMix - 0.45) / 0.4, 1);
    if (pathMix > 0.45) {
      col.lerp(cTrail, core * 0.9);
    } else {
      // 0.30..0.45 = kerb: the trail colour at 55% darkness, 35% strength
      col.lerp(cTrail.clone().multiplyScalar(0.55), (pathMix - 0.30) / 0.15 * 0.35);
    }
  }
  colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
}
```

**What survives:** the `slope`/`lap` computation (terrain.js:198-201) is untouched; the jitter is preserved (retuned to ±4.5 m and now explicitly zero-mean); the flower speckle and the trail lerp both survive with band-aware colours. The `h > 20` and `h > 100` magic constants are gone — both are now expressed in band space.

**Also retune the decorator height gates** (terrain.js:337, 365, 453, 476) so scenery and vertex bands agree. Replace the literals with band fractions:

| line | was | becomes |
|---|---|---|
| terrain.js:337 (pines) | `h < 14 \|\| h > 58` | `h < PEAK*0.09 \|\| h > PEAK*0.37` → `15.3 / 62.9` |
| terrain.js:365 (rocks) | `h < 40 \|\| h > 140` | `h < PEAK*0.28 \|\| h > PEAK*0.84` → `47.6 / 142.8` |
| terrain.js:453 (tufts) | `h < 0.8 \|\| h > 22` | `h < 0.8 \|\| h > PEAK*0.14` → `23.8` |
| terrain.js:476 (snow pines) | `h < 95 \|\| h > 145` | `h < PEAK*0.55 \|\| h > PEAK*0.88` → `93.5 / 149.6` |
| terrain.js:386 (crystals) | `h < PEAK*0.7` | keep |

And re-source the decorator materials from the palette (terrain.js:324, 326, 356, 445, 464, 466, 493, 418, 420):

```js
const treeMat  = new THREE.MeshStandardMaterial({ color: WORLD.forest.veg,      flatShading: true, roughness: 0.9 });
const trunkMat = new THREE.MeshStandardMaterial({ color: WORLD.forest.wood,     flatShading: true, roughness: 0.95 });
const rockMat  = new THREE.MeshStandardMaterial({ color: WORLD.cliffs.rockDark, flatShading: true, roughness: 1 });
const tuftMat  = new THREE.MeshStandardMaterial({ color: WORLD.meadow.vegLight, flatShading: true });
const spineMat = new THREE.MeshStandardMaterial({ color: WORLD.frozen.veg,      flatShading: true });
const scapMat  = new THREE.MeshStandardMaterial({ color: WORLD.summit.terrainB, flatShading: true });
const birdMat  = new THREE.MeshStandardMaterial({ color: WORLD.summit.rockDark, flatShading: true });
const poleMat  = new THREE.MeshStandardMaterial({ color: OBJ.pylon,             flatShading: true });
```

---

# C) Lighting + atmosphere rework

## C.1 Light rig — main.js:72-83 replaced

```js
import { WORLD, bandFloat01, bandColor, bandNum } from './art/palette.js';
import { Mood } from './art/mood.js';

const hemi = new THREE.HemisphereLight(WORLD.meadow.hemiSky, WORLD.meadow.hemiGround, WORLD.meadow.hemiI);
scene.add(hemi);

const SUN_DIST   = 170;
const SHADOW_MAP = 2048;
let   SHADOW_S   = 48;          // mutated by the quality controller (§D.6)

const sun = new THREE.DirectionalLight(WORLD.meadow.sun, WORLD.meadow.sunI);
sun.castShadow = true;
sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
sun.shadow.camera.near = 30;
sun.shadow.camera.far  = 320;
sun.shadow.camera.left = -SHADOW_S; sun.shadow.camera.right = SHADOW_S;
sun.shadow.camera.top  =  SHADOW_S; sun.shadow.camera.bottom = -SHADOW_S;
sun.shadow.bias        = -0.00018;   // was -0.0004; normalBias handles the rest
sun.shadow.normalBias  =  0.022;     // NEW — kills peter-panning on flat-shaded low-poly
scene.add(sun, sun.target);
```

`normalBias` is the change that lets you drop `bias` by 2.2×; with flat shading and a 4.7 cm/texel map, `-0.0004` was visibly detaching contact shadows under the huts and crates.

## C.2 Sun direction + texel snapping — main.js:223-227 replaced

The current sky sun disc points at `(0.583, 0.713, 0.389)` while the actual light points at `(0.336, 0.917, 0.214)` — **the visible sun and the shadow direction have never matched.** Fixed here by deriving both from one function.

```js
const _sunDir = new THREE.Vector3();

// shift01: 0 = shift start (low, warm morning sun), 1 = shift end (low dusk sun).
// Owned by the shift-structure workstream; defaults to mid-morning.
function sunDirection(shift01, out) {
  const az   = THREE.MathUtils.lerp(0.62, -0.38, shift01) + 0.55;
  const elev = 0.62 - Math.abs(shift01 - 0.45) * 0.34;
  return out.set(Math.cos(elev) * Math.sin(az), Math.sin(elev), Math.cos(elev) * Math.cos(az));
}

// --- in frame(), replacing main.js:223-227 ---
const p = ctx.player.body.translation();
sunDirection(ctx.shift01 ?? 0.35, _sunDir);

// Texel-snap the shadow target so the cascade doesn't shimmer while it follows
// the player. Quantise in world XZ at exactly one shadow-map texel.
const texel = (SHADOW_S * 2) / SHADOW_MAP;
const tx = Math.round(p.x / texel) * texel;
const tz = Math.round(p.z / texel) * texel;
const ty = Math.round(p.y / texel) * texel;
sun.target.position.set(tx, ty, tz);
sun.position.set(tx + _sunDir.x * SUN_DIST, ty + _sunDir.y * SUN_DIST, tz + _sunDir.z * SUN_DIST);
skyUniforms.sunDir.value.copy(_sunDir);
sky.position.copy(camera.position);   // was (p.x, 0, p.z) — dome must be camera-centred
                                      // or the horizon line drifts below you at PEAK
```

## C.3 `src/art/mood.js`

```js
import * as THREE from 'three';
import { bandFloat01, bandColor, bandNum, WORLD } from './palette.js';

// Warms/cools the whole rig across a shift. Multiplied onto the band sun colour.
const DAY_STOPS = [
  [0.00, new THREE.Color(0xffd9a0)],   // clock-in: low golden
  [0.45, new THREE.Color(0xfff6e6)],   // midday: neutral
  [0.85, new THREE.Color(0xffb46a)],   // late: golden hour
  [1.00, new THREE.Color(0xff8f5e)],   // clock-out: dusk rose
];

export class Mood {
  constructor({ scene, skyUniforms, hemi, sun, renderer, peak }) {
    Object.assign(this, { scene, skyUniforms, hemi, sun, renderer, peak });
    this.bf = 0;              // smoothed band float, 0..4
    this.band01 = 0;          // bf / 4, for the grade pass
    this._c = new THREE.Color();
    this._day = new THREE.Color();
    this.grade = { sat: 1, gainR: 1, gainB: 1 };
  }

  _dayTint(shift01, out) {
    for (let i = 0; i < DAY_STOPS.length - 1; i++) {
      const [t0, c0] = DAY_STOPS[i], [t1, c1] = DAY_STOPS[i + 1];
      if (shift01 <= t1) return out.copy(c0).lerp(c1, (shift01 - t0) / (t1 - t0));
    }
    return out.copy(DAY_STOPS[DAY_STOPS.length - 1][1]);
  }

  // dt-smoothed so a fall down the mountain doesn't strobe the sky.
  update(dt, playerY, flash, shift01 = 0.35) {
    const target = bandFloat01(THREE.MathUtils.clamp(playerY / this.peak, 0, 1));
    this.bf += (target - this.bf) * Math.min(dt * 2.2, 1);
    const bf = this.bf;
    this.band01 = bf / 4;

    const u = this.skyUniforms;
    bandColor('skyTop',     bf, u.topColor.value);
    bandColor('skyHorizon', bf, u.horizonColor.value);
    bandColor('sun',        bf, u.sunColor.value);
    u.uStars.value = bandNum('stars', bf);
    u.uCloud.value = bandNum('cloudBand', bf);
    u.flash.value  = flash;

    bandColor('fog', bf, this.scene.fog.color);
    this.scene.fog.near = bandNum('fogNear', bf);
    this.scene.fog.far  = bandNum('fogFar',  bf);

    bandColor('hemiSky',    bf, this.hemi.color);
    bandColor('hemiGround', bf, this.hemi.groundColor);
    this.hemi.intensity = bandNum('hemiI', bf) + flash * 1.2;

    this._dayTint(shift01, this._day);
    bandColor('sun', bf, this._c).multiply(this._day);
    this.sun.color.copy(this._c);
    this.sun.intensity = bandNum('sunI', bf) + flash * 1.6;

    // Dusk loses key light; give the exposure back so the image doesn't sink.
    this.renderer.toneMappingExposure = 1.05 + Math.max(0, shift01 - 0.6) * 0.32;

    const i = Math.min(Math.floor(bf), 4), k = bf - i;
    const a = WORLD[Object.keys(WORLD)[i]].grade;
    const b = WORLD[Object.keys(WORLD)[Math.min(i + 1, 4)]].grade;
    this.grade.sat   = a.sat   + (b.sat   - a.sat)   * k;
    this.grade.gainR = a.gainR + (b.gainR - a.gainR) * k;
    this.grade.gainB = a.gainB + (b.gainB - a.gainB) * k;
  }
}
```

**main.js:229-238 becomes three lines:**

```js
const alt01 = THREE.MathUtils.clamp(p.y / PEAK, 0, 1);   // still needed by particles/music
mood.update(realDt, p.y, ctx.director.flash, ctx.shift01 ?? 0.35);
post.setGrade(mood.grade, mood.band01);
```

Construct at main.js:91 (after the light rig, before the resize handler):
```js
const mood = new Mood({ scene, skyUniforms, hemi, sun, renderer, peak: PEAK });
```
and add `mood` to the `ctx` object literal at main.js:96-112.

## C.4 Sky shader — main.js:33-64 replaced

```js
const skyUniforms = {
  topColor:     { value: new THREE.Color(WORLD.meadow.skyTop) },
  horizonColor: { value: new THREE.Color(WORLD.meadow.skyHorizon) },
  sunColor:     { value: new THREE.Color(WORLD.meadow.sun) },
  sunDir:       { value: new THREE.Vector3(0.6, 0.55, 0.57).normalize() },
  flash:        { value: 0 },
  uTime:        { value: 0 },
  uStars:       { value: 0 },
  uCloud:       { value: 0.55 },
};
```
Fragment shader:
```glsl
uniform vec3 topColor, horizonColor, sunDir, sunColor;
uniform float flash, uTime, uStars, uCloud;
varying vec3 vDir;

float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(horizonColor, topColor, pow(h, 0.62));

  // Star field — only at the summit, where uStars ramps 0 -> 1.
  if (uStars > 0.001) {
    vec2 sp = floor(d.xz / max(d.y, 0.25) * 90.0);
    float s = h21(sp);
    float star = step(0.9965, s) * smoothstep(0.15, 0.55, d.y);
    star *= 0.6 + 0.4 * sin(uTime * 2.2 + s * 40.0);
    col += vec3(0.85, 0.90, 1.0) * star * uStars * 2.2;   // > bloom threshold: stars bloom
  }

  // Cirrus band: three sheared sine sheets, 1.1 deg .. 27 deg above the horizon.
  if (uCloud > 0.001) {
    float a = atan(d.z, d.x);
    float band = smoothstep(0.02, 0.14, d.y) * (1.0 - smoothstep(0.16, 0.46, d.y));
    float c = sin(a *  7.0 + uTime * 0.050) * 0.5
            + sin(a * 13.0 - uTime * 0.031 + d.y * 22.0) * 0.3
            + sin(a * 23.0 + d.y * 41.0) * 0.2;
    c = smoothstep(0.25, 0.85, c);
    col = mix(col, mix(col, vec3(1.0), 0.55), c * band * uCloud);
  }

  float sd   = max(dot(d, sunDir), 0.0);
  float disc = pow(sd, 620.0);
  float halo = pow(sd,   9.0);
  col += sunColor * (disc * 2.6 + halo * 0.30);   // disc peak ~2.1 linear -> blooms
  col  = mix(col, vec3(1.0), flash * 0.55);
  gl_FragColor = vec4(col, 1.0);
}
```
Drive `skyUniforms.uTime.value = gameTime;` inside `mood.update` or alongside `particles.update` at main.js:266.

**CRITICAL — the sky will change appearance the moment the composer lands.** `new THREE.Color(0x…)` converts sRGB → Linear-sRGB (`ColorManagement.enabled === true` in r170). The current shader writes those linear values straight into the **sRGB-encoded default framebuffer with no `colorspace_fragment` include**, so today's sky is rendered ~2× too dark. Under the composer it writes into a linear half-float target and `OutputPass` encodes it correctly. Every sky/fog hex in §A.2 is authored for the *corrected* pipeline. Do not land §A without §D, or the sky is wrong twice.

---

# D) Post-processing stack

## D.1 Pass order and the tone-mapping question

**Verified against `node_modules/three/src/renderers/WebGLRenderer.js:1800-1806`:**
```js
let toneMapping = NoToneMapping;
if ( material.toneMapped ) {
  if ( _currentRenderTarget === null || _currentRenderTarget.isXRRenderTarget === true ) {
    toneMapping = _this.toneMapping;
  }
}
```
Tone mapping is applied **only when rendering to the default framebuffer**. The moment `RenderPass` targets a composer RT, every material stops tone-mapping automatically. So:

- **Leave `renderer.toneMapping = THREE.ACESFilmicToneMapping` at main.js:25 exactly as-is.** `OutputPass` reads `renderer.toneMapping` and `renderer.outputColorSpace` at compile time (`OutputPass.js:52-68`) and applies both once, at the end. **No double-apply, no code change to lines 24-26.** Removing `renderer.toneMapping` would silently disable ACES in `OutputPass` too.
- `renderer.toneMappingExposure` is still honoured (`OutputPass.js:46` reads it every frame), so `Mood`'s dusk exposure ramp works.

Order:

```
RenderPass(scene, camera)         → linear HDR, half-float, MSAA-resolved
UnrealBloomPass                   → additive, thresholded on linear luminance
OutputPass  (renderToScreen=false)→ ACES + sRGB encode
GradePass   (renderToScreen=true) → CDL / split-tone / sat / vignette / grain
```

Grading sits **after** `OutputPass` deliberately: lift/gamma/gain, vignette and grain are display-referred operations and behave the way a colourist expects on 0..1 sRGB. `OutputPass` writes sRGB-encoded values into a half-float RT whose `texture.colorSpace` is `NoColorSpace`, so three performs no decode on read and the grade pass gets raw pass-through. The final `ShaderPass` writes to screen from a custom `ShaderMaterial` with no `colorspace_fragment` include, so nothing re-encodes. Verified correct.

## D.2 `src/fx/post.js`

```js
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass }from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass }     from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass }     from 'three/addons/postprocessing/ShaderPass.js';

export const GradeShader = {
  name: 'StorybookGrade',
  uniforms: {
    tDiffuse:       { value: null },
    uTime:          { value: 0 },
    uResolution:    { value: new THREE.Vector2(1, 1) },
    uLift:          { value: new THREE.Vector3(0.008, 0.006, 0.014) },
    uGamma:         { value: new THREE.Vector3(0.98, 1.00, 1.02) },
    uGain:          { value: new THREE.Vector3(1.05, 1.00, 0.95) },
    uSaturation:    { value: 1.18 },
    uShadowTint:    { value: new THREE.Vector3(1.06, 0.99, 0.90) },
    uHighlightTint: { value: new THREE.Vector3(0.96, 0.99, 1.06) },
    uSplit:         { value: 0.50 },
    uVignette:      { value: 0.34 },
    uVignetteSoft:  { value: 0.35 },
    uGrain:         { value: 0.020 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uSaturation, uSplit, uVignette, uVignetteSoft, uGrain;
    uniform vec2  uResolution;
    uniform vec3  uLift, uGamma, uGain, uShadowTint, uHighlightTint;
    varying vec2  vUv;

    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;

      // --- ASC-CDL: slope (gain), offset (lift), power (gamma) ---
      c = clamp(c * uGain + uLift, 0.0, 1.0);
      c = pow(c, uGamma);

      // --- Split tone: warm shadows, cool highlights ---
      float l = dot(c, LUMA);
      float wShadow = 1.0 - smoothstep(0.00, 0.55, l);
      float wHigh   =       smoothstep(0.45, 1.00, l);
      c = mix(c, c * uShadowTint,    wShadow * uSplit);
      c = mix(c, c * uHighlightTint, wHigh   * uSplit * 0.8);

      // --- Saturation about luma ---
      l = dot(c, LUMA);
      c = mix(vec3(l), c, uSaturation);

      // --- Vignette (circular, not oval — aspect-corrected) ---
      vec2 d = vUv - 0.5;
      d.x *= uResolution.x / max(uResolution.y, 1.0);
      float v = 1.0 - uVignette * smoothstep(uVignetteSoft, 0.92, length(d) * 1.42);
      c *= v;

      // --- Fine grain, weighted into the shadows (~2/255 peak) ---
      float g = hash12(gl_FragCoord.xy + fract(uTime) * 691.0) - 0.5;
      c += g * uGrain * (0.35 + 0.65 * (1.0 - dot(c, LUMA)));

      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

const TIERS = {
  high:   { msaa: 4, bloomRes: 256, dpr: 2.0, grain: 0.020, shadowMap: 2048, shadowS: 48 },
  medium: { msaa: 0, bloomRes: 192, dpr: 1.5, grain: 0.016, shadowMap: 1536, shadowS: 52 },
  low:    { msaa: 0, bloomRes: 0,   dpr: 1.0, grain: 0.000, shadowMap: 1024, shadowS: 58 },
};

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.tier = 'medium';                 // start conservative, promote after 3 s
    this._t = 0; this._good = 0; this._bad = 0;
    this._build();
  }

  _build() {
    const t = TIERS[this.tier];
    this.composer?.dispose?.();
    if (this.tier === 'low') { this.composer = null; return; }

    const size = this.renderer.getSize(new THREE.Vector2());
    const pr = this.renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, {
      type: THREE.HalfFloatType,
      samples: t.msaa,                    // hardware MSAA — keeps flat-shaded edges CRISP.
                                          // Do NOT use FXAA/SMAA here: they smear the
                                          // low-poly silhouettes this art direction lives on.
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(size.x, size.y);

    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(t.bloomRes, t.bloomRes),
      /* strength */ 0.62,
      /* radius   */ 0.62,
      /* threshold*/ 0.85,
    );
    this.composer.addPass(this.bloom);

    const out = new OutputPass();
    out.renderToScreen = false;
    this.composer.addPass(out);

    this.grade = new ShaderPass(GradeShader);
    this.grade.renderToScreen = true;
    this.grade.uniforms.uGrain.value = t.grain;
    this.grade.uniforms.uResolution.value.set(size.x, size.y);
    this.composer.addPass(this.grade);
  }

  setSize(w, h) {
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(w, h);
    this.grade?.uniforms.uResolution.value.set(w, h);
  }

  setGrade(g, band01) {
    if (!this.grade) return;
    const u = this.grade.uniforms;
    u.uSaturation.value = g.sat;
    u.uGain.value.set(g.gainR, 1.0, g.gainB);
    u.uSplit.value    = 0.50 + band01 * 0.22;   // stronger split-tone up high
    u.uVignette.value = 0.34 + band01 * 0.10;   // summit closes in
  }

  // fps = the EMA already computed at main.js:191. Hysteresis prevents oscillation.
  tick(dt, fps, tierCap = 'high') {
    this._t += dt;
    if (this._t < 3) return;
    if (fps < 42) { this._bad += dt; this._good = 0; } else if (fps > 58) { this._good += dt; this._bad = 0; }
    const order = ['low', 'medium', 'high'];
    const i = order.indexOf(this.tier), cap = order.indexOf(tierCap);
    if (this._bad > 3 && i > 0)                    { this.tier = order[i - 1]; this._bad = 0; this._apply(); }
    else if (this._good > 8 && i < Math.min(2, cap)) { this.tier = order[i + 1]; this._good = 0; this._apply(); }
  }

  _apply() {
    const t = TIERS[this.tier];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, t.dpr));
    this.onTier?.(t);                      // main.js resizes the shadow map / SHADOW_S
    this._build();
    this.setSize(window.innerWidth, window.innerHeight);
  }

  render(dt, time) {
    if (!this.composer) { this.renderer.render(this.scene, this.camera); return; }
    if (this.grade) this.grade.uniforms.uTime.value = time;
    this.composer.render(dt);
  }
}
```

## D.3 Bloom threshold — the arithmetic that makes it work

Three's reflected radiance for a Lambert diffuse is `albedo/π × irradiance`; emissive is added **raw** (`totalEmissiveRadiance = emissive × emissiveIntensity`, no `/π`). `UnrealBloomPass` thresholds on the linear luminance of the HDR buffer. Computed against this palette:

| surface | linear luma in the HDR buffer |
|---|---|
| meadow grass `0x5b9b31`, sun 2.30 + hemi 1.05 | **0.235** |
| frozen ice `0xa6c6d3`, sun 1.80 + hemi 0.92 | **0.396** |
| summit snow `0xe1e5ea`, sun 1.50 + hemi 0.88 | **0.496** ← brightest lit surface |
| sky horizon (meadow) `0xf5e7cc` | 0.810 |
| sun disc (`sunColor × 2.6`) | ~2.10 |

**`threshold = 0.85` sits above every lit surface and below every intended glow.** The current emissive intensities are all *below* the brightest snow (lantern `0xffaa33 @ 2.2` = luma 1.10 vs. its own scale, but only 0.50 base) — so they must be raised. Set them here:

| object | file:line | new colour | new `emissiveIntensity` | resulting luma |
|---|---|---|---|---|
| trail lanterns | terrain.js:420 | `OBJ.emLantern` `0xffb43a` | **6.0** | 3.25 |
| summit crystals | terrain.js:379 | emissive `OBJ.emCrystal` `0x47d8f5` | **4.5** | 2.57 |
| beacon pad | deliveries.js:96 | emissive `0xffd166` | **5.0** | 3.39 |
| golden package (preview) | packages.js:74 | emissive `0xcf8f1e` | **3.0** | 2.04 |
| golden package (spawned) | packages.js:236 | emissive `0xcf8f1e` | **3.0** | 2.04 |
| elevator deck | props.js:279 | emissive `OBJ.emElevator` | **2.0** | 1.14 |
| potion flask idle | packages.js:200 | `0x8b2fa8` | 0.8 → **2.2** | (peaks ~9 at max shake, packages.js:630 — leave the formula, it now blooms violently near detonation, which is the point) |
| anvil eye | packages.js:195 | `0xff2222` | 2 → **4.0** | 1.02 |
| depot kiosk wood | packages.js:86 | `0x6b4826` | 0.7 → **0.5** | 0.04 (fill only, must NOT bloom) |

`bloom.strength = 0.62`, `bloom.radius = 0.62`. If the horizon (0.810) starts to haze, raise `threshold` to 0.95 — that is the only knob you should need.

### Things that DO bloom, by design
Sun disc, stars, lanterns, crystals, beacon pad + column core, golden cargo, the potion at high shake, additive glow particles when several stack, the lightning bolt (`MeshBasicMaterial 0xeef4ff`, luma 0.90 — just over threshold; raise its colour to `0xffffff` × 1.6 via `hdr()` for a proper strike), and specular glints off the sea (`roughness 0.35, metalness 0.1` spikes past 1.0).

### Things that MUST NOT bloom — and the fix
- **Snow particles** (`particles.js:128`, `0xf4faff`, luma **0.952 > 0.85**) would smear the whole summit into white haze. **Change to `0xd7e6f5`** (luma 0.776). The whiteness now comes from fog + sky, which is where it belongs.
- Wind streaks (`particles.js:146`, `0xffffff`, luma 1.0) — these *should* streak-bloom. Keep, but cut the size to `0.4 + Math.random()*0.4`.
- `deliveries.shock` (`MeshBasicMaterial 0xffd166`, α ≤ 0.8) resolves to ~0.54 after blending and won't bloom. Use the HDR trick: `this.shock.material.color.setRGB(2.4, 1.9, 0.9)` — `MeshBasicMaterial`'s `diffuse` uniform is an unclamped `vec3`, so a `Color` holding values > 1 gives you an HDR emitter with zero extra machinery. Same for the bolt.

## D.4 Exact main.js edits

| main.js | change |
|---|---|
| 1-14 | add `import { Post } from './fx/post.js';` `import { Mood } from './art/mood.js';` `import { WORLD, ... } from './art/palette.js';` |
| 19-27 | **unchanged.** `antialias: true` is now dead weight when the composer is active but costs nothing and is the correct fallback for the `low` tier. |
| 33-64 | sky uniforms + fragment shader per §C.4 |
| 72-83 | light rig per §C.1 |
| **new, after 83** | `const mood = new Mood({...});`<br>`const post = new Post(renderer, scene, camera);`<br>`post.onTier = (t) => { sun.shadow.mapSize.set(t.shadowMap, t.shadowMap); sun.shadow.map?.dispose(); sun.shadow.map = null; SHADOW_S = t.shadowS; sun.shadow.camera.left = -SHADOW_S; sun.shadow.camera.right = SHADOW_S; sun.shadow.camera.top = SHADOW_S; sun.shadow.camera.bottom = -SHADOW_S; sun.shadow.camera.updateProjectionMatrix(); };` |
| 85-90 (resize) | after line 89 add `post.setSize(window.innerWidth, window.innerHeight);` |
| 96-112 (ctx) | add `post, mood,` and `shift01: 0.35,` |
| **195** | `renderer.render(scene, camera);` → `post.render(realDt, gameTime);` |
| 223-227 | replaced per §C.2 |
| 229-238 | replaced per §C.3 (3 lines) |
| **267** | `renderer.render(scene, camera);` → `post.tick(realDt, fps, ctx.qualityCap ?? 'high'); post.render(realDt, gameTime);` |

## D.5 What happens to the existing custom shader work

| thing | effect | action |
|---|---|---|
| **Sky `ShaderMaterial`** (main.js:41) | Now renders into a linear HDR target and gets ACES + sRGB applied at the end. **Visually changes a lot** (currently under-encoded → too dark). | Intended. All sky/fog hexes in §A.2 are authored for the corrected pipeline. |
| **Sea `onBeforeCompile`** (terrain.js:403-411) | Vertex-only injection; completely unaffected by the composer. **But it has no `customProgramCacheKey`.** Three's program cache key (`WebGLPrograms.js:361, 411`) includes `material.customProgramCacheKey()` and *not* the `onBeforeCompile` body — so any other `MeshStandardMaterial` with identical parameters can share the sea's compiled program (or vice versa) and either lose the waves or gain them. Latent today; a **guaranteed bug** once §E adds rim injection to more standard materials. | Add `seaMat.customProgramCacheKey = () => 'sea-wave';` after terrain.js:411. Mandatory. |
| **Particles `onBeforeCompile`** (particles.js:50-54) | `PointsMaterial` is a built-in material → its `tonemapping_fragment` include is now a no-op (render target ≠ null) and `OutputPass` handles it. Additive glow now stacks in **linear** rather than post-tone-mapped space → considerably punchier. | Same `customProgramCacheKey` fix: `mat.customProgramCacheKey = () => 'psize';` after particles.js:54. Reduce `glow` pool `size` 0.7 → 0.6 to compensate for the extra punch. |
| **Transparent cloud blobs** (terrain.js:507) | `opacity 0.92`, blended in linear HDR now instead of post-tone-map. Slightly brighter and less "chalky" — correct. They sit at luma ≈ 0.29 lit, well under threshold. | No change, but see §G.3 for the geometry fix. |
| **Beacon column** (deliveries.js:101) | `fog: false` + `depthWrite: false` still works identically through the composer. | See §F.1. |
| **`renderer.autoClear`** | `RenderPass` sets `clear = true` by default and the sky dome (`frustumCulled = false`) covers the frame. | No change. |

## D.6 verify.mjs / CI risk register

`scripts/verify.mjs` fails the whole run on **any** console error, pageerror or failed request. Watch:

1. **GLSL compile errors** in the grade shader or the sky shader surface as `console.error` → instant CI fail. Compile-test both locally before committing.
2. **`samples: 4` on a `WebGLRenderTarget` under `--use-angle=swiftshader`.** WebGL2 multisampled renderbuffers are supported by SwiftShader but are extremely slow. The `Post` tier starts at `medium` (`msaa: 0`) precisely so verify.mjs never allocates a multisample RT — headless fps will be ~5, so `tick()` demotes to `low` within 3 s and the composer is torn down entirely. **Verify this: it is the single biggest CI regression risk in this workstream.** If it still bites, add `if (new URLSearchParams(location.search).has('nopost')) this.tier = 'low';` and pass `?nopost=1` from `verify.mjs:4`'s `GAME_URL`.
3. **Half-float render targets** need `EXT_color_buffer_half_float`; WebGL2 core in SwiftShader has it. Low risk.
4. `composer.dispose()` on tier change disposes render targets; calling it while `_build()` has not yet created one is guarded by `?.`.
5. `playwright` remains an **undeclared dependency** in `package.json:15-17` — pre-existing, out of scope, but it means nothing in this workstream is actually gated by CI (`.github/workflows/deploy.yml` only curl-checks the bundle). Flag to the user.

---

# E) Rim light + per-object shader work

## E.1 `src/art/shaders.js`

```js
import * as THREE from 'three';

let _rimId = 0;

// Cheap view-space fresnel added to outgoingLight. Works on any lit built-in
// material (MeshStandard/MeshPhysical/MeshLambert/MeshPhong): `normal` comes
// from <normal_fragment_begin> and `vViewPosition` is declared unconditionally
// in the lit fragment shaders.
export function addRim(material, { color = 0xbcd9ff, power = 2.6, strength = 0.55 } = {}) {
  const u = {
    uRimColor:    { value: new THREE.Color(color) },
    uRimPower:    { value: power },
    uRimStrength: { value: strength },
  };
  const id = 'rim' + (++_rimId);
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    prev?.(sh, r);
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>',
        '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimPower, uRimStrength;')
      .replace('#include <opaque_fragment>', `
        {
          float rimF = 1.0 - saturate(dot(normalize(normal), normalize(vViewPosition)));
          outgoingLight += uRimColor * pow(rimF, uRimPower) * uRimStrength;
        }
        #include <opaque_fragment>`);
  };
  // MANDATORY: without this, three's program cache (WebGLPrograms.js:361,411)
  // will hand this material a program compiled for a different onBeforeCompile.
  material.customProgramCacheKey = () => id;
  material.userData.rim = u;   // so gameplay can animate strength
  material.needsUpdate = true;
  return u;
}

// Emissive floor: stops a hazard silhouetting to pure black in shadow.
export function addEmissiveFloor(material, amt = 0.10) {
  material.emissive ??= new THREE.Color();
  material.emissive.copy(material.color).multiplyScalar(1);
  material.emissiveIntensity = amt;
}

// MeshBasicMaterial HDR helper: `diffuse` is an unclamped vec3 uniform, so a
// Color holding >1 turns any basic material into a bloom emitter for free.
export function hdr(hex, gain) {
  return new THREE.Color(hex).multiplyScalar(gain);
}
```

## E.2 Character — character.js

At **character.js:75-76** (`const mat = source.material; mat.roughness = 0.85;`):

```js
import { addRim } from '../art/shaders.js';
import { OBJ }    from '../art/palette.js';

const mat = source.material;
mat.roughness = 0.85;
mat.flatShading = true;                                  // matches the world's shading language
this._rim = addRim(mat, { color: OBJ.charRim, power: 2.4, strength: 0.62 });
```

Apply the same to the two joint-cap materials (**character.js:211-212**) and the chute cardboard (**character.js:37, 42**) so the courier reads as one silhouette:

```js
const capMat   = new THREE.MeshStandardMaterial({ color: OBJ.charCap,   flatShading: true, roughness: 0.9 });
const pantsMat = new THREE.MeshStandardMaterial({ color: OBJ.charPants, flatShading: true, roughness: 0.9 });
addRim(capMat,   { color: OBJ.charRim, power: 2.4, strength: 0.62 });
addRim(pantsMat, { color: OBJ.charRim, power: 2.4, strength: 0.62 });
```

**Rim strength must stay ≤ 0.9.** Peak rim contribution `0.62 × luma(0xdce9ff)=0.79 → 0.49` sits well under the 0.85 bloom threshold, so the courier gets a crisp edge without a halo. Do not raise it past 1.08 or he starts glowing.

**Dynamic rim** — drive it from `Character.update` (character.js:239) so the rim reads as danger state:
```js
// after this.root.position.set(...) at character.js:246
const rimK = player.knockTimer > 0 ? 1.5 : player.parachute ? 1.25 : 1.0;
this._rim.uRimStrength.value = 0.62 * rimK;
this._rim.uRimColor.value.setHex(player.knockTimer > 0 ? 0xff8f6a : OBJ.charRim);
```

## E.3 Emissive discipline (what bloom sees)

Rule to encode in a comment at the top of `palette.js`:

> **Only objects in `OBJ.em*` may carry `emissiveIntensity > 1.0`.** Everything else that needs to avoid reading black in shadow uses `addEmissiveFloor(mat, 0.10)`, which stays two decades below the bloom threshold. The sky's brightness comes from its own shader, not from an emissive material, so it is structurally excluded from the emissive budget.

Explicitly **not** emissive: cloud blobs, sea, terrain, huts, gondolas, station pads, crates, mushrooms, planks, seesaws, birds, snow particles.

---

# F) Readability wins

## F.1 The beacon must read from 200 m and against snow

Replace `_buildBeacon()` (**deliveries.js:84-108**) with a four-layer marker. Layers 1-3 are diegetic; layer 4 is a never-occluded waypoint.

```js
import { hdr, addRim } from '../art/shaders.js';
import { OBJ, BRAND }  from '../art/palette.js';

_buildBeacon() {
  const { scene } = this.ctx;

  // 1. Ground ring — 11 m radius, so the pad reads from directly above too.
  //    Additive + fog:false so snow cannot wash it out.
  this.zone = new THREE.Mesh(
    new THREE.RingGeometry(9.6, 11.0, 40, 1),
    new THREE.MeshBasicMaterial({
      color: hdr(OBJ.emBeacon, 1.4), transparent: true, opacity: 0.55,
      side: THREE.DoubleSide, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  this.zone.rotation.x = -Math.PI / 2;
  this.zone.position.y = 0.06;
  this.zone.renderOrder = 2;

  // 2. Pad — unchanged geometry, emissive raised to 5.0 (blooms, see §D.3).
  this.pad = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 2.7, 0.35, 8),
    new THREE.MeshStandardMaterial({
      color: OBJ.emBeacon, emissive: 0xcf8f1e, emissiveIntensity: 5.0, flatShading: true,
    }),
  );

  // 3. Column: HDR CORE (blooms, survives a white background) inside the soft
  //    outer cone. The core is what actually carries the read at distance.
  this.columnCore = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.75, 90, 6, 1, true),
    new THREE.MeshBasicMaterial({
      color: hdr(OBJ.emBeacon, 2.6), transparent: true, opacity: 0.9,
      side: THREE.DoubleSide, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  this.column = new THREE.Mesh(
    new THREE.CylinderGeometry(1.8, 2.4, 90, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color: OBJ.emBeacon, transparent: true, opacity: 0.30,
      side: THREE.DoubleSide, depthWrite: false, fog: false,
    }),
  );
  this.columnCore.position.y = this.column.position.y = 35;

  // 4. Waypoint diamond — depthTest:false, renderOrder 999. NEVER occluded,
  //    so the target is legible through the mountain. This is the single
  //    biggest far-field readability win and it costs one draw call.
  this.pip = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.15, 0),
    new THREE.MeshBasicMaterial({
      color: hdr(OBJ.emBeacon, 2.0), transparent: true, opacity: 0.92,
      depthTest: false, depthWrite: false, fog: false,
    }),
  );
  this.pip.position.y = 7.5;
  this.pip.renderOrder = 999;

  this.light = new THREE.PointLight(OBJ.emBeacon, 60, 30);
  this.light.position.y = 3;

  this.beacon = new THREE.Group();               // MUST stay named `beacon` —
  this.beacon.add(this.pad, this.column, this.columnCore, this.pip, this.zone, this.light);
  scene.add(this.beacon);                        // verify.mjs:72-73 & :248 read
                                                 // ctx.deliveries.beacon.position
  this.shock = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.18, 6, 28),
    new THREE.MeshBasicMaterial({
      color: hdr(OBJ.emBeacon, 2.4), transparent: true, opacity: 0,
      depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    }),
  );
  this.shock.rotation.x = Math.PI / 2;
  scene.add(this.shock);
}
```
Animate in `fixedUpdate` (**deliveries.js:197-198**):
```js
this.column.material.opacity     = 0.26 + Math.sin(t * 2.5) * 0.08;
this.columnCore.material.opacity = 0.72 + Math.sin(t * 5.0) * 0.18;
this.zone.material.opacity       = 0.42 + Math.sin(t * 2.5 + 1.1) * 0.14;
this.pad.rotation.y += dt * 0.6;
this.pip.rotation.y += dt * 1.9;
this.pip.position.y  = 7.5 + Math.sin(t * 2.2) * 0.35;
```

**Motion, not colour, is what carries far-field readability against snow.** The core's 5 Hz pulse and the pip's spin are the load-bearing parts; the gold is secondary.

## F.2 Depot ring — brand it as a loading bay

Replace the plain torus at **packages.js:108-114** with a hazard-chevron ring in `BRAND.gold` / `BRAND.ink` (this is the 3D-side seed of the fake-logistics branding the UI workstream owns):

```js
// 8 alternating gold / ink arc segments at r = 1.7 (matches the 2.6 m pickup
// test at packages.js:481, with visual margin).
this.ring = new THREE.Group();
for (let i = 0; i < 8; i++) {
  const seg = new THREE.Mesh(
    new THREE.TorusGeometry(1.7, 0.15, 5, 6, Math.PI / 4 - 0.06),
    new THREE.MeshBasicMaterial({
      color: i % 2 ? hdr(BRAND.gold, 1.9) : new THREE.Color(BRAND.ink),
      transparent: true, opacity: 0.92, fog: false,
    }),
  );
  seg.rotation.z = (i * Math.PI) / 4;
  this.ring.add(seg);
}
this.ring.rotation.x = Math.PI / 2;
this.ring.position.set(p.x, y + 0.25, p.z);
scene.add(this.ring);
```
`packages.js:501` (`this.ring.rotation.z += dt;`) keeps working unchanged on the Group. 8 draw calls — merge the 8 torus segments with `mergeGeometries` + vertex colours to get 1 if you care; at the depot only, it's not worth it.

## F.3 Hazards vs scenery at speed

Today: hazard boulders are `0x5d6480` (director.js:29), decor rocks are `0x6b748f` (terrain.js:356). Nearly the same colour — at 12 m/s they are indistinguishable, which is a fairness bug, not just an art one. Four-part fix, all in `Director`'s constructor (**director.js:29-31**):

```js
import { addRim, addEmissiveFloor } from '../art/shaders.js';
import { OBJ } from '../art/palette.js';

const hazardRim = { color: OBJ.hazardRim, power: 1.9, strength: 0.85 };

this._boulderMat = new THREE.MeshStandardMaterial({ color: OBJ.hazardRock, flatShading: true, roughness: 1 });
this._snowMat    = new THREE.MeshStandardMaterial({ color: 0xeef6ff,       flatShading: true, roughness: 0.9 });
this._icicleMat  = new THREE.MeshStandardMaterial({
  color: OBJ.hazardIce, emissive: 0x6fc8f0, emissiveIntensity: 0.55,
  flatShading: true, roughness: 0.2, transparent: true, opacity: 0.9,
});
for (const m of [this._boulderMat, this._snowMat, this._icicleMat]) addRim(m, hazardRim);
addEmissiveFloor(this._boulderMat, OBJ.hazardEmFloor);
```
Also apply `addRim(mesh.material, hazardRim)` to the roller log material (**props.js:169**).

1. **Shared rim colour `0xff7a3d` at strength 0.85** — every dynamic threat gets the same hot orange edge. Nothing static in this palette has a warm rim, so "warm outline = it will hurt you" becomes a learnable rule in one encounter. Peak contribution `0.85 × 0.355 = 0.30` → does not bloom.
2. **Scenery moves away**: decor rocks go to `WORLD.cliffs.rockDark` `0x3c4049` (cool, dark) while hazards use `OBJ.hazardRock` `0x4d5468` (lighter, bluer) + emissive floor. Value separation ~1.3 stops.
3. **Emissive floor 0.10** stops a boulder rolling out of sunlight into a shadow and becoming an invisible black blob against dark rock.
4. **Motion streaks.** Add to `Director._cullList` (**director.js:225-238**), inside the existing loop:
```js
b._streak = (b._streak ?? 0) - dt;
const v = b.body.linvel();
const sp = Math.hypot(v.x, v.y, v.z);
if (sp > 6 && b._streak <= 0) {
  b._streak = 0.08;
  this._tmp.set(bp.x, bp.y, bp.z);
  this.ctx.particles.burst(this._tmp, {
    count: 1, speed: 0.4, up: 0.1, life: 0.32, size: 1.9,
    glow: true, color: OBJ.hazardRim, grav: 0, drag: 3,
  });
}
```
A trailing additive smear is what actually makes a boulder legible in peripheral vision at speed — colour alone does not survive motion blur on a human retina.

## F.4 Trail legibility

Three mechanisms, already specified above, working together:
1. **Hue, not value**: `frozen.trail = 0xae8a5b` / `summit.trail = 0xb49474` are the only chromatic surfaces in a cold band (§A.2).
2. **Kerb line** at `0.30 < pathMix < 0.45` gives the road a visible border (§B.2).
3. **Lanterns at `emissiveIntensity 6.0`** (terrain.js:420) now bloom — 46 instanced points of light lining the route are a dotted line the eye follows automatically. Free: they were already instanced and already there.

---

# G) Draw-call cleanup that pays for the post stack

## G.1 Measured baseline (counted from source, not estimated)

| system | meshes | detail |
|---|---|---|
| `cablecar.js` | **89** | 5 stations × 6 (pad + roof + 4 poles) = 30; cable 1; 8 pylons × 2 = 16; 6 gondolas × 7 = 42 |
| `props.js` | **109** | 20 mushrooms × 3 = 60; 4 geyser rims; 3 seesaws × 2 = 6; 2 elevators; 11 crates; 4 pendulums × 5 = 20; 6 planks |
| `terrain.js` | **~87** | terrain 1; 12 island halves; 8 InstancedMesh; ~5 crystals; sea 1; 12 birds; **~48 cloud blobs** |
| `deliveries.js` | **21** | 9 huts × 2 = 18; shock, pad, column |
| `packages.js` | 7 | kiosk 5, ring 1, preview 1 |
| sky / particles / bolt | 5 | |
| runtime hazards | 0-20 | |
| **total** | **≈ 318-338** | matches the stated 250-350 |

## G.2 `src/art/instanced.js` — the proxy helper

The one constraint that governs everything: `Physics.syncMeshes` (**physics.js:98-123**) writes `mesh.position.set(...)` and `mesh.quaternion.copy(...)`. A bare `THREE.Object3D` satisfies that contract without being in the scene graph. That is how dynamic bodies get instanced.

```js
import * as THREE from 'three';

export class InstancedPool {
  // parts: [{ geometry, material, offset?:Matrix4 }] — one InstancedMesh each,
  // all driven by the SAME array of proxy Object3Ds.
  constructor(scene, parts, count, { castShadow = true, receiveShadow = false } = {}) {
    this.proxies = Array.from({ length: count }, () => new THREE.Object3D());
    this.meshes = parts.map(({ geometry, material }) => {
      const im = new THREE.InstancedMesh(geometry, material, count);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = castShadow; im.receiveShadow = receiveShadow;
      im.frustumCulled = false;              // proxies move; a stale bounds culls wrongly
      scene.add(im);
      return im;
    });
    this.offsets = parts.map((p) => p.offset ?? new THREE.Matrix4());
    this._m = new THREE.Matrix4();
    this.count = count;
  }

  proxy(i) { return this.proxies[i]; }

  // Call once per RENDER frame (not per physics substep).
  sync(used = this.count) {
    for (let i = 0; i < used; i++) {
      const p = this.proxies[i];
      p.updateMatrix();
      for (let m = 0; m < this.meshes.length; m++) {
        this._m.multiplyMatrices(p.matrix, this.offsets[m]);
        this.meshes[m].setMatrixAt(i, this._m);
      }
    }
    for (const im of this.meshes) { im.count = used; im.instanceMatrix.needsUpdate = true; }
  }
}
```

## G.3 The plan

### `cablecar.js`
- **Stations (30 → 3).** Three `InstancedMesh`: pads (count 5), roofs (count 5), poles (count 20). Static — set matrices once in `_build()`, no per-frame sync.
- **Pylons (16 → 2).** The variable height is handled by a unit-height geometry: `new THREE.CylinderGeometry(0.35, 0.6, 1, 6)` scaled `(1, h, 1)` per instance (radii are absolute, so the taper is preserved). Masts count 8, arms count 8. Static.
- **Gondolas (42 → 1).** Merge the 7 cabin meshes into one `BufferGeometry` with `mergeGeometries` from `three/addons/utils/BufferGeometryUtils.js`, baking `cabMat`/`cabMat2` into a `color` attribute and using one `MeshStandardMaterial({ vertexColors: true, flatShading: true })`. One `InstancedMesh(count: 6)`.

  **verify.mjs hard requirement (verify.mjs:85, 90):** it reads `ctx.cablecar.gondolas[0].group.position`. **Keep the field named `group`** — assign the pool proxy to it:
  ```js
  this.gondolas.push({ group: pool.proxy(i), body, s: u0 * this.length, sway: 0, swayV: 0, phase: … });
  ```
  `fixedUpdate` (**cablecar.js:209-210**) then works verbatim (`g.group.position.set(...)`, `g.group.quaternion.copy(...)`), and the sync happens in the existing render-rate `update()` (**cablecar.js:214**, called from main.js:220): add `this._pool.sync();` as its first line. **Do not rename `group`, do not switch to `Vector3`** — verify.mjs breaks and CI fails.
- Cable: leave (1).

**89 → 7.**

### `props.js`
- **Mushrooms (60 → 3).** One pool, parts = stem/cap/dots with per-part `offset` matrices baking the local `position.y` and `scale.y` from props.js:196/202/207-208. Keep the record field named `group` and point it at `pool.proxy(i)` so **props.js:322** (`m.group.scale.y = 1 - m.squish * 0.35`) is untouched, and so **verify.mjs:100-101** (`ctx.props.mushrooms[0].pos` / `.capY`) keeps working — those two fields are plain data and unaffected either way.
- **Crates (11 → 1).** Pass `pool.proxy(i)` as the `mesh` argument to `physics.addDynamic` (**props.js:299**) and **do not `scene.add`**. Physics writes the proxy; the pool uploads matrices.
- **Geyser rims 4 → 1** (static). **Seesaw fulcrums 3 → 1** (static). **Seesaw planks 3 → 1** (dynamic, proxy). **Elevators 2 → 1** (kinematic, proxy). **Pendulums 20 → 4** (posts ×8 static, bars ×4 static, logs ×4 proxy, ropes ×4 proxy).
- **Planks: leave as 6 individual meshes.** They flip between `Fixed` and `Dynamic` body types and get `physics.track`/`untrack`'d (props.js:419-435); instancing them buys 5 draw calls for a real chance of a state-machine bug. Not worth it.

**Add `Props.update()`** and call it from **main.js after line 220**:
```js
update() { this._mushPool.sync(); this._cratePool.sync(); this._pendPool.sync(); this._elevPool.sync(); this._seesawPool.sync(); }
```
Matrix upload must be render-rate, not inside `fixedUpdate` — at 144 Hz `fixedUpdate` can be skipped on a frame and instances would freeze.

**109 → 18.**

### `terrain.js` — clouds are the worst offender
**terrain.js:505-522** builds `new THREE.IcosahedronGeometry(3 + hash2(i,b) * 4, 0)` **per blob** — ~48 unique geometries, 48 draw calls, 48 buffer uploads, and 48 transparent-sorted alpha blobs. Replace with one unit geometry and one `InstancedMesh`:

```js
// terrain.js:505-522 REPLACED
this.clouds = [];
const cloudGeo = new THREE.IcosahedronGeometry(1, 0);        // ONE geometry, radius 1
const cloudMat = new THREE.MeshStandardMaterial({
  color: 0xffffff, flatShading: true, roughness: 1, transparent: true, opacity: 0.92,
});
const CLOUDS = 12, MAX_BLOBS = 5;
this._cloudMesh = new THREE.InstancedMesh(cloudGeo, cloudMat, CLOUDS * MAX_BLOBS);
this._cloudMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
this._cloudMesh.frustumCulled = false;
this._cloudMesh.castShadow = false;
scene.add(this._cloudMesh);

let ci = 0;
for (let i = 0; i < CLOUDS; i++) {
  const blobs = 2 + ((hash2(i, 61) * 3) | 0);
  const a = hash2(i, 71) * Math.PI * 2;
  const r = 60 + hash2(i, 73) * 160;
  const origin = new THREE.Vector3(Math.cos(a) * r, 60 + hash2(i, 79) * 130, Math.sin(a) * r);
  const parts = [];
  for (let b = 0; b <= blobs; b++) {
    const s = 3 + hash2(i, b) * 4;
    parts.push({
      idx: ci++,
      off: new THREE.Vector3(b * 4 - blobs * 2, hash2(b, i) * 2, hash2(i * 3, b) * 3),
      scale: new THREE.Vector3(s, s * 0.55, s),
    });
  }
  this.clouds.push({ origin, parts, speed: 1 + hash2(i, 83) * 2.5 });
}
```
Drift in `update()` (**terrain.js:534-537**) moves `c.origin.x` and writes `CLOUDS × ~4` matrices. Birds (**terrain.js:489-503**, 12 meshes) get the same treatment → 1. Crystals (~5) already share geometry + material → 1 `InstancedMesh` (they only spin about Y; write matrices in `update`).

**Leave the floating islands alone (12 meshes).** `verify.mjs:138` reads `ctx.terrain.summitIsland.group.position`; the islands are kinematic carriers for the player and the risk/reward is bad for 10 draw calls.

**~87 → ~28.**

### `deliveries.js`
Huts (18 → 2): one `InstancedMesh` for the 9 bases, one for the 9 roofs, static. Roofs use `OBJ.liveryBody`.
**21 → 5.**

## G.4 Before / after

| | before | after |
|---|---|---|
| cablecar | 89 | 7 |
| props | 109 | 18 |
| terrain | ~87 | ~28 |
| deliveries | 21 | 5 |
| packages | 7 | 7 (+ 8 depot ring, or 1 if merged) |
| sky / particles / bolt | 5 | 5 |
| **static total** | **≈ 318** | **≈ 70** |
| runtime hazards | 0-20 | 0-20 |
| **peak** | **≈ 338** | **≈ 90** |

A **~3.6× draw-call reduction**, which is roughly the budget the post stack spends: RenderPass (1 scene pass, now MSAA-resolved), UnrealBloom (11 full-screen quads across 5 mips at 256², i.e. cheap), OutputPass (1 quad), GradePass (1 quad). On a desktop GPU the composer costs ~1.2-1.8 ms at 1080p; the removed 248 draw calls buy back 2-4 ms of CPU. Net positive, and it makes headroom for the `high` tier the user asked for.

---

# Implementation order (each step independently shippable and verifiable)

1. **`src/art/palette.js`** + terrain.js `ZONES` derivation (§A, §B.1). Verify: `zoneAt(0)` → meadow, `zoneAt(150)` → summit; `npm run dev` looks unchanged.
2. **§B.2 vertex colours.** Verify: visual band edges sit at 20.4 / 59.5 / 102 / 144.5 m; HUD zone name flips at the same instant the ground colour turns.
3. **§G instancing + `src/art/instanced.js`.** Verify: `renderer.info.render.calls` in the console drops from ~320 to ~90; run `scripts/verify.mjs` in full — the gondola-ride, mushroom-bounce and summit-island tests are the ones that catch a proxy mistake.
4. **§D post stack** with `Post` forced to `medium`. Verify: `verify.mjs` passes with zero console errors; screenshots in `verify-out/` show the corrected (brighter) sky.
5. **§C lighting + mood.** Verify: the sun disc in the sky now sits exactly where shadows point.
6. **§D.3 emissive retune + §E rim + §F readability.** Verify: at the summit, snow does not bloom; lanterns, crystals and the beacon core do.
7. **Enable tier promotion to `high`** and the shadow-map retune.
