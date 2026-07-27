<!--
  RAW DESIGN SPEC — Shift structure, results, meta-progression

  Provenance: written by an independent design agent against commit 3602969, then
  reviewed by two critics (see critique-feasibility.md / critique-coherence.md).

  THIS DOCUMENT IS NOT THE PLAN. Where it disagrees with docs/design/README.md or
  the approved v4 plan, THE PLAN WINS. Six specs were written blind to each other and
  four of them rewrite the same files incompatibly; the conflicts are resolved in the
  plan, not here. Read this for the reasoning and the raw values, not for the decisions.

  NOTE: the worked quota table uses INVENTED spot heights and is wrong by 30-50%. Real heights: 13.1/26.4/42.8/62.3/81.4/103.4/126.3/150.1 m. 18 unlocks trimmed to 10 in the plan.
-->

# SPEC — Shift Structure, Results, Pause, Meta-Progression

Repo: `D:\unstable-delivery`. All paths absolute. All line numbers refer to the current HEAD (`3602969`).

**3 new files:** `src/game/shift.js`, `src/game/meta.js`, `src/ui/screens.js`. Everything else is surgical edits to existing files. No new deps. No new art assets.

---

## A) SHIFT MODEL

### The decision

**A shift is a MANIFEST of N consignments. The shift ends when the last manifest line is CLOSED.** A line closes exactly two ways: `DELIVERED` (`Deliveries._deliver`, deliveries.js:136) or `WRITTEN OFF` (`Deliveries.onPackageLost`, deliveries.js:128). Both already exist and are already the only two terminal outcomes for a parcel. The shift end condition is therefore free — zero new plumbing, zero new state to keep in sync.

**Why this beats the alternatives:**

- **Timed shift** — rejected. The game already has a clock: the per-delivery par timer (`par = 40 + target.pos.y * 1.4`, deliveries.js:142, surfaced at deliveries.js:233-235 → `hud.setTimer`). A second, dominant shift clock competes with it and makes the speed bonus illegible. Worse: a hard timer expires *mid-carry*, discarding the single most emotionally invested state in the game (a 90%-condition porcelain 40 m from the Stormgate). Ending a shift by taking something away from the player is the opposite of what this game is for.
- **Escalating quota with a rising bar** — this *is* the design, just factored correctly. Manifest length is the volume axis; the revenue quota is the quality axis. Both rise per shift (numbers below).
- **Soft-fail on bankruptcy** — rejected as the *primary* terminator because `score` can be driven negative-ish forever (it is floored at 0 by deliveries.js:129) and the loop would never close. Kept as a *modifier*: bankruptcy is folded into the quota check.

Time is used as a **scoring axis, never a terminator**: a punctuality bonus at results (see D).

### Exact numbers

```js
// src/game/shift.js — module constants
export const MANIFEST_LEN   = (n) => 3 + Math.min(n - 1, 5);          // 3,4,5,6,7,8,8,8…
export const MAX_TYPE_IDX   = (n) => Math.min(n, PACKAGE_TYPES.length - 1); // shift 1 → 0..1
export const QUOTA_SLACK    = [1.00, 1.15, 1.30, 1.45, 1.60, 1.75];   // idx = min(n-1,5)
export const GOLDEN_FROM    = 3;   // first shift that can roll a golden consignment
export const GOLDEN_CHANCE  = (n) => (n < GOLDEN_FROM ? 0 : n >= 5 ? 1 : 0.5);
```

**Quota is derived from the manifest, not hand-authored**, so it can never drift from the spot heights:

```js
// baseline pay per line at 100% condition, no bonuses — mirrors deliveries.js:152
const linePar = (line) => Math.round(100 + Math.round(line.spot.pos.y * 2)) * (line.golden ? 3 : 1);
this.quota = Math.round(
  this.manifest.reduce((s, l) => s + linePar(l), 0) * QUOTA_SLACK[Math.min(n - 1, 5)]
);
```

Worked numbers (path heights ≈ 20/38/57/78/100/122/144/163 m at `SPOT_TS` deliveries.js:6):

| shift | lines | spots (idx) | Σ linePar | slack | quota | clean-chain revenue (est.) |
|---|---|---|---|---|---|---|
| 1 | 3 | 0,1,2 | 530 | 1.00 | **530** | ~1450 |
| 2 | 4 | 0..3 | 786 | 1.15 | **904** | ~2100 |
| 3 | 5 | 0..4 | 1086 | 1.30 | **1412** | ~2900 |
| 4 | 6 | 1..6 | 1430 | 1.45 | **2074** | ~3800 |
| 5 | 7 | 2..8 | 1854 | 1.60 | **2966** | ~4900 |
| 6+ | 8 | 1..8 | 2172+ | 1.75 | **3801+** | ~5800 |

Shift 1's quota equals "deliver all three, no bonuses, no damage" — a probationary bar that anyone who doesn't destroy cargo clears. Shift 6's 1.75× requires an active chain ≥ ×2.5 or heavy bonus play. The bar rises without a single hand-tuned constant.

### Manifest generation (cargo ladder → shifts)

`PACKAGE_TYPES` (packages.js:7-48) and `typeForDelivery(n)` (packages.js:125-129) stay **byte-identical** (verify.mjs depends on both). The manifest generator drives them:

```js
// Shift._buildManifest(n)
const maxIdx = MAX_TYPE_IDX(n);                  // shift 1 → 1, shift 7+ → 7
const lines = [];
for (let i = 0; i < MANIFEST_LEN(n); i++) {
  // Line 1 of every shift is guaranteed to be the NEWEST unlocked type — the
  // "new cargo class" beat that the briefing memo introduces.
  const idx = i === 0 && n <= PACKAGE_TYPES.length ? maxIdx
            : 1 + Math.floor(Math.random() * maxIdx);   // never plain crate again after shift 1
  lines.push({ no: i + 1, typeIdx: n === 1 ? [0, 0, 1][i] : idx, golden: false, spotIdx: 0, status: 'pending' });
}
if (Math.random() < GOLDEN_CHANCE(n)) {
  const g = 1 + Math.floor(Math.random() * (lines.length - 1)); // never line 1
  lines[g].golden = true;
}
// Spots climb monotonically within the shift; window slides up with shift number.
const lo = Math.min(n - 1, this.spotCount - lines.length);
lines.forEach((l, i) => { l.spotIdx = lo + i; l.spot = ctx.deliveries.spots[l.spotIdx]; });
lines.forEach((l) => { l.def = ctx.packages.typeForDelivery(l.typeIdx); });
```

Type introduction schedule (`MAX_TYPE_IDX`): shift 1 → crate/porcelain · 2 → +balloon · 3 → +egg · 4 → +sheep · 5 → +anvil · 6 → +potion · 7 → +ghost · 8+ → full pool. Golden variants from shift 3 (50%), guaranteed from shift 5. This is exactly "8 types then golden variants" spread over 7 shifts instead of 7 deliveries.

### Carry-over

| Carried across shifts | Reset every shift |
|---|---|
| `meta.data.shift`, `mp`, `owned`, `record`, `history`, `seenTips`, `settings` | `deliveries.score`, `deliveries.completed`, `deliveries.chain` |
| World geometry (static, deterministic) | `shift.stats` (all of D), `shift.elapsed`, `shift.cursor` |
| — | `director.boulders/snowballs/icicles` (**despawned**, see B) |
| — | `packages.current`, `packages.escapee`, `packages.slipCount` |
| — | `ctx.checkpoint` → back to the depot |

### Failure

**A shift can be failed, but never lost mid-shift.** The shift always ends and always pays. Failing = ending **below quota**.

Cost of a below-quota shift:
1. `mp` award loses the `quotaBonus` and `cleanBonus` terms (typically −7 to −12 MP of ~12–31).
2. `meta.data.pipStreak++`. The results stamp reads **UNDER REVIEW** instead of **APPROVED**, and the next briefing carries a PIP memo.
3. The next shift's quota is **not raised** — `n` still increments, but a PIP shift reuses the previous shift's `QUOTA_SLACK` index (mercy).
4. `pipStreak >= 3` → **TERMINATION**: `meta.data.shift` resets to 1, `pipStreak = 0`. **`mp`, `owned` and `record` are kept.** Run resets, meta persists.

Meeting quota sets `pipStreak = 0`.

**Justification for making failure soft:** the entire comic register of this game is built on things going wrong being *funny* — yeeting a parcel off a cliff (packages.js:432), the sheep formally resigning (packages.js:424), "That fall has been noted in your performance review" (controller.js:383). A hard game-over would punish precisely the moments the game is engineered to celebrate, and would make the fragile cargo (porcelain, potion) feel like a trap rather than a joke. The PIP converts failure from a *mechanical* punishment into a *narrative* one with a real economic sting (MP starvation → slower unlocks → shifts stay hard), which is on-brand and keeps the physics comedy intact. Termination-after-3 gives the run arc a genuine floor without ever ending a session against the player's will.

