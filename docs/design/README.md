# Design documentation

## Read in this order

1. **`contracts.md`** — the three interfaces that must not drift: the `Hud` API, the
   `window.__game` debug surface, and colour ownership. If you are writing code, this is
   the authority.
2. The raw specs below, for reasoning and raw values.

## The raw specs

Six specs were written in parallel by independent agents against commit `3602969`, then
reviewed by two critics. They are kept verbatim because their reasoning and their numbers
are worth having — but **they were written blind to each other**, and four of the six
rewrite the same files (`main.js`, `terrain.js`, `cablecar.js`, `props.js`, `hud.js`) with
incompatible designs.

| File | Covers | Status |
|---|---|---|
| `art.md` | palette, band unification, lighting, sky, post-processing, instancing | partly superseded |
| `ui.md` | brand kernel, tokens, typography, components, screens, motion, a11y | partly superseded |
| `i18n.md` | string inventory, i18n module, EN/DE copy | section E superseded |
| `shift.md` | shift model, state machine, results, meta-progression | numbers corrected |
| `mechanics.md` | audit of existing systems, new mechanics, the stack, tuning | scope trimmed |
| `perf.md` | quality tiers, auto-downgrade, draw-call budget, test/CI | scope trimmed |
| `critique-feasibility.md` | what breaks when you implement them straight | — |
| `critique-coherence.md` | do they cohere as one design | — |

**The specs are not the plan.** Where a spec disagrees with `contracts.md` or with the
approved v4 plan, the plan wins. Every file carries a header saying what in it is dead.

## The resolved conflicts, in one table

| Conflict | Resolution |
|---|---|
| Two incompatible post pipelines both claiming `src/fx/post.js` | One: `RenderPass → UnrealBloomPass → GradePass`, `NoToneMapping`, multisampled target, no `OutputPass`, no FXAA |
| Two auto-quality controllers both mutating `setPixelRatio` per frame | One: `src/fx/quality.js` |
| Two full instancing rewrites of the same five files | One: `src/art/instanced.js` `InstancedPool`, used everywhere. Crates **are** instanced — the stated blocker was false, `physics.track()` carries rotation for any real `Object3D` |
| UI freezes five `Hud` signatures / i18n wants them keyed | i18n wins — see `contracts.md` §1 |
| "manifest" means two different objects | `shift.manifest[]` = the day's ledger. `packages.active[]` = the physical stack. The stack is never called a manifest |
| `ctx.shift01` read but never produced | `Shift` must export it |
| Palette anchored to pre-redesign hex | `ud.css` tokens are canonical |
| Hazard rim collides with static livery | 3D livery moves to `#A83619` |
| Two stacked vignettes | One, in the grade shader |
| `ZONES` rewritten twice with incompatible schemas | One merged edit: band edges from the palette **and** `name:` → `nameKey:` |

**Cut:** handling-class menu, localStorage migration framework, the 38-stat ledger (→ 12),
the determinism/pixel-diff test framework, decor-count LOD tiering, 18 unlocks (→ 10).
**Deferred:** the zip-line — it feeds neither the waybill nor the stamps, and it is cleanly
separable.
