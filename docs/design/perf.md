<!--
  RAW DESIGN SPEC — Performance, quality tiers, test/CI

  Provenance: written by an independent design agent against commit 3602969, then
  reviewed by two critics (see critique-feasibility.md / critique-coherence.md).

  THIS DOCUMENT IS NOT THE PLAN. Where it disagrees with docs/design/README.md or
  the approved v4 plan, THE PLAN WINS. Six specs were written blind to each other and
  four of them rewrite the same files incompatibly; the conflicts are resolved in the
  plan, not here. Read this for the reasoning and the raw values, not for the decisions.

  NOTE: its Post/tone-mapping pipeline wins, its instancing rewrite does NOT (plan B1, B3). Its crate-instancing blocker claim is factually wrong.
-->

# PERFORMANCE, QUALITY TIERS & TEST/CI INFRASTRUCTURE — Implementation Spec

Verified against: `main.js` (292 L), `physics.js` (144 L), `particles.js` (205 L), `terrain.js` (548 L), `cablecar.js` (228 L), `props.js` (481 L), `director.js` (385 L), `hud.js` (153 L), `character.js` (408 L), `deliveries.js`, `packages.js`, `index.html` (232 L), `scripts/verify.mjs` (397 L), `vite.config.js`, `deploy.yml`, `package.json`, `node_modules/three@0.170.0/examples/jsm/postprocessing/*`.

---

## 0. MEASURED BASELINE (counted, not estimated)

| Source | Draw calls (color pass) | Notes |
|---|---|---|
| `terrain.js` mesh + sea + 8 InstancedMesh | 11 | |
| `terrain.js` islands (6 × 2) | 12 | `_buildIslands` L295-314 |
| `terrain.js` crystals | 14 | individual `Mesh`, shared geo+mat, L387 |
| `terrain.js` birds (3 flocks × 4) | 12 | L494-503 |
| `terrain.js` clouds (12 groups × 3-5 blobs) | **~48** | each blob its own `IcosahedronGeometry`, L512 — **transparent** |
| `props.js` mushrooms (20 × 3) | **60** | 9 + 3 + 8-per-gap; L39-46, L78 |
| `props.js` pendulums (4 × 5) | 20 | L95-111 |
| `props.js` crates / planks / geysers / seesaws / elevators | 11 / 6 / 4 / 6 / 2 | |
| `cablecar.js` stations (5 × 6) | 30 | L37-49 |
| `cablecar.js` pylons (8 × 2) | 16 | `upLineCount=13`, skip `i%3===0` |
| `cablecar.js` gondolas (6 × 7) | **42** | L136-154 |
| `cablecar.js` cable tube | 1 | |
| `deliveries.js` huts (8 × 2) + beacon(3) + shock | 20 | |
| `packages.js` current parcel + kiosk + ring + preview | ~9 | |
| `character.js` rig (6 parts + 5 caps) + chute (6, hidden) | 11 | |
| `main.js` sky | 1 | |
| `particles.js` | 3 | |
| `director.js` bolt + live hazards (≤5 boulder, ≤6 icicle, ≤14 snowball) | 1 + ≤25 | |
| **TOTAL colour pass** | **~336 idle → ~361 peak** | |
| **+ shadow depth pass** (~250 casters) | **~590 GPU draws/frame** | shadow draws DO count in `renderer.info.render.calls` |

Vertices: terrain 22 801 (45 000 tris) + everything else ≈ 60 000 tris. **This scene is draw-call- and fill-bound, never vertex-bound.** Every optimisation below targets draw calls and fill rate. Nothing targets vertex count.

---

## A) QUALITY TIER SYSTEM

### A.1 New file: `src/core/quality.js`

**Exported API**

```js
export const TIER_ORDER = ['low', 'medium', 'high'];   // ordered worst → best
export const TIERS;                                     // Record<name, TierDef>
export function detectTier(renderer): 'low'|'medium'|'high';
export class Quality {
  constructor(ctx)                       // reads ?quality=, then localStorage, then detectTier()
  get tier(): TierDef
  get current(): string                  // resolved tier name
  get mode(): 'auto'|'low'|'medium'|'high'
  setMode(mode): void                    // user-driven; persists
  applyPixelRatio(): void                // renderer.setPixelRatio + setSize + post.setSize
  resetGrace(sec?): void                 // suppress auto decisions for N s
  sample(realDt): void                   // call EVERY frame from frame()
}
```

`ctx.quality` is a new `ctx` field. `Quality._apply()` pokes subsystems **directly** (`this.ctx.post?.setTier(t)`, `this.ctx.particles?.setTier(t)`, `this.ctx.terrain?.setTier(t)`) with `?.` guards — same style as `this.ctx.hud.toast(...)`. **No event bus is introduced.**

### A.2 The tier table (authoritative)

```js
import * as THREE from 'three';

export const TIER_ORDER = ['low', 'medium', 'high'];

export const TIERS = {
  low: {
    name: 'low',
    // --- resolution ---
    maxDpr: 1.00,  maxPixels: 2.30e6,
    // --- shadows: the PROGRAM KEY never changes across tiers (see A.4) ---
    shadowMapSize: 512,  shadowBox: 24,  shadowBias: -0.0012,
    // --- composer ---
    msaa: 0,
    bloom: false, bloomScale: 0.50, bloomStrength: 0.00, bloomRadius: 0.50, bloomThreshold: 1.20,
    fxaa: false,  grain: 0.000,   vignette: 0.34,
    // --- particles (RATES ONLY — pools are never resized, see A.5) ---
    particleScale: 0.35, snowScale: 0.25, burstScale: 0.40,
    // --- decor instance counts (collider-free meshes only, see A.6) ---
    decor: { poles: 20, lamps: 20, tufts: 90,  spines: 16, scaps: 16, crystals: 8,  birds: 4,  clouds: 5  },
    // --- draw distance ---
    fogNear: 70, fogFar: 380, cameraFar: 900,
    seaWaves: false,
  },
  medium: {
    name: 'medium',
    maxDpr: 1.25,  maxPixels: 3.70e6,
    shadowMapSize: 1024, shadowBox: 48, shadowBias: -0.0006,
    msaa: 0,
    bloom: true,  bloomScale: 0.50, bloomStrength: 0.50, bloomRadius: 0.50, bloomThreshold: 1.15,
    fxaa: true,   grain: 0.010,    vignette: 0.32,
    particleScale: 0.70, snowScale: 0.60, burstScale: 0.75,
    decor: { poles: 46, lamps: 46, tufts: 200, spines: 30, scaps: 30, crystals: 14, birds: 8,  clouds: 9  },
    fogNear: 85, fogFar: 480, cameraFar: 1100,
    seaWaves: true,
  },
  high: {
    name: 'high',
    maxDpr: 1.50,  maxPixels: 8.30e6,
    shadowMapSize: 2048, shadowBox: 55, shadowBias: -0.0004,
    msaa: 4,
    bloom: true,  bloomScale: 1.00, bloomStrength: 0.55, bloomRadius: 0.45, bloomThreshold: 1.10,
    fxaa: true,   grain: 0.012,    vignette: 0.30,
    particleScale: 1.00, snowScale: 1.00, burstScale: 1.00,
    decor: { poles: 46, lamps: 46, tufts: 320, spines: 40, scaps: 40, crystals: 14, birds: 12, clouds: 12 },
    fogNear: 90, fogFar: 560, cameraFar: 1200,
    seaWaves: true,
  },
};
```

`maxDpr` **and** `maxPixels` both apply; the effective DPR is the min of three terms:

```js
applyPixelRatio() {
  const t = this.tier;
  const w = window.innerWidth, h = window.innerHeight;
  const dpr = Math.max(0.5, Math.min(
    window.devicePixelRatio || 1,
    t.maxDpr,
    Math.sqrt(t.maxPixels / Math.max(w * h, 1)),   // hard megapixel budget
  ));
  this.dpr = dpr;
  this.ctx.renderer.setPixelRatio(dpr);
  this.ctx.renderer.setSize(w, h);
  this.ctx.post?.setSize(w, h, dpr);
}
```

Resulting drawing-buffer sizes:

| Display / dpr | low | medium | high |
|---|---|---|---|
| 1920×1080 @1 | 1.00 → 2.07 Mpx | 1.25 → 3.24 Mpx | 1.50 → 4.67 Mpx |
| 1920×1080 @2 | 1.00 → 2.07 Mpx | 1.25 → 3.24 Mpx | 1.50 → 4.67 Mpx |
| 2560×1440 @1 | 0.79 → 2.30 Mpx | 1.00 → 3.69 Mpx | 1.50 → 8.30 Mpx |
| 3840×2160 @2 | 0.53 → 2.30 Mpx | 0.67 → 3.70 Mpx | 1.00 → 8.29 Mpx |

The DPR cap does the work on retina 1080p; the megapixel cap does the work on 4K. **Both are required.** `setPixelRatio` accepts fractional values (three floors only at `setSize`).

### A.3 What is safe to change at RUNTIME vs BOOT-ONLY

| Knob | Runtime? | Why |
|---|---|---|
| pixel ratio / canvas size | **yes** | pure RT realloc |
| shadow map size, shadow box, bias | **yes** | see A.4 — needs `sun.shadow.map.dispose(); sun.shadow.map = null` |
| `renderer.shadowMap.enabled` toggle | **NO (avoid)** | changes the program cache key → full recompile of every material (200–500 ms stall). Tiers must never touch it. |
| bloom on/off, strength/radius/threshold | **yes** (enabled flag) | |
| bloom **resolution scale** | rebuild pass | `UnrealBloomPass` allocates 11 RTs in its ctor; call `bloom.setSize(w*s, h*s)` |
| MSAA sample count | **rebuild composer** | `WebGLRenderTarget.samples` change requires a new RT |
| FXAA on/off | **yes** (`pass.enabled`) | |
| grade pass params | **yes** | uniforms |
| particle **spawn rates** | **yes** | multipliers only |
| particle **pool size** (`max`) | **NO — never do it** | reallocates 3 `BufferGeometry`. See A.5: pools cost nothing, rates cost everything. |
| decor `.count` on **poles/lamps/tufts/spines/scaps/crystals/birds/clouds** | **yes** | these have **no colliders** |
| decor `.count` on **trees/trunks/rocks** | **NO — boot only** | `terrain.js:345`, `:371` create a Rapier collider per placed instance. Lowering `.count` at runtime leaves **invisible collidable trees**. If you tier these at all, tier the placement loop cap at construction and create colliders to match. Recommendation: **don't tier them at all** — 3 draw calls total. |
| `scene.fog.near/far`, `camera.far` | **yes** | note `main.js:236` overwrites `fog.color` each frame — near/far are untouched by that |
| **`SEGMENTS = 150`** (`terrain.js:39`) | **NEITHER — out of scope** | It feeds three coupled things: the visual `PlaneGeometry`, `this.grid` (which `heightAt()` samples — used by props placement, director spawns, cablecar pads, and `verify.mjs:115`), **and the Rapier trimesh collider** (`_buildCollider`, L258-267). Changing it changes the *physical world*: gap edges, plank alignment, spawn heights, and therefore scores. Cross-tier score comparability and meta-progression require one world. 22 801 verts is ~0.05 % of the frame cost. **Verdict: SEGMENTS is a constant. Do not make it a tier knob at any level.** |

