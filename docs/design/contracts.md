# Locked contracts

Three interfaces are written down **before** any code touches them, because four of the
six design specs patch each of these independently and none of them knows the others
exist. If you are implementing any stage, this file is the authority — not the spec that
happens to be open in your editor.

Changing anything here is a deliberate decision, not a merge artifact. If a stage needs a
change, change it *here first*, in its own commit, then follow through to the call sites.

---

## 1. `Hud` public API

**Rule: every method that renders user-facing text takes a translation key plus params.
Never a pre-built string.** This overrules the UI spec's "unchanged signatures — do not
touch" list. Bilingual is a hard product requirement and string-passing cannot satisfy it:
a string handed to the Hud has already lost the information needed to re-render it when
the language flips.

Params objects are flat and interpolate into `{name}`-style placeholders in the copy tables.

### Existing methods — final signatures

| Method | Signature after Stage 5 | Renders | Called from |
|---|---|---|---|
| `show()` | unchanged | reveals the HUD root | `main.js:153` |
| `toast(key, params?, opts?)` | was `toast(text, small)` → `opts = { small }` | transient centre message | 26 sites: `main.js`, `director.js`, `deliveries.js`, `controller.js`, `packages.js` |
| `banner(keyOrNull, params?)` | was `banner(textOrNull)` | hazard/event banner | `director.js:134,138,158,178` |
| `setTimer(secLeftOrNull)` | unchanged (numeric) | speed-bonus countdown | `deliveries.js:235,237` |
| `setPackage(defOrNull, opts?)` | was `setPackage(name, note, hasShake)` — takes the **def object**, reads `def.nameKey`/`def.noteKey`, derives `hasShake` from `def.id === 'potion'` | consignment card | `main.js:154`, `packages.js:373,413,472,487` |
| `setCondition(pct)` | unchanged (numeric) | condition meter | `packages.js:300,414,488` |
| `setShake(pct)` | unchanged (numeric) | instability meter | `packages.js:628` |
| `setScore(n)` | unchanged (numeric) | score count-up | `deliveries.js:45,130,177` |
| `setDeliveries(n)` | unchanged (numeric) — **pluralisation moves into i18n**, `hud.js:90`'s inline `deliver${n===1?'y':'ies'}` is deleted | delivery count | `deliveries.js:178` |
| `setChain(chain)` | unchanged (numeric) | on-a-roll multiplier | `deliveries.js:37,179` |
| `scorePop(items)` | was `scorePop(lines)` — items are `{key, params, amount}`, not formatted strings | itemised receipt | `deliveries.js:46,165` |
| `setAlt(y, zoneKey)` | was `setAlt(y, zoneName)` | altitude + zone | `deliveries.js:230` |
| `setTarget(relBearing, dist, spotKey)` | was `setTarget(…, name)` | navigation strip | `deliveries.js:229` |
| `showSlip(num, def, targetKey)` | was `showSlip(num, def, targetName)` — **`textContent` only, the `innerHTML` at `hud.js:139` is deleted** | waybill | `packages.js:489` |
| `hideSlip()` | unchanged | | `deliveries.js:182` |
| `damageFlash()` | unchanged | | `packages.js:301` |

### New methods

| Method | Purpose | Introduced in |
|---|---|---|
| `stamp(kindId, opts?)` | `opts = { subKey, params, at, rot, quiet }`. **One signature** — three specs invented three. `kindId` indexes `STAMPS` in `src/ui/brand.js`. | Stage 4 |
| `setTracking(str)` | tracking number on the waybill | Stage 4 |
| `setShift({ index, done, total })` | shift-progress indicator | Stage 6 |
| `setManifest(lines)` | waybill rows; each line `{ no, defId, spotKey, status, golden }` where `status ∈ pending \| transit \| delivered \| writtenOff \| refused` | Stage 7 |
| `setStatus({ quality, lang, music })` | read-only status chips | Stage 3/5 |
| `setHint(rows)` | controls hint, wraps, no `nowrap` | Stage 4 |
| `setLockHint(on)` | "click to resume mouse look" — currently the pointer-lock loss is **silent** | Stage 4 |
| `boot(msgKey, pct)` | loading screen with real progress | Stage 9 |
| `fault(message)` | replaces the unstyled text swap at `main.js:272` | Stage 4 |
| `results(data)` | end-of-shift payslip | Stage 6 |
| `showScreen(name)` / `hideScreen(name)` | `'title' \| 'briefing' \| 'pause' \| 'results' \| 'meta' \| 'settings' \| 'fault'`. **The Hud owns screen toggling** — the shift module does not. | Stage 6 |
| `bindMenu(handlers)` | `{ onStart, onResume, onAbandon, onNextShift, onQuality, onLang, onMusic, onMotion }` | Stage 6 |
| `setLang(code)` | applies the dictionary to every `[data-i18n]` and re-renders live regions | Stage 5 |
| `applyScale()` | sets `--ud-scale` from the viewport | Stage 4 |
| `reduced()` | boolean, OS setting OR manual override | Stage 4 |

