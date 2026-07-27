import * as THREE from 'three';

// The single source of colour truth.
//
// LEAF MODULE: this imports `three` and nothing else from `src/`. `world/terrain.js`
// imports it, never the reverse — an import back into terrain.js hoists above
// `const PEAK = 170` at terrain.js:3 and boot dies with a TDZ ReferenceError.
//
// The mountain is read as five altitude bands. Three axes move together with
// height: brightness rises (with a deliberate dip in the pine band so four
// clear steps read instead of one gradient), saturation falls monotonically
// 52% -> 16% (the world desaturates so the FIXED accents — gold beacon, red
// mushroom, cyan crystal — gain contrast exactly where legibility gets hard),
// and hue makes an intentional break 96 -> 132 -> 34 -> 198 -> 214 degrees.
// The warm ochre of the cliffs is that temperature break; without it the
// mountain is a single green-to-blue ramp and its middle third has no identity.

export const BAND_KEYS = ['meadow', 'forest', 'cliffs', 'frozen', 'summit'];

// Fractions of PEAK where one band gives way to the next.
export const BAND_EDGES01 = [0.12, 0.35, 0.6, 0.85];

// Half-width of the cross-fade, in the same units. At PEAK=170 that is ±7.65 m;
// the closest two edges are 0.23 apart, so the windows never overlap.
export const BLEND = 0.045;

// `trail` in the two cold bands is the ONLY warm tone up there — that, not
// brightness, is what keeps the path readable on snow.
const BANDS = [
  { // meadow
    terrainA: 0x5b9b31, terrainB: 0xa2ce3b, rock: 0x897258, veg: 0x287132, trail: 0x8c6736,
    fog: 0xf1e2c6, fogNear: 110, fogFar: 640,
    skyTop: 0x3e94e0, skyHorizon: 0xf5e7cc,
    sun: 0xefc680, sunI: 2.3, hemiSky: 0xa5cde9, hemiGround: 0x6e964a, hemiI: 1.25,
  },
  { // forest
    terrainA: 0x2e763c, terrainB: 0x4e9c3a, rock: 0x786654, veg: 0x224f38, trail: 0x7b5932,
    fog: 0xbedee4, fogNear: 95, fogFar: 560,
    skyTop: 0x3185d8, skyHorizon: 0xc1e0eb,
    sun: 0xe8d19c, sunI: 2.2, hemiSky: 0xa0c6e4, hemiGround: 0x406d46, hemiI: 1.2,
  },
  { // cliffs
    terrainA: 0x917959, terrainB: 0xb0886d, rock: 0x6a5a4d, veg: 0x536a44, trail: 0x684b31,
    fog: 0xb5c8d9, fogNear: 80, fogFar: 480,
    skyTop: 0x2f6cbc, skyHorizon: 0xb2cadc,
    sun: 0xe5dbbd, sunI: 2.05, hemiSky: 0x95b8da, hemiGround: 0x786654, hemiI: 1.12,
  },
  { // frozen
    terrainA: 0xa6c6d3, terrainB: 0xdae0e7, rock: 0x586274, veg: 0x31544d, trail: 0xae8a5b,
    fog: 0xadbfcd, fogNear: 55, fogFar: 360,
    skyTop: 0x34558d, skyHorizon: 0x9fb3c6,
    sun: 0xd2dde5, sunI: 1.8, hemiSky: 0x89a6c8, hemiGround: 0x8da1b0, hemiI: 1.0,
  },
  { // summit
    terrainA: 0xe1e5ea, terrainB: 0xf4f4f6, rock: 0x424857, veg: 0x3f5a58, trail: 0xb49474,
    fog: 0x6f7d9b, fogNear: 30, fogFar: 230,
    skyTop: 0x1b1f37, skyHorizon: 0x5e6f8d,
    sun: 0xb6c2d8, sunI: 1.5, hemiSky: 0x53618d, hemiGround: 0x818c9c, hemiI: 0.88,
  },
];