### A.4 Shadows without recompiles

`renderer.shadowMap.enabled` and "number of shadow-casting lights" are both part of the WebGL program cache key. Toggling either recompiles every `MeshStandardMaterial` in the scene. Therefore:

* `renderer.shadowMap.enabled = true` and `renderer.shadowMap.type = THREE.PCFSoftShadowMap` are set **once** at `main.js:22-23` and **never** touched by tiers.
* `sun.castShadow = true` always.
* Low tier reduces cost by **shrinking the ortho box from 55 m to 24 m** (`shadowBox`). The sun re-centres on the player every frame (`main.js:225-226`), so a 24 m box still shadows the courier, the parcel and the immediate trail — but culls ~90 % of the depth-pass draws (250 → ~20).
* **Do not** use `shadowMap.autoUpdate = false` + every-Nth-frame refresh: the shadow camera moves with the player each frame, so a 3-frame stale map offsets shadows by ~0.5 m at 10 m/s. Visibly swimming. Shrinking the box is flicker-free and saves more.
* A user-facing **"Shadows: Off"** switch may exist in settings as a *manual* option that accepts the one-time recompile — and §E pre-warms the no-shadow program variant so even that is cheap.

Runtime resize of the shadow map:

```js
if (sun.shadow.mapSize.x !== t.shadowMapSize) {
  sun.shadow.map?.dispose();          // three will not resize an existing FBO
  sun.shadow.map = null;
  sun.shadow.mapSize.set(t.shadowMapSize, t.shadowMapSize);
  const S = t.shadowBox;
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = t.shadowBias;
  sun.shadow.needsUpdate = true;
}
```

### A.5 Particles: tier the RATES, never the POOLS

`particles.js:100-104` allocates 1500 + 800 + 1600 = 3900 particles. Per particle that is `pos(3)+col(3)+size(1)+vel(3)+life+maxLife+grav+drag+baseSize` ≈ 60 B → **234 KB total.** Resizing that at runtime buys nothing and churns three `BufferGeometry` objects.

GPU cost is `max` vertices per `Points` draw (dead particles get `psize = 0`, `gl_PointSize = 0`, discarded pre-raster). 3900 vertices per frame is free. **All real cost is fill from live particles.** Therefore tier only:

* `particles.js:116` — `const rate = (12 + altitude01 * 220) * this.snowScale;` (232/s → 58/s on low)
* `particles.js:134` — `const streakRate = (gust > 0.35 ? gust * 24 : 0) * Math.min(windLen/12, 1.5) * this.particleScale;`
* `particles.js:153` — `for (let i = 0, n = Math.ceil(count * this.burstScale); i < n; i++)`

Constructor default: `this.particleScale = this.snowScale = this.burstScale = 1;` so behaviour is unchanged before `setTier` runs.

```js
// particles.js — add to class Particles
setTier(t) {
  this.particleScale = t.particleScale;
  this.snowScale = t.snowScale;
  this.burstScale = t.burstScale;
}
```

The additive `glow` pool (800, `AdditiveBlending`, size 2.0 in `explosion()`) is the worst fill offender — a close-range explosion covers the screen several times over, and with bloom on it is sampled again through the whole mip chain. `burstScale` is the lever for that.

### A.6 Decor counts must degrade *spatially*, not *by index*

`terrain.js` fills the lantern instances in ascending path order (`L425: t = 0.02 + (k/nLan)*0.95`). Lowering `.count` from 46 to 20 deletes **everything above t ≈ 0.42** — the entire upper mountain goes unlit. Same for `tufts`, `spines/scaps`, `crystals`, `birds`, `clouds`.

Fix at build time — write instance matrices in a bit-reversal-ish stride order so **any prefix is spatially well distributed**:

```js
// terrain.js — module-level helper
function strideOrder(n) {
  const out = [], seen = new Uint8Array(n);
  for (let step = n; ; step = Math.max(1, step >> 1)) {
    for (let i = 0; i < n; i += step) if (!seen[i]) { seen[i] = 1; out.push(i); }
    if (step === 1) break;
  }
  return out;
}
```

Apply it when writing `setMatrixAt(slot, m)` — i.e. `slot = order[li]` instead of `slot = li`. Then `setTier` is a one-liner:

```js
// terrain.js — add to class Terrain
setTier(t) {
  const d = t.decor, im = this._im, max = this._imMax;
  for (const k of ['poles','lamps','tufts','spines','scaps','crystals','birds','clouds'])
    if (im[k]) im[k].count = Math.min(max[k], d[k]);
  this._seaWaves = t.seaWaves;   // gate the uTime write at terrain.js:538
}
```

`_im` / `_imMax` are new fields populated in `_decorate()`. **`trees`, `trunks`, `rocks` are deliberately absent** (colliders).

---

## B) AUTO-DOWNGRADE CONTROLLER

### B.1 Signal

The existing EMA at `main.js:191` (`fps = fps*0.95 + (1/dt)*0.05`) is a ~20-**frame** constant — at 20 fps it becomes a 1 s constant, and it is a *mean*, which hides the stutters users actually feel. Keep it (it is exposed as `window.__game.fps`, used by `verify.mjs:390`), but **do not drive tier decisions from it.**

Drive decisions from the **p95 frame time over a 120-frame window**. Percentile is robust to one GC spike and directly measures "does this stutter".

### B.2 Constants (non-overlapping bands — cannot oscillate)

| Constant | Value | Rationale |
|---|---|---|
| `WINDOW` | 120 frames | ≈2 s at 60 fps, ≈6 s at 20 fps |
| `DOWN_MS` | 22.2 ms (< 45 fps) | |
| `UP_MS` | 13.5 ms (> 74 fps) | 29 fps dead zone between the bands |
| `DOWN_STREAK` | 3 windows | ≈6 s of sustained badness before acting |
| `UP_STREAK` | 5 windows | ≈10 s of sustained headroom |
| `GRACE_S` | 6 s | after `startGame()` — shaders still linking, textures uploading |
| `COOLDOWN_S` | 3 s | after any tier change / resize / tab-visible |
| `UP_LOCKOUT_S` | 60 s | no upgrade within 60 s of a downgrade |
| `MAX_UPGRADES` | 2 per session | |
| ratchet | after any down→up→down cycle, `locked = true` for the session | kills pumping |

### B.3 Code

```js
// src/core/quality.js  (continued)

const DOWN_MS = 22.2, UP_MS = 13.5, WINDOW = 120;
const DOWN_STREAK = 3, UP_STREAK = 5;
const GRACE_S = 6, COOLDOWN_S = 3, UP_LOCKOUT_S = 60, MAX_UPGRADES = 2;

const KEY = 'ud.quality';
const readProfile  = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; } };
const writeProfile = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* private mode */ } };

function percentile(buf, p) {
  const a = Array.prototype.slice.call(buf).sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(a.length * p))];
}

export function detectTier(renderer) {
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const r = ((dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || '').toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render|angle \(google/.test(r)) return 'low';
  if (/intel/.test(r) && !/arc|iris xe|iris plus/.test(r)) return 'low';
  if ((navigator.hardwareConcurrency ?? 8) < 4) return 'low';
  if (/intel|adreno|mali|apple gpu/.test(r) || (navigator.deviceMemory ?? 8) < 4) return 'medium';
  return 'high';
}

export class Quality {
  constructor(ctx) {
    this.ctx = ctx;
    const saved = readProfile();
    const forced = new URLSearchParams(location.search).get('quality');  // CI + debug

    this.mode = (forced && (forced === 'auto' || TIERS[forced])) ? forced
              : (saved.mode ?? 'auto');
    this.current = this.mode === 'auto'
      ? (TIERS[saved.autoTier] ? saved.autoTier : detectTier(ctx.renderer))
      : this.mode;

    this.locked = false;
    this._buf = new Float32Array(WINDOW);
    this._n = 0;
    this._down = 0; this._up = 0; this._upgrades = 0;
    this._graceT = GRACE_S;
    this._lastDownT = -1e9;
    this._t = 0;
  }

  get tier() { return TIERS[this.current]; }

  resetGrace(sec = COOLDOWN_S) { this._graceT = Math.max(this._graceT, sec); this._n = 0; }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'auto') { this._upgrades = 0; this.locked = false; this.resetGrace(GRACE_S); }
    else { this.current = mode; }
    writeProfile({ mode: this.mode, autoTier: this.current });
    this._apply('manual');
  }

  sample(realDt) {
    this._t += realDt;
    if (this._graceT > 0) { this._graceT -= realDt; return; }
    if (this.mode !== 'auto' || this.locked) return;

    this._buf[this._n++] = realDt * 1000;
    if (this._n < WINDOW) return;
    this._n = 0;

    const p95 = percentile(this._buf, 0.95);
    if (p95 > DOWN_MS)      { this._down++; this._up = 0; }
    else if (p95 < UP_MS)   { this._up++;   this._down = 0; }
    else                    { this._down = 0; this._up = 0; }

    const i = TIER_ORDER.indexOf(this.current);
    if (this._down >= DOWN_STREAK && i > 0) {
      this.current = TIER_ORDER[i - 1];
      this._down = 0; this._lastDownT = this._t;
      if (this._upgrades > 0) this.locked = true;     // pumped once — stop forever
      this.resetGrace(COOLDOWN_S);
      this._apply('auto-down');
    } else if (this._up >= UP_STREAK && i < TIER_ORDER.length - 1
               && this._upgrades < MAX_UPGRADES
               && this._t - this._lastDownT > UP_LOCKOUT_S) {
      this.current = TIER_ORDER[i + 1];
      this._up = 0; this._upgrades++;
      this.resetGrace(COOLDOWN_S);
      this._apply('auto-up');
    }
  }

  _apply(reason) {
    const t = this.tier;
    const { renderer, scene, camera, sun } = this.ctx;

    this.applyPixelRatio();

    if (sun.shadow.mapSize.x !== t.shadowMapSize) {
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      sun.shadow.mapSize.set(t.shadowMapSize, t.shadowMapSize);
    }
    const S = t.shadowBox;
    sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
    sun.shadow.camera.top = S;   sun.shadow.camera.bottom = -S;
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = t.shadowBias;

    scene.fog.near = t.fogNear; scene.fog.far = t.fogFar;
    camera.far = t.cameraFar; camera.updateProjectionMatrix();

    this.ctx.post?.setTier(t);
    this.ctx.particles?.setTier(t);
    this.ctx.terrain?.setTier(t);

    if (this.mode === 'auto') writeProfile({ mode: 'auto', autoTier: this.current });
    if (reason === 'auto-down') this.ctx.hud?.qualityToast(this.current);
    this.ctx.hud?.setQualityBadge(this.mode, this.current);
    this.ctx.needsRepaint?.();
  }
}
```

