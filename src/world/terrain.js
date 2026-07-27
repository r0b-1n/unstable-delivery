import * as THREE from 'three';
import { BAND_KEYS, BAND_EDGES01, bandFloat, bandColor, OBJ } from '../art/palette.js';
import { patchMaterial } from '../art/shaders.js';
import { fbm, ridged, warp, rand2 } from './noise.js';
import { PEAK, WORLD_R, KILL_Y, CELL, SIZE, SEGMENTS, W, LAKE, CIRQUE } from './dims.js';
import { Scatter } from './scatter.js';
import { Landmarks } from './landmarks.js';
import { Backdrop } from './backdrop.js';

// Re-exported so the five modules that already say
// `import { PEAK, KILL_Y } from '../world/terrain.js'` keep working.
export { PEAK, WORLD_R, KILL_Y };

// Visual chunking. 16x16 chunks of 100 m each: small enough that frustum
// culling throws away most of the map, large enough that 256 draw calls is
// still a rounding error next to what the scatter costs.
const CHUNKS = 16;
const CHUNK_CELLS = SEGMENTS / CHUNKS;    // 50 cells = 100 m
const LOD_STRIDE = [1, 2, 5];             // must all divide CHUNK_CELLS
const SKIRT = 6;                          // meters a chunk's edge apron drops

// Massif shape.
//
// SHAPE_P is the exponent of the radial falloff and it is the single most
// consequential number on the mountain. At 1.65 the profile sags: nearly all
// the height sits inside a third of the radius and everything outside it is a
// skirt under 7 % grade. Rendered, that is a cone standing on a dinner plate —
// a mountain that is 1600 m wide and reads as 500 m wide, which defeats the
// entire point of building it this big. At 1.15 the flank is close to straight
// and the massif fills its own footprint.
const SUMMIT_R = 700;   // radius at which the base profile reaches sea level
const SHAPE_P = 1.15;
const RIM0 = 690, RIM1 = 780;

// Route. R_OUT follows SUMMIT_R outward: the depot has to stand where the
// mountain is still near sea level, and with the fuller profile that is 640,
// not 520. LOOPS comes down to keep the trail at ~3.8 km.
const LOOPS = 1.85;
const A0 = 0.8;
const R_OUT = 640, R_IN = 20;
const PATH_N = 1400;
const TWO_PI = Math.PI * 2;

const { clamp, smoothstep, lerp } = THREE.MathUtils;

// The base profile, without noise. The trail's height curve is derived from
// this same function so the route sits ON the mountain by construction instead
// of being an independent curve that carve-and-fill has to reconcile.
function baseProfile(r) {
  return PEAK * Math.pow(clamp(1 - r / SUMMIT_R, 0, 1), SHAPE_P);
}

// The massif with its compass-angle modulation but no noise: the mountain's
// mean surface. Used to derive heights that have to be known before the grid
// exists — the lake's water level, above all.
function massifAt(x, z) {
  const th = Math.atan2(z, x);
  const flank = 1 + 0.15 * Math.sin(th + 0.6) + 0.09 * Math.sin(th * 3 + 1.1);
  return PEAK * Math.pow(clamp(1 - Math.hypot(x, z) / (SUMMIT_R * flank), 0, 1), SHAPE_P);
}

// Water level of the tarn, taken from the mean surface at its own centre so
// that moving the lake never means re-tuning a hardcoded altitude.
const LAKE_Y = massifAt(LAKE.x, LAKE.z) - 4;

// Vertical difficulty bands, derived from the palette so the colour a player
// sees and the zone the rules use can never drift apart. `name` is the English
// source string and is superseded by `nameKey` once i18n lands.
const ZONE_NAMES_EN = ['Sunny Meadows', 'Pinewood Ledges', 'Windy Cliffs', 'The Frozen Face', 'Storm Summit'];
export const ZONES = BAND_KEYS.map((key, i) => ({
  key,
  nameKey: `zone.${key}`,
  name: ZONE_NAMES_EN[i],
  y0: i === 0 ? -5 : PEAK * BAND_EDGES01[i - 1],
  y1: i === BAND_KEYS.length - 1 ? Infinity : PEAK * BAND_EDGES01[i],
}));

