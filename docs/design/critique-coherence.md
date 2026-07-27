<!--
  RAW DESIGN SPEC — Completeness and coherence critique

  Provenance: written by an independent design agent against commit 3602969, then
  reviewed by two critics (see critique-feasibility.md / critique-coherence.md).

  THIS DOCUMENT IS NOT THE PLAN. Where it disagrees with docs/design/README.md or
  the approved v4 plan, THE PLAN WINS. Six specs were written blind to each other and
  four of them rewrite the same files incompatibly; the conflicts are resolved in the
  plan, not here. Read this for the reasoning and the raw values, not for the decisions.
-->

# Critique: 6 specs as ONE design — COHERENCE & COMPLETENESS

No file edits made. Read-only analysis per task instructions.

---

## 1. Single artistic vision? NO — palette forked, tonemap pipeline forked twice

**Hex conflicts (exact):**

| Token | art spec (`palette.js` BRAND) | UI spec (`ud.css` tokens) | Verdict |
|---|---|---|---|
| paper | `0xf5ecd7` (explicitly "same as existing #slip") | `--ud-paper-100 #F7F1E3` | 3-way mismatch: existing code, art's claim, UI's new value all differ |
| paper ink | `0x3a2c18` | `--ud-ink-900 #1B1710` | UI silently re-derived a whole new paper palette for AAA contrast, unaware art anchored BRAND to old hex |
| screen text | `0xeaf2ff` | `--ud-screen-text #E7F0FF` | close, not identical — drift |
| brand livery | `0xe4622e` | `--ud-brand #E2552F` | close, not identical — pick one literal |
| gold | `0xffd166` | `--ud-gold #FFD166` | ✅ matches — the one coupling UI spec itself flagged (§K.3) |
| blue2 | `0x8fb0dd` | `--ud-screen-dim #8FB0DD` | ✅ matches |
| **good/bad state** | `good:0x45d17a` (green), `bad:0xff4d6d` | H.2: *"Green is not used for state anywhere... blue→amber→red"* | **Direct contradiction.** Art's BRAND table preserves old green/pink-red hue ramp; UI explicitly bans green for colorblind-safety, redesigns to blue/amber/red. Art spec was written against pre-redesign hexes. |

Art spec anchors itself to "must equal index.html's inline `<style>`" (§A.3) — but UI spec **deletes that inline style block entirely** (§I.4, all IDs retired, `#ud-*` renamed). Art's anchor is dangling the moment UI lands.

**Tonemap pipeline forked TWICE, independently, in full:**
- Art §D.1/D.2: keeps `renderer.toneMapping = ACESFilmicToneMapping`, uses `OutputPass` + custom `GradePass` after it. Explicitly: *"Do NOT use FXAA/SMAA — they smear low-poly silhouettes"* → hardware MSAA only.
- Perf §C.1/C.2: sets `renderer.toneMapping = THREE.NoToneMapping`, **deletes `OutputPass`**, folds ACES+sRGB into its own `GradeShader`. Tier table turns `fxaa:true` ON for medium+high — directly contra art's stated aesthetic argument. Perf's own high tier (`msaa:4, fxaa:true`) also self-contradicts: MSAA resolves crisp edges, FXAA blurs them right back.

Both are **complete, mutually exclusive implementations of the same file `src/fx/post.js`, same class name `Post`**, different constructor signatures (`new Post(renderer,scene,camera)` vs `new Post(ctx)`), different `render()` arity (`render(dt,time)` vs `render(dt)`), different `main.js:267` edits. Whichever lands second silently destroys the other's calibration.

**Vignette double-stack risk:** art's post-grade vignette (0.34→0.44 rising w/ altitude) sits on WebGL canvas; existing `#vignette-damage` (DOM, low-condition red pulse) sits on top in HTML. Nobody checked the combined case (low condition + summit) — plausible late-game state, both vignettes stack, screen over-darkens at exactly the moment player needs visibility most.

**Tonal friction (not fatal, unreconciled):** art = warm painterly "storybook vibrant" bloom-heavy world; UI = cold monospace bureaucratic waybill (Courier New, `#1B1710` near-black ink, vintage-paper cream). Deliberate contrast per user's own decisions #1/#2 — fine — but no spec designs the *transition* between them (pause/results hard-cuts to flat paper screen, no visual bridge specified beyond an audio thud).