### B.4 Wiring in `main.js`

* `main.js:191`, immediately after the fps EMA: `ctx.quality.sample(realDt);`
* `startGame()` (`main.js:149`): `ctx.quality.resetGrace(6);`
* Resize handler: `ctx.quality.resetGrace();` (resizing tanks fps for a beat — must not trigger a downgrade)
* New `visibilitychange` listener: `if (!document.hidden) ctx.quality.resetGrace();` (returning from a background tab yields one 500 ms frame)

### B.5 User-visible behaviour

| Event | What the user sees |
|---|---|
| **auto-downgrade** | one small toast via the existing `hud.toast(text, true)` path, in-voice. EN: `"⚙ Cost-saving measures applied. Graphics: MEDIUM."` DE (rewritten, not translated): `"⚙ Sparmaßnahmen in Kraft. Grafik: MITTEL."` |
| **auto-upgrade** | **nothing.** Silent. Toasting an upgrade invites the user to notice churn and second-guess the system. |
| **always** | a persistent badge in the pause/settings panel: `Auto (currently: Medium)`. New HUD API: `hud.setQualityBadge(mode, tier)` writing to `#hud-quality-badge`. |
| **manual** | picking Low/Medium/High in settings calls `setMode(name)` → `mode !== 'auto'` → `sample()` returns immediately. Auto is **fully disabled**, never silently re-enabled. Picking "Auto" restarts from the current tier with counters reset. |

Persistence: `localStorage['ud.quality'] = {mode, autoTier}`. `?quality=` overrides both. All `localStorage` access is wrapped in `try/catch` — **an unguarded access throws in sandboxed/3rd-party contexts and would fail `verify.mjs`'s error gate.**

---

## C) COMPOSER COST MODEL

### C.1 The pipeline

`RenderPass → [UnrealBloomPass] → [FXAA ShaderPass] → GradePass(renderToScreen)`

**Grade replaces `OutputPass`.** It does ACES tonemap + lift/gain + saturation + vignette + grain + sRGB encode in one pass, saving a full ping-pong. Consequently:

```js
renderer.toneMapping = THREE.NoToneMapping;        // scene writes LINEAR HDR into the RT
renderer.toneMappingExposure = 1.05;               // read by the grade shader
renderer.outputColorSpace = THREE.SRGBColorSpace;  // unchanged (drives texture decode)
rt.texture.colorSpace = THREE.LinearSRGBColorSpace;// no decode when passes sample it
```

`GradeShader` must implement ACES and the sRGB OETF **inline** rather than `#include <tonemapping_pars_fragment>` / `<colorspace_fragment>` — those chunks depend on defines the renderer injects only for scene materials, and silently no-op on a hand-rolled `ShaderPass`. Ten lines of well-known code beats a define-injection dependency.

**Fallback path**: when `post.enabled === false` (URL `?post=off`, or composer construction threw), restore `renderer.toneMapping = THREE.ACESFilmicToneMapping` and call `renderer.render(scene, camera)` directly. The game must be fully playable and shippable on this path.

### C.2 Render-target format and precision

```js
const type = (gl.getExtension('EXT_color_buffer_half_float') ||
              gl.getExtension('EXT_color_buffer_float'))
             ? THREE.HalfFloatType : THREE.UnsignedByteType;

const rt = new THREE.WebGLRenderTarget(w, h, {
  type,
  samples: tier.msaa,          // 0 | 4 — MSAA lives on the RT, not the canvas
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  depthBuffer: true,
  stencilBuffer: false,        // MaskPass unused; saves 1 byte/px
});
rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
const composer = new EffectComposer(renderer, rt);
```

**`HalfFloatType` is mandatory for the art direction,** not a nicety: bloom must operate on linear HDR *before* tonemapping. Lantern emissives are `emissiveIntensity 2.2` (`terrain.js:420`), crystals `1.4` (`:379`), the sky's sun spot is `×1.4` (`main.js:60`). In an 8-bit RT all of these clip to 1.0 and the luminosity high-pass threshold becomes meaningless. On the 8-bit fallback, drop `bloomThreshold` from 1.10 to **0.55** and accept a softer, less selective bloom.

`EffectComposer`'s own default RT is already `HalfFloatType` (`EffectComposer.js:26`) but **has `samples: 0`** — you must pass your own RT to get MSAA.

**`antialias` on the canvas must be `false`.** With a composer the scene never renders to the default framebuffer, so canvas MSAA is pure wasted memory (~236 MB at 5120×2880 with 4×).

### C.3 Fill cost, derived

`UnrealBloomPass` (`UnrealBloomPass.js:41-70`): `nMips = 5`, chain starts at `resolution/2`, halving each level; kernel radii `[3,5,7,9,11]` → `[7,11,15,19,23]` taps, separable H+V.

Full-resolution-equivalent bilinear RGBA16F fetches per frame:

| Stage | fetches (× full-res area) |
|---|---|
| high-pass (¼ area, 1 tap) | 0.25 |
| mip0 blur H+V (¼ area, 7+7) | 3.50 |
| mip1 (1/16, 11+11) | 1.38 |
| mip2 (1/64, 15+15) | 0.47 |
| mip3 (1/256, 19+19) | 0.15 |
| mip4 (1/1024, 23+23) | 0.05 |
| composite (5 mips at full res) | 5.00 |
| **bloom total** | **≈ 10.8** |
| FXAA | ≈ 1.5 |
| Grade | ≈ 1.0 |

At `bloomScale = 0.5` the entire chain shrinks 4× → **≈2.7 full-res-equivalent fetches.** This is the single most important knob.

### C.4 Estimated frame budgets

**Mid-range discrete GPU (~220 GB/s, e.g. RTX 3050 / RX 6600), tier `high`:**

| | 1080p (4.67 Mpx) | 1440p @1.5 (8.30 Mpx) |
|---|---|---|
| shadow pass, 2048², ~180 draws | 0.5 ms | 0.5 ms |
| main pass, ~95 draws, MSAA 4× HF | 2.8 ms | 4.8 ms |
| MSAA resolve | 0.4 ms | 0.7 ms |
| bloom @ scale 1.0 (10.8 × area × 8 B) | 1.8 ms | 3.3 ms |
| FXAA | 0.35 ms | 0.6 ms |
| Grade | 0.25 ms | 0.45 ms |
| **GPU total** | **≈ 6.1 ms (160 fps)** | **≈ 10.4 ms (96 fps)** |

**Intel Iris Xe (~50 GB/s effective), tier `medium`, 3.24 Mpx, no MSAA, bloomScale 0.5:**
shadow 1024² 0.6 · main 5–7 · bloom 1.4 · FXAA 1.0 · grade 0.5 → **8.5–10.5 ms GPU**, plus 3.5–5.5 ms CPU (Rapier step with ~120 bodies over a 45 k-tri trimesh + JS updates) → **45–70 fps**. Deliberately sitting right on the auto-downgrade boundary.

**Intel UHD 620, tier `low`, 2.07 Mpx, shadow box 24, no bloom/FXAA:**
main 6–9 · grade 0.4 → **~7–10 ms GPU**, CPU-bound at 4–8 ms → **40–60 fps**.

**Same iGPU at `high`, bloomScale 1.0, 4.67 Mpx:** bloom alone = 10.8 × 4.67 M × 8 B = **403 MB/frame of texture traffic = 8.1 ms just for bloom.** This is why `bloomScale` is 0.5 below `high`, and why `detectTier` returns `low` for non-Xe Intel.

### C.5 Should the composer render at reduced resolution and upscale?

**No separate downscale-and-upscale stage.** The `maxPixels` budget in the tier table already *is* the resolution control, and it applies to the scene pass, the composer RTs and the canvas uniformly with zero extra blits. Adding a second scaling factor gives two knobs that fight each other and an extra full-screen resample. The only sub-resolution stage is the bloom chain (`bloomScale`), which is a *blur* and therefore genuinely free to run at half res.

### C.6 Memory budget

RGBA16F = 8 B/px. `rt1 + rt2` = 2 × area × 8. MSAA 4× multiplies rt1's storage by 4. Bloom chain ≈ 0.92 × area × 8 × `bloomScale²`.

| Config | rt1+rt2 | +MSAA 4× | bloom | shadow map | **total** |
|---|---|---|---|---|---|
| low @ 2.07 Mpx | 33 MB | — | — | 1 MB (512²) | **34 MB** |
| medium @ 3.24 Mpx | 52 MB | — | 6 MB | 4 MB | **62 MB** |
| high @ 4.67 Mpx | 75 MB | +112 MB | 34 MB | 16 MB | **237 MB** |
| high @ 8.30 Mpx (4K) | 133 MB | +199 MB | 61 MB | 16 MB | **409 MB** |
| ~~old antialias:true @ 5120×2880 dpr 2~~ | — | — | — | — | ~~**~350 MB canvas MSAA alone**~~ |

409 MB at 4K/high is fine on a 8 GB discrete card and fatal on shared-memory integrated. `detectTier` never returns `high` for those, and auto-downgrade catches the rest.

### C.7 Interaction with the resize handler (`main.js:85-90`)

Two mandatory changes:

