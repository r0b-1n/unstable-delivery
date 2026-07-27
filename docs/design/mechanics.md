<!--
  RAW DESIGN SPEC — New mechanics

  Provenance: written by an independent design agent against commit 3602969, then
  reviewed by two critics (see critique-feasibility.md / critique-coherence.md).

  THIS DOCUMENT IS NOT THE PLAN. Where it disagrees with docs/design/README.md or
  the approved v4 plan, THE PLAN WINS. Six specs were written blind to each other and
  four of them rewrite the same files incompatibly; the conflicts are resolved in the
  plan, not here. Read this for the reasoning and the raw values, not for the decisions.

  NOTE: the zip-line is deferred to Stage 10 despite being marked MUST here (plan B11).
-->

# UNSTABLE DELIVERY — WORKSTREAM: NEW MECHANICS

Read: `controller.js`, `character.js`, `packages.js`, `props.js`, `cablecar.js`, `director.js`, `deliveries.js`, plus `main.js`, `terrain.js`, `physics.js`, `hud.js`, `sfx.js`, `particles.js`, `music.js`, `index.html`, `scripts/verify.mjs`.

---

## A) AUDIT — WHAT ALREADY EXISTS AND DOES NOT PAY OFF

Ranked worst-offender first. "Smallest change" = the minimum edit that makes the system earn its line count.

### A1. The cable car — the biggest lie in the codebase
`cablecar.js` is ~230 LOC, ~89 meshes, 6 gondolas, 5 stations, a 400-segment `TubeGeometry`, a ~4.4 km `CatmullRomCurve3`. Its entire gameplay contribution is: checkpoints at stations (`main.js:173-183`), a 55 Hz hum (`cablecar.js:214-227`), and `groundVel` ride-along if you happen to stand in a gondola (`controller.js:185-188`).

`BASE_SPEED = 7.5` (`cablecar.js:6`) against `WALK = 7.2` / `SPRINT = 10.8`. Near stations `_speedAt` drops it to `7.5 × 0.22 = 1.65 m/s`. **A gondola is slower than walking, on the same spiral, with a wait time.** There is no reason to ever board one. Meanwhile `packages.js:36` prints `'HEAVY. TAKE THE CABLE CAR.'` on the anvil — the game advertises a mechanic that does not exist.

**Smallest change that makes it matter:** two things, both reusing existing machinery.
1. `BASE_SPEED 7.5 → 9.5`, `_speedAt` floor `0.22 → 0.3` (`cablecar.js:6, 178`). Still slower than sprint (correct — the gondola is the *safe* route, not the fast one).
2. The **freight hook** (B1b): the carry spring at `packages.js:518-547` takes an arbitrary anchor. Point it at a gondola instead of the hands. ~30 LOC. This is what finally makes the anvil's warning text true.

Then B1a (zip-line) makes the *cable* itself, not the gondolas, the fast route.

### A2. Seesaws — outright dead weight
`props.js:54-56, 236-272` — 3 revolute-joint planks, mass 22, ~37 LOC + 3 joint bodies + 3 static fulcrums. A seesaw with nothing on the other end is a wobbly board. In hundreds of playthroughs nothing will ever be sitting on the far end, because there is currently **no way to put anything down** (packages are carried, thrown, or loose-and-immediately-regrabbed at `packages.js:553`). They are also placed at `side(t, ±4)` — 4 m off the road, so you don't even walk over them.

**Smallest change:** they only become a mechanic once B2 (set down) exists. Move them onto the road (`±4 → ±2.5`), add end lips so a placed parcel stays put, add `restitution 0.35` to the plank collider (`props.js:264`). ~12 LOC on top of B2.
**If B2 is not funded: delete them.** Do not ship three dead props on the road.

### A3. Elevator platforms — near-dead weight
`props.js:58-60, 274-288, 468-479`. Two kinematic discs at `side(0.36, 9)` and `side(0.62, 9)` — 9 m off the path, so you have to leave the road for no stated reason. Cycle is `(t*0.14 + phase) % 2` = **14.3 s period**, ~6 s travel + ~4 s dwell each end. Average wait ~7 s with zero indication of where the platform is or when it returns. They work mechanically (the `groundVel` ride at `controller.js:187` is correct) but nobody will ever use them.

**Smallest change:** halve the cycle (`t*0.14 → t*0.26`, period 7.7 s) and put something at the top — the cheapest is to make the elevator's top position one of the **placed-parcel drop targets** or a windsock landmark (B4a) so it reads as infrastructure. Honestly: **cut candidate**. 30 LOC removed, nothing lost.

### A4. Geysers — no telegraph, therefore no skill
`props.js:222-234, 356-386`. 4 vents, period `4.2–5.8 s`, active window `1.4 s`, radius `sqrt(6.5) ≈ 2.55 m`, impulse `m*60*active*falloff*dt`, reach 16 m (30 m with parachute — a lovely detail). The problem is `props.js:359`: `g.active = cycle < 1.4 ? ... : 0`, and **steam particles only spawn while `active > 0`**. There is zero anticipation: the geyser is invisible until it has already launched you. A random shove is not a mechanic.

**Smallest change:** a 1.0 s charge phase before eruption — bubbling `particles.steam(pos, 0.3)`, a rising sine 90→350 Hz, and the rim mesh's `emissiveIntensity` ramping 0→2.5. ~10 LOC. This alone converts a random shove into a timed jump. See B6.

### A5. Crumbling planks — good, unrewarded
`props.js:127-158, 402-443`. Genuinely well-built: 0.7 s crack with a position jitter, then dynamic, then 9 s respawn with a "don't materialize inside the courier" guard. The only failure is that clearing one under the wire is not *stamped* — the game's best "oh god oh god I made it" beat produces no receipt.

**Smallest change:** track `pl.startedCrackingAt`; when the player leaves the plank footprint while `state === 'cracking'`, `deliveries.addBonus(40, '⏱ BEAT THE BOARD')`. 6 LOC.

### A6. The escaped sheep — the funniest mechanic, behind the highest gate
`packages.js:343-429`. Excellent: bespoke mesh, hop AI with flee/wander, recapture at 1.8 m, TTL 22 s, formal resignation quip. But it only fires from `break()` (`packages.js:321`), which requires condition 0. Sheep `fragile: 0.18` (`packages.js:29`), and `dmg = min((dv-6) × 0.18 × 4.5, 45)` with a `dmgCd = 0.3` cooldown — you need something like a dozen genuinely violent impacts inside one delivery. **Most players will never see it.**

**Smallest change:** `fragile: 0.18 → 0.42`, and fire `_sheepEscape` on any single landing with `dv > 25` while the crate is loose/thrown. 3 LOC. Also add the escapee-chews-placed-parcels interaction in D.

### A7. The potion shake meter — great feedback, no verb
`packages.js:621-644`. The heartbeat that accelerates (`heartT = 1.25 - shake/100 × 0.85`), the emissive pulse, the sizzle above 82, the HUD bar — this is the best-communicated system in the game. What's missing is **agency**: shake only decays at `3.5/s` and the only way to influence it is to stop playing. The player has feedback but no counter-verb.

**Smallest change:** a SETTLE state — if the player's horizontal speed < 1.5 for > 0.8 s, decay becomes `12/s` and a "◇ SETTLING" chip appears. Plus: riding a gondola or the zip-line halves accumulation and doubles decay. 6 LOC, and it wires the potion into A1.

### A8. The ghost flip — noise, not a mechanic
`packages.js:645-661`. Every 4–8 s, 1.4 s of `mass*40` upward force against gravity 22 → net **+18 m/s² up**. Dramatic, untelegraphed, uncounterable, unusable. It is a random interruption you cannot plan around or exploit, which is the definition of noise.

**Smallest change:** (a) 0.9 s wind-up — scale the two eye meshes ×1.8 and a falling 300→120 Hz tone; (b) during the flip, if carried, give the *player* a small float (`m*8*dt` while `vy < 2`). Now the flip is a **jump extender you can time**. ~8 LOC, and it turns the ghost from the worst parcel into the most skill-expressive one.

### A9. Close calls — too narrow, flat reward
`director.js:102-124`. 25 points, `_closeCd = 1.5 s`, requires distance < 2.3 m and relative speed > 8. Scans only `this.boulders` and `this.snowballs`. **Excluded:** icicles (`director.js:_tickIcicles`), pendulum logs, rolling logs (`props.rollers`), lightning, gondolas. Flat 25 means a heroic 4-dodge sequence and one lucky graze pay identically.