**Self-contradiction inside art spec alone:** hazard rim = `0xff7a3d` (warm orange, meant as sole "danger" signal, §F.3 explicitly: "nothing static has a warm rim"). But art's OWN `liveryBody 0xe4622e` (gondolas, hut roofs — static, everywhere) sits in near-identical hue space. Undermines the stated "warm rim = learnable danger cue" rule.

---

## 2. Gaps — nobody touched these

- **Audio design.** No spec redesigns music/sfx for new art direction or new mechanics. Mech spec *invokes* `music.duck(sec)`, `sfx.clipOn()`, `sfx.geyser()`, `sfx.baa()` as if they exist — none defined in a Music/Sfx API contract. Zero discussion of audio register matching "storybook vibrant" + "corporate satire." Biggest silent gap given music.js already has an intensity system built for exactly this.
- **Camera as design tool beyond FOV/shake tuning.** No cinematic framing for results/briefing screens (the highest-value screenshot moment next to gameplay). No 3D camera behavior during pause. Title screen stays a **static cover.png** — none of the art/lighting/palette investment reaches the very first thing a player sees. No attract-mode flythrough proposed anywhere.
- **Loading screen content.** Perf spec adds a 10–30s SwiftShader-class shader warm-up (§E) but only specifies a text string ("Loading the mountain…"/"compiling…"). No progress bar, no visual tied to warm-up steps. A 30s wait behind one static line is a bad first impression nobody flagged.
- **First 60s / attract sequence.** Shift spec's briefing-as-tutorial (§G) is genuinely good text design but the *screen itself* stays generic panel CSS — no 3D showcase.
- **Screenshot/share/OG tags.** Explicitly asked, entirely absent: no `og:image`, no `twitter:card`, no meta description, no photo-mode (hide-HUD) key, no favicon change anywhere across all six specs.
- **README.** Not mentioned once across 6 specs despite adding: tier system, i18n key scheme, `ctx.shift`/`ctx.meta`, 18 upgrades, new keybinds (E/G/1-2-3/Esc/P). Nobody will remember this in 3 months.
- **Returning-player re-entry, experiential side.** Meta spec covers persistence mechanics thoroughly but title screen shows no "Welcome back, Shift 4 awaits" state — returning player's title screen looks identical to a new player's.
- **Colorblind check on the 3D world itself.** UI did rigorous WCAG/protanopia work on 2D; art's hazard-vs-scenery separation (§F.3) is hue+value based but never simulation-checked the way UI checked its own palette.

---

## 3. Contradictions (severity-ranked, concrete)

**#1 — Post/composer duplicated in full** (detailed in §1 above). Two owners of `src/fx/post.js`/`Post`, incompatible tonemap strategy, incompatible constructor/render signatures, incompatible FXAA stance. **Also duplicates the auto-tier controller**: art's `Post.tick(dt,fps,tierCap)` (raw EMA fps, bad>3s/good>8s) vs perf's `Quality.sample(realDt)` (p95 over 120-frame window, 3/5-window streaks, ratchet-lock, 60s up-lockout). Both would fight over `setPixelRatio`/shadow-map resize every frame if both ship. **Resolution: keep perf's `Quality` (more rigorous hysteresis), delete art's `Post.tick`. Pick ONE tonemap path** (recommend perf's fold-into-Grade — it's the only one that survives the "tone mapping only applies to default framebuffer" constraint art itself documented, without needing `OutputPass` as a crutch).

**#2 — "Manifest" means two incompatible things.** Mech §C6: `deliveries.manifest[]` = up to 3 simultaneous carried-parcel/beacon pairs (stack model, 3 live targets at once). Shift §A: `shift.manifest[]` = the whole shift's sequential consignment list with a single-target `cursor`. Same word, different objects, different owners (`deliveries.` vs `shift.`), fundamentally different core-loop assumption (parallel targets vs sequential target). Neither spec references the other. **Resolution: shift's manifest = the shift-level ledger (what's left to deliver today); mech's stack = a VIEW into up to 3 of shift's pending lines bound simultaneously. Rename one of them before implementation — this needs to be a single reconciled data model, not a merge-time surprise.**

**#3 — `Hud.stamp()` defined twice, incompatible signatures.** UI §J: `stamp(kindId, {sub, at, rot, quiet})`. Mech §C7: `stamp(rowIdx, kind)`. Same method name, different arg meaning entirely.