**1. Debounce.** Every resize event currently calls `setPixelRatio` + `setSize`. With a composer that reallocates **13+ half-float render targets**. Dragging a window edge fires ~60 resize events/second → ~800 RT allocations/second → guaranteed `webglcontextlost` on integrated GPUs. This is a top-3 risk.

```js
// main.js:85-90 — REPLACE ENTIRELY
let _resizeT = 0;
window.addEventListener('resize', () => {
  clearTimeout(_resizeT);
  _resizeT = setTimeout(() => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    ctx.quality.applyPixelRatio();   // renderer setPixelRatio+setSize AND post.setSize
    ctx.quality.resetGrace();
    needsRepaint = true;
  }, 120);
});
```

**2. `bloom.setSize` must be re-applied *after* `composer.setSize`.** `EffectComposer.setSize` (L192-207) loops `passes[i].setSize(effectiveWidth, effectiveHeight)` — which resets `UnrealBloomPass` to **full** resolution, silently destroying `bloomScale`. This is a real, easy-to-miss bug:

```js
// src/fx/post.js
setSize(cssW, cssH, dpr) {
  if (!this.composer) return;
  const w = Math.max(1, Math.floor(cssW * dpr)), h = Math.max(1, Math.floor(cssH * dpr));
  this.composer.setSize(w, h);                                   // resets bloom to full res
  this.bloom?.setSize(w * this._tier.bloomScale,                 // ...so restore the scale
                      h * this._tier.bloomScale);
  this.fxaa?.material.uniforms.resolution.value.set(1 / w, 1 / h);
}
```

**3. Pixel-ratio bookkeeping.** `EffectComposer` multiplies its `_width/_height` by its own `_pixelRatio` (initialised from `renderer.getPixelRatio()` in the ctor). Sizing in **device pixels** with `composer.setPixelRatio(1)` avoids double-application. **`setPixelRatio(1)` must be called before the first `addPass`**, because `addPass` sizes the pass with `_width * _pixelRatio`.

```js
this.composer = new EffectComposer(renderer, rt);
this.composer.setPixelRatio(1);   // MUST precede addPass
this.composer.setSize(w, h);      // w,h already in device px
this.composer.addPass(new RenderPass(scene, camera));
```

**4. `renderer.info.autoReset`.** `FullScreenQuad.render()` calls `renderer.render()` internally, and `renderer.render()` resets `info` when `autoReset` is true. After `composer.render()`, `renderer.info.render.calls` would report only the **last pass (1 call)**. Set once at boot and reset manually:

```js
renderer.info.autoReset = false;      // main.js, right after renderer creation
// ...and at the top of frame():
renderer.info.reset();
```

Without this, every draw-call assertion in §F is meaningless.

### C.8 What breaks on Intel integrated GPUs

| # | Failure | Detection | Mitigation |
|---|---|---|---|
| 1 | `RGBA16F` not colour-renderable (older HD/UHD 6xx, some drivers) — `WebGLRenderTarget` silently becomes incomplete, screen goes black | `gl.getExtension('EXT_color_buffer_half_float')` returns null | fall back to `UnsignedByteType` + `bloomThreshold 0.55` |
| 2 | MSAA on a float RT unsupported / falls back to 1× | tier `high` (msaa 4) is never auto-selected on Intel | `msaa: 0` on low/medium |
| 3 | **Context loss from RT churn** (undebounced resize, or 400 MB alloc on 128 MB dedicated VRAM) | `webglcontextlost` event — **currently unhandled** | new handler, §C.9 |
| 4 | Shadow-map + composer + bloom together exceed the shared-memory budget → driver reset | see #3 | tier memory table §C.6 caps low at 34 MB |
| 5 | Program-link stalls of 30–60 ms each on ANGLE/D3D11 | first-frame jank | §E warm-up |
| 6 | **SwiftShader** (CI): pure CPU raster, ~100× slower fill. The full post stack at 1280×720 costs ~200–500 ms/frame | `verify.mjs` timing checks fail | CI must force `?quality=low&post=off`, §F |

### C.9 Context-loss handler (new — none exists today)

```js
// main.js, immediately after app.appendChild(renderer.domElement)  (L27)
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();                                   // required, or restore never fires
  console.warn('WebGL context lost — restoring at low quality');   // WARN, not error:
  ctx.quality?.setMode('low');                          // verify.mjs fails on console.error
}, false);
renderer.domElement.addEventListener('webglcontextrestored', () => {
  ctx.post?.setTier(ctx.quality.tier);
  ctx.quality?.applyPixelRatio();
  needsRepaint = true;
}, false);
```

### C.10 Don't render behind modals

`main.js:193-197` currently renders every frame in non-playing states. With a composer that is 6–10 ms of GPU burned behind a pause menu. Replace with a repaint flag:

```js
if (state !== 'playing') {
  if (needsRepaint) { ctx.post.render(realDt); needsRepaint = false; }
  return;
}
needsRepaint = true;
```

`needsRepaint = true` is set on: state transitions, resize, tier change, language change. The browser compositor holds the last presented frame, so a CSS `backdrop-filter: blur()` pause overlay works over a frozen canvas at zero GPU cost.

---

## D) DRAW-CALL AND MEMORY BUDGET

### D.1 Instancing conversions — before/after

| # | Conversion | File / lines | Before | After | Saved | Animation risk |
|---|---|---|---|---|---|---|
| 1 | mushrooms → 3 `InstancedMesh` (stem/cap/dots) | `props.js:188-220`, `:322` | 60 | 3 | **57** | squish rewrite |
| 2 | cloud blobs → 1 `InstancedMesh` | `terrain.js:505-522`, `:534-537` | ~48 | 1 | **47** | drift rewrite |
| 3 | gondola parts → 3 `InstancedMesh` (cab, trim, arm) | `cablecar.js:129-169`, `:209-210` | 42 | 3 | **39** | pose carrier, see D.3 |
| 4 | stations → 3 `IM` (pad, roof, pole) | `cablecar.js:37-49` | 30 | 3 | **27** | none (static) |
| 5 | delivery huts → 2 `IM` | `deliveries.js:64-72` | 16 | 2 | **14** | none (static) |
| 6 | pylons + arms → 2 `IM` | `cablecar.js:101-121` | 16 | 2 | **14** | none (static) |
| 7 | crystals → 1 `IM` | `terrain.js:381-394`, `:533` | 14 | 1 | **13** | rotation rewrite |
| 8 | birds → 1 `IM` | `terrain.js:494-503`, `:539-546` | 12 | 1 | **11** | `lookAt` rewrite |
| 9 | pendulum frames (posts+bars) → 2 `IM` | `props.js:94-103` | 12 | 2 | **10** | none (static) |
| 10 | floating islands → 2 `IM` | `terrain.js:295-314`, `:527-531` | 12 | 2 | **10** | bob rewrite |
| | **TOTAL** | | **262** | **20** | **242** | |

**Result: ~336 → ~94 colour draw calls. With the shadow pass, ~590 → ~180 GPU draws/frame.**

**Priority order** (do 1–4 first; they are 170 of the 242): mushrooms → clouds → gondolas → stations → huts/pylons → crystals/birds → pendulums/islands.

**Explicitly NOT converted:**

* **`props.js` crates (11)** — each is a dynamic Rapier body whose mesh is written every frame by `physics.syncMeshes` (`physics.js:109-121`). Instancing means no per-mesh `.position`/`.quaternion` to write. `physics.track(body, null)` supports a null mesh but `entry.pos` carries **no rotation** (`physics.js:88`), so tumbling crates would lose their spin. 11 draw calls is not worth extending the physics sync API. **Skip.**
* **`terrain.js` trees/trunks/rocks** — already instanced.
* **`director.js` hazards** — short-lived, ≤25 concurrent, individually tracked by physics. Same objection as crates. **Skip.**

### D.2 Geometry bake requirements (exactness, not approximation)

**Mushrooms.** Current geometries bake `scale` into their dimensions *and* their Y offsets (`props.js:193-208`): stem `Cylinder(0.45s, 0.6s, 1.4s)` at `y = 0.7s`; cap `Sphere(1.5s)` `scale.y 0.62` at `y = 1.35s`; dots `Sphere(1.52s)` `scale.y 0.62` at `y = 1.4s`. Every term is **linear in `s`**, so a uniform instance scale reproduces the current geometry *exactly*, provided the geometries are built at `s = 1` with the offsets baked in:

```js
const stemGeo = new THREE.CylinderGeometry(0.45, 0.6, 1.4, 7).translate(0, 0.7, 0);
const capGeo  = new THREE.SphereGeometry(1.5, 9, 6, 0, Math.PI*2, 0, Math.PI*0.5)
                  .scale(1, 0.62, 1).translate(0, 1.35, 0);
const dotGeo  = new THREE.SphereGeometry(1.52, 6, 4, 0, Math.PI*2, 0, Math.PI*0.4)
                  .scale(1, 0.62, 1).translate(0, 1.4, 0);
```

Squish (`props.js:322`, currently `m.group.scale.y = 1 - m.squish * 0.35`) becomes a per-instance matrix:

```js
// props.js fixedUpdate — replaces line 322
const sy = m.scale * (1 - m.squish * 0.35);
_m4.makeScale(m.scale, sy, m.scale).setPosition(m.pos.x, m.pos.y, m.pos.z);
for (const im of this._mushIM) im.setMatrixAt(m.idx, _m4);
this._mushDirty = true;
// ...after the mushroom loop:
if (this._mushDirty) { for (const im of this._mushIM) im.instanceMatrix.needsUpdate = true; this._mushDirty = false; }
```

**`m.pos`, `m.capY`, `m.r`, `m.scale` must be preserved verbatim** — `verify.mjs:100-101` reads `mushrooms[0].pos` and `.capY`, and `props.js:326-347` reads `m.pos`/`m.capY`/`m.r`.

**Pylons** (`cablecar.js:111`) use a per-pylon height `h`. Build `CylinderGeometry(0.35, 0.6, 1, 6)` (unit height) and use `makeScale(1, h, 1)`. Taper ratio is preserved; visual delta is nil.

**Islands** (`terrain.js:297-302`): `top` = `Cylinder(d.s, d.s*0.82, 1.6, 7)` — radius scales but height is **constant**, so a *non-uniform* instance scale `makeScale(s, 1, s)` on a unit-radius / 1.6-tall geometry is required. `bottom` = `Cone(d.s*0.8, d.s*1.5, 7)` at `y = -d.s*0.75 - 0.8` — uniform in `s` plus a constant `-0.8` offset, so `makeScale(s,s,s).setPosition(x, y - 0.8, z)`.