**Smallest change:** include `this.icicles` and `ctx.props.rollers` in the scan; cooldown `1.5 → 0.9`; escalating payout `25 / 50 / 100 / 150` for grazes within a 3.5 s rolling window, printed as `NEAR MISS ×N`. ~10 LOC.

### A10. The wind vector — the most under-visualized system in the game
`ctx.wind` drives: player impulses (`controller.js:283, 291, 294`), package forces (`packages.js:562`), gondola sway (`cablecar.js:196`), snow drift and streaks (`particles.js:127, 145`). The magnitude is `(2.5 + alt01*15 + min(level,8)*1.1) × (0.3 + gust)` — up to ~50 N-ish at the summit in a gale. **The player cannot see which way it is blowing at a glance, and can never use it — only be bullied by it.** Wind streaks only spawn above `gust > 0.35` (`particles.js:134`), so most of the time there is no directional cue at all.

**Smallest change:** three parts, all cheap, see B4. Windsocks are also the single most on-brand piece of set dressing this game could add.

### A11. Boing combo, airmail, hazard pay — fine, minor tuning only
`props.js:336-343` (boing), `deliveries.js:144, 153` (airmail flat 75), `director.js:130-144` (hazard pay 6/s). All working, all readable. Only note: boing escalation `1 + 0.1*min(combo-1,5)` tops out at 1.5× — barely visible. Raise to `0.14` (F14).

### A12. Bug flag (not a mechanic): checkpoint can move DOWN
`main.js:177`: `Math.abs(ctx.checkpoint.y - st.pos.y) > 1`. Walking back past a lower station **demotes your checkpoint**. With B3 (Return to Sender) this becomes a real problem — the return leg would reset you to the bottom. Fix: `st.pos.y > ctx.checkpoint.y + 1`.

### A13. Other dead weight, flagged not fixed
- `cablecar.js:75-89` — the **elevated return line** is half the curve geometry and half the gondolas ride on it, unreachable and pointless. Keep visually (it sells the loop), but know it costs.
- `props.js:65-67` — two `_crateStack(side(0.3,5), 3)` / `side(0.55,-5)` piles, 6 loose dynamic bodies in the middle of nowhere, punt fodder only. B2 gives them a purpose (climbing blocks).
- `packages.js:55` `slipCount` only feeds the slip number.

---

## B) NEW MECHANICS — RANKED BY VALUE PER LINE

*(The multi-package stack is the highest-value item overall; it is specified in full in section C as requested.)*

---

### B1 · THE FREIGHT LINE — cable clip + cargo hook
**≈95 LOC. Highest value-per-line in this section.**

**Fiction.** Every cable in the alpine freight network carries a company trolley. Clipping your own harness to a live freight line is against seventeen regulations, all of which are printed on the trolley. You do it anyway. The gondola hook is the *approved* method: slow, safe, pays freight class.

#### B1a — Cable clip (zip-line)

**Rules.**
- Key `E`. Requires: not knocked down, `_clipCd <= 0`, and a point on the **up-line half of the curve** (`u < 0.5`) within 4.5 m above the player and within 3.0 m horizontally.
- `CLIP_SPEED = 26` m/s along `+u` (uphill). This must be dramatically faster than sprint (10.8) or the mechanic is pointless.
- `CLIP_GRIP = 6.0` s, draining at `1 + 0.5 × packages.carriedCount()` per second. Full grip with one parcel = 4.0 s ≈ **104 m of travel**. This is a *burst shortcut*, not a transit system — critical, because the up-line is ~2.2 km long and an unlimited ride would trivialize the entire mountain.
- Grip exhaustion = you fall, wherever you are. Usually over a chasm. That is the point.
- Detach: `Space` (launch), `E` (let go), grip = 0, or auto-detach on reaching a station's `u`.
- `_clipCd = 2.5` s after any detach — no instant re-clip.
- The stack sheds to 1 parcel on clip (`packages._spill('one hand on the trolley')` down to `active[0]`). Comedy + real cost.

**Physics approach — velocity constraint, NOT a joint.** A Rapier joint to a kinematic trolley is more code and less controllable. Instead, each `fixedUpdate` while clipped:
```js
const cc = this.ctx.cablecar;
this.clipU = (this.clipU + (CLIP_SPEED * dt) / cc.length) % 1;
const cp = cc.curve.getPointAt(this.clipU);
const ct = cc.curve.getTangentAt(this.clipU);
const p = this.body.translation();
const tx = cp.x, ty = cp.y - 2.4, tz = cp.z;           // hang 2.4 m below the cable
const cx = THREE.MathUtils.clamp((tx - p.x) * 18, -30, 30);
const cy = THREE.MathUtils.clamp((ty - p.y) * 18, -30, 30);
const cz = THREE.MathUtils.clamp((tz - p.z) * 18, -30, 30);
this.body.setLinvel({ x: ct.x * CLIP_SPEED + cx, y: ct.y * CLIP_SPEED + cy, z: ct.z * CLIP_SPEED + cz }, true);
```
Velocity (not `setTranslation`) preserves CCD and keeps collisions live — a pendulum log can still knock you off the line, which is exactly the risk profile we want. `getPointAt`/`getTangentAt` cost: the gondola loop already does 12 arc-length lookups per fixed step (`cablecar.js:189-190`); one more is free.

Detach launch:
```js
this.body.setLinvel({ x: ct.x * CLIP_SPEED * 0.8, y: 6, z: ct.z * CLIP_SPEED * 0.8 }, true);
this.airborneBySomethingFun = true;   // suppresses fall-damage knockdown
this.lastLaunchT = this._t;           // makes the following delivery count as AIRMAIL
```

**Insertion points.**
- `controller.js:26` — after `this._puntCd = 0;` add `this.clipped = false; this.clipU = 0; this.clipGrip = 0; this._clipCd = 0;`
- `controller.js:83` — after the `KeyF` line, inside the same `keydown` handler (after the `e.repeat` guard at :80): `if (e.code === 'KeyE') this._tryClipOrHook();`
- `controller.js:139` — after `_throwOrPunt()`, add `_tryClipOrHook()`, `_tickClip(dt)`, `_detachClip(launch)`.
- `controller.js:196` — immediately after `this._groundCheck();`, insert `if (this.clipped) { this._tickClip(dt); }` and gate the movement/jump/parachute/footstep blocks (`:226-334`) behind `if (!this.clipped) { … }`. Keep the `KILL_Y` check at `:337` outside the gate.
- `controller.js:266` — the jump block: prepend `if (this.clipped && this.jumpBuffer > 0) { this.jumpBuffer = 0; this._detachClip(true); } else if (…existing…)`.
- `cablecar.js:179` — after `_speedAt`, add:
  ```js
  // Nearest point on the UP-LINE half of the loop. Brute-force 240 samples;
  // only ever called on an E press, ~0.4 ms.
  nearestCableU(pos) {
    let bu = 0, bd = Infinity, bp = null;
    for (let i = 0; i < 240; i++) {
      const u = i / 480;                       // u in [0, 0.5) = up-line only
      const q = this.curve.getPointAt(u);
      const d = Math.hypot(q.x - pos.x, q.y - pos.y, q.z - pos.z);
      if (d < bd) { bd = d; bu = u; bp = q; }
    }
    return { u: bu, point: bp, dist: bd };
  }
  ```

**Visual.** A trolley group built in `controller.js` (or better: `cablecar.js` builds one shared `this.trolley` group, hidden by default): two `CylinderGeometry(0.16,0.16,0.1,8)` wheels at `x = ±0.22` in `0x3a4258`, a `TorusGeometry(0.14,0.04,4,10)` hook below in `0xc8a24a` brass, and a 2.4 m `CylinderGeometry(0.02,0.02,2.4,3)` strap down to the courier. Positioned at the cable point each render frame from `main.js:220` (`ctx.cablecar.update()`).

`character.js` needs a clip branch — insert **before** the parachute branch at `character.js:325`:
```js
if (player.clipped) {
  lerp(this.armL.rotation, 'x', -2.75, 14); lerp(this.armR.rotation, 'x', -2.75, 14);
  lerp(this.armL.rotation, 'z', 0.12, 10);  lerp(this.armR.rotation, 'z', -0.12, 10);
  lerp(this.legL.rotation, 'x', 0.42 + Math.sin(t * 4) * 0.14, 8);
  lerp(this.legR.rotation, 'x', 0.30 + Math.cos(t * 3.6) * 0.14, 8);
  lerp(this.torsoG.rotation, 'x', -0.18, 8);
  this.chute.visible = false;
}
```