export function zoneAt(y) {
  for (const z of ZONES) if (y < z.y1) return z;
  return ZONES[ZONES.length - 1];
}

export class Terrain {
  constructor(ctx) {
    this.ctx = ctx;
    this.islands = [];
    this.chunks = [];
    this.lakeLevel = LAKE_Y;
    this.lod0R = 300;
    this.lod1R = 850;
    this._w = [0, 0];       // scratch for the domain warp
    this._computeGapWidths();
    this._buildPath();
    this._buildGrid();
    this._buildChunks();
    this._buildCollider();
    this._buildIslands();
    // The map owns its own dressing: scatter, set pieces and horizon are all
    // "the mountain" and none of them is meaningful to the rest of the game,
    // so they hang off Terrain rather than adding three more members to ctx.
    this.backdrop = new Backdrop(ctx, this);
    this.landmarks = new Landmarks(ctx, this);
    this.scatter = new Scatter(ctx, this);
  }

  // ---- Route -------------------------------------------------------------

  _buildPath() {
    this.pathSamples = [];
    for (let i = 0; i <= PATH_N; i++) this.pathSamples.push(this.pathPoint(i / PATH_N));
  }

  // Chasms cut across the trail in the upper zones — jump them, ride a
  // mushroom out of them, or trust a crumbling plank. `m` is the physical
  // gap length in meters; every third gap (index 2, 5) is plank-less and
  // sized to be sprint-jumpable — at SPRINT 10.8 and JUMP 11.2 against
  // gravity 22 the air time is 1.02 s, so the reach is about 11 m. The two
  // plank-less gaps are the only ones under that; the rest need the board.
  // The t-space half-width `w` is derived from the local path speed at
  // construction — a fixed t-width would make gaps WIDER near the base
  // (large spiral radius) and trivial near the summit.
  static GAPS = [
    { t: 0.415, m: 8 },
    { t: 0.505, m: 9 },
    { t: 0.585, m: 7 },
    { t: 0.665, m: 10 },
    { t: 0.735, m: 11 },
    { t: 0.805, m: 8 },
    { t: 0.875, m: 12 },
    { t: 0.94, m: 13 },
  ];

  _computeGapWidths() {
    for (const g of Terrain.GAPS) {
      const e = 0.001;
      const a = pathXZ(g.t - e), b = pathXZ(g.t + e);
      const speed = Math.hypot(b.x - a.x, b.z - a.z) / (2 * e); // meters per t
      g.w = (g.m / 2) / speed;
    }
  }

  gapAt(t) {
    for (const g of Terrain.GAPS) if (Math.abs(t - g.t) < g.w) return g;
    return null;
  }

  pathPoint(t) {
    const q = pathXZ(t);
    return {
      x: q.x, z: q.z, angle: q.angle, t,
      h: baseProfile(q.base) + 1.5,
      width: 9.5 - t * 6.3,         // 9.5 m at the depot, 3.2 m near the summit
      gap: this.gapAt(t),
    };
  }

  // Path sample a given number of METERS further up the trail from (x, z).
  pathAheadOf(x, z, meters) {
    let i = this._nearestPath(x, z).i;
    let acc = 0;
    while (acc < meters && i < this.pathSamples.length - 1) {
      const a = this.pathSamples[i], b = this.pathSamples[++i];
      acc += Math.hypot(b.x - a.x, b.z - a.z);
    }
    return this.pathSamples[i];
  }