### Invariants

- `setPackage`, `setCondition`, `setShake` must stay callable at all times —
  `packages._sheepEscape` and `_tickEscapee` call them and those paths are asserted at
  `verify.mjs:312-336`.
- Every setter is **memoised**: `director.js:134` currently writes the banner 60×/s while
  an event is live and cargo is carried, each write forcing a style recalculation over a
  live WebGL composite. Compare-then-write, in the Hud, without touching `director.js`.
- Nothing inside `#hud` is ever focusable. Screens are **siblings** of `#hud`, not
  children, so `hud.show()` can never orphan them.
- The Hud gets `this.ctx` (one line after `main.js:121`) like every other subsystem —
  it is currently the only one without a back-reference, which is why the tracking number
  cannot be derived today.

---

## 2. `window.__game` debug surface

`scripts/verify.mjs` drives this object and **fails the whole suite on any console error**.
Four specs patch `main.js:277-292` independently. This is the merged surface.

### Existing — must keep working, unchanged semantics

`state`, `fps`, `playerPos`, `playerVel`, `score`, `completed`, `package`, `bodies`, `ctx`,
`start`, `teleport`.

### Changes

| Member | Change | Why |
|---|---|---|
| `start(opts = {})` | gains `opts.endless` (skip shift termination), `opts.skipBriefing` (go straight to `playing`), `opts.lang` (force a language) | `verify.mjs:30` calls `start()` bare and then expects `state === 'playing'`; without this the new briefing state strands it |
| `package` | keeps returning the **bottom of the stack**, i.e. `packages.current` | `verify.mjs` reads it at ~15 sites; `get current() { return this.active[0] ?? null }` keeps them all valid |

### Additions

| Member | Stage | Purpose |
|---|---|---|
| `runFrames(n, dt = 1/60)` | 0 — **shipped** | Advances the world by exact fixed steps with no rendering, and returns `gameTime`. Sets a `manualStep` flag so the rAF loop renders but does not simulate while stepping. |
| `gameTime` | 0 — **shipped** | Accumulated simulation time. |
| `tier` / `setTier(t)` | 3 | read and force the quality tier |
| `qmode` | 3 | `'auto' \| 'manual'` |
| `lang` / `setLang(code)` | 5 | language round-trip check |
| `i18nAudit()` | 5 | returns keys present in one language and missing in the other, plus keys never rendered |
| `shift` | 6 | `{ index, cursor, quota, revenue, manifest }` |
| `pause()` / `resume()` | 6 | drive pause determinism without a real pointer-lock event |
| `endShift()` | 6 | force the results screen |
| `meta` | 8 | `{ mp, owned }` |
| `resetMeta()` | 8 | wipe localStorage for a clean run |

### Wall-clock waits are the harness's main source of flakiness

Headless runs on SwiftShader at ~12–13 fps, so `waitForTimeout(400)` buys a wildly
varying amount of simulation. The yeet-to-deliver check at `verify.mjs` failed roughly
one run in three **before any of this overhaul started** for exactly that reason: the
carry spring had not yet pulled the parcel into the courier's hands, so the throw hurled
a parcel that was still lying at the depot 300 m away.

It is now driven by `runFrames`, which is both deterministic and much faster than waiting
(no rendering). **Stage 3 adds a post-processing composer and will make headless slower
still** — convert the remaining wall-clock-timed checks to `runFrames` at that point,
while the slowdown is observable:

- the walk-distance check (`moved < 2` after 2 s of `W`)
- the recovery-roll check (polls a real timer for `v[1] < -15` against a stalled rAF loop)

Two further notes for anyone writing new checks: a "closest approach" reading taken from
a loop that breaks on success can never fall much below the success threshold and is
therefore useless as a margin signal — report the frame count instead. And a check whose
result sits within a centimetre of its own gate is not a test; give it real headroom.

### Traps the harness will hit

- **Auto-pause on `pointerlockchange`**: headless never acquires the lock, so
  `document.pointerLockElement` is permanently `null`. A naive handler pauses on frame 1
  and every subsequent assertion fails. Fire only on a `true → false` transition.
- **`requestPointerLock()` returns a Promise in Chrome 113+.** An unhandled rejection is a
  `pageerror` and `verify.mjs:19` fails the run. Always `p?.catch?.(() => {})`. Never pass
  an options object — `{ unadjustedMovement }` throws `NotSupportedError` on Firefox.
- **No new asset loads.** `verify.mjs:20-21` fails on any `requestfailed` or HTTP ≥ 400.
  Fonts are the one exception and they are all-or-nothing (see below).
- **Free keys:** currently taken are `WASD`, `Shift`, `Space`, `C`, `F`, `M`, mouse-2,
  wheel. Mechanics claims `E` and `G`. `Esc` belongs to pause. **Do not repurpose `Space`** —
  `verify.mjs:280-309` synthesises it for the recovery roll.

---