### D.3 The gondola risk, and its zero-breakage mitigation

`cablecar.fixedUpdate` (`cablecar.js:187-211`) moves each gondola along `this.curve` and writes `g.group.position` / `g.group.quaternion`. `g.group` is read by **three** places:

* `cablecar.js:220` — proximity check for the cable hum
* `verify.mjs:85` — `const p = g.group.position` (teleport target)
* `verify.mjs:90` — `const gp = g.group.position` (stayed-on check)

**Do not delete `g.group`.** Keep it as a plain `THREE.Object3D` that is *never added to the scene* — it costs one matrix compose per gondola per frame and nothing on the GPU. The existing pose code at `cablecar.js:209-210` stays **byte-identical**; only three lines are appended:

```js
    // cablecar.js:209-210 — UNCHANGED:
    g.group.position.set(c.x, c.y, c.z);
    g.group.quaternion.copy(qSway);
    // NEW — push the pose into the instanced meshes:
    g.group.updateMatrix();
    for (const im of this.cabIM) im.setMatrixAt(g.idx, g.group.matrix);
  }
  for (const im of this.cabIM) im.instanceMatrix.needsUpdate = true;   // once, after the loop
```

The 7 per-gondola child meshes have **local offsets** (floor `y=-1.0`, roof `y=1.5`, arm, 4 walls). Bake each offset into its geometry with `.translate()`, then one `InstancedMesh` per distinct geometry+material combination. That is 3 materials → but 7 distinct geometries. Two options:

* **3 draw calls**: merge the 3 `cabMat` parts into one geometry, the 4 `cabMat2` walls into another, the arm alone → 3 `InstancedMesh × 6 instances`. Requires `BufferGeometryUtils.mergeGeometries` (a 4th addon import).
* **7 draw calls, zero new imports**: 7 `InstancedMesh × 6 instances`. Still 42 → 7.

**Recommend the 7-call version.** 35 calls saved with no new dependency and no merge bookkeeping.

**Frustum culling note:** the six gondolas are spread around the whole mountain, so a single `InstancedMesh` has a bounding sphere covering everything and is never culled. That is correct and cheap — 7 always-drawn calls beats 42 sometimes-culled ones.

`this.stations[]` holds only `{name, pos, t, cableY}` (`cablecar.js:56`) — no mesh references. Station instancing is risk-free.

The same "keep `.group` as a pose carrier" rule applies to **`terrain.summitIsland.group`**, read by `verify.mjs:138` and by **`deliveries.js:195`** (`this.target.moving.group.position`).

### D.4 Cloud instancing

Currently 12 `Group`s, each with 3–5 `Mesh`es, **each with its own `IcosahedronGeometry`** (`terrain.js:512`) — 48 unshared geometries, all transparent (`opacity 0.92`), all depth-sorted individually every frame.

```js
// terrain.js _decorate — replace L505-522
const cloudGeo = new THREE.IcosahedronGeometry(1, 0);          // ONE unit geometry
const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1, transparent: true, opacity: 0.92 });
const blobs = [];
for (let i = 0; i < 12; i++) {
  const n = 2 + ((hash2(i, 61) * 3) | 0);
  const a = hash2(i, 71) * Math.PI * 2, r = 60 + hash2(i, 73) * 160;
  const cx = Math.cos(a) * r, cy = 60 + hash2(i, 79) * 130, cz = Math.sin(a) * r;
  for (let b = 0; b <= n; b++) {
    blobs.push({
      cloud: i, s: 3 + hash2(i, b) * 4,
      ox: b * 4 - n * 2, oy: hash2(b, i) * 2, oz: hash2(i * 3, b) * 3,
      cx, cy, cz, speed: 1 + hash2(i, 83) * 2.5,
    });
  }
}
const order = strideOrder(blobs.length);          // so .count reduction stays spread out
this._im.clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, blobs.length);
this._imMax.clouds = blobs.length;
this._cloudBlobs = order.map((k) => blobs[k]);    // slot i == this._cloudBlobs[i]
scene.add(this._im.clouds);
```

```js
// terrain.js update() — replace L534-537
const im = this._im.clouds, m = _m4;
for (let i = 0; i < im.count; i++) {
  const b = this._cloudBlobs[i];
  b.cx += b.speed * dt;
  if (b.cx > WORLD_R + 60) b.cx = -WORLD_R - 60;
  m.makeScale(b.s, b.s * 0.55, b.s).setPosition(b.cx + b.ox, b.cy + b.oy, b.cz + b.oz);
  im.setMatrixAt(i, m);
}
im.instanceMatrix.needsUpdate = true;
```

Note the `.count` on `clouds` is now the tier decor knob (`tier.decor.clouds` scaled: `Math.round(blobs.length * d.clouds / 12)`).

**Transparency-sorting caveat:** `MeshStandardMaterial` with `transparent: true` keeps `depthWrite: true` by default, so the 48 blobs already depth-test against each other. Collapsing them into one instanced draw removes per-blob painter's sort; with `depthWrite` on and near-opaque white puffs, this produces no visible artefact. Verified by inspection of the material config at `terrain.js:507`.

### D.5 Memory budget, before/after

| | before | after |
|---|---|---|
| terrain visual geometry | 1.00 MB (22 801 v × 44 B) | unchanged |
| terrain index | 0.54 MB | unchanged |
| **Rapier trimesh + BVH** | ≈ 2.0 MB | unchanged |
| cloud geometries (48 unshared, 60 v each) | 92 KB | 1.9 KB (1 shared) + 48 × 64 B matrices = 5 KB |
| mushroom geometries (60 unshared) | ~180 KB | 3 shared (~9 KB) + 20 matrices |
| gondola geometries (42 unshared) | ~55 KB | 7 shared + 6 matrices |
| station/pylon/hut geometries (62) | ~110 KB | 7 shared |
| particle pools | 234 KB | unchanged (never resized) |
| shadow map | 16 MB (2048²) | 16 / 4 / 1 MB by tier |
| **canvas MSAA (antialias:true, dpr 2 @1440p)** | **~350 MB** | **0** (`antialias:false`) |
| composer RTs | 0 | 34 / 62 / 237 MB by tier |

The `antialias: true` → `false` change alone reclaims more memory than the whole composer costs at `medium`.

### D.6 Per-shift disposal

`disposeObject(root, disposeMaterials=false)` already exists (`physics.js:9-16`). Three amendments:

**1. Handle `InstancedMesh`.** `disposeObject` only calls `geometry.dispose()`. `InstancedMesh.dispose()` frees `instanceMatrix`/`instanceColor`. One line:

```js
// physics.js:9-16 — amended
export function disposeObject(root, disposeMaterials = false) {
  root.traverse((o) => {
    o.geometry?.dispose();
    o.dispose?.();                        // InstancedMesh/BatchedMesh: instanceMatrix
    if (disposeMaterials && o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
    }
  });
}
```
(`Object3D`, `Mesh`, `Group`, `Points` have no `dispose`, so `?.()` is a safe no-op on everything else.)

**2. One `shiftRoot` per shift.** Everything the new shift structure builds (contract beacons, per-shift huts, decorations) is parented to a single `ctx.shiftRoot = new THREE.Group()`. Teardown:

```js
scene.remove(ctx.shiftRoot);
disposeObject(ctx.shiftRoot, /* materials */ false);
ctx.shiftRoot = null;
```
`disposeMaterials: false` is correct **only if materials are module-level shared constants.** Today they are not: `props.js` allocates a `new MeshStandardMaterial` inside `_pendulum` (L92, L107), `_plank` (L142), `_mushroom` (L194/199/205), `_geyser` (L227), `_seesaw` (L242/258), `_elevator` (L279), `_crateStack` (L293); `cablecar.js` inside `_gondola` (L133/134/140). At 20 mushrooms that is 60 material objects. Three de-duplicates *programs* by cache key so there is no shader cost, but each is a live object with its own uniform group. **Hoist all of these to module level as part of the instancing work** — instancing forces one material per `InstancedMesh` anyway.

`packages.js` is the exception: its per-package materials are genuinely per-instance and are correctly disposed with `disposeObject(pkg.mesh, true)` at L469 (comment at L469 confirms intent). Leave it.

**3. `Physics.removeBody` leaks contact listeners — latent correctness bug.**

`physics.js:140-143` untracks and removes the body but never clears `this.contactListeners`, which is keyed by **collider handle** (`onContactForce`, L77). Rapier **reuses collider handles**. A stale listener therefore keeps a dead package's closure alive *and* can fire `_onImpact(deadPkg, mag)` for a brand-new, unrelated collider.

`packages.js:465` does call `offContactForce` before removing — but `packages.js:380` (escapee sheep removal), `director.js:232`/`:346` (hazards), and `props.js:459` (rollers) do not. Belt-and-braces fix in the one place that matters:

```js
// physics.js:140 — replace removeBody
removeBody(body) {
  for (let i = 0, n = body.numColliders(); i < n; i++) {
    this.contactListeners.delete(body.collider(i).handle);
  }
  this.untrack(body);
  this.world.removeRigidBody(body);
}
```

`ctx.physics.contactListeners.size` is exported in the render manifest (§F) as the leak canary.

---

## E) SHADER COMPILE STALLS AND WARM-UP

### E.1 The problem, quantified

Cold-start program links on Windows/ANGLE cost 10–60 ms each. Program count in this scene:

| Source | distinct programs |
|---|---|
| `MeshStandardMaterial` permutations (vertexColors / flatShading / transparent / emissive / instanced / map) | ~14 |
| shadow-depth variants of the above | ~6 |
| `MeshBasicMaterial` (bolt, beacon column, ring, shock) | 2 |
| `PointsMaterial` (+ `onBeforeCompile` hook) | 1 |
| sky `ShaderMaterial` | 1 |
| sea `MeshStandardMaterial` + `onBeforeCompile` | 1 |
| character `GLTF` material | 1 |
| **composer**: bloom high-pass, **5 separable blur variants** (`KERNEL_RADIUS` 3/5/7/9/11 → 5 distinct programs), bloom composite, FXAA, Grade, CopyShader | **10** |
| **total** | **~36** |

Without warm-up: ~1–2 s of stutter smeared across the first 15 s of play, plus **one huge stall on the first composer frame** (10 programs at once).