**Audio.** `sfx.js` needs one new sound, insert after `pop()` (`sfx.js:193`):
```js
clipOn() {
  this.tone({ freq: 900, type: 'square', peak: 0.12, decay: 0.05, slideTo: 300 });
  this.noise({ freq: 4200, peak: 0.13, decay: 0.07, type: 'highpass' });
}
```
Everything else reuses what exists: force `sfx.cableHum(true)` while clipped (`cablecar.js:214-227` already owns the hum node — add a `player.clipped ||` to the `near` test at `:221`), and `setRush` fires for free at 26 m/s via `main.js:255-256`.

**Particles.** `particles.sparks(trolleyWorldPos, 0xffe6a8, 2)` every 0.08 s while clipped. Additive glow pool, 3 draw calls total already. **This is the screenshot.**

**HUD.** One chip: `◤ FREIGHT LINE · GRIP ███░░` — `hud.chip('grip', …)`, see the HUD API in C.

**Failure mode if ignored.** Nothing breaks. `E` does nothing when you're not under a cable. The player who never clips plays exactly today's game, just slightly slower on the upper mountain. Acceptable — this is a mastery layer, not a gate.

#### B1b — Cargo hook (freight class)

**Rules.**
- Same `E` key, **higher priority**: if a gondola's hook slot is within 4.0 m, `E` hooks the top carried parcel instead of clipping.
- `pkg.hooked = gondola`. The carry spring anchor becomes `gondola.group.position + (0, 2.0, 0)` — one branch in the existing spring, no new physics.
- A hooked parcel: takes **zero impact damage and zero shake** (short-circuit `_onImpact` and the potion accumulator on `pkg.hooked`), earns **no SPEED bonus and no AIRMAIL**, and earns a `freightMult = def.mass > 30 ? 1.5 : 1.0`.
- It still delivers: `deliveries.fixedUpdate` gate at `:212` becomes `(!pkg.carried && !pkg.hooked && pkg.thrownT <= 0) → return`.
- Unhook by touching it (existing proximity re-grab at `packages.js:553`).

**Insertion points.**
- `cablecar.js:168` — add `hooked: null` to the gondola record; add a brass `TorusGeometry(0.18, 0.05, 4, 12)` hook mesh at `y = 1.5 + (DROP - 1.5)` in `_gondola`.
- `cablecar.js:179` — `hookSlot(g)` returning `{x: g.group.position.x, y: g.group.position.y + 2.0, z: g.group.position.z}`.
- `packages.js:520` — the `if (pkg.carried)` branch becomes `if (pkg.carried || pkg.hooked)`, with the anchor chosen by `pkg.hooked ? cablecar.hookSlot(pkg.hooked) : player.getCarryAnchor()`. The player-reaction impulse block (`:543-546`) is skipped entirely when hooked.
- `packages.js:274` `_onImpact` — first line: `if (pkg.delivered || pkg.hooked) return;`
- `deliveries.js:143` — `const speedBonus = pkg.hooked ? 0 : Math.max(…)`; `:144` — `const airmail = !pkg.hooked && (…)`; `:153` — multiply by `freightMult`.

**Failure mode if ignored.** The anvil stays a slog (which is currently the status quo), the potion stays a knife-edge. Nothing regresses.

---

### B2 · SET DOWN — parcels become world objects
**≈30 LOC. Second-best value-per-line; unlocks B7 and most of D.**

**Fiction.** "SET DOWN (G). Note: leaving a consignment unattended voids the insurance and, per §14.2, transfers custody to whatever finds it."

**Rules.**
- Key `G`. Takes the **top** carried parcel; sets `carried = false`, `placed = true`, `noGrabT = 1.2`, zeroes linvel/angvel, translates to `playerPos + fwd × 1.1` at `terrain.heightAt(x,z) + 0.6`.
- **The key change: collision groups.** Carried parcels are `(0x0004 << 16) | 0xfffd` (`packages.js:246`) — membership bit 2, filter excludes bit 1 (the player capsule at `0x0002`). A **placed** parcel switches to membership bit 3: `collider.setCollisionGroups((0x0008 << 16) | 0xffff)`. The player's own filter `0xfffb` clears bit 2 only, so bit 3 passes → **the player can now stand on it.** The ground probe at `controller.js:178` uses the same filter, so `grounded` works on top of it. Two calls, no new bodies.
- Re-grab on proximity (existing `packages.js:553`) but **only if you are not standing on it**: skip when `player.grounded && playerY > pkgY + 0.4`.
- Only `crate`, `porcelain`, `sheep`, `anvil` are `placeable` (flat-bottomed). The egg and potion are balls (`packages.js:242-244`) and would roll — placing them is allowed but they get no special treatment, which is its own joke.
- **UNATTENDED timer:** while `placed && distance to player > 6`, `pkg.unattended += dt`; past 12 s, `damage(pkg, dt * 1.0)` and a HUD chip `⚠ UNATTENDED · INSURANCE VOID`. This is the anti-parking-abuse rule and it is free satire.

**Insertion points.**
- `controller.js:83` — `if (e.code === 'KeyG') this.ctx.packages.setDown();`
- `packages.js:495` — after `dropCarried()`, add `setDown()` and `pickUpPlaced(pkg)`.
- `packages.js:553` — add the standing-on-it guard and the `active.length < stackCap()` guard.
- `packages.js:7-48` — add `placeable: true` to crate / porcelain / sheep / anvil.

**Feedback.** `sfx.pop()` on placement (already exists), `particles.dust(pos, 0.6)`. On pick-up: `sfx.pickup()`. HUD: the manifest row grays out and gets a `PLACED` stamp.

**Failure mode if ignored.** Zero. `G` is purely additive.

---

### B3 · REFUSED — return to sender
**≈50 LOC. Gives the condition bar a cliff and gives *downhill* a purpose for the first time.**

**Fiction.** The recipient inspects the parcel, looks at you, and does not sign.

**Rules.** At `_deliver()` (`deliveries.js:136`), grade on `conditionPct`:

| condition | grade | pay | chain |
|---|---|---|---|
| ≥ 90 | **ACCEPTED** | full | `chain++` |
| 50–89 | **ACCEPTED W/ RESERVATIONS** | scaled by `(0.3 + 0.7 × pct/100)` (as today) | unchanged |
| 25–49 | **DAMAGED** | scaled, plus a `-40` handling deduction line on the receipt | `chain = 0` (as today) |
| < 25 | **REFUSED** | **0** | `chain = 0` |

On REFUSED: `pkg.returned = true`, `pkg.delivered` stays `false`, the parcel's manifest entry re-points to a pseudo-spot `{ pos: packages.chutePos.clone().setY(chutePos.y + 0.5), name: 'Depot — Returns Desk', moving: null }`, the beacon relocates and recolors `0xffd166 → 0x8fb0dd`, and `hud.stamp('REFUSED')`.

Delivering a returned parcel to the depot pays `Math.round(40 + conditionPct)` (a pittance — 40–65 points), clears the slot, and prints `↩ RETURN PROCESSED`. Handing it back at 0 condition is impossible (it breaks first, which routes into the existing `onPackageLost`).

**Why this is worth the lines.** The entire movement kit — belly slide (`controller.js:208-224`), parachute (`:275-286`), recovery roll (`:311-322`), boing chains — is *best* going downhill, and today there is literally no reason to ever descend. REFUSED manufactures a downhill leg on demand, and it is the only mechanic on this list that makes the bottom half of the condition bar matter.

**Insertion points.**
- `deliveries.js:136-189` — restructure `_deliver(pkg)` around a `grade` switch; the ceremony block (`:167-183`) forks: ACCEPTED keeps confetti + `sfx.jingle()` + `music.fanfare()`; REFUSED gets `sfx.fail()` + one dry `sfx.thud(0.6)` + **no** particles + `ctx.hitstop(0.14)`.
- `deliveries.js:110-116` — `_chooseTarget` becomes `assignSpot(pkg)`; add `_returnSpot` lazily built from `ctx.packages.chutePos`.

**Feedback.** The anti-fanfare needs its own identity or it reads as a bug. Sequence in E3.