---

## B) NEW STATE MACHINE

### Replacement for main.js:114

```js
// ---------- main.js:114 — replaces `let state = 'loading';` ----------
// loading → title → briefing → playing ⇄ paused
//                                  ↓
//                             results → meta → briefing → playing
let state = 'loading';
let menuOpen = false;   // true for briefing/paused/results/meta — blocks pointer relock

function setState(next) {
  if (state === next) return;
  const prev = state;
  state = next;
  menuOpen = next === 'briefing' || next === 'paused' || next === 'results' || next === 'meta';
  screens.onState(next, prev);                       // ui/screens.js toggles [data-screen]
  ctx.hud.root.style.display = (next === 'playing' || next === 'paused') ? 'block' : 'none';
  if (next !== 'playing') {
    document.exitPointerLock?.();
    ctx.sfx?.setRush(0);
    ctx.sfx?.setWind(0, 0);
    ctx.sfx?.cableHum(false);
    ctx.music?.setIntensity(0.12);
  }
}
```

### Transition table

| from | to | trigger | code site |
|---|---|---|---|
| `loading` | `title` | boot resolves | main.js:142 (`state = 'title'` → `setState('title')`) |
| `title` | `briefing` | click on `#title-screen` | main.js:146 `startGame` |
| `briefing` | `playing` | click `#brief-accept` / `Enter` | `screens` handler `onAccept` |
| `playing` | `paused` | `Escape`/`KeyP`, or pointer-lock lost | new keydown + `pointerlockchange` |
| `paused` | `playing` | `Escape`/`KeyP` / click `#pause-resume` | `resume()` |
| `paused` | `title` | click `#pause-abandon` (confirm) | records shift as failed, `meta.recordShift` |
| `playing` | `results` | `ctx.endShift()` when `shift.isOver` | deliveries.js:189 tail + packages write-off path |
| `results` | `meta` | click `#results-continue` | skipped when `meta.affordableCount() === 0` |
| `results` | `briefing` | (when meta skipped) | same handler |
| `meta` | `briefing` | click `#meta-start` | `beginShift(meta.shift)` |
| `results`/`meta` | `title` | click `#clock-out` | full stop, save flushed |

### Pause implementation — exact code shape

Four hazards, addressed one by one.

**1. The loop must stop stepping physics but keep rendering.** The existing guard at main.js:193-197 already does exactly this. It only needs the comment corrected and the particle freeze made deliberate:

```js
// ---------- main.js:193-197 (replace) ----------
  if (state !== 'playing') {
    // Menus render the frozen world behind the paperwork. NOTE: clock.getDelta()
    // at :190 has ALREADY consumed the elapsed time — that is what keeps the
    // Rapier accumulator from spiralling when we resume. Do not move it below.
    renderer.render(scene, camera);
    return;
  }
```

**2. The Rapier accumulator must not spiral.** physics.js:43 caps `_accum` at `0.12` (7 substeps). It is already safe because main.js:190 calls `clock.getDelta()` **before** the state guard, so no wall-clock time accumulates while paused. Belt-and-braces, because a backgrounded tab stops rAF entirely and one huge `getDelta()` would still hand the 0.1-clamped delta in:

```js
// physics.js — add after step() (physics.js:53)
  resetAccum() { this._accum = 0; }
```

**3. Pointer lock release + re-acquire.**

```js
// ---------- main.js — insert after the existing relock listener (main.js:163) ----------
function pause() {
  if (state !== 'playing') return;
  ctx.player.keys.clear();      // Escape strands held WASD (controller.js:79-89)
  setState('paused');           // setState() calls exitPointerLock()
  screens.showPause(ctx);
}

function resume() {
  if (state !== 'paused') return;
  setState('playing');
  clock.getDelta();                 // drop the paused span (already 0, but explicit)
  ctx.physics.resetAccum();         // no lurch on the first stepped frame
  lockPointer();
}

// Chrome returns a Promise from requestPointerLock and REJECTS it during the
// ~1.25 s security lockout right after Escape. An unhandled rejection is a
// pageerror → scripts/verify.mjs fails. Always swallow it.
function lockPointer() {
  try { renderer.domElement.requestPointerLock?.()?.catch?.(() => {}); } catch { /* noop */ }
}

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' && e.code !== 'KeyP') return;
  if (state === 'playing') pause();
  else if (state === 'paused') resume();
});

// Primary pause trigger: this is what the player actually experiences when they
// hit Escape (browsers may swallow the keydown while locked). Idempotent with
// the keydown path because pause() early-returns on state !== 'playing'.
document.addEventListener('pointerlockchange', () => {
  if (state === 'playing' && document.pointerLockElement !== renderer.domElement) pause();
});
document.addEventListener('pointerlockerror', () => { /* swallow — see lockPointer */ });
```

Also replace the two existing bare `requestPointerLock?.()` calls at **main.js:157** and **main.js:162** with `lockPointer()` — they carry the same latent unhandled-rejection risk today.

**4. The click-to-relock listener at main.js:161-163 fighting the menu.** Two defences, both required:

```js
// ---------- main.js:161-163 (replace) ----------
renderer.domElement.addEventListener('click', () => {
  if (state === 'playing' && !menuOpen) lockPointer();
});
```

and in index.html every overlay is a full-bleed click sink so no click ever reaches the canvas:

```css
[data-screen] { position: fixed; inset: 0; z-index: 60; display: none; pointer-events: auto; }
[data-screen].on { display: flex; }
#hud { pointer-events: none; }   /* unchanged, index.html:46 */
```

**Race analysis.** `resume()` → `lockPointer()` → `pointerlockchange` fires with `pointerLockElement === canvas` → handler sees state `'playing'` and lock present → no-op. `pause()` → `setState` → `exitPointerLock()` → `pointerlockchange` fires → state is already `'paused'` → early return. If the browser refuses the relock (post-Escape lockout), no change event fires; we sit in `'playing'` with a free cursor and the next canvas click recovers. Headless (verify.mjs) never acquires lock at all, so `pointerlockchange` never fires and no spurious pause occurs.

**`gameTime`** (main.js:115) only advances inside `physics.step`'s callback (main.js:207), so it freezes during pause. `player.lastLaunchT` comparisons (deliveries.js:144) therefore stay valid across a pause. No change needed.

---

## C) WHERE RUN STATE LIVES

### Decision

**Two new modules, and `Deliveries` keeps `score`/`completed`/`chain` where they are.**

- `src/game/shift.js` → `ctx.shift` — owns the manifest, quota, cursor, elapsed time, and the full stats ledger.
- `src/game/meta.js` → `ctx.meta` — owns persistence, unlocks, and effect resolution.

**Justification against the ctx architecture.** The codebase's contract is "one flat mutable `ctx` (main.js:96-112), subsystems call each other directly, no bus, no state class". Two more `ctx` fields plus two `boot()` lines is the cheapest possible extension of that contract, and it is exactly how `deliveries`, `director` and `particles` already got there.

Moving `score`/`completed`/`chain` out of `Deliveries` would be pure churn: `completed` is read at deliveries.js:112/133/155/178/185/188, packages.js:482, hud.js:90, and — critically — **verify.mjs:76 and :261**, which assert `completed === 1` and `completed > before`. `chain` is read at deliveries.js:31/38/148/150/179 and hud.js:92-100. They are the *current shift's* revenue ledger and their new lifetime is exactly one shift; the correct change is not to relocate them but to make `Shift.begin()` reset them.