### E.2 Warm-up, inserted in `boot()` at `main.js:140`

Between `ctx.director = new Director(ctx);` (L139) and `state = 'title';` (L142):

```js
  // ---- Shader warm-up: link every program while the loading screen is up ----
  if (new URLSearchParams(location.search).get('warmup') !== '0') {
    document.getElementById('title-loading').textContent = i18n.t('boot.compiling');
    await warmUpShaders();
  }
```

```js
// main.js — new function, place just above boot()
async function warmUpShaders() {
  // 1. Un-hide everything: renderer.compileAsync skips objects with visible=false.
  const hidden = [];
  scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });

  // 2. Materials that only exist at runtime (package parts, hazard meshes) —
  //    park one of each far below the world so their programs get linked too.
  const warm = new THREE.Group();
  warm.position.set(0, -600, 0);
  for (const def of ctx.packages.types) warm.add(ctx.packages.buildVisual(def)); // pure builder, no physics
  warm.add(new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), ctx.director._boulderMat));
  warm.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), ctx.director._snowMat));
  warm.add(new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.6, 5), ctx.director._icicleMat));
  scene.add(warm);

  // 3. A camera that sees the whole mountain (compile() uses the camera only for
  //    light/shadow state, but a wide frustum keeps shadow-cascade state sane).
  const warmCam = camera.clone();
  warmCam.position.set(0, PEAK * 1.2, 320);
  warmCam.lookAt(0, PEAK * 0.4, 0);
  warmCam.far = 1400;
  warmCam.updateProjectionMatrix();

  // 4. Scene programs, incl. shadow-depth variants.
  await renderer.compileAsync(scene, warmCam);

  // 5. Also link the shadows-OFF variant, so the manual "Shadows: Off" toggle
  //    doesn't stall later. Cheap: two compiles, once, on the loading screen.
  const shadowsWere = renderer.shadowMap.enabled;
  renderer.shadowMap.enabled = false;
  await renderer.compileAsync(scene, warmCam);
  renderer.shadowMap.enabled = shadowsWere;

  // 6. Post programs: compileAsync does NOT cover full-screen quads. One
  //    composer render links bloom's 5 blur variants + FXAA + Grade + Copy.
  ctx.post.warmUp();

  // 7. Tear down and restore.
  scene.remove(warm);
  disposeObject(warm, true);
  for (const o of hidden) o.visible = false;
  await new Promise((r) => requestAnimationFrame(r));
}
```

```js
// src/fx/post.js
warmUp() {
  if (!this.composer) return;
  this.composer.render(1 / 60);
}
```

### E.3 Gotchas

* **`visible = false` objects are skipped by `compile`.** `character.chute.visible = false` (`character.js:52`) and `director._bolt.visible = false` (`director.js:37`) would otherwise stall on first parachute deploy / first lightning strike. Step 1 handles this generically.
* **`compileAsync` resolves via `KHR_parallel_shader_compile` when present**; on drivers without it, links are synchronous and the promise resolves next tick. Either way we are on the loading screen, so blocking is correct.
* **`packages.js` needs a pure visual builder.** Extract the `switch` at `packages.js:135-220` into `buildVisual(def) → THREE.Group` with no physics side-effects, so warm-up can instantiate all 8 types without spawning bodies. `spawn()` then calls `buildVisual()`. This is a refactor, not new behaviour.
* **SwiftShader**: 36 program links there can take 10–30 s. `verify.mjs:25` already allows a 60 s boot timeout — **keep it**. CI additionally passes `?warmup=0&quality=low` to skip it entirely.
* **`instanced` is a program define.** Every `InstancedMesh` introduced in §D creates a *new* program variant. Warm-up must run **after** all instancing is built (it does — `boot()` L127-139 constructs everything first).

---

## F) `verify.mjs` OVERHAUL

### F.1 Which of the existing checks break, and the fix for each

| Line | Check | Breaks? | Cause | Fix |
|---|---|---|---|---|
| 25 | `waitForFunction(state === 'title')`, 60 s | **Risk** | boot now awaits `warmUpShaders()`; on SwiftShader 36 links can exceed 60 s | pass `?warmup=0`; keep the literal state name `'title'`; raise timeout to 90 s |
| 30 | `__game.start()` | **Yes** | new state machine may gate start behind a shift/contract selection | contract: `__game.start()` must remain the canonical programmatic entry that begins a default shift and lands in `state === 'playing'` |
| 37-43 | walk 2 s, assert `moved ≥ 2` | **Yes — hard** | with the post stack under SwiftShader the page runs at 1–3 fps; `realDt` is clamped to 0.1 (`main.js:190`), so 2 s of wall clock advances only ~0.2 s of game time and the courier moves < 2 m | (a) force `?quality=low&post=off`; (b) add `__game.gameTime` and assert **metres per game-second**, not per wall-second |
| 43,60,79,95,110,145,160,179,219,235,241,264,265,277,307,308,309,335,336,348 | 20 `throw` assertions | **Risk** | any auto-pause on `visibilitychange` freezes a headless page → every timed check fails | never auto-pause when `document.hidden` was already true at boot; expose `__game.setAutoPause(false)` and call it from the harness |
| 53-60 | `ctx.packages.chutePos` | **Risk** | per-shift/procedural depot | contract: `Packages.chutePos` survives |
| 71-79 | `ctx.deliveries.beacon.position`, `completed === 1` | **Risk** | shift structure may reset `completed`, or require accepting a contract first | contract: `ctx.deliveries.beacon` and `__game.completed` keep their meaning ("deliveries completed in the current shift") |
| 83-96 | `ctx.cablecar.gondolas[0].group.position` | **Yes if naively instanced** | §D.3 | keep `g.group` as an off-scene pose carrier |
| 99-110 | `ctx.props.mushrooms[0].pos/.capY` | **Yes if naively instanced** | §D.2 | preserve `pos`, `capY`, `r`, `scale` on every mushroom record |
| 136-145 | `ctx.terrain.summitIsland.group.position` | **Yes if islands instanced** | §D.3 | keep `.group` |
| 182-196 | `for (n = 0; n < 8; n++) typeForDelivery(min(n,7))` | **Risk** | hardcoded 8; progression may gate types | replace with `for (const def of ctx.packages.types)`; keep `typeForDelivery(i)` accepting a raw index |
| 199-220 | no-fly regression, indices `[2, 3]` | **Risk** | index drift if `PACKAGE_TYPES` is reordered | look up by id: `types.findIndex(t => t.id === 'balloon')` |
| 280-309 | recovery-roll, 400 × 12 ms polling for `v[1] < -15 && p[1]-ground < 4` | **Yes** — already fragile | at 2 fps the tap window is missed → "never reached the tap window" | force low quality; drive with `__game.runFrames()` + `setFixedFrame(1/60)` instead of wall-clock polling |
| 268-277 | `ctx.terrain.constructor.GAPS` | no | | |
| 339-348 | rig part vertex counts | no | | |
| 351-361 | `director._startEvent(...)` smoke | no | | |
| 390-391 | `fps` / `bodies` (log only) | no | **keep as a log; never assert on it** |
| **393-396** | **`errors.length` gate** | **Yes — highest risk** | fails on ANY `console.error`, `pageerror`, `requestfailed`, or HTTP ≥ 400. New sources: unguarded `localStorage` in sandboxed contexts; missing i18n keys logged as errors; a 404 on any new asset (font, LUT, icon) | (a) all `localStorage` in `try/catch`; (b) i18n misses → `console.warn`, never `error`; (c) **no external fonts, no CDN, no new network assets** — everything inlined or under `public/assets/`; (d) the context-lost handler uses `console.warn` |

### F.2 New checks the redesign requires

**Determinism harness first** (three additions to `main.js`, all debug-gated):

```js
// main.js — top of module, before any subsystem is constructed
const _q = new URLSearchParams(location.search);
const _seed = +(_q.get('seed') || 0);
if (_seed) {                       // DEBUG ONLY: makes every subsystem deterministic
  let s = _seed >>> 0;             // without touching a single one of them
  Math.random = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let fixedFrameDt = 0;              // 0 = real clock
// main.js:190 becomes:
const realDt = fixedFrameDt || Math.min(clock.getDelta(), 0.1);
```

New `window.__game` members (extend `main.js:277-292`):

```js
  get gameTime()  { return gameTime; },
  get tier()      { return ctx.quality.current; },
  get qmode()     { return ctx.quality.mode; },
  get lang()      { return ctx.i18n.lang; },
  setQuality(m)   { ctx.quality.setMode(m); },
  setLang(l)      { ctx.i18n.set(l); },
  setFixedFrame(dt) { fixedFrameDt = dt; },
  setAutoPause(on)  { autoPause = on; },
  async runFrames(n) { for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame); },
  manifest()      { return renderManifest(); },
  pause(), resume(), endShift(),      // owned by the game-design workstream
```

```js
// main.js — new function
function renderManifest() {
  const i = renderer.info, db = renderer.getDrawingBufferSize(new THREE.Vector2());
  return {
    state, tier: ctx.quality.current, mode: ctx.quality.mode, lang: ctx.i18n?.lang,
    dpr: +renderer.getPixelRatio().toFixed(3), buffer: [db.x, db.y],
    calls: i.render.calls, triangles: i.render.triangles,
    geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs.length,
    passes: ctx.post.composer
      ? ctx.post.composer.passes.filter((p) => p.enabled).map((p) => p.constructor.name)
      : ['direct'],
    shadows: renderer.shadowMap.enabled && sun.castShadow, shadowMap: sun.shadow.mapSize.x,
    bodies: ctx.physics.world.bodies.len(), synced: ctx.physics.synced.length,
    dynamics: ctx.dynamics.length, listeners: ctx.physics.contactListeners.size,
  };
}
```

**Requires `renderer.info.autoReset = false` + `renderer.info.reset()` at the top of `frame()`** (§C.7), otherwise `calls` reports the last full-screen quad only.