**Failure mode if ignored.** A player who never damages cargo never sees it. A player who does gets a chore — which is the intended sting.

---

### B4 · WIND, MADE LEGIBLE AND USABLE
**≈55 LOC. Enormous art-direction payoff per line.**

**Fiction.** Regional Wind Advisory Apparatus (windsocks). "Company policy: the wind is a partner, not an obstacle."

#### B4a — Windsocks (the art object)
15 of them: one at each of the 5 cable stations (`cablecar.stations[i].pos`), one at each of the 9 delivery spots (`deliveries.spots[i].pos`), one at the depot (`packages.chutePos`).

Geometry, shared across all 15 (one `CylinderGeometry(0.55, 0.28, 2.4, 7, 1, true)` open-ended cone + a 2.6 m pole + a ring), materials: sock `0xff9f43` with `0xf5f0e6` stripes (two thin cylinders), pole `0x3a4258`. `side: THREE.DoubleSide`, `flatShading: true`. No colliders.

Per fixed step:
```js
for (const w of this.windsocks) {
  const wl = Math.hypot(wind.x, wind.z) || 1e-3;
  w.sock.lookAt(w.pos.x + wind.x, w.pos.y + 2.6 - wl * 0.06, w.pos.z + wind.z);
  w.sock.rotateX(Math.PI / 2);
  const k = Math.min(wl / 14, 1);
  w.sock.scale.set(0.35 + k * 0.65, 1, 0.35 + k * 0.65);
}
```
15 extra draw calls. Given the user's explicit "looks over performance" bias, this is a bargain: it makes the single most-used invisible system in the game visible, from any distance, at every landmark, in the exact visual language of a logistics company.

**Insertion:** `props.js:80` (end of `_build`) — the placement loop; `props.js:220` — `_windsock(pos)`; `props.js:479` — the tick at the end of `fixedUpdate`.

#### B4b — Tailwind glide
`controller.js:283` currently applies `wind × m × 0.04 × dt` while parachuting — undirected, so wind is pure noise even in the one state built to exploit it. Replace with:
```js
const wl = Math.hypot(wind.x, wind.z) || 1e-3;
const align = (dx * wind.x + dz * wind.z) / wl;        // -1..1, dx/dz = input dir
const f = hasInput ? (align > 0.5 ? 0.11 : align < -0.5 ? 0.018 : 0.045) : 0.04;
this.body.applyImpulse({ x: wind.x * m * f * dt, y: 0, z: wind.z * m * f * dt }, true);
this._glideDist += Math.hypot(v.x, v.z) * dt;
if (align > 0.5) this.ctx.hud.chip('wind', '🪁 TAILWIND');
```
On landing, if `_glideDist > 45`: `deliveries.addBonus(30, '🪁 TAILWIND')`, reset. Flying *into* the wind is now possible but slow — a real navigational decision.

**Do not touch `targetVy = -3.4`** — `verify.mjs:160` asserts `chuteVy >= -6`.

#### B4c — Balloon sail (see also D)
`packages.js:569-585`. While carrying the balloon bundle **and airborne**, transfer part of the bundle's wind force to the courier:
```js
if (pkg.carried && !player.grounded) {
  player.body.applyImpulse({ x: wind.x * player.body.mass() * 0.030 * dt, y: 0,
                             z: wind.z * player.body.mass() * 0.030 * dt }, true);
}
```
Four lines that invert the design: `windMult: 9` (`packages.js:19`) makes the balloon the most annoying parcel; this makes it the best downwind travel tool in the game. **Must not touch the vertical axis** — `verify.mjs:199-220` asserts a carried balloon lifts the player < 4 m.

**Failure mode if ignored.** Wind stays exactly as punishing as it is now, but at least you can see it.

---

### B5 · HANDLING CLASS — the form
**≈35 LOC. Small mechanical footprint, disproportionate brand payoff.**

**Fiction.** A three-option declaration at the depot counter, exactly the kind of choice a real waybill demands and no customer understands.

**Rules.** While standing in the depot ring with a free manifest slot, `1` / `2` / `3` sets `packages.handling` for the *next* pickup:

| | `1 STANDARD` | `2 EXPRESS` | `3 FRAGILE-CERTIFIED` |
|---|---|---|---|
| par time | ×1.0 | **×0.55** | ×1.25 |
| speed bonus | ×1.0 | **×2.5** | ×0.6 |
| impact damage | ×1.0 | ×1.15 | **×0.5** |
| base pay | ×1.0 | ×1.0 | **×0.7** |
| on-fail | — | **−2 pts/s past par** | **−150 if destroyed** |

Numbers are set so EXPRESS is the greedy choice, FRAGILE is the correct choice for the anvil/potion/porcelain, and STANDARD is never wrong but never exciting.

**Insertion:** `packages.js:52` add `this.handling = 'standard'`; `:265` add `handling: this.handling` to the pkg literal; `_onImpact` (`:285`) multiplies `dmg` by the class factor; `deliveries.js:142-143` scale `par`/`speedBonus`; `deliveries.js:129` add the FRAGILE destruction penalty. Key handling goes in `main.js:165-170` next to the existing `KeyM` listener (it needs the depot-proximity test, which `packages.tryPickup` already computes at `:480-481` — expose it as `packages.atDepot()`).

**HUD.** A 3-row panel that appears only inside the depot ring. Pure form aesthetic — checkbox rows, a dotted underline, "DECLARE HANDLING CLASS".

**Failure mode if ignored.** Defaults to STANDARD forever. Nothing changes.

---

### B6 · PNEUMATIC DISPATCH — the geyser, telegraphed and weaponized
**≈30 LOC.**

**Fiction.** These are not geysers. They are the Vertical Pneumatic Dispatch network, decommissioned in 1908, still pressurized.

**Rules.**
1. **Charge phase (this is the mandatory half).** In the geyser tick (`props.js:357-359`):
   ```js
   const cycle = (t + g.phase) % g.period;
   g.charge = cycle > g.period - 1.0 ? (cycle - (g.period - 1.0)) : 0;   // 0..1
   g.active = cycle < 1.4 ? 1 - cycle / 1.4 : 0;
   ```
   While `charge > 0`: `particles.steam(rimPos, 0.3)` at ~4/s; `sfx.tone({freq: 90 + g.charge*260, type:'sine', peak:0.05, decay:0.12})` at 6 Hz; `g.rim.material.emissiveIntensity = g.charge * 2.5`. Requires adding `emissive: 0x3a4a58` to the rim material (`props.js:227`).
2. **Parcel dispatch.** The geyser loop already iterates `ctx.dynamics`, so a *placed* parcel (B2) already gets launched. Make it intentional: when a package body is launched, set `pkg.thrownT = 3.0` so it can score a delivery in flight (the `deliveries.js:212` gate already honours `thrownT`). If it lands within 15 m of its own beacon: `addBonus(60, '💨 PNEUMATIC DISPATCH')`.
3. **Rebrand the rim mesh:** riveted steel `0x8a95a8` with a brass collar `0xc8a24a`. Feeds the art direction directly.

**Insertion:** `props.js:222-234` (`_geyser`), `props.js:356-386` (tick).

**Failure mode if ignored.** The geyser stays a launcher — but now a *readable* one, which is a strict improvement even for a player who never dispatches a parcel.

---

### B7 · THE PARCEL CATAPULT — seesaws, resurrected
**≈15 LOC on top of B2. Only fund this if B2 ships.**

**Rules.** Place a parcel on one end of a seesaw (B2), drop onto the other end from ≥ 3 m. The plank (mass 22, revolute joint, `props.js:262-271`) already produces plenty of torque against an 80 kg courier at −12 m/s. The reason it never happens today is that nothing is ever on the plank.

Changes:
- Move the seesaws onto the road: `props.js:55` offsets `4, -4, 4 → 2.5, -2.5, 2.5`.
- Add end cups so a placed parcel stays put: two `BoxGeometry(0.3, 0.4, 1.7)` lips at `x = ±3.5`, mirrored as `cuboid(0.15, 0.2, 0.85)` colliders on the same dynamic body.
- `props.js:264` plank collider: `.setRestitution(0.35)`.
- Detect launch: if a placed parcel's `vy` exceeds `+7` while within 4 m of a seesaw pivot → `pkg.thrownT = 3.5`, `pkg.catapulted = true`, `addBonus(50, '🎪 CATAPULT DISPATCH')`, `sfx.boing(0.8)`, `particles.pops(pos, 0xa9743f)`.