  // Nearest point on the route. The old version scanned all 701 samples for
  // every query, which cost 16 million iterations to build a 22 k-vertex mesh
  // and would have cost 900 million to build this one.
  //
  // `angle(t) = t * LOOPS * 2PI + A0` is strictly monotonic, so it inverts:
  // for a query at compass angle `th` the only candidates are the handful of
  // `t` where the spiral crosses that bearing — one per loop. That gives the
  // answer directly for anything plainly off-route, which is 95 % of the map,
  // and a 60-sample local refinement handles the rest.
  _nearestPath(x, z) {
    const th = Math.atan2(z, x);
    const span = LOOPS * TWO_PI;
    let bestI = -1, bestD2 = Infinity;
    for (let k = -1; k <= LOOPS + 1; k++) {
      const tc = (th + TWO_PI * k - A0) / span;
      if (tc < -0.02 || tc > 1.02) continue;
      const i = clamp(Math.round(tc * PATH_N), 0, PATH_N);
      const p = this.pathSamples[i];
      const d2 = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d2 < bestD2) { bestD2 = d2; bestI = i; }
    }
    if (bestI < 0) return this._scanPath(x, z);
    // Refine only near the trail. Further out the bearing-matched sample is
    // already correct to within the sample spacing, and every consumer of a
    // far-away answer only wants to know "not on the road".
    if (bestD2 < 60 * 60) {
      const lo = Math.max(0, bestI - 30), hi = Math.min(PATH_N, bestI + 30);
      for (let i = lo; i <= hi; i++) {
        const p = this.pathSamples[i];
        const d2 = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (d2 < bestD2) { bestD2 = d2; bestI = i; }
      }
    }
    return { p: this.pathSamples[bestI], d: Math.sqrt(bestD2), i: bestI };
  }

  // Fallback for queries whose bearing yields no candidate inside [0,1] —
  // essentially only the dead centre of the map.
  _scanPath(x, z) {
    let bestI = 0, bestD2 = Infinity;
    for (let i = 0; i <= PATH_N; i += 4) {
      const p = this.pathSamples[i];
      const d2 = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d2 < bestD2) { bestD2 = d2; bestI = i; }
    }
    return { p: this.pathSamples[bestI], d: Math.sqrt(bestD2), i: bestI };
  }

  // ---- Height field ------------------------------------------------------

  // `calm` (1 on the trail, 0 well off it) suppresses the violent terms near
  // the route. Without it the ridged noise swings +-90 m at altitude and the
  // trail carve has to cut a 90 m trench to lay a shelf; with it the route
  // reads as a bench cut into a flank rather than a canyon.
  _rawHeight(x, z, calm) {
    const w = warp(x, z, 55, 0.0026, this._w);
    const wx = w[0], wz = w[1];
    const r = Math.hypot(wx, wz);

    // Asymmetric massif: the radial falloff is modulated by compass angle, so
    // the mountain grows a broad south-west shoulder and a steep north face.
    // This one term is what ends "identical from every direction".
    const base = massifAt(wx, wz);
    const frac = base / PEAK;
    const wild = 1 - 0.8 * calm;
    let h = base;

    // Ridges. Amplitude still climbs with altitude, but far less steeply than
    // before: at frac^1.35 the mid-mountain got 17 m of relief on a 500 m peak
    // and the flanks read as a smooth heap of earth. The crests have to be
    // legible from the valley, which is where they are looked at from.
    h += (ridged(wx * 0.0042, wz * 0.0042) - 0.40) * (22 + 78 * Math.pow(frac, 0.9)) * wild;
    // Broad undulation so the lower slopes are not a clean ramp.
    h += (fbm(wx * 0.0085 + 13.7, wz * 0.0085 - 4.2) - 0.5) * (12 + 30 * frac);
    // Fine relief at roughly the grid scale. Without it the finest feature on
    // the mountain is 14 m across, every 2 m facet interpolates smoothly
    // between its neighbours, and a meadow reads as moulded plastic. Suppressed
    // near the trail, which is meant to be walkable rather than lumpy.
    // calm^3, not calm: ridge suppression needs a 50 m halo around the trail,
    // but flattening the fine relief that far out leaves a smooth moulded
    // corridor down the whole route. Cubing pulls the flattening in tight to
    // the road surface itself.
    h += (fbm(wx * 0.055 + 61.3, wz * 0.055 - 17.9) - 0.5) * (1.4 + 2.2 * frac) * (1 - 0.8 * calm * calm * calm);

    // Stratified benches through the middle of the mountain: a soft
    // quantisation onto 15 m steps. Bedding planes read strongly on rock and
    // give the cliff band the identity the palette already promises it.
    // Strength 0.2, not 0.5, and the step is phase-shifted by noise. At half
    // strength on a fixed 15 m grid the quantisation is a perfect contour: seen
    // from the valley the entire upper mountain was a wedding cake, and crossed
    // with the radial gullies it was a waffle. Terracing has to read as bedding
    // that happens to be roughly horizontal, not as a lathe.
    const terr = Math.max(0, 1 - Math.abs(frac - 0.5) * 4.6) * calmInv(calm);
    if (terr > 0) {
      const step = 13 + fbm(wx * 0.003 + 31, wz * 0.003 - 12) * 9;
      const q = h / step, fl = Math.floor(q);
      h = lerp(h, (fl + smoothstep(q - fl, 0.30, 0.80)) * step, terr * 0.2);
    }

    // Glacier cirque scooped out of the flank. The seracs in landmarks.js sit
    // in this basin, which is why both read the same constants.
    const cd = Math.hypot(x - CIRQUE.x, z - CIRQUE.z) / CIRQUE.r;
    if (cd < 1) h -= CIRQUE.depth * Math.pow(1 - cd * cd, 1.5) * wild;

    // The tarn. A dished basin held at a level derived from the mean surface,
    // so the water plane above it always meets a shore rather than floating
    // over a slope or drowning in one.
    const ld = Math.hypot(x - LAKE.x, z - LAKE.z) / LAKE.r;
    if (ld < 1.2) {
      h = lerp(h, LAKE_Y - 6 * (1 - Math.min(ld, 1) ** 2), 1 - smoothstep(ld, 0.7, 1.2));
    }

    // Radial gullies. Sampling on the unit direction — times a radial term
    // that bends them — keeps the channels running downhill, and unlike an
    // atan2 term it leaves no seam along the +x axis.
    const inv = 9 / (r + 1);
    const chan = 1 - Math.abs(fbm(wx * inv + r * 0.0035, wz * inv + 7.3) - 0.5) * 2.6;
    if (chan > 0) h -= chan * chan * 13 * frac * wild;

    // Flatten to the water line at the rim.
    return h * (1 - smoothstep(Math.hypot(x, z), RIM0, RIM1));
  }

  _buildGrid() {
    const t0 = performance.now();
    const grid = this.grid = new Float32Array(W * W);
    const mix = new Float32Array(W * W);      // how much of each point is trail

    // ---- Pass 1: heights + trail carve ----
    for (let gz = 0; gz < W; gz++) {
      const z = -WORLD_R + gz * CELL;
      for (let gx = 0; gx < W; gx++) {
        const x = -WORLD_R + gx * CELL;
        const { p, d } = this._nearestPath(x, z);
        const calm = 1 - smoothstep(d, 16, 52);
        let h = this._rawHeight(x, z, calm);
        let pathMix = 0;
        // Asymmetric, like a real bench cut: a short blend where the trail is
        // dug INTO the hillside, a long one where it is filled out over the
        // drop. Symmetric at 6 m the shelf ended in a sheer face all the way
        // round the spiral, and from a kilometre out the mountain wore a
        // terrace ring nobody asked for.
        const blend = h > p.h ? 9 : 15;
        if (p.gap) {
          // Chasm: drop well below trail level so falling in costs real height.
          const chasmH = p.h - 20;
          if (d < p.width + 1.5) h = Math.min(h, chasmH);
          else if (d < p.width + blend) {
            const k = 1 - smoothstep(d - p.width - 1.5, 0, blend - 1.5);
            h = Math.min(h, lerp(h, chasmH, k));
          }
        } else if (d < p.width) { h = p.h; pathMix = 1; }
        else if (d < p.width + blend) {
          const k = 1 - smoothstep(d - p.width, 0, blend);
          h = lerp(h, p.h, k);
          pathMix = k;
        }
        const i = gz * W + gx;
        grid[i] = h;
        mix[i] = pathMix;
      }
    }

    this._paintGrid(mix);
    this.buildMs = performance.now() - t0;
    console.info(`[terrain] ${W}x${W} grid in ${this.buildMs.toFixed(0)} ms`);
  }

  // ---- Pass 2: colour and rockiness, both slope-aware ----
  _paintGrid(mix) {
    const grid = this.grid;
    const col8 = this._col = new Uint8Array(W * W * 3);
    const rock8 = this._rock = new Uint8Array(W * W);
    const cFlower = [new THREE.Color(OBJ.liveryGold), new THREE.Color(0xff7bac), new THREE.Color(0xffffff)];
    const col = new THREE.Color();
    const tmp = new THREE.Color();

    for (let gz = 0; gz < W; gz++) {
      for (let gx = 0; gx < W; gx++) {
        const i = gz * W + gx;
        const x = -WORLD_R + gx * CELL, z = -WORLD_R + gz * CELL;
        const h = grid[i];
        // Slope is measured over a 4 m baseline, not 2 m. It decides whether a
        // face is bare rock, and the fine-relief octave above puts a metre of
        // wobble on every vertex — on a one-cell stencil that wobble alone
        // reads as a cliff and turns the whole meadow to scree.
        const hx0 = grid[gz * W + Math.max(gx - 2, 0)], hx1 = grid[gz * W + Math.min(gx + 2, W - 1)];
        const hz0 = grid[Math.max(gz - 2, 0) * W + gx], hz1 = grid[Math.min(gz + 2, W - 1) * W + gx];
        const slope = Math.hypot(hx1 - hx0, hz1 - hz0) / (4 * CELL);
        const lap = (hx0 + hx1 + hz0 + hz1 - 4 * h) / (2 * CELL);

        // The jitter is what keeps a band edge from reading as a drawn contour
        // line: it shuffles each vertex across the cross-fade.
        const jitter = (fbm(x * 0.03, z * 0.03) - 0.5) * 26;
        const band = bandFloat((h + jitter) / PEAK);
        bandColor('terrainA', band, col);
        bandColor('terrainB', band, tmp);
        col.lerp(tmp, fbm(x * 0.04, z * 0.04));

        // Flower speckle, fading out as the meadow gives way to pines.
        // Per-VERTEX, not per-noise-lobe. Sampling fbm at high frequency on a
        // 2 m grid aliases into slow blobs, and the meadow ended up with metre-
        // wide smears of pink across it rather than flowers.
        if (band < 1) {
          const f = rand2(Math.round(x * 2.1), Math.round(z * 2.1));
          // Barely a tint. One coloured vertex on a smooth-shaded 2 m grid
          // spreads across four square meters, so anything stronger than this
          // paints dinner plates on the meadow rather than flowers. The actual
          // flowers are instanced geometry in scatter.js.
          if (f > 0.9 && slope < 0.5) col.lerp(cFlower[(f * 977) % 3 | 0], 0.22 * (1 - band));
        }

        // Snow only sticks where it is flat. In the two cold bands the slope
        // threshold drops hard, so steep faces stay bare rock all the way to
        // the summit — that single rule is the difference between a mountain
        // under snow and a white cone.
        const snowy = smoothstep(band, 2.4, 3.2);
        const rockK = smoothstep(slope, lerp(0.85, 0.42, snowy), lerp(1.70, 1.05, snowy));
        col.lerp(bandColor('rock', band, tmp), rockK * 0.9);

        // Bedding planes on anything steep enough to read as a face. Cheapest
        // possible geology, and it is legible at 200 m.
        if (rockK > 0.3) {
          const s = Math.sin(h * 0.62 + fbm(x * 0.02, z * 0.02) * 6) * 0.08;
          col.multiplyScalar(1 + s * rockK);
        }

        // Crevice shading: concave areas darken, ridges brighten slightly.
        col.multiplyScalar(clamp(1 + lap * 0.05 - Math.max(slope - 1.6, 0) * 0.12, 0.72, 1.12));

        // Crisp trail. In the two cold bands `trail` is the only warm tone on
        // the mountain — that, not brightness, keeps the path visible on snow.
        // Opacity climbs with altitude: a faint track through the meadow that
        // gives the band its name, fully opaque where it is the only thing
        // telling you where the ground continues.
        const pm = mix[i];
        if (pm > 0.45) {
          col.lerp(bandColor('trail', band, tmp),
            Math.min((pm - 0.45) / 0.4, 1) * Math.min(0.30 + 0.17 * band, 0.95));
        }

        col8[i * 3] = col.r * 255; col8[i * 3 + 1] = col.g * 255; col8[i * 3 + 2] = col.b * 255;
        rock8[i] = rockK * 255;
      }
    }
  }

  heightAt(x, z) {
    const gx = ((x + WORLD_R) / SIZE) * SEGMENTS;
    const gz = ((z + WORLD_R) / SIZE) * SEGMENTS;
    const x0 = clamp(Math.floor(gx), 0, SEGMENTS - 1);
    const z0 = clamp(Math.floor(gz), 0, SEGMENTS - 1);
    const fx = gx - x0, fz = gz - z0;
    const h00 = this.grid[z0 * W + x0], h10 = this.grid[z0 * W + x0 + 1];
    const h01 = this.grid[(z0 + 1) * W + x0], h11 = this.grid[(z0 + 1) * W + x0 + 1];
    return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fz);
  }

  // Rise over run at a world position. Scatter asks this a hundred thousand
  // times, so it reads the grid directly rather than calling heightAt four
  // times and paying for four bilinear interpolations.
  slopeAt(x, z) {
    const gx = clamp(Math.round((x + WORLD_R) / CELL), 1, W - 2);
    const gz = clamp(Math.round((z + WORLD_R) / CELL), 1, W - 2);
    const g = this.grid;
    return Math.hypot(g[gz * W + gx + 1] - g[gz * W + gx - 1],
      g[(gz + 1) * W + gx] - g[(gz - 1) * W + gx]) / (2 * CELL);
  }

  // ---- Visual chunks -----------------------------------------------------

  _buildChunks() {
    this.mesh = new THREE.Group();
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    // Smooth base normals, flat facets only where the vertex says "rock". Grass
    // and snowfields flow; faces and ridgelines stay hard.
    patchMaterial(this.mat, { faceBlend: true });

    const start = this.pathPoint(0.02);
    for (let cz = 0; cz < CHUNKS; cz++) {
      for (let cx = 0; cx < CHUNKS; cx++) {
        const c = {
          cx, cz, lod: -1, mesh: null,
          x: -WORLD_R + (cx + 0.5) * CHUNK_CELLS * CELL,
          z: -WORLD_R + (cz + 0.5) * CHUNK_CELLS * CELL,
        };
        this.chunks.push(c);
        this._applyLod(c, this._lodFor(c, start.x, start.z));
      }
    }
    this.ctx.scene.add(this.mesh);
  }

  _lodFor(c, camX, camZ) {
    const d = Math.hypot(c.x - camX, c.z - camZ);
    // Hysteresis: a chunk sitting exactly on a boundary must not rebuild every
    // frame as the camera breathes.
    const slack = c.lod < 0 ? 0 : 0.12;
    if (d < this.lod0R * (c.lod === 0 ? 1 + slack : 1)) return 0;
    if (d < this.lod1R * (c.lod <= 1 ? 1 + slack : 1)) return 1;
    return 2;
  }

  _applyLod(c, lod) {
    if (c.lod === lod) return;
    const geo = this._chunkGeometry(c.cx, c.cz, lod);
    if (c.mesh) {
      c.mesh.geometry.dispose();
      c.mesh.geometry = geo;
    } else {
      c.mesh = new THREE.Mesh(geo, this.mat);
      c.mesh.receiveShadow = true;
      c.mesh.castShadow = false;
      this.mesh.add(c.mesh);
    }
    c.lod = lod;
  }

  _chunkGeometry(cx, cz, lod) {
    const stride = LOD_STRIDE[lod];
    const n = CHUNK_CELLS / stride;
    const vw = n + 1;
    const core = vw * vw;
    const total = core + 4 * vw;             // core grid plus a skirt per edge
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const rk = new Float32Array(total);
    const grid = this.grid, col8 = this._col, rock8 = this._rock;

    // Normals come from the FULL-resolution grid at every LOD. That costs
    // nothing extra and buys the one thing that matters: when a chunk swaps
    // detail level its lighting does not change, so the geometry pop is a
    // silhouette shift rather than a flash across the whole surface.
    const put = (vi, gx, gz, drop) => {
      const i = gz * W + gx;
      pos[vi * 3] = -WORLD_R + gx * CELL;
      pos[vi * 3 + 1] = grid[i] - drop;
      pos[vi * 3 + 2] = -WORLD_R + gz * CELL;
      const hx0 = grid[gz * W + Math.max(gx - 1, 0)], hx1 = grid[gz * W + Math.min(gx + 1, W - 1)];
      const hz0 = grid[Math.max(gz - 1, 0) * W + gx], hz1 = grid[Math.min(gz + 1, W - 1) * W + gx];
      const nx = hx0 - hx1, ny = 2 * CELL, nz = hz0 - hz1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nor[vi * 3] = nx / len; nor[vi * 3 + 1] = ny / len; nor[vi * 3 + 2] = nz / len;
      col[vi * 3] = col8[i * 3] / 255;
      col[vi * 3 + 1] = col8[i * 3 + 1] / 255;
      col[vi * 3 + 2] = col8[i * 3 + 2] / 255;
      rk[vi] = rock8[i] / 255;
    };

    const gx0 = cx * CHUNK_CELLS, gz0 = cz * CHUNK_CELLS;
    let vi = 0;
    for (let jz = 0; jz < vw; jz++) {
      for (let jx = 0; jx < vw; jx++) put(vi++, gx0 + jx * stride, gz0 + jz * stride, 0);
    }

    const idx = [];
    for (let jz = 0; jz < n; jz++) {
      for (let jx = 0; jx < n; jx++) {
        const a = jz * vw + jx, b = a + 1, c = a + vw, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }

    // Skirts. Neighbouring chunks at different LODs leave T-junctions along
    // their shared edge; a 6 m apron hanging off every border hides the pinhole
    // without any of the stitching bookkeeping a seamless solution needs.
    // Both windings are emitted: which way a given edge faces depends on the
    // chunk's position on the map, and 1200 extra indices is cheaper than
    // being wrong about it.
    const edges = [
      { fx: (j) => gx0 + j * stride, fz: () => gz0 },
      { fx: (j) => gx0 + j * stride, fz: () => gz0 + CHUNK_CELLS },
      { fx: () => gx0, fz: (j) => gz0 + j * stride },
      { fx: () => gx0 + CHUNK_CELLS, fz: (j) => gz0 + j * stride },
    ];
    const coreIndexOf = [
      (j) => j,                        // top row
      (j) => n * vw + j,               // bottom row
      (j) => j * vw,                   // left column
      (j) => j * vw + n,               // right column
    ];
    edges.forEach((e, ei) => {
      const base = vi;
      for (let j = 0; j < vw; j++) put(vi++, e.fx(j), e.fz(j), SKIRT);
      for (let j = 0; j < n; j++) {
        const a = coreIndexOf[ei](j), b = coreIndexOf[ei](j + 1);
        const c = base + j, d = base + j + 1;
        idx.push(a, c, b, b, c, d, a, b, c, b, d, c);
      }
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aRock', new THREE.BufferAttribute(rk, 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return geo;
  }

  // Called every frame: pull nearby chunks up to detail, push far ones down.
  // Budgeted, because rebuilding a 2601-vertex geometry is cheap but rebuilding
  // forty of them in one frame is not.
  _updateLod() {
    const cam = this.ctx.camera.position;
    let budget = 2;
    // Nearest-first, so walking into a region resolves the ground you are about
    // to stand on before the scenery behind it.
    let cands = null;
    for (const c of this.chunks) {
      const want = this._lodFor(c, cam.x, cam.z);
      if (want === c.lod) continue;
      (cands ??= []).push(c);
    }
    if (!cands) return;
    cands.sort((a, b) => (a.x - cam.x) ** 2 + (a.z - cam.z) ** 2 - ((b.x - cam.x) ** 2 + (b.z - cam.z) ** 2));
    for (const c of cands) {
      if (budget-- <= 0) break;
      this._applyLod(c, this._lodFor(c, cam.x, cam.z));
    }
  }

  setLodRadii(r0, r1) {
    this.lod0R = r0;
    this.lod1R = r1;
  }

  // ---- Collider ----------------------------------------------------------

  _buildCollider() {
    const { physics } = this.ctx;
    const R = physics.RAPIER;
    // Rapier wants the height matrix COLUMN-major; our grid is row-major. Get
    // this backwards and the collider is the terrain mirrored about its
    // diagonal — no crash, no warning, just a world where the ground is not
    // where it is drawn. scripts/verify.mjs probes for exactly this.
    const heights = new Float32Array(W * W);
    for (let gz = 0; gz < W; gz++) {
      for (let gx = 0; gx < W; gx++) heights[gx * W + gz] = this.grid[gz * W + gx];
    }
    const body = physics.world.createRigidBody(R.RigidBodyDesc.fixed());
    const desc = R.ColliderDesc
      .heightfield(SEGMENTS, SEGMENTS, heights, { x: SIZE, y: 1, z: SIZE },
        R.HeightFieldFlags?.FIX_INTERNAL_EDGES)
      .setFriction(0.85);
    this.collider = physics.world.createCollider(desc, body);
  }

  // ---- Floating islands --------------------------------------------------

  // The last stretch to the summit is an island-hopping gauntlet. They bob and
  // drift — everything up here is barely attached to reality.
  _buildIslands() {
    const { physics, scene } = this.ctx;
    const R = physics.RAPIER;
    const end = this.pathPoint(1);
    const islandMat = new THREE.MeshStandardMaterial({ color: OBJ.islandTop, flatShading: true, roughness: 0.9 });
    const underMat = new THREE.MeshStandardMaterial({ color: OBJ.islandUnder, flatShading: true, roughness: 0.95 });

    const defs = [];
    const n = 6;
    for (let i = 0; i < n; i++) {
      const k = (i + 1) / n;
      const a = end.angle + 0.9 + k * 3.4;
      const r = 40 + Math.sin(i * 2.4) * 14;
      defs.push({
        x: Math.cos(a) * r * (1 - k * 0.75),
        z: Math.sin(a) * r * (1 - k * 0.75),
        y: end.h + 9 + k * 34,
        s: i === n - 1 ? 11 : 5.4 - k * 1.5,
        phase: i * 1.7,
        bob: i === n - 1 ? 0.6 : 1.6,
      });
    }
    this.summitIsland = null;

    for (const d of defs) {
      const group = new THREE.Group();
      const top = new THREE.Mesh(new THREE.CylinderGeometry(d.s, d.s * 0.82, 1.6, 7), islandMat);
      top.castShadow = top.receiveShadow = true;
      const bottom = new THREE.Mesh(new THREE.ConeGeometry(d.s * 0.8, d.s * 1.5, 7), underMat);
      bottom.rotation.x = Math.PI;
      bottom.position.y = -d.s * 0.75 - 0.8;
      bottom.castShadow = true;
      group.add(top, bottom);
      scene.add(group);

      const body = physics.world.createRigidBody(
        R.RigidBodyDesc.kinematicPositionBased().setTranslation(d.x, d.y, d.z),
      );
      physics.world.createCollider(R.ColliderDesc.cylinder(0.8, d.s).setFriction(1.0), body);

      const isl = { group, body, base: new THREE.Vector3(d.x, d.y, d.z), phase: d.phase, bob: d.bob, radius: d.s };
      this.islands.push(isl);
      if (d.s > 8) this.summitIsland = isl;
    }
  }

  update(dt, t) {
    this._updateLod();
    this.backdrop.update(dt, t);
    this.scatter.update(dt, t);
    this.landmarks.update(dt, t);
    // Bobbing islands (kinematic so they carry the player).
    for (const isl of this.islands) {
      const y = isl.base.y + Math.sin(t * 0.6 + isl.phase) * isl.bob;
      const x = isl.base.x + Math.sin(t * 0.35 + isl.phase * 2) * 1.2;
      isl.body.setNextKinematicTranslation({ x, y, z: isl.base.z });
      isl.group.position.set(x, y, isl.base.z);
    }
  }
}

// Route geometry without the gap lookup, so gap widths can be measured from it
// during construction before any gap exists.
function pathXZ(t) {
  const angle = t * LOOPS * TWO_PI + A0;
  const base = R_OUT + (R_IN - R_OUT) * Math.pow(t, 0.95);
  // The trail bulges in and out instead of drawing one lazy arc, and wobbles
  // harder on the steep upper flank where a clean traverse would read as a
  // drawn line rather than a path someone wore into a mountain.
  const wob = 0.045 + 0.055 * smoothstep(t, 0.42, 0.78);
  const radius = base * (1 + wob * Math.sin(t * 41) + wob * 0.6 * Math.sin(t * 17 + 1.7));
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, angle, base };
}

// Terracing is suppressed near the trail along with everything else violent.
function calmInv(calm) {
  return 1 - 0.7 * calm;
}