| # | New check | Assertion |
|---|---|---|
| **N1** | **Tier switching.** For each of `low`/`medium`/`high`/`auto`: `setQuality(t)`, `runFrames(30)`, read `manifest()`. | tier applied; `dpr ≤ TIERS[t].maxDpr`; `buffer[0]*buffer[1] ≤ maxPixels * 1.02`; `shadowMap === TIERS[t].shadowMapSize`; `passes` contains `UnrealBloomPass` iff `tier.bloom`; **zero console errors**; no `webglcontextlost` |
| **N2** | **Tier switch is not destructive.** After cycling `high → low → high`, `manifest().textures` and `.geometries` must return to within +3 of their initial values. | catches composer RTs leaking on rebuild |
| **N3** | **Language switch.** `setLang('de')`, `runFrames(2)`, read `document.body.innerText`. | contains none of the EN sentinels (`CLICK TO START`, `deliveries`, `DELIVER TO`); contains no `undefined`, no `[[`, no `null`; then `setLang('en')` restores. Zero console errors on both. |
| **N4** | **Pause/resume determinism.** `pause()`; record `{gameTime, playerPos, score}`; `waitForTimeout(2000)`; `resume()`; `runFrames(1)`; re-read. | `Δ gameTime < 0.05`; `Δ|playerPos| < 1e-6`; `score` unchanged. Also `manifest().state === 'paused'` while paused. |
| **N5** | **Pause does not repaint.** While paused, `renderer.info.render.frame` must be constant across 60 rAF ticks. | verifies §C.10 |
| **N6** | **Results screen totals.** Run a scripted shift with 3 deliveries (teleport-to-beacon ×3), `endShift()`, wait for `state === 'results'`. | the results DOM shows a total exactly equal to `ctx.deliveries.score`; deliveries count matches `__game.completed`; zero console errors |
| **N7** | **localStorage round-trip.** After N6, read `localStorage` keys; `page.reload()`; wait for `title`. | persisted profile (career total, unlocks, `ud.quality`, language) is byte-identical; the restored language/quality are actually applied (check `manifest()`) |
| **N8** | **Screen sweep.** title → settings → back → start → pause → settings → resume → endShift → results → back to title. `runFrames(10)` on each. | zero console errors, zero `pageerror`, zero failed requests across the entire sweep |
| **N9** | **Draw-call ceiling.** At a fixed pose (`teleport` to spawn, `setFixedFrame(1/60)`, `runFrames(20)`), with `director.level = 0` and hazard lists emptied. | `manifest().calls ≤ 260` (high/medium), `≤ 160` (low). Baselines after §D: ~190 / ~110. Ceiling is ~35 % headroom — catches a 3× regression, not a 5 % drift. |
| **N10** | **Memory ceiling + leak.** After shift 1 record `{geometries, textures}`. Run 2 more shifts. | `geometries` after shift 3 ≤ shift-1 value + 10; `textures` ≤ +2; `listeners` (contact-listener Map size) ≤ +2; `synced` and `dynamics` ≤ +5 |
| **N11** | **No mid-game compiles.** Record `manifest().programs` after `runFrames(180)` of play, then again after the chaos soak. | equal — any growth means a program linked mid-game, i.e. a warm-up gap and a guaranteed stall on real hardware |
| **N12** | **Invisible-collider guard.** For `trees`, `trunks`, `rocks`: assert `im.count === im.instanceMatrix.count` at every tier. | catches anyone tiering a collider-bearing InstancedMesh (§A.3) |

### F.3 Visual regression that is not flaky under SwiftShader

The naive approach (screenshot + pixel diff) is unusable here: SwiftShader rasterises differently from any GPU, and the scene contains `Math.random` particles, wind, drifting clouds, hazard spawns, a rAF score count-up (`hud.js:76-88`) and CSS keyframe animations.

**Primary, gating signal — a structural JSON manifest, not pixels.**

Extend `manifest()` with a `hud` block (`{score, deliveries, alt, target, package}` text contents) and a `poses` fixture:

```js
// scripts/poses.mjs
export const POSES = [
  { id: 'depot',   t: 0.015, dy: 2,  frames: 60 },
  { id: 'forest',  t: 0.28,  dy: 2,  frames: 60 },
  { id: 'cliffs',  t: 0.45,  dy: 2,  frames: 60 },
  { id: 'frozen',  t: 0.72,  dy: 2,  frames: 60 },
  { id: 'summit',  t: 0.95,  dy: 2,  frames: 60 },
];
```

For each pose: `setSeed` via URL, `setFixedFrame(1/60)`, teleport, `runFrames(pose.frames)` — **exactly `frames/60` game-seconds every run, on every machine.** Snapshot `manifest()` to `tests/manifests/<tier>-<pose>.json` and diff. This catches every regression that actually matters — "bloom silently stopped being added to the chain", "shadows are on at low", "the HUD lost its score node", "draw calls tripled" — with **zero pixel flakiness.**

**Secondary, non-gating — screenshots as artefacts.**

Keep `page.screenshot()` into `verify-out/` (already `.gitignore`d, L7) and upload it as a CI artefact for human eyeballing. If you want a machine check on top:

```js
await page.screenshot({ path: `${OUT}/pose-${id}.png`, animations: 'disabled', caret: 'hide' });
```
* fixed `viewport: {width:1280, height:720}`, `deviceScaleFactor: 1`
* forced `?quality=low&post=off` so the pipeline is byte-identical run to run
* compare with `pixelmatch` at `threshold: 0.25`, **assert `diffPixels / total < 0.02`** — never 0
* baselines live in `tests/baselines/` and are only valid for the **same container image**; regenerate with `npm run baselines`
* gate behind `PLAYWRIGHT_VISUAL=1` (opt-in), never on by default
* `pixelmatch` + `pngjs` are `import()`ed dynamically and the check is skipped if they are absent

### F.4 What IS and IS NOT a meaningful headless perf assertion

**Meaningful (deterministic CPU-side counters — assert on these):**
* `renderer.info.render.calls` / `.triangles` — draw-call budget (N9)
* `renderer.info.memory.geometries` / `.textures` — leak detection (N10)
* `renderer.info.programs.length` — mid-game compile detection (N11)
* `ctx.physics.world.bodies.len()`, `physics.synced.length`, `ctx.dynamics.length`, `physics.contactListeners.size` — object-lifecycle leaks
* **Fixed-step count per game-second** — physics determinism: with `setFixedFrame(1/60)`, `runFrames(600)` must advance `gameTime` by 10.0 ± 0.02
* **CPU-only simulation throughput**: with `?post=off&quality=low` and the canvas at `1×1`, measure wall-clock for `runFrames(600)`. Assert `< 20 s` for 10 game-seconds. This isolates JS + Rapier from the GPU and is comparable run to run within ±30 %. It is the check that would catch, e.g., `_nearestPath` (`terrain.js:120-129`) going quadratic — it is a **700-sample linear scan** called per boulder spawn, per snowball spawn, and once per vertex (22 801×) at build time.

**NOT meaningful (log only, never assert):**
* fps / frame time / GPU time under SwiftShader — says nothing about real hardware. `verify.mjs:390-391` must stay a `console.log`.
* Anything wall-clock that depends on the rasteriser.
* Pixel-exact screenshots (see F.3).

---

## G) CI

### G.1 `package.json`

```jsonc
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview --port 4173 --strictPort",
    "verify": "node scripts/verify.mjs",
    "baselines": "UPDATE_BASELINES=1 node scripts/verify.mjs"
  },
  "dependencies": {
    "@dimforge/rapier3d-compat": "^0.14.0",
    "three": "^0.170.0"
  },
  "devDependencies": {
    "vite": "^6.0.0",
    "playwright": "^1.49.0"      // ← MISSING TODAY; verify.mjs:2 imports it
  },
  "optionalDependencies": {
    "pixelmatch": "^6.0.0",      // only for the opt-in visual diff (F.3)
    "pngjs": "^7.0.0"
  }
}
```

`playwright`, not `@playwright/test` — `verify.mjs:2` does `import { chromium } from 'playwright'`. `vite preview` needs `--port 4173 --strictPort` so it matches `verify.mjs:4`'s default and fails loudly instead of silently taking 4174.

### G.2 `.github/workflows/deploy.yml` — exact changes

**Change 1 — triggers.** `deploy.yml:7` currently deploys to production Pages from the feature branch `claude/unstable-delivery-game-7v97xz`. Any push to that branch overwrites the live site with WIP. **Delete line 7.** Add a PR trigger:

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:
```

**Change 2 — new `e2e` job** (insert before `build`):

```yaml
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: Install Chromium
        run: npx playwright install --with-deps chromium
      - run: npm run build
      - name: Start preview server
        run: |
          nohup npx vite preview --port 4173 --strictPort > preview.log 2>&1 &
          for i in $(seq 1 30); do
            curl -sf http://localhost:4173/ >/dev/null && exit 0
            sleep 1
          done
          echo "::error::preview server never came up"; cat preview.log; exit 1
      - name: E2E verify
        env:
          GAME_URL: "http://localhost:4173/?quality=low&post=off&warmup=0&seed=1337"
        run: npm run verify
      - name: Stop preview server
        if: always()
        run: pkill -f "vite preview" || true
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: verify-out
          path: verify-out/
          retention-days: 7
```

The `?quality=low&post=off&warmup=0` query string is **not optional** — without it the composer under SwiftShader drops the page to 1–3 fps and every wall-clock check in `verify.mjs` fails (§C.8 #6, §F.1 L37-43).

**Change 3 — gating.** The Pages jobs must not run on PRs, and `deploy` must not run if the game is broken:

```yaml
  build:
    if: github.event_name != 'pull_request'
    needs: e2e            # ← don't even build a bundle we know is broken
    ...
  deploy:
    if: github.event_name != 'pull_request'
    needs: [build, e2e]   # ← e2e gates the live site
    ...
  verify:                 # (existing curl smoke test)
    if: github.event_name != 'pull_request'
    needs: deploy