## 3. Colour: one source, two consumers

**`src/ui/ud.css` tokens are canonical. `src/art/palette.js` is written against them, not
the other way round.** The art spec was authored against the pre-redesign inline styles and
its `BRAND` block is dead on arrival.

| Rule | |
|---|---|
| `--ud-gold` **is** `#FFD166` **is** `0xffd166` | The beacon (`deliveries.js:89`), the depot ring (`packages.js:110`) and the gold particles all hardcode this literal today. If it ever moves, it moves in both files in one commit. |
| Green is not a state colour | Anywhere. The ramp is blue `#2F7DBE` → amber `#E8A21C` → red `#C03221`. L\* ≈ 51 / 72 / 42, so the three separate by lightness as well as hue and survive protanopia and deuteranopia. |
| Acceptance test | A greyscale screenshot of the HUD is fully readable. Every state indicator carries four redundant channels: word, percentage, countable tick fill, hatch pattern. |
| 3D livery is `#A83619` | `--ud-brand-deep`. The bright `#E2552F` is reserved for the 2D wordmark. Otherwise the static livery sits in the same hue as the hazard rim `#FF7A3D` and destroys the "warm rim = danger" rule the art direction depends on. |
| One vignette | It lives in the grade shader. The DOM `#vignette-damage` is deleted; damage is a `uDamage` uniform pulse. Two stacked vignettes turn the screen near-black at low condition on the summit — exactly when the player needs to see. |
| Fonts are all-or-nothing | Commit all three `.woff2` files **or** delete the three `@font-face` `url()` blocks. A dangling font URL is a `requestfailed` and kills the entire E2E suite. The system fallback stack carries ~90% of the design. |

`src/art/palette.js` is a **leaf module** — it imports `three` and nothing else from `src/`.
`world/terrain.js` imports it. Reversing that direction gives a TDZ `ReferenceError` on
`PEAK` (imports hoist above `const PEAK = 170` at `terrain.js:3`) and boot dies, which
`verify.mjs` reports as a `pageerror`.

---

## 4. What actually shipped, and where it differs

Written after the fact. Where the plan and the code disagree, **the code is
right and this section says why** — the plan was written before any of it ran.

| Planned | Shipped | Why |
|---|---|---|
| Self-hosted Oswald + Courier Prime | System stack only | The three `.woff2` files were never available. Contract §3 is explicit: all three or none, because a dangling font URL is a `requestfailed` and kills the suite. The fallback carries the design. |
| Stage 4 (UI) then Stage 5 (i18n) | Built together | The canonical Hud API takes keys, not strings. Shipping Stage 4 alone would have meant writing ~120 throwaway English strings and deleting them one stage later. |
| Multi-beacon stack (one target per parcel) | One beacon, stack is a look-ahead | Every parcel getting its own live beacon is a second system as large as the stack itself. Taking the next N manifest lines in advance gives the same "carry three jobs up in one climb" play for one beacon. |
| Gondola `BASE_SPEED` 9.5 | 8.6, walls 0.75 → 0.95 | At 9.5 the cabin throws its passenger out on the curves. Measured, not guessed: the gondola check went `stayedOn: false`. |
| Zip-line (Stage 10) | Not built | Explicitly the first thing to cut. It feeds neither the waybill nor the stamps; the set-down, the windsocks and the near-miss streak all do more per line. |
| Seesaw catapult, elevator deletion | Neither | `G` (set down) is the enabler both were waiting for, and it is now in. Deleting them was contingent on the catapult *not* shipping; with set-down they are usable. |

### Frame-stepping is now the default, not the exception

Stage 3's composer made headless slow enough that the simulation runs **slower
than real time** — the accumulator caps at 0.12 s per frame while a frame takes
longer than that. Every wall-clock check that carried an assertion has been
converted to `runFrames`. The two that were named in §2 (walk distance,
recovery roll) plus seven more: gondola ride, mushroom bounce, potion
detonation, package-type smoke, both no-fly checks, the carry-airborne probe,
both parachute checks, the sheep chase and the event smoke test.

Two findings worth keeping:

- The recovery-roll tap window had to move from 4 m to 2.5 m above ground.
  That is forced by determinism, not a loosening: the jump buffer lasts 0.14 s
  (8 frames) and a tap at 4 m still has ~12 frames of fall left. Polling a wall
  clock against a starved rAF loop only ever passed because it sampled coarsely
  enough to land inside the window by luck.
- The jump check asserted against a guessed 3 m. Gravity here is **-22**, not
  -9.81, so `v²/2g` with `JUMP` is 2.5 m and the guess was simply wrong. Read
  the constant before writing the threshold.

### The stack broke a test assumption, not the game

`while (packages.current) remove(...)`, never `if`. With a stack, `current` is
the *bottom* and `!current` no longer means "that parcel is gone" — the potion
check reported a survival that had actually detonated, because a crate below it
was still held. Checks that care about a specific parcel now test
`packages.active.includes(pkg)`.