**Failure mode if ignored.** Same as today (nothing), except the seesaws are now at least on the road where they read as obstacles.

---

### B8 · AUDIT-FIX BUNDLE
**≈45 LOC total, spread across five files. Cheapest points on the board.**

| # | change | file:line |
|---|---|---|
| a | Plank "⏱ BEAT THE BOARD +40" on leaving a cracking plank | `props.js:412-423` |
| b | Graze streak 25/50/100/150, cooldown 1.5→0.9, include `icicles` + `props.rollers` | `director.js:102-124` |
| c | Sheep `fragile: 0.18 → 0.42`; `_sheepEscape` also on a loose/thrown landing with `dv > 25` | `packages.js:29`, `packages.js:274-289` |
| d | Ghost 0.9 s telegraph (eyes ×1.8, 300→120 Hz tone) + player float during the flip | `packages.js:645-661` |
| e | Potion SETTLE verb + gondola/clip damping | `packages.js:621-644` |
| f | Checkpoint monotonic: `Math.abs(cp.y - st.pos.y) > 1` → `st.pos.y > cp.y + 1` | `main.js:177` |
| g | Boing escalation `0.1 → 0.14` | `props.js:337` |
| h | **The director conspires:** when `packages.escapee` exists and the player is above `PEAK * 0.6`, force `_eventTimer = Math.min(_eventTimer, 4)` | `director.js:153` |

(h) is one line and it manufactures moment E5 deliberately instead of by coincidence.

---

## C) THE MULTI-PACKAGE STACK — **YES. SHIP IT.**

Not hedging: this is the highest-value mechanic in the entire redesign. A courier under a leaning tower of three mismatched parcels on an ice ledge in a gale is the game's identity in one frame — it is what the art direction, the brand UI, and the satire are all *for*. Everything else in this document is support.

### C1 — Architecture: keep `packages.current` alive

`packages.current` is read in 11 production sites and, critically, in **~15 places in `scripts/verify.mjs`** (lines 165, 171, 176, 186–193, 202–215, 227, 250, 314–331). Deleting it fails the test harness. So:

```js
// packages.js — replace `this.current = null` at :53
this.active = [];        // every live consignment, carried / placed / hooked / loose
this.handling = 'standard';

// class accessor, insert after the constructor (~:59)
get current() { return this.active[0] ?? null; }   // bottom of the stack = oldest consignment
```
`spawn()` (`:270`) pushes instead of assigning. `remove()` (`:463-473`) splices and re-indexes. **No `verify.mjs` edits are required.** This is the deciding constraint on the whole design.

### C2 — Rules

- **`MAX_STACK = 3`.** Three is the readable silhouette; four is noise and the spring chain gets mushy.
- `stackCap()` returns `1` if any carried parcel is the **anvil** (`stackable: false`, "OVERSIZED — SINGLE ITEM DISPATCH"), else `3`.
- **You may only take as many parcels as you have destinations.** Each pickup binds a parcel to a distinct delivery spot via `deliveries.assignSpot(pkg)`. Three parcels → three beacons.
- Pickup is unchanged in feel: walk into the depot ring, `tryPickup()` fires (`packages.js:475-491`), gated on `carriedCount() < stackCap()`.
- **`throwCarried` throws the TOP parcel only.** The rest stay. ("You always throw the one on top. That's how gravity works.")
- **`setDown` (B2) takes the top parcel.**

### C3 — Physics: a vertical spring chain, not three springs to the player

Three independent springs to three anchors at increasing heights will fight each other and oscillate. Instead: **parcel 0 springs to the hands; parcel *i* springs to parcel *i−1*.**

Rewrite of the carry block at `packages.js:518-547`:
```js
// anchor
let ax, ay, az;
if (pkg.hooked) { const h = cablecar.hookSlot(pkg.hooked); ax = h.x; ay = h.y; az = h.z; }
else if (i === 0) { const a = player.getCarryAnchor(); ax = a.x; ay = a.y; az = a.z; }
else { const b = this.active[i - 1].body.translation(); ax = b.x; ay = b.y + 1.15; az = b.z; }

const dx = ax - p.x, dy = ay - p.y, dz = az - p.z;
const dist = Math.hypot(dx, dy, dz);
const snap = i === 0 ? 4 : 3;
if (dist > snap) { /* existing teleport-back path, unchanged */ }
else {
  const m = def.mass;
  const k = (130 * m) / (1 + i * 0.55);
  const c = (11  * m) / (1 + i * 0.35);      // 14 → 11: see F11
  const fx = dx * k - v.x * c, fy = dy * k - v.y * c, fz = dz * k - v.z * c;
  body.resetForces(true);
  body.addForce({ x: fx, y: fy, z: fz }, true);
  if (i === 0 && !pkg.hooked) {
    // reaction on the courier, scaled by how much tower is hanging off parcel 0
    let r = (def.id === 'anvil' ? 0.35 : 0.12) * (1 + 0.35 * (this.carriedCount() - 1));
    let ry = -fy * r * 0.4;
    ry = Math.min(ry, player.body.mass() * 22 * 0.15);   // never a jetpack (verify.mjs:219)
    player.body.applyImpulse({ x: -fx * r * dt, y: ry * dt, z: -fz * r * dt }, true);
  }
}
```

**Stability check** (Rapier at 1/60, `m = 6`): index 0 → ω = √(780/6) = 11.4 rad/s (33 steps/period), ζ = 66/(2√4680) = **0.48** — under-damped, ~19 % overshoot, ≈0.12 s of visible lag on direction changes. Index 2 → k = 371, c = 49 → ω = 7.9, ζ = **0.52** with a longer period. The top parcel visibly trails and leans. That lag *is* the mechanic.

**Inter-parcel collision must be off while stacked**, or two spring-driven cuboids will jitter against each other. Packages are `(0x0004 << 16) | 0xfffd`; `0xfffd` leaves bit 2 set, so packages currently collide with each other. On becoming carried: `collider.setCollisionGroups((0x0004 << 16) | 0xfff9)` (also clears bit 2). On drop/throw/place: restore `0xfffd`, or `(0x0008 << 16) | 0xffff` if placed (B2). Four lines, three states, one function: `_setPhase(pkg, 'carried' | 'loose' | 'placed')`.

**Ordering note:** `packages.fixedUpdate` runs *after* `player.fixedUpdate` (`main.js:212-213`), and the chain is iterated bottom-to-top within one tick, so parcel *i* reads parcel *i−1*'s translation from the **previous** physics step. That one-step lag is free and desirable — it propagates the wobble upward.

### C4 — Toppling

After the spring loop, if `carriedCount() >= 2` and the lateral offset between the top parcel and parcel 0 exceeds **2.2 m** (≈44° lean at a 2.3 m stack height), call `_spill('the stack went')`:
- All carried parcels → `carried = false`, `noGrabT = 0.35`, phase `'loose'`.
- `hud.toast('📦 THE STACK WENT', false)`, `sfx.shatter()` at reduced peak, `ctx.shake(0.4)`, `ctx.hitstop(0.06)`.
- No automatic damage — the ground does that job via `_onImpact`. The comedy is watching them go.

`knockdown()` (`controller.js:145`) already calls `dropCarried()`; make that loop the whole stack.

### C5 — What changes, file by file

| file:line | change |
|---|---|
| `packages.js:7-48` | add `stackable` (false for anvil), `placeable` (crate/porcelain/sheep/anvil); sheep `fragile → 0.42` |
| `packages.js:53` | `this.current = null` → `this.active = []`; add `handling` |
| `packages.js:~59` | `get current()` accessor |
| `packages.js:199-206` | `this._liquid = flask` → `this._pendingLiquid = flask` (null it at the top of `_buildMesh`) — **must be per-parcel or two potions collide** |
| `packages.js:255-267` | pkg literal gains `liquid, hooked:null, placed:false, unattended:0, handling, spot:null, returned:false, catapulted:false` |
| `packages.js:270` | `this.current = pkg` → `this.active.push(pkg)` |
| `packages.js:463-473` | `remove()` splices from `active`; must tolerate a pkg not in the array (`verify.mjs` calls it in loops) |
| `packages.js:475-491` | `tryPickup()` gated on `carriedCount() < stackCap()`; calls `deliveries.assignSpot(pkg)` |
| `packages.js:493-495` | `dropCarried()` loops `active` |
| `packages.js:497-696` | extract the per-package body into `_tickPackage(pkg, i, dt, t)`; `fixedUpdate` loops `active` |
| `packages.js` new | `carriedMass()`, `carriedCount()`, `stackCap()`, `topCarried()`, `maxShake()`, `setDown()`, `hookTo()`, `_spill()`, `_setPhase()` |
| `controller.js:241-243` | `carryMass` → `packages.carriedMass()` |
| `character.js:256-258` | `heavy` → `Math.min(packages.carriedMass() / 45, 1)`; carry `armPitch −1.35 → −1.55` when `carriedCount() >= 2` |
| `deliveries.js` | manifest + 3 beacons, see below |
| `hud.js` | `setManifest`, see below |
| `main.js:259-263` | `pkg.shake > 50` → `packages.maxShake() > 50` |