// Band-independent object colours. The 3D livery is the DEEP brand red: the
// bright #E2552F belongs to the 2D wordmark only. Put the bright one on a
// gondola and the static livery sits in the same hue as `hazardRim`, which
// destroys the "warm rim = danger" rule the whole art direction leans on.
export const OBJ = {
  liveryBody: 0xa83619,
  liveryTrim: 0xf7f1e3,
  liveryGold: 0xffd166,
  liveryDeep: 0x7d2711,   // gondola arm, station poles — the shadow of the livery

  crateWood: 0xb5814a,
  crateBand: 0xf5ecd7,
  timberDark: 0x6b4a2e,   // posts, ropes, lamp poles
  timberMid: 0x8a6238,    // planks, seesaws, pads
  plankPale: 0x9a7040,

  mushroomStem: 0xf2e7cf,
  mushroomCap: 0xe8443f,  // darker than before so it stays under the bloom threshold
  mushroomDots: 0xffffff,

  cable: 0x232838,
  pylon: 0x3a4258,
  geyserRim: 0x9a8f7c,
  liftPad: 0x8fd0e8,

  islandTop: 0xd8e9fa,
  islandUnder: 0x8791ad,
  sea: 0x2f74c0,
  cloud: 0xffffff,
  bird: 0x2b2b33,
  snowCap: 0xf2f8ff,

  wool: 0xf5f0e6,
  hide: 0x2b2b2b,
  cardboard: 0xc98b4e,
  paperTape: 0x8a5a2b,
  skin: 0xb7a894,
  trousers: 0x8d8577,

  porcelain: 0xf0ead6,
  porcelainBand: 0x4d7fd0,
  eggShell: 0x7ed957,
  eggSpots: 0x3f9e2f,
  anvilDark: 0x33363f,
  anvilLight: 0x3d414d,
  ghostBody: 0xcfe3ff,
  ghostEye: 0x222244,
  balloonSet: [0xff4d6d, 0xffd166, 0x4dd0ff, 0x45d17a],

  // Emissives. Only these are allowed above the bloom threshold.
  emLantern: 0xffb43a,
  emCrystal: 0x47d8f5,
  emCrystalBody: 0x7de3ff,
  emBeacon: 0xffd166,
  emBeaconDeep: 0xcf8f1e,
  emPotion: 0xb64fc8,
  emPotionDeep: 0x8b2fa8,
  emAnvilEye: 0xff2222,
  emEgg: 0x2d7a1e,
  emGhost: 0x88aaff,
  emLift: 0x1b5e77,
  emDepot: 0x6b4826,
  emDepotRoof: 0x5e2020,
  emCrate: 0x553311,
  bolt: 0xeef4ff,

  // Hazards read as one family: darker and bluer than any band's own rock, so
  // "that lump is out to get me" never has to be learned per zone.
  hazardRock: 0x4d5468,
  hazardIce: 0xbfe6ff,
  hazardRim: 0xff7a3d,
  hazardEmFloor: 0.1,     // a hazard must never read as a black blob
  hazardSnow: 0xf2f8ff,
};

// Precomputed THREE.Color per band per property — bandColor runs 22801 times
// during the terrain build and must not allocate.
const COLOR_PROPS = ['terrainA', 'terrainB', 'rock', 'veg', 'trail', 'fog', 'skyTop', 'skyHorizon', 'sun', 'hemiSky', 'hemiGround'];
const CACHE = {};
for (const prop of COLOR_PROPS) CACHE[prop] = BANDS.map((b) => new THREE.Color(b[prop]));

// Continuous band coordinate 0..4. Summing smoothsteps gives a value that is
// exactly an integer inside a band and slides across the edge over 2*BLEND.
export function bandFloat(alt01) {
  let f = 0;
  for (let i = 0; i < BAND_EDGES01.length; i++) {
    f += THREE.MathUtils.smoothstep(alt01, BAND_EDGES01[i] - BLEND, BAND_EDGES01[i] + BLEND);
  }
  return f;
}

export function bandColor(prop, f, out) {
  const list = CACHE[prop];
  const i0 = Math.max(0, Math.min(BANDS.length - 1, Math.floor(f)));
  const i1 = Math.min(BANDS.length - 1, i0 + 1);
  return out.copy(list[i0]).lerp(list[i1], f - i0);
}

export function bandNum(prop, f) {
  const i0 = Math.max(0, Math.min(BANDS.length - 1, Math.floor(f)));
  const i1 = Math.min(BANDS.length - 1, i0 + 1);
  return THREE.MathUtils.lerp(BANDS[i0][prop], BANDS[i1][prop], f - i0);
}

// Flat lookup for the places that want one band's colour, not a blend
// (tree materials, prop tints) — index by BAND_KEYS position.
export function bandOf(key) {
  return BANDS[BAND_KEYS.indexOf(key)];
}

export { BANDS };