**#4 — Four independent patches to `window.__game` / `verify.mjs`.** Perf (tier/qmode/manifest-pose harness), shift (shift/quota/manifest/mp/pause/resume/endShift), i18n (i18nAudit), art (implicit via `?nopost=1`) each assume they alone own `main.js:277-292`. Guaranteed clobber if applied independently.

**#5 — Two incompatible pause implementations.** Shift spec writes its own `pause()`/`resume()`/keydown handler + a new `src/ui/screens.js` module. UI spec's own K.1 table assumes a *different* pointer-lock-guard strategy (`hadLock` true→false transition) and assumes **Hud itself** owns `showScreen()`/`hideScreen()`. Two different modules proposed as the screen-toggle owner, two different pause-detection strategies, both editing the same main.js region.

**#6 — `setPackage()` signature conflict.** i18n: `setPackage(def, hasShake)` (2-arg, breaking change from 3-arg). Mech: explicitly says *"keep `setPackage(name, note, hasShake)`... as thin shims"* (3-arg, old signature). Incompatible.

**#7 — Shadow bias/normalBias mismatch.** Art fixes peter-panning via `bias:-0.00018` + `normalBias:0.022` (a paired fix). Perf's tier table sets `high: shadowBias:-0.0004` (art's OLD pre-fix value) and **never sets `normalBias` at all**. If perf's numbers land verbatim, high tier reintroduces the exact shadow-detachment bug art fixed.

**#8 — `director.level` refactor vs mech's line-level tuning.** Shift rewrites `director.js:43-48` (`onDelivery`→`setThreat`, level externally pushed). Mech's F13/A9 tuning table cites the same line numbers assuming the OLD `completed`-driven level model. Whichever lands first, the other's line-number-anchored edits apply to stale code.

**#9 — PACKAGE_TYPES edited three ways.** i18n deletes `name/note/warning`; mech adds `stackable/placeable`, changes sheep `fragile 0.18→0.42`; shift depends on array length=8 and stable `id` order. All compatible in principle, but three specs each hand-edit the same array literal independently — needs one merge pass, not three sequential ones.

**#10 — `rollNext()` calling convention drifts 3 ways** (i18n: drop arg; shift: keep arg but ignore when shift active; mech: gate behind `carriedCount()<stackCap()` entirely). Needs single resolution.

**Convergent, not contradictory (note only):** mech §A12/B8f and shift both independently caught and fixed the same checkpoint-can-move-down bug at `main.js:177` — apply once.

---

## 4. Cut list (ruthless)

- **One whole auto-tier system + one whole post pipeline.** Two fully-specced, competing implementations of the same subsystem = textbook duplicate engineering. Kill art's `Post.tick`/tonemap approach, keep perf's `Quality`+fold-into-Grade.
- **Perf's determinism/visual-regression framework** (seeded `Math.random` monkey-patch, p95 percentile harness, pose-manifest JSON snapshot testing, opt-in pixelmatch diff, N1-N12 new checks) — disproportionate test-infra investment for a project whose *existing* test runner (`playwright`) isn't even a declared dependency and isn't run in CI today. Fix the dependency + CI gate first; defer the elaborate regression suite until real perf problems are observed.
- **Meta-progression's migration framework** (`MIGRATIONS` object, versioned `while(d.v<SCHEMA_VERSION)` loop) for a schema that has never shipped a v1 yet — defensive code for a migration that doesn't exist. Also **18 upgrades × 4 depts** is more shop-economy than an indie physics-comedy game needs at launch — trim to ~8.
- **Shift's 38-stat instrumentation ledger** — good comedic payoff on ~12 of these (sheep resignations, longest fall, bestChain); `zoneSeconds{5 buckets}`, `cableSeconds`, `chuteSeconds`, `slideSeconds` etc. are bookkeeping for a screen glanced at for 10s. Trim to what feeds the incident-picker + payslip; defer "full record disclosure" dump.
- **Cable-clip/zip-line (mech B1a, ~95 LOC)** — mech's own words: *"nothing breaks if ignored... this is a mastery layer, not a gate."* New velocity-constraint physics + trolley mesh + animation branch + audio + particles, for something explicitly inconsequential to the core loop, while cheaper existing-mechanic fixes (telegraphs, escalation curves) sit right next to it in the same doc, unshipped. Defer past v1.
- **Handling Class (mech B5)** — 3-option menu × 5 tunable multiplier axes, requires stopping at depot and pressing 1/2/3. Purely numeric friction, doesn't touch physical comedy. Mech's own scope table already ranks it "COULD"/cut-first — reaffirm, cut.
- **Perf's `strideOrder` spatial-LOD permutation for decor instancing** (§A.6) — clever, but tiers a handful of draw calls (lamps/tufts/crystals/birds/clouds, already ~3-8 calls total after art's own instancing pass) that were never the bottleneck. Contradicts the user's explicit "looks over performance" bias. Simplify: don't tier decor counts, only tier composer/shadow/particle-rate.
- **UI's full ARIA/focus-trap/AAA-contrast layer** — not wasteful, well executed, but sequence LAST, not load-bearing for "does it ship."