```

**Should e2e gate deploys? Yes.** `build` failing means a compile error; `e2e` failing means the game is unplayable. ~4–6 min (Chromium install ~60 s, suite ~3–5 min) is a reasonable price for not shipping a black screen to GitHub Pages. `timeout-minutes: 15` bounds the worst case.

### G.3 Stray repo-root binaries

```
54efd762-3ce3-4197-9e66-4bf4585087e7.png            2 399 385 B
Gemini_Generated_Image_n1gkvin1gkvin1gk.png.glb       677 512 B
```

Neither is under `public/`, so Vite never bundles them — they are pure `git clone` / `actions/checkout` overhead (3.0 MB on every CI run and every developer clone). They duplicate `public/assets/cover.png` and `public/assets/character.glb`.

**Action:** confirm byte-identity (`sha256sum` against `public/assets/*`), then `git rm` both. Do **not** rewrite history for 3 MB. `.gitignore` already covers `dist/`, `verify-out/`, `node_modules/` — no change needed there.

---

## H) RISK REGISTER

Ranked by likelihood × impact. Each row: risk → mitigation → early-detection signal.

| # | Risk | L | I | Score | Mitigation | Early-detection signal |
|---|---|---|---|---|---|---|
| **1** | **SwiftShader + composer collapses `verify.mjs`.** 25 checks are wall-clock timed; `realDt` clamps at 0.1 so the game runs at 0.2× real time at 2 fps. Half the suite throws. | H | H | **9** | CI passes `?quality=low&post=off&warmup=0`; rewrite timing-sensitive checks (roll, potion, mushroom) onto `setFixedFrame(1/60)` + `runFrames(n)` | first CI run after the composer lands fails at `verify.mjs:43` ("Player did not move") |
| **2** | **Undebounced resize destroys the GL context.** 13+ half-float RTs reallocated per resize event × 60 events/s while dragging a window edge. | H | H | **9** | 120 ms debounce (§C.7); drop to `low` on `webglcontextlost` | `webglcontextlost` fires; canvas goes black and never recovers (no handler exists today) |
| **3** | **Naive instancing breaks `verify.mjs` and `deliveries.js`.** Deleting `gondola.group` / `island.group` breaks `verify.mjs:85,90,138` and `deliveries.js:195`. | H | M | **6** | Keep `.group` as an off-scene `Object3D` pose carrier; preserve `mushroom.pos/.capY/.r/.scale` | `verify.mjs:95` "Gondola did not carry the player"; `verify.mjs:145` "Fell through the summit island" |
| **4** | **Console-error gate fails on new code paths.** `verify.mjs:393-396` exits 2 on ANY error. Unguarded `localStorage`, i18n miss logged as `error`, a 404 on any new asset. | H | M | **6** | wrap every `localStorage` in `try/catch`; i18n misses → `console.warn`; **no webfonts, no CDN, no new network assets**; context-lost handler uses `warn` | CI `ERRORS:` line non-empty |
| **5** | **Tier change triggers a full material recompile.** Toggling `renderer.shadowMap.enabled` changes the program cache key → 36 relinks → 200–500 ms freeze exactly when the game is already struggling. | M | H | **6** | tiers never touch `shadowMap.enabled`; they shrink `shadowBox` 55→24 instead; both variants pre-warmed at boot | check N11 (`manifest().programs` grows mid-game) |
| **6** | **`bloomScale` silently reset on every resize.** `EffectComposer.setSize` calls `pass.setSize(fullW, fullH)` on the bloom, restoring it to full resolution — a 4× cost increase that only appears after the first window resize. | M | H | **6** | re-apply `bloom.setSize(w*scale, h*scale)` after `composer.setSize` | fps craters after resizing but not on load; manifest shows unchanged `calls` — this one only shows up in a GPU trace, so **the fix must be in the spec, not found later** |
| **7** | **`renderer.info` reports nonsense with a composer.** `FullScreenQuad.render` calls `renderer.render` which auto-resets `info`; `calls` reports the last pass (1). Every draw-call assertion silently passes forever. | M | H | **6** | `renderer.info.autoReset = false` + manual `reset()` at the top of `frame()` | N9 reports `calls: 1` — obviously wrong; assert `calls > 20` as a sanity floor |
| **8** | **Decor `.count` reduction deletes the top half of the mountain.** Instances are written in ascending path order; `count 46→20` unlights everything above t≈0.42. | M | M | **4** | `strideOrder()` permutation at build time (§A.6) | low-tier screenshots at pose `frozen`/`summit` show no lanterns |
| **9** | **Runtime `.count` on collider-bearing instances → invisible walls.** `trees`/`trunks`/`rocks` create one Rapier collider per placed instance (`terrain.js:345,371`). | M | H | **6** | those three are excluded from `tier.decor` by design; documented in §A.3 | check N12 (`im.count === im.instanceMatrix.count`); player reports "invisible tree" |
| **10** | **`removeBody` leaks contact listeners and mis-fires on reused handles.** `physics.js:140-143` never clears the handle-keyed `Map`; Rapier reuses collider handles. | M | H | **6** | clear listeners in `removeBody` (§D.6.3) | `manifest().listeners` grows monotonically across shifts (check N10) |
| **11** | **`HalfFloatType` unsupported → black screen.** Older Intel drivers can't render to RGBA16F. | L | H | **3** | feature-detect `EXT_color_buffer_half_float`; fall back to `UnsignedByteType` + `bloomThreshold 0.55` | manifest `passes` present but the canvas is black; add a boot log of the chosen RT type |
| **12** | **First-frame composer stall.** `UnrealBloomPass` links 5 distinct blur programs (`KERNEL_RADIUS` 3/5/7/9/11) on its first render. | H | L | **3** | `post.warmUp()` during the loading screen (§E) | check N11 |
| **13** | **4K + `high` allocates 409 MB of RTs.** OOM / driver reset on 4 GB cards. | L | H | **3** | `maxPixels: 8.30e6` cap; `antialias:false` reclaims ~350 MB; auto-downgrade catches the rest | `webglcontextlost` on first frame at 4K |
| **14** | **Auto-downgrade oscillates.** User sits exactly on a boundary; the tier pumps up and down forever. | M | M | **4** | 29 fps dead zone; 3/5-window streaks; 60 s up-lockout; max 2 upgrades/session; **hard lock after one down→up→down cycle** | log every `_apply(reason)`; assert in a soak test that `_upgrades ≤ 2` |
| **15** | **Auto-downgrade fires on transient stalls** — a resize, a tab-restore, or the shift-results screen. | M | M | **4** | `resetGrace()` on resize, `visibilitychange`, tier change, `startGame`; p95 over 120 frames rather than an instantaneous EMA | downgrade toast appears immediately after alt-tabbing back |
| **16** | **`deploy.yml:7` publishes a feature branch to production Pages.** | M | H | **6** | delete line 7 | live site shows WIP; already happened once (commit `418b93b` fixed a related Pages issue) |
| **17** | **`playwright` is an undeclared dep.** `npm ci` in CI never installs it; `verify.mjs:2` throws `ERR_MODULE_NOT_FOUND`. | H | L | **3** | declare it in `devDependencies` | the very first CI run of the `e2e` job |
| **18** | **Pixel-diff visual regression is permanently red.** SwiftShader rasterisation drift + particle randomness. | H | L | **3** | JSON manifest is the gating signal; pixels are an opt-in artefact at 2 % tolerance behind `PLAYWRIGHT_VISUAL=1` | the second CI run after baselines are recorded |
| **19** | **Per-shift geometry leak.** New shift content is created but not disposed; `disposeObject` misses `InstancedMesh.instanceMatrix`. | M | M | **4** | one `ctx.shiftRoot` per shift + `disposeObject(root)` with the `o.dispose?.()` amendment; hoist all materials to module level | check N10 (`geometries`/`textures` grow across shifts) |
| **20** | **`_nearestPath` is a 700-sample linear scan** (`terrain.js:120-129`) called per hazard spawn, per plank tick, and 22 801× at build. Any increase in spawn rate makes it a CPU cliff. | L | M | **2** | not in scope to fix now; the CPU-throughput assertion (§F.4) bounds it | CPU-only throughput check exceeds 20 s per 10 game-seconds |
| **21** | **3 MB of stray root binaries** slow every clone and every `actions/checkout`. | H | VL | **2** | `git rm` after a hash check against `public/assets/` | trivial; `ls -la` |

---

## APPENDIX — Complete list of `main.js` insertion points

| Line(s) | Change |
|---|---|
| 1-14 | add `import { Quality } from './core/quality.js'; import { Post } from './fx/post.js';` |
| 19 | `antialias: true` → `antialias: false, powerPreference: 'high-performance', stencil: false` |
| 21 | delete `setPixelRatio(min(dpr,2))` — owned by `Quality.applyPixelRatio()` |
| 22-23 | keep `shadowMap.enabled = true` / `PCFSoftShadowMap` — **never touched again** |
| 25 | `toneMapping` → `THREE.NoToneMapping` (the grade pass tonemaps) |
| after 27 | `renderer.info.autoReset = false;` + `webglcontextlost` / `webglcontextrestored` handlers (§C.9) |
| 76-82 | shadow config moves into `Quality._apply` (leave harmless defaults) |
| 85-90 | **replace entirely** with the debounced handler (§C.7) |
| 96-112 | add `quality: null, post: null` to `ctx`; add `needsRepaint() { needsRepaint = true; }` |
| 114 | add `let needsRepaint = true; let fixedFrameDt = 0; let autoPause = true;` |
| before 118 | add the seeded-`Math.random` block and `warmUpShaders()` (§E.2, §F.2) |
| 118-119 | `ctx.quality = new Quality(ctx); ctx.post = new Post(ctx); ctx.quality._apply('boot');` — **before** `new Sfx()` |
| 140 | `ctx.quality._apply('boot2'); await warmUpShaders();` |
| 149 | `startGame()`: add `ctx.quality.resetGrace(6); needsRepaint = true;` |
| 189 | `renderer.info.reset();` |
| 190 | `const realDt = fixedFrameDt || Math.min(clock.getDelta(), 0.1);` |
| 191 | after the fps EMA: `ctx.quality.sample(realDt);` |
| 193-197 | replace with the `needsRepaint` gate (§C.10) |
| 267 | `renderer.render(scene, camera)` → `ctx.post.render(dt)` |
| 277-292 | extend `window.__game` with the 11 new members (§F.2) + `renderManifest()` |

**New files:** `src/core/quality.js`, `src/fx/post.js`, `src/fx/grade.js` (the `GradeShader` object), `scripts/poses.mjs`, `tests/manifests/*.json`.
**Modified:** `main.js`, `physics.js` (L9-16 `disposeObject`, L140 `removeBody`), `particles.js` (`setTier` + 3 rate sites), `terrain.js` (`setTier`, `strideOrder`, cloud/crystal/bird/island instancing), `cablecar.js` (station/pylon/gondola instancing), `props.js` (mushroom/pendulum instancing, material hoisting), `deliveries.js` (hut instancing), `packages.js` (`buildVisual` extraction, `types` getter), `hud.js` (`qualityToast`, `setQualityBadge`), `index.html` (`#hud-quality-badge`), `scripts/verify.mjs`, `package.json`, `.github/workflows/deploy.yml`.