`Shift` is genuinely a different concern: it has a *different lifetime* (spans `Deliveries`' whole life, must be re-initialised repeatedly), a *different vocabulary* (manifest lines, quota, PIP), and it must be serialisable. Cramming it into a 240-line file about beacon geometry and payout maths would be the wrong seam.

### `src/game/shift.js` — exported API

```js
import { PACKAGE_TYPES } from '../packages/packages.js';
import { zoneAt } from '../world/terrain.js';

export const MANIFEST_LEN, MAX_TYPE_IDX, QUOTA_SLACK, GOLDEN_FROM, GOLDEN_CHANCE; // §A

export class Shift {
  constructor(ctx)

  // --- fields ---
  n            // 1-based shift number
  manifest     // [{ no, typeIdx, def, golden, spotIdx, spot, status, payout, condition, seconds }]
  cursor       // index of the line currently in play (0-based)
  quota        // number
  elapsed      // seconds of stepped shift time
  parTotal     // Σ per-line par seconds (for the punctuality bonus)
  endless      // true only under the verify.mjs shim — isOver never fires
  stats        // see §D — flat object of counters

  // --- lifecycle ---
  begin(n)                 // build manifest+quota, zero stats, push threat, emit briefing data
  peekNext()               // -> the pending line the depot should issue (drives packages.rollNext)
  lineNo()                 // -> cursor + 1, for the delivery slip number
  currentSpotIdx()         // -> manifest[cursor].spotIdx, drives Deliveries._chooseTarget
  onDelivered(pkg, gained, detail)   // closes the line as 'delivered'
  onWrittenOff(golden)     // closes as 'writtenOff', OR returns 'redo' (see §E #8)
  get isOver()             // !endless && every line closed
  summary()                // -> the results data model (§D)
  fixedUpdate(dt)          // clocks + per-tick samplers (top speed, climb, zone time…)
}
```

`onDelivered`/`onWrittenOff` both end with `this._advance()`, which does `this.cursor++` and then — **and only then** — `this.ctx.director.setThreat(...)`. Never per-frame (see §I, check 24).

### Every call site that must change

| file:line | now | becomes |
|---|---|---|
| main.js:96-112 | ctx literal | `+ meta: null, shift: null, screens: null,` and `+ endShift() { endShift(); },` |
| main.js:118-121 | boot head | `ctx.meta = new Meta();` **first** — every later constructor reads effects |
| main.js:130 | `ctx.deliveries = new Deliveries(ctx)` | unchanged, then `ctx.shift = new Shift(ctx)` after `ctx.director` (main.js:139) |
| main.js:149-158 | `startGame()` | → `setState('briefing')` + `beginShift(ctx.meta.shift)` |
| main.js:214 | physics callback tail | `+ ctx.shift.fixedUpdate(fdt);` |
| deliveries.js:112 | `if (this.completed < this.spots.length) idx = this.completed;` | `let idx = this.ctx.shift?.endless === false ? this.ctx.shift.currentSpotIdx() : (this.completed < this.spots.length ? this.completed : 3 + …)` |
| deliveries.js:133 | `packages.rollNext(this.completed)` | `packages.rollNext()` |
| deliveries.js:185 | `packages.rollNext(this.completed)` | `packages.rollNext()` |
| deliveries.js:188 | `director.onDelivery(this.completed)` | keep (flavour toasts) + `this.ctx.shift.onDelivered(pkg, gained, {…}); if (this.ctx.shift.isOver) this.ctx.endShift();` |
| deliveries.js:128-134 | `onPackageLost` | `+ const redo = this.ctx.shift.onWrittenOff(golden); if (!redo && this.ctx.shift.isOver) return this.ctx.endShift();` |
| packages.js:63 | `rollNext(n)` | `rollNext(n)` — **keep the arg** for the harness; ignore it when `ctx.shift && !ctx.shift.endless` |
| packages.js:486 | `this.slipCount++` | `this.slipCount = this.ctx.shift?.lineNo() ?? ++this.slipCount` |
| director.js:43-48 | `onDelivery(completed)` sets `this.level` | split: `setThreat(v){this.level=v;}` + `onDelivery()` keeps only the 3 flavour toasts, re-keyed to shift progress |

New `resetForShift()` on four subsystems, all called from `beginShift()`:

```js
// main.js — new
function beginShift(n) {
  ctx.shift.begin(n);
  ctx.deliveries.resetForShift();
  ctx.director.resetForShift();      // MUST despawn every hazard body — see below
  ctx.packages.resetForShift();
  ctx.player.resetForShift();
  ctx.checkpoint.copy(ctx.packages.chutePos).add(new THREE.Vector3(-3, 0.5, -2));
  ctx.hud.setScore(0); ctx.hud.setDeliveries(0); ctx.hud.setChain(0);
  ctx.hud.setQuota(ctx.shift.quota, 0);
  ctx.hud.setManifest(0, ctx.shift.manifest.length);
  screens.showBriefing(ctx.shift, ctx.meta);
  setState('briefing');
}
```

```js
// director.js — new method. Leaking Rapier bodies across shifts is the single
// most likely bug in this whole spec. Reuse the existing removal path.
resetForShift() {
  for (const list of [this.boulders, this.snowballs]) { for (const b of list) b.ttl = -1; this._cullList(list, 0); }
  for (const ic of this.icicles) ic.ttl = -1;
  this._tickIcicles(0);
  this.event = null; this._eventWarn = null; this.windMult = 1; this.hazardPay = 0;
  this.flash = 0; this._boltTtl = 0; this._bolt.visible = false;
  this.ctx.hud.banner(null);
  const n = this.ctx.shift.n;
  this._boulderTimer  = n === 1 ? 1e9 : 10;
  this._icicleTimer   = 4;
  this._lightningTimer = 7;
  this._eventTimer    = n === 1 ? 1e9 : Math.max(30 - n * 3, 12);
}
```

```js
// packages.js — new
resetForShift() {
  if (this.current) this.remove(this.current);
  if (this.escapee) this._removeEscapee();
  this.slipCount = 0;
  this.ctx.hud.hideSlip();
  this.rollNext();
}
// player/controller.js — new
resetForShift() {
  const cp = this.ctx.checkpoint;
  this.body.setTranslation({ x: cp.x, y: cp.y + 2, z: cp.z }, true);
  this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  this.keys.clear(); this.knockTimer = 0; this.rollTimer = 0; this.slide = false;
  this.parachute = false; this.lastLaunchT = -99;
}
// game/deliveries.js — new
resetForShift() {
  this.score = 0; this.completed = 0; this.chain = 0;
  this._shockT = 0; this.pickupTime = performance.now();
  this._chooseTarget();
}
```

---

## D) RESULTS SCREEN DATA MODEL

The payslip is the payoff. Every counter below lives in `shift.stats`, is zeroed by `Shift.begin()`, and is folded into `meta.data.record` by `Meta.applyShiftResult()`.

### Instrumentation table — exhaustive

`S` = `ctx.shift.stats`. Every write is guarded `ctx.shift?.` where the subsystem can outlive/predate Shift (Deliveries and Packages are constructed *before* Shift; the harness may also drive them without a shift).

| # | stat | type | exact hook point | counter code |
|---|---|---|---|---|
| 1 | `delivered` | int | deliveries.js:155 (`this.completed++`) | inside `Shift.onDelivered`: `S.delivered++` |
| 2 | `writtenOff` | int | deliveries.js:129 | inside `Shift.onWrittenOff`: `S.writtenOff++` |
| 3 | `cleanDeliveries` | int | deliveries.js:148 | `if (conditionPct >= 90) S.cleanDeliveries++` |
| 4 | `conditionSum` → **clean rate / avg condition** | float | deliveries.js:139 | `S.conditionSum += conditionPct` → `avg = conditionSum / delivered` |
| 5 | `bestChain` | int | deliveries.js:148, after `this.chain++` | `S.bestChain = Math.max(S.bestChain, this.chain)` |
| 6 | `chainsBroken` | int | deliveries.js:36 (inside `breakChain`, after the `chain === 0` guard) | `S.chainsBroken++; S.chainBreakReasons.push(reason)` |
| 7 | `grossRevenue` | int | deliveries.js:154 + :44 | `S.grossRevenue += gained` in both |
| 8 | `bonuses{label}` | map | deliveries.js:43-46 (`addBonus`) | `S.bonuses[label] = (S.bonuses[label] ?? 0) + gained; S.bonusCount[label] = …+1` — captures CLOSE ONE, HAZARD PAY, BOING ×n for free |
| 9 | `damagesPaid` | int | deliveries.js:129 | `S.damagesPaid += penalty` (penalty computed with the insurance effect, §E #7) |
| 10 | `hazardPayAccrued` | float | director.js:133 | `S.hazardSeconds += dt` alongside the existing accrual |
| 11 | `closeCalls` | int | director.js:117 | `S.closeCalls++` |
| 12 | `bestBoing` | int | props.js:335-343 | `const s = ctx.shift?.stats; if (s) s.bestBoing = Math.max(s.bestBoing, this.boingCombo)` |
| 13 | `longestAirmail` (m) | float | **new**, controller.js:333 region | see airtime block below |
| 14 | `longestFall` (m) | float | same block | `S.longestFall = Math.max(S.longestFall, this._airPeakY - p.y)` |
| 15 | `topSpeed` (m/s) | float | `Shift.fixedUpdate` | `S.topSpeed = Math.max(S.topSpeed, Math.hypot(v.x,v.y,v.z))` |
| 16 | `metresClimbed` | float | `Shift.fixedUpdate` | `if (y > this._lastY) S.metresClimbed += y - this._lastY; this._lastY = y` |
| 17 | `peakAltitude` | float | `Shift.fixedUpdate` | `S.peakAltitude = Math.max(S.peakAltitude, y)` |
| 18 | `distanceTravelled` | float | `Shift.fixedUpdate` | `S.distance += Math.hypot(x-lx, z-lz)` |
| 19 | `cableSeconds` | float | `Shift.fixedUpdate` | `if (ctx.cablecar.gondolaBodies.has(ctx.player.groundBody)) S.cableSeconds += dt` — needs cablecar.js:168 `this.gondolaBodies.add(body)` (Set built in ctor) and controller.js:187 `this.groundBody = gb` (currently the ref is discarded) |
| 20 | `falls` | int | controller.js:151 (top of `respawn()`) | `ctx.shift?.stats.falls++` |
| 21 | `knockdowns` | int | controller.js:142 | `this.ctx.shift?.stats.knockdowns++` |
| 22 | `recoveryRolls` | int | controller.js:316 (`this.rollTimer = 0.45`) | `this.ctx.shift?.stats.recoveryRolls++` |
| 23 | `explosions` | int | packages.js:626 (`this.break(pkg, true)`) | `this.ctx.shift?.stats.explosions++` |
| 24a | `sheepEscapes` | int | packages.js:344 (top of `_sheepEscape`) | `S.sheepEscapes++` |
| 24b | `sheepRecaptured` | int | packages.js:414 | `S.sheepRecaptured++` |
| 24c | `sheepResigned` | int | packages.js:424 | `S.sheepResigned++` |
| 25 | `lightningHits` | int | director.js:375 | `this.ctx.shift?.stats.lightningHits++` |
| 26 | `events{name}` | map | director.js:139 (event-end block) | `S.events[this.event.name] = (…)+1` |
| 27a | `throws` | int | packages.js:436 (`pkg.carried = false` in `throwCarried`) | `S.throws++` |
| 27b | `yeetDeliveries` | int | deliveries.js:144 | `if (pkg.thrownT > 0) S.yeetDeliveries++` |
| 28 | `airmailDeliveries` | int | deliveries.js:144 | `if (airmail) S.airmailDeliveries++` |
| 29 | `chuteSeconds` | float | `Shift.fixedUpdate` | `if (ctx.player.parachute) S.chuteSeconds += dt` |
| 30 | `slideSeconds` | float | `Shift.fixedUpdate` | `if (ctx.player.slide) S.slideSeconds += dt` |
| 31 | `punts` | int | controller.js:132 (`this._puntCd = 0.5`) | `this.ctx.shift?.stats.punts++` |
| 32 | `bestDelivery` | int | deliveries.js:154 | `S.bestDelivery = Math.max(S.bestDelivery, gained)` |
| 33 | `fastestDelivery` (s) | float | deliveries.js:141 | `S.fastestDelivery = Math.min(S.fastestDelivery, elapsed)` (init `Infinity`) |
| 34a | `speedBonusTotal` | int | deliveries.js:143 | `S.speedBonusTotal += speedBonus` |
| 34b | `airmailBonusTotal` | int | deliveries.js:153 | `if (airmail) S.airmailBonusTotal += 75` |
| 35 | `elapsed` / `punctuality` | float | `Shift.fixedUpdate` (`this.elapsed += dt`) | bonus at summary: `Math.max(0, Math.round((this.parTotal - this.elapsed) * 4))` |
| 36 | `checkpoints` | int | main.js:178 (inside the `d < 6` branch) | `ctx.shift?.stats.checkpoints++` |
| 37 | `conditionLost` | float | packages.js:293 (`Packages.damage`) | `this.ctx.shift?.stats.conditionLost += dmg` |
| 38 | `zoneSeconds{key}` | map | `Shift.fixedUpdate` | `S.zoneSeconds[zoneAt(y).key] += dt` (5 buckets, powers "TIME BY ALTITUDE BAND") |

**Airtime block** (new, replaces nothing — inserted at controller.js:332-334, just before `this._wasAirborne = !this.grounded`):

```js
// --- Airtime ledger: longest airmail hop + longest survived fall ---
if (!this.grounded) {
  if (!this._wasAirborne) { this._airDist = 0; this._airStartY = p.y; this._airPeakY = p.y; }
  this._airDist += Math.hypot(v.x, v.z) * dt;
  this._airPeakY = Math.max(this._airPeakY, p.y);
} else if (this._wasAirborne) {
  const s = this.ctx.shift?.stats;
  if (s) {
    s.longestAirmail = Math.max(s.longestAirmail, this._airDist ?? 0);
    s.longestFall    = Math.max(s.longestFall, (this._airPeakY ?? p.y) - p.y);
  }
}
```

### `Shift.summary()` return shape

```js
{
  n, quota, revenue,          // revenue = deliveries.score at close (already net of write-offs)
  met: revenue >= quota, shortfall: Math.max(0, quota - revenue),
  punctuality, elapsed, parTotal,
  lines: [{ no, name, golden, dest, status, condition, payout, seconds }],
  bonusRows: [{ label, count, total }],           // from stats.bonuses, sorted desc
  deductionRows: [{ label, total }],              // damages, insurance excess, union dues (¤0, joke)
  mp: { revenue, quota, clean, chain, total },    // the MP breakdown, §E
  incidents: [ …3 auto-picked comedy lines… ],    // see below
  stats                                           // the whole ledger, for the fold-out
}
```

**Incident picker** — deterministic, ranked, first 3 that fire:

| condition | line (EN source voice) |
|---|---|
| `sheepResigned > 0` | `“${n} sheep formally resigned. HR has been notified.”` |
| `explosions > 0` | `"Essence of Regret, released into the environment. ×${explosions}."` |
| `lightningHits > 0` | `"Struck by lightning ${n}×. Classified as an act of the mountain."` |
| `longestFall > 40` | `"Longest uncontrolled descent: ${m} m. Impressive. Not billable."` |
| `longestAirmail > 60` | `"Longest airborne leg: ${m} m. Filed as AIRMAIL."` |
| `bestBoing >= 4` | `"${n} consecutive mushroom impacts. Nobody asked for this."` |
| `writtenOff === 0` | `"Zero write-offs. Do not let this go to your head."` |
| `bestChain >= 5` | `"Chain of ${n}. Somebody in Accounts noticed."` |
| `chainsBroken >= 3` | `"Chain broken ${n}×. Consistency is a competency."` |
| `falls >= 5` | `"${n} recorded falls. The mountain thanks you for your donation."` |
| `cableSeconds > 45` | `"${s} s spent riding company infrastructure. Efficient. Suspicious."` |
| always (fallback) | `"Shift completed without incident. This is itself an incident."` |

### Payslip layout (the waybill)

Sections, top to bottom, in the `#slip` monospace/paper idiom that index.html:151-168 already establishes — this is the one existing element already speaking the brand language, and the results screen is its full-page expansion:

1. **Header** — wordmark, `SHIFT No. 003`, `EMPLOYEE ${meta.data.employeeId}`, dashed rule.
2. **CONSIGNMENTS** — one row per manifest line: `01  PLAIN CRATE ......... HERMIT HUT   98%   ¤ 312`; written-off rows are struck through with `WRITTEN OFF  ¤ –50` in `#a83232`.
3. **BONUSES** — aggregated from `bonusRows`: `SPEED ×3 … ¤ 214`, `AIRMAIL ×1 … ¤ 75`, `HAZARD PAY ×2 … ¤ 96`, `CLOSE ONE ×5 … ¤ 187`, `PUNCTUALITY … ¤ 88`.
4. **DEDUCTIONS** — damages, insurance excess, `UNION DUES ¤ 0 (WAIVED)`.
5. **QUOTA LINE** — `NET ¤ 1,842 / QUOTA ¤ 1,412` + `MET` or `SHORT BY ¤ 214`.
6. **MERIT POINTS** — the `mp` breakdown, counted up with the existing `hud.setScore` easing trick (hud.js:76-88), reused as a shared `countUp(el, from, to, ms)` helper.
7. **NOTABLE INCIDENTS** — the 3 picked lines.
8. **Stamp** — a CSS-only rotated bordered block, `transform: rotate(-14deg)`, `APPROVED` (`#45d17a`) / `UNDER REVIEW` (`#ff4d6d`) / `EXEMPLARY` if the cosmetic unlock (§E #18) is owned. Animated in with a scale-down + slight overshoot, and `ctx.sfx.thud(1.2)` on land.
9. Footer buttons: `[ CONTINUE ]` `[ CLOCK OUT ]`, plus a `[ FULL RECORD ▾ ]` disclosure that expands the entire `stats` object as a two-column table.

---

## E) META-PROGRESSION

### Currency

**Merit Points (MP).** Footer on every screen: *"Merit Points are not a currency and hold no cash value."*

```js
// Meta.awardFor(summary)
const mp = {
  revenue: Math.floor(summary.revenue / 300),
  quota:   summary.met ? 3 + Math.min(summary.n, 8) : 0,
  clean:   summary.met && summary.stats.writtenOff === 0 ? 4 : 0,
  chain:   Math.max(0, summary.stats.bestChain - 3),
};
mp.total = mp.revenue + mp.quota + mp.clean + mp.chain;
```

Yield: ~12 MP after a good shift 1, ~31 after shift 5, ~5 after a PIP shift.

### Cost curve

`cost(id) = BASE[id] * 2 ** currentLevel`. Full table costs **548 MP** ≈ 25–30 shifts. Every upgrade declares `req: { shift: k }` where relevant (shown greyed with `AVAILABLE FROM SHIFT k`).

### Effect resolution

Each upgrade declares `key` + `per` (per-level delta). `Meta` precomputes `this._eff = {key: per*level, …}` on load and on every `buy()`, so hot-path hooks are a plain property read:

```js
// meta.js
eff(key) { return this._eff[key] ?? 0; }
```

**Never call `eff()` in a loop body without this memo** — it is read at 60 Hz from `controller.fixedUpdate`.

### The 18 unlocks

| # | id / name | dept | tiers | BASE | req | effect (per level) | exact hook |
|---|---|---|---|---|---|---|---|
| 1 | `harness` — **ERGONOMIC LOAD HARNESS** | EQUIPMENT | 3 | 5 | — | carry-mass divisor `60 → 60 + 20·L` | controller.js:243 → `1 / (1 + carryMass / (60 + M.eff('harness')))` |
| 2 | `boots` — **STEEL-TOED BOOTS** | EQUIPMENT | 2 | 6 | — | fall-hurt threshold `−17 → −(17 + 3·L)` m/s | controller.js:265 **and** :311 → both `-17` become `-(17 + M.eff('boots'))` |
| 3 | `sprint` — **COURIER SPRINT CERTIFICATION** | CERT | 3 | 6 | — | `SPRINT 10.8 → +0.6·L` (max 12.6) | controller.js:244 → `(shift ? SPRINT + M.eff('sprint') : SPRINT)` (const at :5 stays as the base) |
| 4 | `altCert` — **HIGH-ALTITUDE OPERATIONS CERT** | CERT | 1 | 10 | shift 3 | wind push on the courier ×`(1 − 0.30·L)` | controller.js:291 (`0.02`) and :293 (`g`) → both ×`(1 - M.eff('altCert'))` |
| 5 | `packaging` — **REINFORCED PACKAGING (SUPPLIER CONTRACT)** | LOGISTICS | 3 | 8 | — | impact damage ×`(1 − 0.12·L)` | packages.js:285 → `Math.min((dv - 6) * pkg.def.fragile * 4.5 * (1 - M.eff('packaging')), 45)` |
| 6 | `cradle` — **ANTI-SLOSH FLASK CRADLE** | EQUIPMENT | 2 | 8 | shift 6 | shake gain ×`(1 − 0.15·L)`; decay `3.5 → +1.2·L` | packages.js:625 (gain) and :627 (decay) |
| 7 | `insurance` — **CARGO INSURANCE TIER I/II/III** | INSURANCE | 3 | 6 | — | write-off penalty ×`(1 − 0.30·L)` (50→35/20/5; golden 300→210/120/30) | deliveries.js:129 → `Math.round((golden ? 300 : 50) * (1 - M.eff('insurance')))` |
| 8 | `restBreak` — **UNION REST BREAK** | UNION | 1 | 12 | shift 4 | 1× per shift, a write-off **re-issues the same line** instead of closing it | `Shift.onWrittenOff` → `if (M.has('restBreak') && !this._usedRedo) { this._usedRedo = true; return 'redo'; }` — line stays `pending`, `cursor` unchanged, HUD dispatch: *"DISPATCH: Rest break invoked. The parcel never happened."* |
| 9 | `seniority` — **SENIORITY BONUS** | UNION | 4 | 5 | shift 2 | chain cap `4 → 4 + L` (×3 → ×3.5/4/4.5/5) | deliveries.js:31 → `Math.min(this.chain, 4 + this.ctx.meta.eff('seniority'))`; **hud.js:93 must read the identical expression** or the HUD lies |
| 10 | `chute` — **PARACHUTE, COMPANY ISSUE** | EQUIPMENT | 2 | 8 | shift 2 | steer authority `8 → 8 + 3·L`; terminal `−3.4 → −3.4 + 0.5·L` | controller.js:282 (`* 8 *`) and :280 (`targetVy`) |
| 11 | `cablePass` — **CABLE CAR ANNUAL PASS** | LOGISTICS | 1 | 10 | shift 3 | gondola speed ×1.35; station crawl `0.22 → 0.35` | cablecar.js:178 → `BASE_SPEED * (crawl + (1-crawl) * min(d/18,1)) * spd` with `crawl/spd` from `M.has('cablePass')` |
| 12 | `routing` — **DISPATCH PRIORITY ROUTING** | LOGISTICS | 2 | 7 | — | speed-bonus par ×`(1 + 0.15·L)` | deliveries.js:142 **and** :233 → `(40 + this.target.pos.y * 1.4) * (1 + M.eff('routing'))` (both, or the HUD timer desyncs) |
| 13 | `hazardGrade` — **HAZARD PAY GRADE** | UNION | 3 | 6 | shift 2 | hazard accrual `6/s → 6 + 3·L` | director.js:133 → `this.hazardPay += dt * (6 + M.eff('hazardGrade'))` |
| 14 | `safety` — **SAFETY BRIEFING ATTENDANCE** | CERT | 1 | 9 | — | event warning `2.5 s → 4.0 s` | director.js:157 → `{ name, ttl: 2.5 + M.eff('safety') }` |
| 15 | `weather` — **WEATHER SERVICE SUBSCRIPTION** | LOGISTICS | 2 | 8 | shift 3 | ambient wind ×`(1 − 0.08·L)`; gale `windMult 3.4 → 3.4 − 0.5·L` | director.js:65 (strength) and :181 (`this.windMult = 3.4 - M.eff('galeCut')`) |
| 16 | `waiver` — **THIRD-PARTY LIABILITY WAIVER** | INSURANCE | 1 | 14 | shift 4 | respawning no longer breaks the chain | controller.js:164 → `if (!this.ctx.meta.has('waiver')) this.ctx.deliveries?.breakChain('respawn')` |
| 17 | `prp` — **PERFORMANCE-RELATED PAY** | UNION | 3 | 10 | shift 3 | all delivery payouts ×`(1 + 0.06·L)` | deliveries.js:153 → `Math.round((base + speedBonus + …) * mult * goldMult * (1 + M.eff('prp')))` |
| 18 | `frame` — **EMPLOYEE OF THE MONTH (FRAMED)** | COSMETIC | 1 | 20 | shift 5 | HUD panels gain a `#ffd166` 2 px border; the results stamp reads **EXEMPLARY** | CSS class `body.eotm` toggled in `Meta` init; zero gameplay effect, zero new assets |

Departments group the meta screen into four columns: **EQUIPMENT REQUISITION · CERTIFICATIONS · INSURANCE & LIABILITY · UNION BENEFITS** (+ a `LOGISTICS` column). Each card: title, dept stamp, current tier as `■■□`, effect line in plain corporate English (*"Reduces recorded impact damage to consignments by 12% per tier."*), cost, `[ REQUISITION ]` button.

---

## F) PERSISTENCE

### Schema

```js
// meta.js
export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'ud.save.v1';   // namespaced: github.io is a SHARED origin
                                           // across every one of the user's Pages projects
```

```json
{
  "v": 1,
  "employeeId": "UD-4417",
  "shift": 4,
  "mp": 23,
  "mpLifetime": 71,
  "owned": { "harness": 2, "boots": 1, "seniority": 3 },
  "pipStreak": 0,
  "seenTips": ["chute", "beam", "chute-hint", "first-delivery"],
  "record": {
    "shiftsWorked": 7, "shiftsPassed": 5, "terminations": 0,
    "delivered": 26, "writtenOff": 4, "bestChain": 6,
    "bestShiftRevenue": 3120, "topSpeed": 31.4, "metresClimbed": 4210,
    "longestAirmail": 88.2, "longestFall": 61.0,
    "sheepResigned": 2, "explosions": 1, "lightningHits": 3, "falls": 41
  },
  "history": [ { "n": 3, "rev": 1902, "quota": 1412, "met": true, "mp": 13 } ],
  "settings": { "music": true, "lang": "en", "quality": "auto" }
}
```

`history` is capped at the **last 10** entries (`history = history.slice(-10)`) — it feeds a sparkline of revenue vs quota on the meta screen using inline SVG (no library, no assets).

`employeeId` is generated once: `'UD-' + (1000 + Math.floor(Math.random()*9000))`.

### Schema change / migration

```js
const MIGRATIONS = {
  // 1: (d) => { …becomes v2… },   // add one entry per version bump
};

function load() {
  let raw;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch { return defaults(); }
  if (!raw) return defaults();
  let d;
  try { d = JSON.parse(raw); } catch { return backupAndReset(raw); }
  if (typeof d !== 'object' || d === null || typeof d.v !== 'number') return backupAndReset(raw);
  if (d.v > SCHEMA_VERSION) return backupAndReset(raw, 'future');   // a newer build wrote this
  while (d.v < SCHEMA_VERSION) { d = MIGRATIONS[d.v](d); d.v++; }
  return { ...defaults(), ...d, record: { ...defaults().record, ...d.record } };
}
function backupAndReset(raw, why) {
  try { localStorage.setItem(STORAGE_KEY + '.bak', raw); } catch { /* noop */ }
  const d = defaults();
  d._notice = why === 'future'
    ? 'Employment record filed by a future version of this company. Starting a new file.'
    : 'Employment record unreadable. A new file has been opened. The old one is not your problem.';
  return d;
}
```

The `_notice` is surfaced as one toast on the title screen, never persisted (it is stripped in `serialize()`).

**Never `console.error` on any of these paths** — verify.mjs:18 fails the build on a single console error.

### Writes

```js
save() {
  clearTimeout(this._saveT);
  this._saveT = setTimeout(() => this._flush(), 300);
}
_flush() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.serialize())); }
  catch { this._memoryOnly = true; }   // Safari private mode throws on setItem — degrade silently
}
```

Flush immediately (not debounced) on: `visibilitychange → hidden`, `pagehide`, and after `applyShiftResult()`. All `localStorage` access is wrapped; on failure the game runs fully with an in-memory object and the meta screen shows a small `STORAGE UNAVAILABLE — THIS SHIFT WILL NOT BE FILED` note.

### Reset

Meta screen footer: `[ REQUEST TERMINATION OF EMPLOYMENT ]` → an inline confirm requiring the literal text `RESIGN` typed into a field → `meta.reset()` → `removeItem(STORAGE_KEY)`, fresh defaults, back to title. No `confirm()` dialogs (they steal pointer lock and look nothing like the brand).

### NEVER persisted

Player position/velocity · any Rapier handle or body · `ctx` or any reference into it · the in-flight manifest or `packages.current` · `deliveries.score`/`chain`/`completed` · `director` timers or hazard lists · `gameTime` · wall-clock timestamps used for gating (no daily-reward mechanics, no way to validate them client-side) · **resolved upgrade effects** — only `owned: {id: level}` is stored, effects are recomputed from the table on every load so a balance patch applies retroactively.

**GitHub Pages implication:** there is no server, so the save is purely client-side and trivially editable via devtools. That is fine and should not be defended against — no checksums, no obfuscation. Do add an `[ EXPORT RECORD ]` button that copies the JSON to the clipboard (`navigator.clipboard.writeText`) and an `[ IMPORT ]` paste field, so a user changing machines or clearing site data isn't silently wiped. Both are ~10 lines and cost nothing.

---

## G) ONBOARDING / FIRST SHIFT

No tutorial mode. The **briefing screen is the tutorial**, and the in-shift beats are dispatch messages.

### Shift 1 briefing copy (EN source)

```
UNSTABLE DELIVERY  ·  MOUNTAIN LOGISTICS DIVISION
────────────────────────────────────────────────
ASSIGNMENT BRIEF                        SHIFT 001
EMPLOYEE  UD-4417                   (PROBATIONARY)

MANIFEST ........ 3 CONSIGNMENTS
QUOTA ........... ¤ 530
ROUTE ........... SUNNY MEADOWS → PINEWOOD LEDGES
CONDITIONS ...... FINE. ENJOY IT.

01  PLAIN CRATE .............. HERMIT HUT
02  PLAIN CRATE .............. LUMBER POST
03  GRANDMA'S PORCELAIN ...... OWL WATCHTOWER

NOTES FROM DISPATCH
 ·  Parcels are collected at the depot chute. Walk into the ring.
 ·  The gold beam marks where the parcel is expected.
    It is not a suggestion.
 ·  Consecutive undamaged deliveries extend your CHAIN.
    The chain pays. Breaking it does not.
 ·  You will fall. This is normal and is not covered.

WASD move · SHIFT sprint · SPACE jump
  hold in air: parachute · tap before landing: roll
F throw / kick · C belly slide · ESC pause · M music

              [ ACCEPT ASSIGNMENT ]  ↵
```

Shift 2+ briefings drop the NOTES block and the controls block (or collapse them behind `[ CONTROLS ▾ ]`), keep MANIFEST/QUOTA/ROUTE/CONDITIONS, and add a `NEW ON THIS ROUTE` line naming the newly unlocked cargo type with its `warning` string from `PACKAGE_TYPES` — e.g. *"NEW ON THIS ROUTE: BALLOON BUNDLE — LIGHTER THAN AIR-ISH."* A PIP shift prepends a red memo block:

```
⚠ PERFORMANCE IMPROVEMENT PLAN — ATTEMPT 1 OF 3
   Shift 003 closed ¤ 214 below quota. Quota held at
   the previous level as a gesture of goodwill.
```

### What is gated on shift 1

| gate | mechanism |
|---|---|
| No scheduled events at all | `director.resetForShift()` sets `_eventTimer = 1e9` when `shift.n === 1`; lifted to `26` by `Shift._advance()` when `cursor >= 1` |
| No ambient boulders until consignment 2 | `_boulderTimer = 1e9` on shift 1, and director.js:70 gains `&& (shift.n >= 2 \|\| shift.cursor >= 1)` |
| Only cargo types 0–1 | `MAX_TYPE_IDX(1) === 1` |
| No golden cargo | `GOLDEN_CHANCE(1) === 0` |
| No thunder / avalanche | `_pickEvent` gates (see §H) |
| Meta screen skipped | `results → briefing` directly when `meta.affordableCount() === 0` (after shift 1 the player typically has ~12 MP and *can* afford something, so it usually shows — that's intended, the first requisition is the hook) |

### Tutorial beats — in-fiction, one-shot, persisted

New HUD method, styled as a telex strip along the bottom (distinct from `toast`, which is the centre-screen shout):

```js
// hud.js — new
dispatch(text, ms = 5200) {
  this.dispatchEl.textContent = `DISPATCH ▸ ${text}`;
  this.dispatchEl.classList.remove('in'); void this.dispatchEl.offsetWidth;
  this.dispatchEl.classList.add('in');
  clearTimeout(this._dispT);
  this._dispT = setTimeout(() => this.dispatchEl.classList.remove('in'), ms);
}
```

Fired by `Shift`, each guarded by `meta.tip(id)` which returns `true` once ever and then persists the id into `seenTips`:

| id | trigger (file:line) | copy |
|---|---|---|
| `chute` | 2 s after `briefing → playing` | *"Chute is hot. Walk into the ring to collect."* |
| `beam` | first `deliveries.onPackagePicked()` (deliveries.js:122) | *"Follow the beam. Watch CONDITION — we bill you the difference."* |
| `damage` | first `packages.damage()` (packages.js:291) | *"We heard that."* |
| `air` | first frame with `!player.grounded` for >1.2 s while carrying (Shift.fixedUpdate) | *"Hold SPACE on the way down. The parcel is aerodynamic. You are not."* |
| `land` | first `player.knockdown` from a fall (controller.js:325) | *"Tap SPACE just before touchdown next time. It's in the handbook."* |
| `chain` | first `_deliver` with `conditionPct >= 90` (deliveries.js:148) | *"One down. Do it again without the noise — that's a CHAIN."* |
| `station` | first time within 8 m of a cable-car station (main.js:177 branch) | *"The gondola is company property. Ride it. That is what it's for."* |
| `fragile` | pickup of any `def.fragile > 1` type (packages.js:487) | *"That one is 74 years old. So is the grudge."* |
| `throw` | consignment 3 issued on shift 1 | *"F throws the parcel. A thrown parcel still counts as delivered. Legally."* |

Every one fires at most once **across the player's whole employment**, so shift 2 is silent. That is the entire onboarding system: no tutorial state, no gating logic beyond one `Set` lookup.

---

## H) DIFFICULTY COUPLING

### The core change

`director.level = completed` (director.js:44) is globally monotone. Under shifts, `completed` resets to 0 every shift, so difficulty would collapse at every shift start. Replace the *source* of `level`, not its type.

**`level` must stay a plain writable field** — verify.mjs:365 does `window.__game.ctx.director.level = 7`. A getter would throw in strict mode (ES modules are strict) → pageerror → harness fails.

```js
// ---------- director.js:43-48 (replace) ----------
// Threat level is pushed by Shift, never computed per-frame — the verify
// harness writes director.level directly (verify.mjs:365) and must win.
setThreat(level) { this.level = level; }

onDelivery(completed) {
  const n = this.ctx.shift?.n ?? 1;
  if (n === 1 && completed === 1) this.ctx.hud.toast('🌬️ The mountain has noticed you.', true);
  if (n === 2 && completed === 1) this.ctx.hud.toast('🪨 Insurance premiums rising…', true);
  if (n >= 4 && completed === 1) this.ctx.hud.toast('⛈️ The summit storm knows your name.', true);
}
```

```js
// shift.js — called from begin() and from _advance(). NEVER from fixedUpdate.
_pushThreat() {
  const prog = this.manifest.length ? this.cursor / this.manifest.length : 0;
  this.ctx.director.setThreat((this.n - 1) * 1.6 + prog * 1.4);
}
```

Resulting level bands: shift 1 → 0.0–1.4 · 2 → 1.6–3.0 · 3 → 3.2–4.6 · 4 → 4.8–6.2 · 5 → 6.4–7.8 · 6 → 8.0–9.4. The existing clamps `Math.min(this.level, 8)` (director.js:65) and `Math.min(this.level, 6)` (director.js:74) then plateau ambient chaos around shift 6, which is correct — beyond that difficulty must come from the cargo mix and the quota, not from more rocks per second.

### Exact per-line curve edits in director.js

| line | current | new |
|---|---|---|
| :15 | `this._boulderTimer = 10;` | seeded by `resetForShift()`: `n === 1 ? 1e9 : 10` |
| :26 | `this._eventTimer = 14;` | seeded by `resetForShift()`: `n === 1 ? 1e9 : Math.max(30 - n * 3, 12)` |
| :70 | `if (p.y > PEAK * 0.18) {` | `if (p.y > PEAK * 0.18 && (S.n >= 2 \|\| S.cursor >= 1)) {` |
| :72 | `this.boulders.length < 5` | `this.boulders.length < THREE.MathUtils.clamp(3 + Math.floor(S.n / 2), 3, 6)` |
| :73 | `Math.max(13 - this.level * 1.2 - alt01 * 4, 3.5)` | `Math.max(15 - this.level * 1.1 - alt01 * 4, 3.0)` — gentler shift 1, harder late |
| :74 | `0.7 + Math.min(this.level, 6) * 0.12` | unchanged |
| :84 | `Math.max(7 - this.level * 0.5 - alt01 * 2, 2)` | unchanged (the frozen band is unreachable before shift ~3 anyway) |
| :97 | `Math.max(9 - this.level * 0.6, 3.5)` | unchanged |
| :140 | `Math.max(26 - this.level * 1.5, 12)` | `Math.max(30 - this.level * 1.8, 10)` |
| :157 | `{ name, ttl: 2.5 }` | `{ name, ttl: 2.5 + M.eff('safety') }` (§E #14) |
| :65 | `(2.5 + alt01*15 + Math.min(this.level,8)*1.1) * (0.3+gust01) * this.windMult` | `× (1 - M.eff('weather'))` |
| :181 | `this.windMult = 3.4;` | `this.windMult = 3.4 - M.eff('galeCut');` |
| :165-174 | `_pickEvent(zone)` | filter the table by shift: `thunder` requires `n >= 3`, `avalanche` requires `n >= 4`; if the filtered table is empty fall back to `['gale']` |

**Do not put the shift gates inside `_startEvent`** — verify.mjs:355 calls `director._startEvent('avalanche', p, {key:'frozen'})` directly and must keep working at any shift number.

### Shape check

- **Shift 1:** level 0→1.4. No events, no boulders until line 2, then a small boulder roughly every 13 s in the meadow band only. Cargo: crate/crate/porcelain. Learnable.
- **Shift 3:** level 3.2→4.6. Events every ~24 s (thunder now in the pool), boulders every ~9 s, up to 4 concurrent, icicles live above 102 m. Cargo up to Dragon Egg + a 50% golden. Spicy.
- **Shift 5:** level 6.4→7.8. Events every ~16 s, boulders every ~5 s up to 5 concurrent, avalanche + thunder live, wind strength at the `min(level,8)` ceiling, potion in the pool, guaranteed golden, 7 lines, quota 2966. Chaos.

---

## I) verify.mjs IMPACT

### Breakage audit — all 25 checks

| # | check (verify.mjs line) | verdict |
|---|---|---|
| 1 | `state === 'title'` (:25) | **OK** — `'title'` still exists and `boot()` still lands there |
| 2 | `__game.start()` (:30) then implicitly `'playing'` | **BREAKS** — `startGame()` now goes to `'briefing'`. **Shim required** |
| 3 | player moved ≥2 m (:43) | OK |
| 4 | jump dy (:49) | OK |
| 5 | package pickup at the chute (:58-60) | **CONDITIONAL** — requires `packages.nextDef` to be set, i.e. a manifest must exist. The shim's `start()` must call `beginShift(1)` before entering `'playing'` |
| 6 | carry-while-walking (:67) | OK |
| 7 | **`completed !== 1` throws (:79)** | **OK only if `deliveries.completed` stays shift-scoped and `MANIFEST_LEN(1) >= 2`.** With `MANIFEST_LEN(1) === 3` the shift is not over after 1 delivery. **Hard constraint on §A: never make shift 1's manifest shorter than 3.** |
| 8 | gondola ride (:83-95) | OK — but `cablecar.gondolaBodies` Set must be populated in the ctor, not lazily |
| 9 | mushroom bounce (:99-110) | OK — new `stats.bestBoing` write must be `ctx.shift?.stats` guarded (props.js runs before Shift exists in `boot()` ordering if Shift is constructed last; it is, so the guard is mandatory) |
| 10 | mid-path + high-zone screenshots (:113-133) | OK |
| 11 | summit island (:136-145) | OK |
| 12 | parachute (:148-160) | OK |
| 13 | **potion explodes (:163-179)** | **BREAKS** — `break(pkg, true)` → `onPackageLost` → `Shift.onWrittenOff` closes a manifest line. Across the whole harness run `onPackageLost` fires ≥2× (potion, possibly sheep) and `_deliver` fires 2× → a 3-line manifest empties → `ctx.endShift()` → state flips to `'results'` mid-harness → every subsequent `keyboard` interaction is dead and the run fails. **Highest-risk breakage.** |
| 14 | package-type smoke loop (:182-195) | OK — `typeForDelivery(n)` must keep its exact signature and semantics |
| 15 | no-fly regression, balloon + egg (:199-220) | OK |
| 16 | parachute-while-carrying (:224-241) | OK |
| 17 | **throw → yeet-delivery (:245-265)** | delivers a 2nd consignment. Fine *given the endless shim*; without it, combined with #13, the shift ends here |
| 18 | gap spans (:268-277) | OK |
| 19 | recovery roll (:280-309) | OK — `stats.recoveryRolls++` guarded |
| 20 | sheep escape + recapture (:312-336) | OK when caught; if the 20-attempt chase fails, `onPackageLost` fires → same class of problem as #13 |
| 21 | rig vertex counts (:339-348) | OK |
| 22 | **event smoke, `_startEvent` direct (:351-360)** | **OK only if the shift gates live in `_pickEvent`, not `_startEvent`** (mandated in §H) |
| 23 | **chaos soak, `director.level = 7` (:365)** | **OK only if `level` stays a writable field AND `Shift` never pushes threat per-frame.** Both mandated in §H. If `setThreat` were called from `fixedUpdate`, the harness's `level = 7` would be overwritten within 16 ms and the soak would test nothing |
| 24 | fps / bodies readout (:390) | OK |
| 25 | **zero console errors / pageerrors / failed requests (:18-21, :393-396)** | **AT RISK** from four new sources — see below |

### The compatibility shim

`__game.start()` must remain callable with zero arguments and must leave the game in a state where the *entire* existing harness runs unmodified:

```js
// ---------- main.js:277-292 — extend the debug handle ----------
window.__game = {
  get state() { return state; },
  get fps() { return fps; },
  get playerPos() { … },   get playerVel() { … },
  get score() { return ctx.deliveries?.score; },
  get completed() { return ctx.deliveries?.completed; },
  get package() { … },
  get bodies() { … },
  ctx,

  // NEW debug reads
  get shift() { return ctx.shift?.n; },
  get quota() { return ctx.shift?.quota; },
  get manifest() { return ctx.shift?.manifest.map((l) => `${l.def.id}:${l.status}`); },
  get mp() { return ctx.meta?.data.mp; },

  // COMPAT: the harness calls start() with no args and expects to be 'playing'
  // immediately, with a live manifest, and expects the shift NEVER to end
  // (it destroys and delivers packages ~20 times across the run).
  start(opts = {}) {
    const { skipBriefing = true, endless = true, shift = 1 } = opts;
    beginShift(shift);              // manifest, quota, subsystem resets, → 'briefing'
    ctx.shift.endless = endless;    // isOver always false; nextConsignment() rolls random
    if (skipBriefing) enterPlaying();
  },

  // NEW debug drivers, additive
  pause, resume,
  endShift: () => endShift(),
  beginShift,
  setEndless(v) { ctx.shift.endless = !!v; },
  teleport(x, y, z) { … },
};
```

`enterPlaying()` is the extracted tail of today's `startGame()` (main.js:150-157) minus the title-screen hide:

```js
function enterPlaying() {
  ctx.sfx.start(); ctx.music.start();
  ctx.hud.show(); ctx.hud.setPackage(null);
  setState('playing');
  lockPointer();
}
function startGame() {                       // main.js:149 — title click handler
  document.getElementById('title-screen').style.display = 'none';
  beginShift(ctx.meta.shift);                // → 'briefing'
}
```

`Shift.endless === true` semantics:
- `get isOver()` → always `false`.
- `peekNext()` → synthesises a line from `typeForDelivery(deliveries.completed)`, exactly reproducing today's behaviour.
- `currentSpotIdx()` → returns `null`, so `Deliveries._chooseTarget()` (deliveries.js:110-116) falls through to its **existing, unchanged** logic.
- `onDelivered`/`onWrittenOff` still record stats (so the counters get exercised by the harness — free smoke coverage) but do not advance `cursor` or push threat.

Net effect: **verify.mjs stays byte-identical and all 25 checks pass.**

### The four console-error risks (check 25)

1. **Unhandled `requestPointerLock()` promise rejection** → pageerror. Fixed by `lockPointer()`'s `?.catch?.()`. Note this risk *already exists* today at main.js:157 and :162.
2. **`localStorage` throwing** (Safari private mode; some headless configs) → must be try/caught everywhere and must **never** `console.error`. Silent degrade to in-memory.
3. **`getElementById` returning `null`** in the new `Screens`/`Hud` constructors, then `.style` on `null` → pageerror. Mandate: every new element (`#screen-briefing`, `#screen-pause`, `#screen-results`, `#screen-meta`, `#dispatch`, `#hud-quota`, `#hud-manifest`) is **static markup in index.html**, never created at runtime, and `Screens` grabs all refs once in its constructor exactly as hud.js:3-27 does.
4. **`ctx.shift` accessed before construction.** `Shift` is built last in `boot()` (after `ctx.director`, main.js:139), but `Packages` (main.js:131) and `Deliveries` (main.js:130) both run gameplay code paths during construction (`Packages.rollNext(0)` at packages.js:58; `Deliveries._chooseTarget()` at deliveries.js:27). **Every `ctx.shift` read in packages.js, deliveries.js, props.js, director.js and controller.js must use `ctx.shift?.`** with a working fallback to today's behaviour. Alternative (cleaner, recommended): construct `Shift` *before* `Deliveries` at main.js:130 with a two-phase init — `new Shift(ctx)` sets up empty fields only, and `shift.begin(n)` (which needs `deliveries.spots`) runs later from `beginShift()`. Do this; it removes the whole class of ordering bugs. `ctx.meta = new Meta()` goes first, at main.js:119.

### Suggested additive checks for verify.mjs (new, optional)

```js
// --- Shift lifecycle: a finite shift ends and produces a results screen ---
const shiftEnd = await page.evaluate(async () => {
  const g = window.__game;
  g.start({ endless: false, shift: 1 });
  const len = g.ctx.shift.manifest.length;
  for (let i = 0; i < len; i++) {
    if (!g.ctx.packages.current) {
      const c = g.ctx.packages.chutePos;
      g.teleport(c.x + 0.5, c.y + 1.5, c.z);
      await new Promise((r) => setTimeout(r, 900));
    }
    const b = g.ctx.deliveries.beacon.position;
    g.teleport(b.x, b.y + 1.5, b.z);
    await new Promise((r) => setTimeout(r, 900));
  }
  return { state: g.state, len, quota: g.quota, mp: g.mp };
});
if (shiftEnd.state !== 'results') throw new Error('Shift did not end after the manifest emptied');

// --- Pause: physics must freeze, rendering must continue, no accumulator lurch ---
const paused = await page.evaluate(async () => {
  const g = window.__game;
  g.start();
  const p0 = g.playerPos;
  g.pause();
  await new Promise((r) => setTimeout(r, 1200));
  const p1 = g.playerPos;
  g.resume();
  await new Promise((r) => setTimeout(r, 200));
  return { state: g.state, drift: Math.hypot(p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]) };
});
if (paused.drift > 0.01) throw new Error('World advanced while paused');
if (paused.state !== 'playing') throw new Error('Resume did not return to playing');

// --- Hazard cleanup: beginShift must not leak Rapier bodies ---
const leak = await page.evaluate(async () => {
  const g = window.__game;
  g.ctx.director._startEvent('boulderRain', g.ctx.player.body.translation(), { key: 'cliffs' });
  await new Promise((r) => setTimeout(r, 3000));
  const before = g.bodies;
  g.beginShift(2);
  await new Promise((r) => setTimeout(r, 300));
  return { before, after: g.bodies, boulders: g.ctx.director.boulders.length };
});
if (leak.boulders !== 0) throw new Error('beginShift left hazards alive');
if (leak.after > leak.before) throw new Error('beginShift leaked rigid bodies');

// --- Persistence round-trip ---
const save = await page.evaluate(() => {
  const g = window.__game;
  g.ctx.meta.data.mp = 42; g.ctx.meta._flush();
  const raw = JSON.parse(localStorage.getItem('ud.save.v1'));
  return { v: raw.v, mp: raw.mp, hasPos: JSON.stringify(raw).includes('playerPos') };
});
if (save.v !== 1 || save.mp !== 42) throw new Error('Save round-trip failed');

// --- Meta effects actually reach the hooks ---
const effect = await page.evaluate(() => {
  const m = window.__game.ctx.meta;
  m.data.owned.harness = 3; m._rebuildEff();
  return m.eff('harness');            // expect 60 (20 per level)
});
if (effect !== 60) throw new Error('Meta effect resolution broken');
```

CI (`.github/workflows/deploy.yml`) still does not run `verify.mjs` and `playwright` is still an undeclared dep — both pre-existing, both out of scope here, both worth flagging to whoever owns the build workstream.

---

## ARCHITECTURE FLAGS

1. **`ctx` grows by 4 fields** (`meta`, `shift`, `screens`, `endShift`). This is within the existing contract (one flat mutable object, direct calls, no bus). No event bus is introduced, no state class. `endShift` sits alongside `shake`/`hitstop` (main.js:110-111) as a main-loop callback — the same pattern already in use.
2. **Construction order is now load-bearing.** `Meta` must be first (every constructor may read effects), `Shift` must be constructed before `Deliveries` but `begin()`-ed after. Document this with a comment block at main.js:118.
3. **Two effects must be read in exactly two places each or the HUD lies:** the chain cap (deliveries.js:31 **and** hud.js:93) and the routing par (deliveries.js:142 **and** deliveries.js:233). Extract each into a single method on `Deliveries` (`chainCap()`, `parFor(spot)`) and have the HUD call it via `ctx`.
4. **`director.level` must stay a writable field**, and `setThreat` must never be called per-frame. Violating either silently guts verify.mjs's chaos soak.
5. **`MANIFEST_LEN(1) >= 3` is a hard constraint**, not a tuning value — verify.mjs:79 asserts `completed === 1` and the shift must not have ended at that point.
6. **All new user-facing strings must route through the i18n layer** the bilingual workstream defines. This spec introduces ~95 of them: 1 briefing template (14 slots), 12 incident lines, 9 dispatch tips, 18 upgrade names + 18 effect descriptions, ~20 results labels, 6 stamp/verdict strings, 5 PIP/termination lines. Keys should be namespaced `brief.*`, `results.*`, `incident.*`, `dispatch.*`, `upgrade.<id>.name|desc`, `meta.*`.
7. **No new geometry, textures, fonts or audio assets.** The stamp, the sparkline, the paper texture and the wordmark are all CSS/inline-SVG. Audio reuses `sfx.jingle()`, `sfx.thud()`, `sfx.pickup()`, `sfx.fail()`, `music.fanfare()`.