---

## 5. Strongest / weakest / the one big swing

**Strongest: the multi-package STACK (mech §C).** Simple physics framing (spring-chain to previous parcel, not N springs to player), reuses existing carry-spring code, and is the one idea that simultaneously pays off art direction (leaning-tower-on-ice screenshot), UI (waybill becomes meaningful with real rows), AND gameplay depth (stack composition as decision, toppling as consequence) — *if* contradiction #2 (manifest collision) gets resolved first. Close second: **REFUSED/return-to-sender (mech B3)** — the only proposal across all six specs that gives the condition bar's low end and the mountain's *downhill* half any purpose at all; currently there is no reason in the entire game to ever descend.

**Weakest: Handling Class (mech B5).** A menu-driven numeric-modifier system bolted onto the one moment (depot pickup) that should stay physical and immediate. Doesn't deepen the comedy-physics loop the game is actually about — it's the one new-mechanic proposal that is pure UI/spreadsheet, not motion. Mech's own document immediately demotes it to cut-first, which is itself the tell.

**The one big swing this design should make:** collapse mech's stack + shift's manifest + UI's waybill panel into **ONE reconciled system** — a single per-shift consignment ledger where up to 3 lines can be *physically carried at once* as a leaning tower, rendered simultaneously as the 3D stack (art's bloom/rim/spring-lag) and as the paper waybill (UI's stamped line items). Right now it's three overlapping half-systems written by three authors who never saw each other. Unified, it is simultaneously the best screenshot, the best brand expression, and the deepest mechanic in the whole redesign.

---

## 6. Sequencing

**Must land first (blocking, cross-spec reconciliation, no code yet):**
1. Palette: finalize UI's WCAG-audited tokens as canonical; rewrite art's `palette.js`/BRAND against *those* hexes (currently backwards — art assumed pre-redesign values).
2. Resolve manifest/stack data model (mech vs shift) — foundational, everything else (beacons, waybill rows, i18n manifest keys) depends on it.
3. Pick ONE post/tonemap pipeline + ONE auto-tier controller; delete the other before any emissive/bloom-threshold tuning happens (that tuning is pipeline-specific and gets thrown away otherwise).
4. Lock `window.__game`/`verify.mjs` API surface in one document across perf+shift+i18n before touching that file four times.
5. Lock `Hud` public method surface (one signature table) across UI+mech+shift+i18n before any consumer call-site is written — `stamp()` collision and `setPackage()` collision must be fixed here, not discovered at merge.
6. Reconcile shift's spot-assignment window (`lo = min(n-1, spotCount-lines)`) against mech's need for 3 *distinct simultaneous* spots per stack — verify compatible before implementation.

**Trivial, zero-risk, do anytime/immediately regardless of the above:** declare `playwright` in `package.json`, fix `deploy.yml`'s feature-branch-to-prod trigger, delete the 3MB stray root binaries.

**Can only be tuned once the rest is live, not before:** bloom thresholds/emissive intensities (need final tonemap path running); auto-downgrade hysteresis constants (need real hardware frame-time data, not estimates); quota/pay curve numbers (shift's quota math assumes solo-delivery pay, but mech's multidrop/stack bonuses stack on top — needs playtesting with both live together); German string-layout CSS fixes (UI's §E measurements are estimates pending actual rendered `ud.css`); all six "manufactured moments" (mech §E) — only verifiable once art+mech+UI are simultaneously running.