`carriedMass()` with 3 parcels (sheep 12 + egg 9 + porcelain 5 = 26 kg): `massFactor = 1/(1+26/60) = 0.70` → walk 4.6 m/s. With the anvil forced to a solo carry, the worst realistic tower is ~29 kg. That is the intended "don't be greedy" pressure without making a full stack unplayable.

**Balloon caveat (`verify.mjs:219` will fail otherwise):** the balloon's player lift assist (`packages.js:570-576`) must be applied **once, taking the max**, never summed across a stack. And `carriedMass()` subtracts 8 kg per carried balloon (floor 1) — so *stack order and composition become a decision*, which is exactly the depth we want.

### C6 — Deliveries: the manifest

- `deliveries.manifest = []` — up to 3 `{ pkg, spot, pickupTime, par }`.
- `_buildBeacon()` (`:84-108`) → `_buildBeacons()` producing **3** beacon groups. Each gets a pad + column. **Only `beacons[0]` carries the `PointLight`** (`:104`) — moved between beacons as the primary target changes, so the renderer never exceeds one point light.
- **`verify.mjs:72` and `:249` read `ctx.deliveries.beacon.position`.** Keep it working: `get beacon() { return this.beacons[0]; }`, and always keep `beacons[0]` bound to `manifest[0]`.
- `assignSpot(pkg)` picks a spot not already in the manifest (fall back to the existing `_chooseTarget` distribution: `completed < spots.length ? completed : 3 + rand(spots.length-3)`).
- `fixedUpdate` (`:210-217`) loops the manifest, testing each parcel against **its own** beacon with the existing `dxz < 3.4 && dy < 4.5` gate.
- `update()` (`:221-239`) points the HUD arrow at the **nearest** manifest beacon and shows that entry's timer.
- **MULTIDROP combo:** deliveries from one stack within a 12 s rolling window multiply: `×1.0 / ×1.4 / ×1.9`. Applied on top of `chainMult` and `goldMult`.

### C7 — HUD: the manifest is the brand payoff

`#hud-top-left` stops being "the package panel" and becomes **the waybill**: up to 3 line items, each with parcel name, a mini condition bar, an instability bar (potion only), a destination, and a stamp slot. This is the single richest surface the UI workstream will get.

New API in `hud.js`:
```js
setManifest(rows)   // rows = [{ id, name, note, condition, shake|null, dest, warn|null,
                    //           stamp: null|'PLACED'|'FREIGHT'|'REFUSED'|'DELIVERED' }]
stamp(rowIdx, kind) // rubber-stamp thunk animation on one row
chip(id, text|null) // transient status chips: TAILWIND / SETTLING / UNATTENDED / GRIP / FREIGHT LINE
```
**Keep `setPackage(name, note, hasShake)`, `setCondition(pct)` and `setShake(pct)` as thin shims** that mutate row 0 and re-render — `packages._sheepEscape` (`:373`) and `_tickEscapee` (`:413-414`) call them and **those paths are directly asserted by `verify.mjs:312-336`**.

---

## D) CARGO INTERACTION DEPTH

The per-type switch lives at `packages.js:565-662`. Two of the eight types have **no case at all**.

| type | today | verdict | fix |
|---|---|---|---|
| **crate** | *no switch case*, `fragile 0.35`, no behaviour | **boring** | Give it a job: it is the **foundation**. A crate at index 0 reduces the spring lag divisor for everything above (`1 + i*0.55` → `1 + i*0.38`) — the tower is stable *because* the crate is boring. It is the only fully `placeable` parcel that reliably supports a courier (B2 climbing block). Plus a one-shot joke on `dv > 20`: `hud.toast('📦 The crate is now open. It was empty. It has always been empty.')` + 3 packing-peanut particles. |
| **porcelain** | `fragile 1.6` | fine | No new code. It is the first parcel to hit REFUSED (B3) and the primary customer for FRAGILE-CERTIFIED (B5). Its depth comes from the new systems, not from itself. |
| **balloon** | `windMult 9`, lift assist, `gravityScale 0.12` | one-note | (1) B4c downwind sail. (2) A carried balloon subtracts **8 kg** from `carriedMass()` — a balloon on top makes a heavy tower haulable, which makes stack composition a real decision. (3) **balloon + anvil in the same stack → lift cancelled entirely**, `hud.toast('The balloons are trying. The anvil is winning.')` |
| **egg** | random kicks, ball collider, `restitution 0.5` | fine | On a stack, the sideways kick (`:592`) also applies to the parcel **above** it → the egg is the main topple risk. A *placed* egg rolls downhill, which routes into the existing loose-egg escape branch (`:594-597`) — now reachable on purpose. |
| **sheep** | escapes at 0 condition | best mechanic, unreachable | `fragile → 0.42` (B8c). Kick `anger` scales with stack index: `anger *= 1 + 0.4 * i`. A sheep at the *bottom* of a tower is chaos. **The escapee chews placed parcels:** if the loose sheep is within 2 m of a `placed` parcel, `damage(pkg, dt * 8)` and `hud.toast('🐑 She is eating the manifest.')` |
| **anvil** | *no switch case*, `mass 45`, `fragile 0`, `windMult 0.05` | **boring, and its warning text is a lie** | Three fixes. (1) `stackable: false` → forces solo carry, "OVERSIZED — SINGLE ITEM DISPATCH". (2) A real case: while carried and grounded, set `player.collider.setFriction(0.35)` — **the anvil is the ice-traversal tool**, the one thing that lets you cross The Frozen Face without skating. Discoverable, funny, mechanically real. Add a ground-crack beat every 0.5 s (`particles.dust`, `sfx.thud(0.5)`). (3) `freightMult = 1.5` when hooked (B1b) — the cable car finally pays, and `'HEAVY. TAKE THE CABLE CAR.'` stops being a lie. |
| **potion** | shake meter | good | SETTLE verb (A7/B8e). Shake accumulation scales with stack position: `× (1 + 0.5 × i)` — carrying the flask under two parcels is visibly a bad idea and the meter says so. Hooked/clipped transit halves accumulation and doubles decay. |
| **ghost** | random flip | **noise** | Telegraph + player float (B8d). `carriedMass()` skips the ghost entirely (it is weightless). But its flip **ejects whatever sits above it** off the tower: `above.body.applyImpulse({x: rand, y: m*6, z: rand})`. Stacking on a ghost is a gamble. |

**Incompatible consignments** — a single table, the most brand-appropriate object imaginable (a hazardous-goods segregation matrix). Keep it to four pairs:
```js
// packages.js, module scope
const INCOMPAT = {
  'potion|egg':    { shake: +6,  note: 'Sudden movement, unstable contents.' },
  'balloon|anvil': { lift: 0,    note: 'Lift capacity: theoretical.' },
  'ghost|porcelain': { topple: 0.35, note: 'The deceased do not respect ceramics.' },
  'sheep|potion':  { shake: +4,  note: 'She kicks. It fizzes.' },
};
```
Surfaced as a red rule line across the affected manifest rows at pickup: `⚠ INCOMPATIBLE CONSIGNMENT · §9.4`.

---

## E) SIX MANUFACTURED MOMENTS

### E1 — THE LEANING TOWER ON THE ICE *(the screenshot)*
A 3-high stack on The Frozen Face, in a gale.
**Chain (sustained state, not a discrete event — which is exactly why it's the screenshot and not the clip):**
spring-chain lag at index 2 (ζ 0.52, ω 7.9) produces a visible 30–40° trail → `character.js` carry pose at `armPitch −1.55`, `torsoG.rotation.x −0.30` → `controller.js:224` sets friction 0.01 on ice → `particles.js:134` wind streaks crossing frame left-to-right at `gust > 0.35` → `sfx.setWind(alt01 0.72, gust 0.9)` → `music.setIntensity(0.22 + 0.72×0.55 + 0.25) = 0.87` (pad + kick + sparkle octave all in) → camera FOV settling around 71 → HUD manifest showing three line items, three condition bars, one instability bar, and a red `⚠ INCOMPATIBLE CONSIGNMENT` rule.
**Sequencing requirement:** none. It must simply be *possible* to be in all these states at once, which requires C + B4a + the manifest HUD.

### E2 — THE ZIP-LINE OVER THE CHASM *(the clip)*
**Chain, in order, over ~4.5 s:**
`t=0.00` `sfx.clipOn()` metallic chunk · trolley mesh appears · `player.clipped = true`
`t=0.05` `sfx.cableHum(true)` forced on · `hud.chip('grip', '◤ FREIGHT LINE · GRIP ███░░')`
`t=0.20` `setRush` ramps to 1.0 (`main.js:256`, speed3 = 26 → clamp((26−9)/14) = 1.0)
`t=0.20→` `particles.sparks(trolleyPos, 0xffe6a8, 2)` every 0.08 s — additive glow pool, free
`t=0.30` camera FOV lerps 68 → 77 at the *slow* rate (F9: rate 3 when opening) so the acceleration reads as building, not snapping
`t=1.0–3.5` the parcel swings on its spring under the courier; `ctx.gust` sways nothing on the player (correct — the cable is rigid) but the gondolas in frame sway (`cablecar.js:196`)
`t=3.6` `Space` → `_detachClip(true)` → `setLinvel(tangent × 20.8 + (0,6,0))`, `airborneBySomethingFun = true`, `lastLaunchT = t`
`t=3.65` `ctx.shake(0.15)` + FOV lerps *down* at the fast rate (rate 9)
`t=4.4` landing: `particles.dust(pos, 2.4)` + `sfx.thud(1.6)`; the delivery that follows within 4 s stamps `🪂 AIRMAIL +75`.

### E3 — THE REFUSAL *(the anti-fanfare)*
Arriving at the Yeti Outpost with a 19 % porcelain. This needs a **distinct audio-visual identity or players will read it as a bug.**
**Chain:**
delivery trigger fires → `ctx.hitstop(0.14)` (vs the normal 0.09, and at the F7 long-form factor 0.10 so motion doesn't fully lock) → **no confetti, no `pops`, no shockwave, no `sfx.jingle`, no `music.fanfare`** → `sfx.fail()` + one dry `sfx.thud(0.6)` → the delivery slip animates up from the bottom-right and a **REFUSED** stamp rotates in and thunks (`@keyframes stamp-thunk`: `scale(3) rotate(-14deg) blur(2px)` → `scale(1) rotate(-6deg) blur(0)` over 140 ms, `cubic-bezier(.2,1.6,.3,1)`) → `hud.toast('❌ REFUSED. Take it back.', false)` → `music.setIntensity` floored at 0.15 for 3 s (add a `music.duck(sec)`) → the beacon column recolors `0xffd166 → 0x8fb0dd` and relocates to the depot over 0.5 s → the HUD target arrow sweeps 180°.
The absence of the ceremony is the point. Every system that normally fires must be *audibly* missing.

### E4 — PNEUMATIC DISPATCH
**Chain:**
`G` set-down → collision group flip 0x0004 → 0x0008 · `sfx.pop()` · `particles.dust(0.6)`
geyser charge 1.0 s → 4 bubbles/s `steam(pos, 0.3)` · rising sine 90→350 Hz at 6 Hz · rim `emissiveIntensity 0 → 2.5`
eruption → `sfx.geyser()` · `particles.steam(pos, 2.4)` for 3 frames · impulse `m × 60 × active × falloff × dt` · `pkg.thrownT = 3.0`
**the camera does not follow the parcel** — that is the joke. You watch it leave frame.
`+1.8 s` → either `addBonus(60, '💨 PNEUMATIC DISPATCH')` + `sfx.jingle()`, or `hud.toast('The parcel has entered the sea.', true)`.

### E5 — THE SHEEP AT THE SUMMIT
**Chain:** crate breaks (`sfx.shatter()` + `sfx.baa()` + `particles.shards(0xa9743f)`) → `hud.toast('🐑 THE SHEEP IS LOOSE! Catch her!')` → escapee hops every 0.45–0.85 s with `particles.dust(0.5)` and `sfx.baa()` at 35 % → `director._strike()` → the bolt mesh (`director.js:33-38`) + `flash = 1` drives `hemi.intensity` to 2.5 and `sun.intensity` to 4.2 for ~0.33 s (`main.js:237-238`) → the sheep silhouetted white against the wash.
**Sequencing requirement (B8h, one line):** today the 22 s escapee TTL overlapping an 8 s thunder event on a 12–26 s timer is pure coincidence. Make the director conspire: `if (ctx.packages.escapee && p.y > PEAK * 0.6) this._eventTimer = Math.min(this._eventTimer, 4);` at `director.js:153`.

### E6 — THE MULTIDROP
Three parcels, three pads, one descent along the Wind Shrine ledge.
**Chain:** parcel A delivered → standard ceremony, but `hud.scorePop` prepends `MULTIDROP 1/3` → 6 s later parcel B → shockwave ring + `MULTIDROP ×1.4` → parcel C → `ctx.hitstop(0.16)` · `particles.confetti` fired at **both** remaining beacon positions as well · `music.fanfare()` transposed up (add a `semitones = 0` argument to `fanfare()` at `music.js:193`) · all three beacon columns fade `opacity → 0` over 0.8 s · the HUD manifest empties **row by row with a 120 ms stagger**, each row taking a green `DELIVERED` stamp on the way out → final `scorePop`: `MANIFEST CLEARED ×1.9`.
The stagger is the whole trick — three simultaneous stamps read as one event; three at 120 ms read as a receipt printing.

---

## F) FEEL / TUNING — CONCRETE CONSTANT CHANGES

| # | file:line | from → to | reason |
|---|---|---|---|
| F1 | `controller.js:4` | `WALK 7.2 → 6.6` | Widens the sprint delta from 1.50× to 1.64×, so Shift reads as a gear change rather than a nudge. Also makes the 26 m/s zip-line feel enormous by contrast. With a stack you live below 5 m/s anyway. |
| F2 | `controller.js:5` | `SPRINT 10.8` — **keep** | Already at the edge of what a 68° FOV third-person camera can parse on a spiral trail. |
| F3 | `controller.js:6` + `:270` | `JUMP 10.5 → 11.2`; mass penalty `1/(1+carryMass/90) → /70` | Unloaded apex goes 2.50 m → 2.85 m (g = 22) — snappier. A 26 kg tower drops to 8.1 m/s, the solo anvil to 6.9. Widens the loaded/unloaded contrast, which is the entire game. |
| F4 | `controller.js:254` | grounded gain `14 : 10 → 16 : 12` | Time-to-full-speed 0.50 s → 0.40 s. Snappier start without removing the world's ability to shove you. |
| F5 | `main.js:241` | `trauma -= dt * 1.4 → dt * 2.6` | A 0.9 knockdown currently rings for 0.64 s and muddies the readability of the *next* event. At 2.6 it's 0.35 s. **Compensate by raising the amounts:** knockdown `0.55 → 0.7` (`controller.js:144`), delivery `0.22 → 0.30` (`deliveries.js:174`), explosion `0.9 → 1.0` (`packages.js:328`). Sharper, not weaker. |
| F6 | `main.js:244-246` | rotational `k*0.06 → k*0.09`; add a directional kick | Positional white noise reads as a rumble, not a hit. Store `kickY = amt * 0.5` in `ctx.shake()` and apply `camera.position.y -= kickY` decaying at 12/s. One impulse frame is worth more than 20 frames of jitter. |
| F7 | `main.js:201-204` | `dt = realDt * 0.06` → `realDt * (hitstopT > 0.10 ? 0.10 : 0.02)` | 0.06 at a 0.09 s duration is a 1.4-frame freeze — reads as a hitch, not a hit. 0.02 makes the short stop a genuine freeze-frame; the long one (potion, 0.12) keeps motion at 0.10 so the blast wave still reads. **Note:** hitstop also scales `player.update(dt)` and `character.update(dt)` — locking the camera hard is *correct* on a hit. |
| F8 | `main.js:250` | `68 + clamp(speed-7, 0, 7) * 1.3` → `68 + clamp(speed-6, 0, 11) * 0.95 + (parachute?4:0) + (clipped?7:0)` | Current formula saturates at 14 m/s, which sprint nearly reaches — the kick is on almost permanently and stops signalling anything. New saturation at 17 m/s restores "I am going genuinely fast" to zip-line / geyser launch / big slides only. |
| F9 | `main.js:251` | `lerp(…, dt*5)` → asymmetric: `const rate = targetFov > camera.fov ? 3 : 9;` | FOV opens slowly (builds anticipation), snaps back fast (punctuates impact). One line, disproportionate effect. |
| F10 | `controller.js:64` | add `&& !this.slide` to the knockdown gate | Belly-sliding into a boulder should launch you comically, not end the run. The slide is the best verb in the game and it currently dies to the most common hazard. |
| F11 | `packages.js:533` | `c = 14 * m → 11 * m` | ζ 0.61 → 0.48, ~19 % overshoot, ≈0.12 s of visible lag on direction changes. At 14 the parcel looks glued to the courier; at 11 it looks *carried*. This is the cargo-is-alive fantasy in one constant. |
| F12 | `packages.js:285` | `min((dv-6) * fragile * 4.5, 45)` → `min((dv-7) * fragile * 5.2, 40)` | Raises the free-bump floor so ordinary terrain contact stops chipping mysteriously, but makes real slams bite harder — the condition bar moves in readable chunks instead of dripping. Cap 40 guarantees no single hit can send 100 → REFUSED (B3, threshold 25) out of nowhere. |
| F13 | `director.js:117, 105` | `addBonus(25) → 25/50/100/150` escalating; `_closeCd 1.5 → 0.9` | At 1.5 s a boulder-rain event yields at most 5 grazes and a heroic 4-dodge sequence pays the same as one lucky brush. |
| F14 | `props.js:337` | `launch *= 1 + 0.10*min(combo-1,5)` → `0.14` | Top-out 1.5× → 1.7×. At 0.10 the escalation is invisible; the combo needs to visibly climb or the counter is lying. |
| F15 | `cablecar.js:6, 178` | `BASE_SPEED 7.5 → 9.5`; `_speedAt` floor `0.22 → 0.3` | A gondola slower than a walking courier is a joke at the game's expense. 9.5 is still below sprint — correct, the gondola is the safe route and the zip-line is the fast one. Also strictly helps `verify.mjs:95` (`moved >= 3`). |

---

## G) SCOPE DISCIPLINE

### MUST — the redesign is incoherent without these
1. **C · THE STACK** — the image the entire brand rests on.
2. **`hud.setManifest` / stamps / chips** — the stack is meaningless without the waybill surface. Ship with C or not at all.
3. **B3 · REFUSED / RETURN TO SENDER** — gives the condition bar a cliff and gives descent a purpose for the first time.
4. **B1a · CABLE CLIP** — resurrects the largest dead asset (~230 LOC of scenery) and produces the best clip in the game.
5. **F1, F3, F5, F7, F8, F9** — roughly 15 lines that change how everything reads.
6. **B8 · audit bundle** — sheep gate (c), geyser telegraph (B6.1), plank bonus (a), checkpoint monotonic (f), director conspiracy (h). All cheap, all fix things that are already broken.

### SHOULD
7. **B2 · SET DOWN** — the enabler for B7 and most of D.
8. **B1b · FREIGHT HOOK** — makes the anvil's warning text true.
9. **B4a + B4b · windsocks + tailwind** — the highest art-payoff-per-line in the document.
10. **D · crate job, anvil case, balloon-in-stack, potion stack-index shake** — fixes the two types that have no behaviour at all.
11. **MULTIDROP + moment E6 sequencing.**
12. **B8d ghost telegraph + float, B8b graze streak.**

### COULD
13. B5 handling class (lovely form; small mechanical footprint).
14. B7 seesaw catapult.
15. B6.2 pneumatic dispatch scoring.
16. D incompatible-consignment table.
17. B4c balloon sail.
18. The escapee chewing placed parcels.

### CUT FIRST, IN THIS ORDER
1. **B7 seesaw catapult.** If it isn't funded, **delete the seesaws** (`props.js:54-56, 236-272`) — 37 lines out, 3 joint bodies and 3 static fulcrums gone, and nothing is lost, because they do nothing today.
2. **B5 handling class.** The brand UI can carry the form aesthetic without a mechanical hook.
3. **D incompatible-consignment table.**
4. **The elevator platforms** (`props.js:58-60, 274-288, 468-479`) if B2/B6 don't land — 30 lines, off-path, unmotivated.
5. **B4c balloon sail.**

**Do not cut the stack, the zip-line, or REFUSED.** Cutting any one of those three leaves the art-direction and brand-UI workstreams with nothing new to be *about*, which defeats the purpose of the redesign.

---

## HARD CONSTRAINTS FOR THE IMPLEMENTER

### `scripts/verify.mjs` — 25 checks, fails on ANY console error
- **`packages.current` must remain a working accessor.** ~15 call sites. `get current() { return this.active[0] ?? null; }`.
- **`packages.remove(pkg)`** must tolerate a pkg not present in `active` — verify calls it in loops (`:165, 186-193, 202-215`).
- **`hud.setPackage` / `setCondition` / `setShake`** must remain callable. `packages._sheepEscape:373` and `_tickEscapee:413-414` call them, and those paths are asserted at `verify.mjs:312-336`.
- **`deliveries.beacon`** must stay a `THREE.Object3D` with a live `.position` (`verify.mjs:72, 249`). Use `get beacon() { return this.beacons[0]; }`.
- **`verify.mjs:219` — no-fly regression.** Balloon lift assist must take the **max**, never the sum, across a stack. The carry-spring reaction clamp at `packages.js:545` (`ry ≤ playerWeight * 0.15`) must survive the `× (1 + 0.35 × (count−1))` scaling — apply the multiplier to `r` *before* the clamp, exactly as written in C3.
- **`verify.mjs:160` — parachute terminal velocity.** `targetVy = -3.4` (`controller.js:280`) must not change; tailwind (B4b) affects horizontal only.
- **`verify.mjs:308` — recovery roll.** Do not repurpose `Space`. The zip-line detach must be gated behind `this.clipped` and placed *before* the jump-buffer branch, so an unclipped `Space` is byte-identical to today.
- **`verify.mjs:277` — gap widths.** Do not touch `Terrain.GAPS`.
- **`verify.mjs:110` — mushroom bounce ≥ 10.** F14 only increases it.
- **`verify.mjs:83-96` — gondola ride.** Do not change gondola collider geometry. F15 strictly helps.
- **No new asset loads.** `verify.mjs:20-21` fails the run on any `requestfailed` or `HTTP ≥ 400`. Trolley, windsocks, geyser rim, seesaw lips — all procedural `BufferGeometry`.
- **New keybinds:** currently taken are `WASD`, `Shift`, `Space`, `C`, `F`, `M`, mouse-2, wheel. This spec claims `E` (clip/hook) and `G` (set down), optionally `1`/`2`/`3`. **Leave `Tab` and `Esc` free** — the shift-structure/pause workstream needs them. Add new handlers after the `e.repeat` guard at `controller.js:80`.

### `ctx` architecture
- **No new `ctx` fields are required.** The manifest lives on `deliveries`; clip state lives on `player` (consistent with `player.parachute` / `player.slide` — `character.js` and `main.js` read those the same way); handling class lives on `packages`.
- **Fixed-step ordering** (`main.js:206-215`) is `director → terrain → props → cablecar → player → packages → deliveries`. Consequences:
  - `props.fixedUpdate` reads `player.clipped` one step stale. Acceptable.
  - `packages.fixedUpdate` runs *after* `player.fixedUpdate` — the carry spring sees the post-input pose. Keep it.
  - The stack chain iterated bottom-to-top in one tick makes parcel *i* read parcel *i−1*'s previous-step translation — a free one-step lag that propagates wobble upward. Intentional.
  - `deliveries.fixedUpdate` runs last, so multi-target checks see final positions. Keep it.
- **`packages._liquid` (`:201, 470, 629`) is a singleton and will break with two potions in play.** Move it onto the pkg object (`pkg.liquid`) via a `_pendingLiquid` handoff in `_buildMesh`. This is a latent bug today only because the stack doesn't exist yet.
