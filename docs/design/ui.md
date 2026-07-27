<!--
  RAW DESIGN SPEC — UI / HUD / screens brand system

  Provenance: written by an independent design agent against commit 3602969, then
  reviewed by two critics (see critique-feasibility.md / critique-coherence.md).

  THIS DOCUMENT IS NOT THE PLAN. Where it disagrees with docs/design/README.md or
  the approved v4 plan, THE PLAN WINS. Six specs were written blind to each other and
  four of them rewrite the same files incompatibly; the conflicts are resolved in the
  plan, not here. Read this for the reasoning and the raw values, not for the decisions.

  NOTE: its "unchanged Hud signatures" list is SUPERSEDED — i18n wins (plan B4).
-->

# UI / HUD / SCREENS — FULL LOGISTICS-COMPANY BRAND SYSTEM

## 0. Files this workstream owns

| Path | Status | Purpose |
|---|---|---|
| `D:/unstable-delivery/src/ui/ud.css` | **NEW** | The entire design system: tokens, `@font-face`, every component, every screen. Single file. |
| `D:/unstable-delivery/src/ui/brand.js` | **NEW** | Brand kernel as data: SVG mark, tracking-number format, stamp table, rank table, barcode hash. Zero DOM. |
| `D:/unstable-delivery/src/ui/hud.js` | **REWRITE** | Same class, same ctx contract, superset API. |
| `D:/unstable-delivery/index.html` | **REWRITE of `<style>` + `<body>`** | Inline `<style>` shrinks from 175 lines to a ~30-line critical shell; body gains the new markup. |
| `D:/unstable-delivery/src/main.js` | **PATCH** at lines 15, 85-90, 114, 118-147, 149-163, 165-170, 267, 270-273 | State machine, pointer lock, boot progress, fps feed. |
| `D:/unstable-delivery/src/ui/fonts/*.woff2` | **NEW (binary)** | 3 files, ~72 KB total. Optional — system fallback stack is first-class. |

No new npm dependencies. No event bus. Every subsystem keeps calling `this.ctx.hud.*` exactly as it does today.

---

## A) BRAND KERNEL

### A.1 Company

**Name:** **VPS** — expanded as *Vertical Parcel Service* (EN) / *Vertikaler Paketdienst* (DE).

Chosen because the acronym is language-invariant: the wordmark, the tracking prefix, the stamps, and the favicon never change when the player flips to German — only the expansion line does. That is the one branding decision that makes a bilingual UI cheap.

**Tagline** EN: `UPHILL. ON TIME. MOSTLY.` — DE: `BERGAUF. PÜNKTLICH. MEISTENS.`

**Legal-fiction footer** (small print, appears on title / pause / results):
EN: `VPS is a subsidiary of nothing and liable for less.`
DE: `Die VPS ist Tochter von nichts und haftet für weniger.`

**Depot/terminal string** used on the boot screen and waybill header: `TERMINAL 4 · DEPOT: SUNNY MEADOWS (LOWER)`.

### A.2 Wordmark

Mark is pure geometry so it survives at 18 px and needs no font. Wordmark letters are HTML text in the display face beside it — do not attempt to path out letterforms.

```js
// src/ui/brand.js
export const MARK_SVG = `<svg class="ud-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
<g fill="currentColor">
<path d="M2 26h6l4-6H6z"/><path d="M9 20h6l4-6h-6z"/><path d="M16 14h6l4-6h-6z"/>
</g>
<path d="M22.9 21.9h7.2v7.2h-7.2z" fill="none" stroke="currentColor" stroke-width="1.8"/>
<path d="M22.9 25.5h7.2M26.5 21.9v7.2" stroke="currentColor" stroke-width="1" opacity=".5"/>
</svg>`;
```

Three ascending slanted bars (the climb / an upward arrow) plus a taped parcel. Single-color via `currentColor` so it inks black on paper surfaces and glows gold on screen surfaces without a second asset.

```html
<!-- lockup, used verbatim on title, pause, results, waybill header -->
<span class="ud-lockup">
  <span class="ud-lockup__mark"><!-- MARK_SVG --></span>
  <span class="ud-lockup__type">
    <b>VPS</b>
    <i data-i18n="brand.expand">VERTICAL PARCEL SERVICE</i>
  </span>
</span>
```

```css
.ud-lockup { display:inline-flex; align-items:center; gap:var(--ud-s2); color:var(--ud-brand); }
.ud-lockup__mark svg { display:block; width:1.9em; height:1.9em; }
.ud-lockup__type { display:flex; flex-direction:column; line-height:1; }
.ud-lockup__type b {
  font-family:var(--ud-font-display); font-weight:700; font-size:1em;
  letter-spacing:.20em; text-indent:.20em;           /* kill the trailing-tracking gap */
}
.ud-lockup__type i {
  font-family:var(--ud-font-display); font-weight:500; font-style:normal;
  font-size:.34em; letter-spacing:.22em; text-indent:.22em;
  color:var(--ud-ink-500); margin-top:.35em; white-space:nowrap;
}
.ud-lockup--screen { color:var(--ud-gold); }
.ud-lockup--screen .ud-lockup__type i { color:var(--ud-screen-dim); }
```

Minimum lockup size 16 px cap-height. Never recolor the mark outside `--ud-brand` / `--ud-gold` / `--ud-ink-900`. Never place it on `--ud-sig-yellow`.

### A.3 Tracking number

Format: `VPS-<ZZ><S>-<NNNN>-<C>`

| Field | Source | Rule |
|---|---|---|
| `ZZ` | zone of the **destination** spot | `MW` meadow, `PW` forest, `WC` cliffs, `FF` frozen, `SS` summit (from `ZONES[].key`, terrain.js:8-13) |
| `S` | shift index | base36 uppercase, `1`..`Z` |
| `NNNN` | `packages.slipCount` (packages.js:485) | zero-padded 4 |
| `C` | check char | base36 of `sum(charCodes) % 36` |

```js
// src/ui/brand.js
const ZONE_CODE = { meadow:'MW', forest:'PW', cliffs:'WC', frozen:'FF', summit:'SS' };
export function tracking(zoneKey, shift, slipNo) {
  const core = `${ZONE_CODE[zoneKey] ?? 'XX'}${(shift % 36).toString(36).toUpperCase()}-${String(slipNo).padStart(4,'0')}`;
  let s = 0; for (const c of core) s += c.charCodeAt(0);
  return `VPS-${core}-${(s % 36).toString(36).toUpperCase()}`;
}
// -> "VPS-WC3-0042-K"
```

The same string seeds the fake barcode so a given consignment always prints the same bars:

```js
export function barcodeCss(track) {
  let h = 2166136261;
  for (const c of track) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  const stops = []; let x = 0;
  for (let i = 0; i < 26; i++) {
    const w = 1 + ((h >>> (i % 28)) & 3);            // 1..4 px
    stops.push(`var(--ud-ink-900) ${x}px ${x + w}px`, `transparent ${x + w}px ${x + w + 1 + (i & 1)}px`);
    x += w + 1 + (i & 1);
  }
  return { image: `repeating-linear-gradient(90deg, ${stops.join(',')})`, size: `${x}px 100%` };
}
```

### A.4 Stamp vocabulary

Seven stamps. Each is `{ id, label(i18n key), sub?, tint, rot, shape }`. Nothing else may ever be stamped — a stamp that appears for trivia stops being a reward.

```js
// src/ui/brand.js
export const STAMPS = {
  delivered: { key:'stamp.delivered', tint:'ok',     rot:-7,  shape:'rect' }, // DELIVERED
  damaged:   { key:'stamp.damaged',   tint:'warn',   rot: 5,  shape:'rect' }, // DAMAGED IN TRANSIT
  refused:   { key:'stamp.refused',   tint:'bad',    rot: 9,  shape:'rect' }, // REFUSED BY RECIPIENT
  hazard:    { key:'stamp.hazard',    tint:'sig',    rot:-4,  shape:'rect' }, // HAZARD PAY APPROVED
  golden:    { key:'stamp.golden',    tint:'gold',   rot: 3,  shape:'oval' }, // GOLDEN CONSIGNMENT
  lost:      { key:'stamp.lost',      tint:'bad',    rot:-11, shape:'rect' }, // LOST IN TRANSIT
  closed:    { key:'stamp.closed',    tint:'ink',    rot:-2,  shape:'oval' }, // SHIFT CLOSED
};
```

Trigger map (exact call sites):

| Stamp | Call site |
|---|---|
| `delivered` | `deliveries.js:180` replaces `hud.toast('DELIVERED! +n')` |
| `damaged` | `deliveries.js:181` when `conditionPct < 50` |
| `lost` | `packages.js:336` (`PACKAGE DESTROYED` / potion explosion) |
| `refused` | reserved for the shift/refusal mechanic (game-design workstream); until then unused |
| `hazard` | `director.js:142` on hazard-pay payout |
| `golden` | `packages.js:489` when `def.golden`, stamped onto the waybill on pickup |
| `closed` | results screen only |

### A.5 Rank stamp (results screen)

Corporate euphemism, not letters:

| Band | EN | DE | tint |
|---|---|---|---|
| 0 | `PERFORMANCE PLAN` | `LEISTUNGSGESPRÄCH` | bad |
| 1 | `UNDER REVIEW` | `IN PRÜFUNG` | warn |
| 2 | `SATISFACTORY` | `ZUFRIEDENSTELLEND` | ink |
| 3 | `COMMENDABLE` | `LOBENSWERT` | ok |
| 4 | `EXEMPLARY` | `VORBILDLICH` | gold |

Thresholds are the game-design workstream's; the UI takes `band: 0..4`.

### A.6 Tone rules (binding on all new copy, EN and DE)

1. **The company is the narrator, and the company is never sorry.** Consequences are stated as procedure: *"That fall has been noted in your performance review."*
2. **Understate the catastrophe, overstate the paperwork.** A potion detonation is a *consignment exception*, not an explosion.
3. **Money is always specific.** Never "a penalty" — always `-300`, always in a field with a label.
4. **Second person for blame, passive voice for the company's own failures.** *"You dropped it."* vs *"A replacement has been made available."*
5. **Max 9 words per toast line, max 4 words per form label, max 3 words per stamp.**
6. **No exclamation marks in company chrome** (labels, stamps, buttons, forms). They are permitted in gameplay toasts, which are the mountain shouting, not the company.
7. **No emoji in company chrome.** Existing emoji prefixes stay in gameplay toasts only. Company chrome uses the `.ud-gl` glyph badge (§D.7) instead.
8. **German is rewritten, never translated.** Same beat, native idiom: `"Gravity: 1 — You: 0."` becomes `"Schwerkraft 1 : 0 Sie."`, not a calque. German uses the formal *Sie* throughout — a company that addresses you as *Sie* while docking your pay is funnier than one that says *du*.
9. **Numbers in the UI are always monospace and always right-aligned.** A number that jitters horizontally reads as an estimate.

---

## B) DESIGN TOKENS

Full block. Goes at the top of `src/ui/ud.css`.

### B.1 The surface decision — paper vs screen vs signage

Three surface classes, assigned by **who is speaking**, which keeps the rule memorable and stops the interface turning into a scrapbook:

| Class | Who speaks | Look | Surfaces |
|---|---|---|---|
| **PAPER** — dark ink on cream | the company, in writing | opaque cream, hard drop shadow, 1 px ink keyline, no blur | consignment card, waybill, receipts, toasts, ledger, results, pause, settings, title plate |
| **SCREEN** — light on near-black | the courier's handheld scanner, live | near-black, gold/ice text, thin blue keyline | navigation strip, altitude/zone readout, timer, status chips, boot terminal |
| **SIGNAGE** — black on hazard yellow | the mountain, urgently | flat `#F2B01E`, black ink, diagonal stripe edging | alert banner only, damage vignette frame |

Rationale for *paper as the default*: the game is logistics satire and paperwork is the joke; also, cream `#F7F1E3` at 16:1 contrast is the most legible surface over a bright alpine sky, which is what the player looks at 80% of the time. Rationale for *screen only for live telemetry*: values that change every frame (bearing, distance, altitude, countdown) must not look printed — printed values that mutate read as broken. Rationale for *signage isolation*: hazard yellow appears nowhere else, so it never loses its meaning.

### B.2 Tokens

```css
:root {
  /* ---- scale (set from JS, see §G) ---- */
  --ud-scale: 1;

  /* ---- paper stack ---- */
  --ud-paper-100:#F7F1E3;  /* fresh sheet    */
  --ud-paper-200:#EFE6D2;  /* carbon copy 1  */
  --ud-paper-300:#E3D7BC;  /* carbon copy 2  */
  --ud-paper-400:#D2C29F;  /* kraft / tab    */
  --ud-paper-edge:#C4B392; /* torn edge      */

  /* ---- ink stack ---- */
  --ud-ink-900:#1B1710;   /* press black, 15.98:1 on paper-100 */
  --ud-ink-700:#3A2F20;   /* typewriter,  11.4:1               */
  --ud-ink-500:#6B5C45;   /* secondary,    5.73:1  AA text     */
  --ud-ink-300:#9A8B72;   /* RULES/HAIRLINES ONLY, 2.95:1 — never text */
  --ud-ink-blue:#2A4B8D;  /* biro, handwritten fields          */
  --ud-ink-red:#A32B22;   /* stamp red / corrections, 6.33:1   */
  --ud-ink-carbon:#3E3A63;/* carbon-copy purple, receipts      */

  /* ---- screen stack ---- */
  --ud-screen-900:#0A0F1A;
  --ud-screen-800:#111A2C;
  --ud-screen-line:rgba(150,190,255,.22);
  --ud-screen-text:#E7F0FF;  /* 16.7:1 on screen-900 */
  --ud-screen-dim:#8FB0DD;   /*  6.9:1               */

  /* ---- brand accents ---- */
  --ud-brand:#E2552F;        /* VPS orange-red. 3.35:1 on paper -> >=18px bold only */
  --ud-brand-deep:#A83619;
  --ud-gold:#FFD166;         /* MUST equal 0xffd166 used by the beacon/pads/particles */
  --ud-gold-deep:#C79A3E;

  /* ---- signage ---- */
  --ud-sig-yellow:#F2B01E;   /* black-on-this = 9.96:1 */
  --ud-sig-ink:#0A0F1A;

  /* ---- semantic state (colourblind-safe: blue / amber / red, never green-red) ---- */
  --ud-ok:#2F7DBE;        --ud-ok-ink:#1E5686;   /* INTACT   */
  --ud-warn:#E8A21C;      --ud-warn-ink:#8A5A08; /* SCUFFED  — fill only; text uses -ink */
  --ud-bad:#C03221;       --ud-bad-ink:#8E2116;  /* CRITICAL */
  --ud-dead:#6B5C45;                              /* RUINED   */

  /* ---- type ---- */
  --ud-font-display:'Oswald','Oswald Fallback','Arial Narrow','Roboto Condensed','Segoe UI',system-ui,sans-serif;
  --ud-font-mono:'Courier Prime','Courier Prime Fallback','Courier New','Nimbus Mono PS','DejaVu Sans Mono',ui-monospace,monospace;
  --ud-font-emoji:'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji';

  --ud-fs-micro:calc( 9.5px * var(--ud-scale));
  --ud-fs-xs:   calc(11px   * var(--ud-scale));
  --ud-fs-sm:   calc(12.5px * var(--ud-scale));
  --ud-fs-md:   calc(14px   * var(--ud-scale));
  --ud-fs-lg:   calc(17px   * var(--ud-scale));
  --ud-fs-xl:   calc(22px   * var(--ud-scale));
  --ud-fs-2xl:  calc(30px   * var(--ud-scale));
  --ud-fs-3xl:  calc(44px   * var(--ud-scale));
  --ud-fs-stamp:calc(34px   * var(--ud-scale));
  --ud-fs-stampL:calc(56px  * var(--ud-scale));

  --ud-ls-label:.16em;   /* uppercase micro labels */
  --ud-ls-stamp:.10em;
  --ud-ls-mark:.20em;
  --ud-lh-tight:1.08;
  --ud-lh-body:1.45;

  /* ---- spacing (4px base) ---- */
  --ud-s1:calc( 2px * var(--ud-scale));
  --ud-s2:calc( 4px * var(--ud-scale));
  --ud-s3:calc( 6px * var(--ud-scale));
  --ud-s4:calc( 8px * var(--ud-scale));
  --ud-s5:calc(12px * var(--ud-scale));
  --ud-s6:calc(16px * var(--ud-scale));
  --ud-s7:calc(20px * var(--ud-scale));
  --ud-s8:calc(28px * var(--ud-scale));
  --ud-s9:calc(40px * var(--ud-scale));
  --ud-gutter:calc(18px * var(--ud-scale));

  /* ---- radii ---- */
  --ud-r-paper:2px;   /* paper is cut, not rounded */
  --ud-r-screen:4px;
  --ud-r-stamp:5px;
  --ud-r-pill:999px;

  /* ---- borders ---- */
  --ud-bd-hair:1px solid var(--ud-ink-300);
  --ud-bd-rule:2px solid var(--ud-ink-900);
  --ud-bd-dash:1.5px dashed var(--ud-ink-300);
  --ud-bd-screen:1px solid var(--ud-screen-line);

  /* ---- shadows ---- */
  --ud-sh-paper:0 1px 0 rgba(0,0,0,.18), 0 6px 14px rgba(6,10,20,.42), 0 18px 34px rgba(6,10,20,.24);
  --ud-sh-paper-sm:0 1px 0 rgba(0,0,0,.16), 0 3px 8px rgba(6,10,20,.34);
  --ud-sh-screen:0 4px 18px rgba(0,0,0,.5), inset 0 0 0 1px var(--ud-screen-line);
  --ud-sh-stamp:0 2px 0 rgba(0,0,0,.10);
  --ud-sh-focus:0 0 0 2px var(--ud-paper-100), 0 0 0 5px var(--ud-brand);

  /* ---- motion ---- */
  --ud-t-fast:110ms; --ud-t-base:180ms; --ud-t-slow:320ms; --ud-t-stamp:380ms;
  --ud-e-out:cubic-bezier(.22,1,.36,1);
  --ud-e-in:cubic-bezier(.55,0,1,.45);
  --ud-e-slam:cubic-bezier(.5,0,.08,1);
  --ud-e-back:cubic-bezier(.34,1.56,.64,1);

  /* ---- z layers ---- */
  --ud-z-vignette:10;
  --ud-z-hud:20;
  --ud-z-stamp:30;
  --ud-z-scrim:40;
  --ud-z-screen:50;
  --ud-z-boot:60;
}
```

---

## C) TYPOGRAPHY

### C.1 The two faces and their jobs

| Face | Weights | Job | Never used for |
|---|---|---|---|
| **Oswald** (condensed grotesque, SIL OFL) | 500, 700 | wordmark, stamps, alert banner, all uppercase micro-labels, buttons, section headings, rank | any number, any body copy |
| **Courier Prime** (typewriter mono, SIL OFL) | 400, 700 | every number, every form field value, waybill body, tracking numbers, score, distances, timers, receipts | headings, stamps |

The split is the whole typographic idea: **Oswald says what a field is, Courier Prime says what is in it.** A shipping label is exactly that — a condensed grotesque schema filled by an impact printer. Courier Prime is inherently tabular, which satisfies tone rule 9 for free with no `font-feature-settings`.

A third display face for stamps was rejected: Oswald 700 at `letter-spacing:.10em` inside a double-ruled box already reads as rubber stamp, and a third file is 25 KB for nothing.

### C.2 Self-hosting

Files live in **`src/ui/fonts/`** — *not* `public/`. Referenced from `ud.css` with relative `url('./fonts/…')`. Vite fingerprints them into `dist/assets/Oswald-…woff2` and rewrites the URL relative to the emitted CSS, which is the only variant that survives `base:'./'` on GitHub Pages. Anything in `public/` referenced as `/fonts/…` breaks under a project-path Pages URL.

Budget and provenance (subset to `latin` + `latin-ext` so `ÄÖÜäöüß` are present — the German rewrite needs them):

| File | Source | Subset | Budget |
|---|---|---|---|
| `Oswald-var.woff2` | Google Fonts variable `Oswald[wght]` | latin + latin-ext, `wght 400..700` | ≤ 32 KB |
| `CourierPrime-Regular.woff2` | Google Fonts `Courier Prime` 400 | latin + latin-ext | ≤ 24 KB |
| `CourierPrime-Bold.woff2` | Google Fonts `Courier Prime` 700 | latin + latin-ext | ≤ 24 KB |

**Hard ceiling 120 KB total.** For reference the repo already ships a 2.4 MB `cover.png`; 80 KB of fonts is noise. Subset with `pyftsubset --flavor=woff2 --layout-features='' --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0100-024F,U+2000-206F,U+20AC,U+2122,U+2212"`.

### C.3 `@font-face` + FOUT plan

```css
@font-face{
  font-family:'Oswald'; src:url('./fonts/Oswald-var.woff2') format('woff2-variations');
  font-weight:400 700; font-style:normal; font-display:swap;
}
@font-face{
  font-family:'Courier Prime'; src:url('./fonts/CourierPrime-Regular.woff2') format('woff2');
  font-weight:400; font-style:normal; font-display:swap;
}
@font-face{
  font-family:'Courier Prime'; src:url('./fonts/CourierPrime-Bold.woff2') format('woff2');
  font-weight:700; font-style:normal; font-display:swap;
}
/* Metric-matched fallbacks so the swap does not reflow the HUD. */
@font-face{
  font-family:'Oswald Fallback';
  src:local('Arial Narrow'),local('Roboto Condensed'),local('Liberation Sans Narrow'),local('Segoe UI');
  size-adjust:88%; ascent-override:107%; descent-override:26%; line-gap-override:0%;
}
@font-face{
  font-family:'Courier Prime Fallback';
  src:local('Courier New'),local('Nimbus Mono PS'),local('DejaVu Sans Mono');
  size-adjust:100%; ascent-override:96%; descent-override:24%; line-gap-override:0%;
}
```

`font-display:swap` is correct here: this is a game HUD, not a text page — a 120 ms fallback flash is invisible next to a 3-second physics boot. `block` would risk invisible labels on the loading screen, which is the one screen that must communicate immediately.

**No `<link rel=preload>`** — the hashed filename is unknown at authoring time and hardcoding it breaks on every rebuild. The stylesheet is render-blocking anyway, so the font request starts in the same round trip.

**Fallback plan if the fonts are never added:** every `--ud-font-*` token already lists real system faces first-class. `Arial Narrow` (Windows/macOS) and `Courier New` (universal) carry the whole design at ~90% fidelity. Ship the CSS without `src/ui/fonts/` and nothing breaks — but *do not leave dangling `@font-face` `url()`s*: `scripts/verify.mjs:20` fails the whole suite on a single `requestfailed`. **If the woff2 files are not committed, the three `url()` `@font-face` blocks must be deleted, not left in place.**

### C.4 Type recipes

```css
.ud-label{                      /* every field caption, every micro heading */
  font-family:var(--ud-font-display); font-weight:500;
  font-size:var(--ud-fs-micro); letter-spacing:var(--ud-ls-label);
  text-transform:uppercase; color:var(--ud-ink-500); line-height:1;
}
.ud-value{                      /* every field content */
  font-family:var(--ud-font-mono); font-weight:400;
  font-size:var(--ud-fs-sm); color:var(--ud-ink-900); line-height:var(--ud-lh-body);
}
.ud-num{                        /* every number */
  font-family:var(--ud-font-mono); font-weight:700;
  font-variant-numeric:tabular-nums; font-feature-settings:'tnum' 1;
  letter-spacing:.01em; text-align:right;
}
.ud-head{
  font-family:var(--ud-font-display); font-weight:700;
  text-transform:uppercase; letter-spacing:.08em; line-height:var(--ud-lh-tight);
  color:var(--ud-ink-900);
}
.ud-dotmatrix{                  /* impact-printer smear, zero cost */
  font-family:var(--ud-font-mono); letter-spacing:.06em;
  text-shadow:.45px 0 0 currentColor,-.45px 0 0 currentColor; opacity:.93;
}
.ud-hand{                       /* biro fields: recipient signature, courier name */
  font-family:var(--ud-font-mono); color:var(--ud-ink-blue);
  transform:rotate(-1.2deg); display:inline-block;
}
```

---

## D) COMPONENT INVENTORY

`#hud` root keeps `pointer-events:none`. All screens are **siblings of `#hud`**, not children, so `hud.show()`/`display:none` cannot orphan them.

### D.0 Shared primitives

```css
.ud-paper{
  background:var(--ud-paper-100); color:var(--ud-ink-900);
  border:1px solid var(--ud-ink-700); border-radius:var(--ud-r-paper);
  box-shadow:var(--ud-sh-paper);
  /* NO backdrop-filter: see the perf note below. */
}
.ud-paper--copy{ background:var(--ud-paper-200); color:var(--ud-ink-700); }
.ud-paper--kraft{ background:var(--ud-paper-300); }
.ud-screen{
  background:linear-gradient(180deg,var(--ud-screen-800),var(--ud-screen-900));
  color:var(--ud-screen-text); border:var(--ud-bd-screen);
  border-radius:var(--ud-r-screen); box-shadow:var(--ud-sh-screen);
}
.ud-sig{ background:var(--ud-sig-yellow); color:var(--ud-sig-ink); border:2px solid var(--ud-sig-ink); }
.ud-rule{ height:0; border-top:var(--ud-bd-rule); }
.ud-rule--hair{ border-top:var(--ud-bd-hair); }
.ud-rule--dash{ height:0; border-top:var(--ud-bd-dash); }

/* torn / perforated bottom edge — static elements only */
.ud-perf-b{
  --r:calc(5px * var(--ud-scale));
  -webkit-mask:
    radial-gradient(var(--r) at 50% 0,#0000 98%,#000) 50% calc(100% - var(--r) + .5px)/calc(2*var(--r)) var(--r) repeat-x,
    linear-gradient(#000 0 0) 0 0/100% calc(100% - var(--r)) no-repeat;
  mask:
    radial-gradient(var(--r) at 50% 0,#0000 98%,#000) 50% calc(100% - var(--r) + .5px)/calc(2*var(--r)) var(--r) repeat-x,
    linear-gradient(#000 0 0) 0 0/100% calc(100% - var(--r)) no-repeat;
  border-bottom:0;
}
/* leader-dot field row: LABEL ......... value */
.ud-field{ display:flex; align-items:baseline; gap:var(--ud-s2); }
.ud-field > .ud-label{ flex:0 0 auto; }
.ud-field::after{ content:none; }
.ud-field > .ud-lead{
  flex:1 1 auto; height:1em;
  background-image:radial-gradient(circle .8px at 50% 100%,var(--ud-ink-300) 99%,transparent);
  background-size:4px 100%; background-repeat:repeat-x; background-position:0 -.28em;
}
.ud-field > .ud-value{ flex:0 0 auto; }
```

**Perf rules, binding:**
- **No `backdrop-filter` on any gameplay HUD surface.** The current `.panel` blur (index.html:52) forces a backdrop readback of the WebGL composite every frame it is visible, which on a 60 fps canvas is the single most expensive line of CSS in the file. Paper is opaque; the blur bought nothing. `backdrop-filter` survives **only** on `.ud-scrim` (pause/results), where the sim is not advancing.
- Masks (`.ud-perf-b`) only on static elements — waybill, receipts, results header. Never on anything whose `transform` animates per frame.
- Every HUD panel gets `contain:layout paint;`.
- `will-change:transform` only on `.ud-stamp` and `.ud-nav__needle`, and only while animating.

---

### D.1 Consignment card — replaces `#hud-top-left`

**Purpose:** what you are carrying, how broken it is, how close to detonation. Paper, because it is the copy of the docket the depot handed you.

```html
<section id="ud-consign" class="ud-paper ud-perf-b" aria-labelledby="ud-consign-h">
  <header class="ud-consign__hd">
    <span class="ud-label" id="ud-consign-h" data-i18n="consign.title">CONSIGNMENT</span>
    <span class="ud-consign__track ud-dotmatrix" id="ud-consign-track">VPS-MW1-0001-7</span>
  </header>
  <div class="ud-rule"></div>

  <p class="ud-consign__item" id="ud-consign-name">—</p>
  <p class="ud-consign__note" id="ud-consign-note"></p>

  <div class="ud-gauge" id="ud-row-condition">
    <div class="ud-gauge__hd">
      <span class="ud-label" id="ud-cond-lbl" data-i18n="consign.condition">CONDITION</span>
      <span class="ud-gauge__state" id="ud-cond-state">INTACT</span>
      <span class="ud-num ud-gauge__pct" id="ud-cond-pct">100%</span>
    </div>
    <div class="ud-meter" id="ud-cond-meter" role="meter"
         aria-labelledby="ud-cond-lbl" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"
         aria-valuetext="100 percent, intact"><i></i></div>
  </div>

  <div class="ud-gauge ud-gauge--danger" id="ud-row-shake" hidden>
    <div class="ud-gauge__hd">
      <span class="ud-label" id="ud-shake-lbl" data-i18n="consign.instability">INSTABILITY</span>
      <span class="ud-gauge__state" id="ud-shake-state">STABLE</span>
      <span class="ud-num ud-gauge__pct" id="ud-shake-pct">0%</span>
    </div>
    <div class="ud-meter" id="ud-shake-meter" role="meter"
         aria-labelledby="ud-shake-lbl" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
  </div>
</section>
```

```css
#ud-consign{
  position:absolute; top:var(--ud-gutter); left:var(--ud-gutter);
  width:calc(280px * var(--ud-scale)); padding:var(--ud-s4) var(--ud-s5) var(--ud-s6);
  transform:rotate(-.45deg); contain:layout paint;
}
.ud-consign__hd{ display:flex; justify-content:space-between; align-items:baseline; gap:var(--ud-s3); margin-bottom:var(--ud-s2); }
.ud-consign__track{ font-size:var(--ud-fs-micro); color:var(--ud-ink-500); }
.ud-consign__item{
  font-family:var(--ud-font-mono); font-weight:700; font-size:var(--ud-fs-lg);
  color:var(--ud-ink-900); margin-top:var(--ud-s3); line-height:1.15;
}
.ud-consign__note{
  font-family:var(--ud-font-mono); font-size:var(--ud-fs-xs); color:var(--ud-ink-500);
  line-height:1.4; margin-top:var(--ud-s1);
}
.ud-gauge{ margin-top:var(--ud-s5); }
.ud-gauge__hd{ display:flex; align-items:baseline; gap:var(--ud-s3); }
.ud-gauge__hd .ud-label{ flex:1 1 auto; }
.ud-gauge__state{
  font-family:var(--ud-font-display); font-weight:700; font-size:var(--ud-fs-micro);
  letter-spacing:var(--ud-ls-label); text-transform:uppercase; color:var(--ud-ink-900);
}
.ud-gauge__pct{ font-size:var(--ud-fs-micro); color:var(--ud-ink-700); min-width:3.4ch; }

/* segmented meter: one transform write per change, ticks give a countable non-colour cue */
.ud-meter{
  position:relative; margin-top:var(--ud-s2);
  height:calc(11px * var(--ud-scale));
  background:var(--ud-paper-300); border:1px solid var(--ud-ink-700);
  overflow:hidden; contain:strict;
}
.ud-meter > i{
  position:absolute; inset:0; transform-origin:left center; transform:scaleX(1);
  background:var(--ud-ok); transition:transform var(--ud-t-fast) linear, background-color var(--ud-t-base) linear;
}
.ud-meter::after{                      /* 10 tick divisions */
  content:''; position:absolute; inset:0; pointer-events:none;
  background:repeating-linear-gradient(90deg,transparent 0 calc(10% - 1px),var(--ud-ink-700) calc(10% - 1px) 10%);
  opacity:.5;
}
.ud-meter[data-state="warn"] > i{ background:var(--ud-warn); }
.ud-meter[data-state="bad"]  > i{
  background:var(--ud-bad);
  background-image:repeating-linear-gradient(45deg,rgba(0,0,0,.34) 0 4px,transparent 4px 8px);
}
.ud-meter[data-state="dead"] > i{ background:var(--ud-dead); }
.ud-gauge--danger .ud-meter > i{ background:var(--ud-warn); }
.ud-gauge--danger .ud-meter[data-state="bad"] > i{ background:var(--ud-bad); }

#ud-consign.crit{ animation:ud-panic .48s ease-in-out infinite; }
@keyframes ud-panic{
  0%,100%{ transform:rotate(-.45deg) translateX(0); }
  25%    { transform:rotate(-.45deg) translateX(-1.6px); }
  75%    { transform:rotate(-.45deg) translateX(1.6px); }
}
```

**Redundant non-colour condition cue — four channels, colour is the weakest of them:**
1. the word (`INTACT` / `SCUFFED` / `CRITICAL` / `RUINED`),
2. the numeric percentage,
3. the number of filled ticks out of 10 (countable in greyscale),
4. a 45° hatch pattern that appears only in the `bad` band, plus the whole card shaking.

**JS API (Hud):**

```js
setPackage(name, note, hasShake = false)   // UNCHANGED SIGNATURE — packages.js:413,487, main.js:154
setCondition(pct)                          // UNCHANGED — packages.js:300,414
setShake(pct)                              // UNCHANGED — packages.js:628 (60 Hz, memoised)
setTracking(str)                           // NEW — called from packages.js:489 alongside showSlip
```

Band table (`Hud._band`): `pct > 70 → ok/INTACT`, `> 35 → warn/SCUFFED`, `> 0 → bad/CRITICAL`, `=== 0 → dead/RUINED`. Instability inverts: `< 40 → ok/STABLE`, `< 75 → warn/AGITATED`, else `bad/CRITICAL`.

**Memoisation is mandatory.** `setShake` is called from `packages.js:628` on every fixed step — 60 writes/second of `style.transform` + two `textContent`s. Implementation pattern used by every per-frame setter:

```js
setShake(pct) {
  const q = Math.round(pct);
  if (q === this._shakeQ) return;          // <- the whole point
  this._shakeQ = q;
  this._shakeFill.style.transform = `scaleX(${(q / 100).toFixed(3)})`;
  this._shakePct.textContent = `${q}%`;
  const b = q < 40 ? 'ok' : q < 75 ? 'warn' : 'bad';
  if (b !== this._shakeBand) {
    this._shakeBand = b;
    this._shakeMeter.dataset.state = b;
    this._shakeState.textContent = this.t(`state.shake.${b}`);
  }
}
```

---

### D.2 Ledger — replaces `#hud-top-right`

**Purpose:** the running account the company keeps on you. Paper, because it is an account.

`ALT` and zone move **out** of here into the navigation strip (D.3) — they are telemetry, not accounting. `setAlt` keeps its signature and simply writes to the nav strip instead.

```html
<section id="ud-ledger" class="ud-paper" aria-labelledby="ud-ledger-h">
  <header class="ud-ledger__hd">
    <span class="ud-lockup ud-lockup--mini"><!-- MARK_SVG --><b>VPS</b></span>
    <span class="ud-label" id="ud-ledger-h" data-i18n="ledger.title">ACCOUNT</span>
    <span class="ud-label ud-ledger__shift" id="ud-ledger-shift">SHIFT 01</span>
  </header>
  <div class="ud-rule"></div>

  <output class="ud-num ud-ledger__total" id="ud-score" aria-live="off">0</output>
  <div class="ud-ledger__unit ud-label" data-i18n="ledger.unit">CREDITS EARNED</div>

  <div class="ud-rule ud-rule--dash"></div>
  <div class="ud-field">
    <span class="ud-label" data-i18n="ledger.consignments">CONSIGNMENTS</span>
    <span class="ud-lead"></span>
    <span class="ud-value ud-num" id="ud-ledger-count">0</span>
  </div>

  <ol class="ud-manifest" id="ud-manifest" aria-label="Shift manifest"></ol>

  <div class="ud-chip-stamp" id="ud-chain" hidden>
    <span class="ud-chip-stamp__x ud-num">×1.0</span>
    <span class="ud-chip-stamp__t" data-i18n="ledger.streak">STREAK BONUS</span>
  </div>
</section>
```

```css
#ud-ledger{
  position:absolute; top:var(--ud-gutter); right:var(--ud-gutter);
  width:calc(220px * var(--ud-scale)); padding:var(--ud-s4) var(--ud-s5) var(--ud-s5);
  transform:rotate(.5deg); text-align:right; contain:layout paint;
}
.ud-ledger__hd{ display:flex; align-items:center; gap:var(--ud-s3); }
.ud-lockup--mini{ font-size:var(--ud-fs-xs); gap:var(--ud-s1); }
.ud-lockup--mini b{ font-family:var(--ud-font-display); font-weight:700; letter-spacing:var(--ud-ls-mark); }
.ud-ledger__hd .ud-label{ flex:1 1 auto; text-align:left; }
.ud-ledger__total{
  display:block; width:100%; margin-top:var(--ud-s3);
  font-size:var(--ud-fs-2xl); line-height:1; color:var(--ud-ink-900);
}
.ud-ledger__total.roll{ animation:ud-roll 190ms var(--ud-e-back); }
@keyframes ud-roll{ 0%{ transform:translateY(.14em) } 100%{ transform:translateY(0) } }
.ud-ledger__unit{ margin-top:var(--ud-s1); }
#ud-ledger .ud-rule,#ud-ledger .ud-rule--dash{ margin:var(--ud-s3) 0; }

/* manifest: N boxes, one per required delivery; ticked ones carry an ink check */
.ud-manifest{ display:flex; gap:var(--ud-s1); justify-content:flex-end; margin-top:var(--ud-s4); list-style:none; }
.ud-manifest li{
  width:calc(14px*var(--ud-scale)); height:calc(14px*var(--ud-scale));
  border:1px solid var(--ud-ink-700); background:var(--ud-paper-200);
  position:relative;
}
.ud-manifest li[data-done="1"]::after{
  content:''; position:absolute; left:22%; top:12%; width:38%; height:66%;
  border:2px solid var(--ud-ink-red); border-top:0; border-left:0;
  transform:rotate(38deg);
}
.ud-manifest li[data-now="1"]{ background:var(--ud-gold); animation:ud-blink 1.1s steps(2,end) infinite; }
@keyframes ud-blink{ 50%{ background:var(--ud-paper-200) } }

/* streak: a small rubber stamp, not a fire emoji */
.ud-chip-stamp{
  display:inline-flex; align-items:baseline; gap:var(--ud-s2); margin-top:var(--ud-s4);
  padding:var(--ud-s1) var(--ud-s3);
  border:2px solid var(--ud-ink-red); border-radius:var(--ud-r-stamp);
  color:var(--ud-ink-red); transform:rotate(-3deg);
}
.ud-chip-stamp__x{ font-size:var(--ud-fs-md); }
.ud-chip-stamp__t{ font-family:var(--ud-font-display); font-weight:700; font-size:var(--ud-fs-micro); letter-spacing:var(--ud-ls-label); }
.ud-chip-stamp.pop{ animation:ud-stamp-slam var(--ud-t-stamp) var(--ud-e-slam) both; }
```

**JS API:**
```js
setScore(n)            // UNCHANGED — count-up preserved, now writes to .ud-num, adds .roll for 190 ms
setDeliveries(n)       // UNCHANGED — writes #ud-ledger-count
setChain(chain)        // UNCHANGED — hides at chain<2, else "×2.5" + .pop
setShift({index, done, total})  // NEW — writes #ud-ledger-shift and rebuilds #ud-manifest
```

`setShift` rebuilds the manifest only when `total` changes; otherwise it flips `data-done`/`data-now` attributes.

---

### D.3 Navigation strip — replaces `#hud-target`

**Purpose:** live telemetry. The one **screen** surface in the playing HUD. Everything here changes every frame, and printed things must not.

```html
<section id="ud-nav" class="ud-screen" aria-label="Navigation">
  <div class="ud-nav__needle" id="ud-nav-needle" aria-hidden="true">
    <svg viewBox="0 0 24 24"><path d="M12 2 L20 21 L12 16.4 L4 21 Z" fill="currentColor"/></svg>
  </div>
  <div class="ud-nav__mid">
    <div class="ud-nav__to">
      <span class="ud-label" data-i18n="nav.to">DELIVER TO</span>
      <span class="ud-nav__dest" id="ud-nav-dest">—</span>
    </div>
    <div class="ud-nav__dist ud-num" id="ud-nav-dist">--</div>
  </div>
  <div class="ud-nav__side">
    <div class="ud-nav__alt ud-num" id="ud-nav-alt">0 m</div>
    <div class="ud-nav__zone" id="ud-nav-zone">SUNNY MEADOWS</div>
  </div>
  <div class="ud-nav__timer" id="ud-nav-timer" hidden>
    <span class="ud-label" data-i18n="nav.bonus">EXPRESS WINDOW</span>
    <span class="ud-num" id="ud-nav-timer-v">0s</span>
    <div class="ud-nav__timerbar"><i id="ud-nav-timer-fill"></i></div>
  </div>
</section>
```

```css
#ud-nav{
  position:absolute; top:var(--ud-gutter); left:50%; transform:translateX(-50%);
  display:grid; grid-template-columns:auto 1fr auto; align-items:center;
  gap:var(--ud-s5); padding:var(--ud-s3) var(--ud-s6);
  min-width:calc(360px * var(--ud-scale)); contain:layout paint;
}
.ud-nav__needle{ width:calc(30px*var(--ud-scale)); height:calc(30px*var(--ud-scale)); color:var(--ud-gold); will-change:transform; }
.ud-nav__needle svg{ display:block; width:100%; height:100%; }
.ud-nav__mid{ text-align:center; }
.ud-nav__to{ display:flex; align-items:baseline; gap:var(--ud-s2); justify-content:center; }
.ud-nav__dest{
  font-family:var(--ud-font-display); font-weight:700; font-size:var(--ud-fs-sm);
  letter-spacing:.08em; text-transform:uppercase; color:var(--ud-screen-text);
}
.ud-nav__dist{ font-size:var(--ud-fs-xl); color:var(--ud-gold); line-height:1.05; }
.ud-nav__side{ text-align:right; border-left:var(--ud-bd-screen); padding-left:var(--ud-s5); }
.ud-nav__alt{ font-size:var(--ud-fs-md); color:var(--ud-screen-text); }
.ud-nav__zone{
  font-family:var(--ud-font-display); font-weight:500; font-size:var(--ud-fs-micro);
  letter-spacing:var(--ud-ls-label); text-transform:uppercase; color:var(--ud-screen-dim); white-space:nowrap;
}
.ud-nav__timer{ grid-column:1/-1; display:flex; align-items:center; gap:var(--ud-s3); border-top:var(--ud-bd-screen); padding-top:var(--ud-s2); }
.ud-nav__timer .ud-num{ font-size:var(--ud-fs-xs); color:var(--ud-gold); min-width:4ch; }
.ud-nav__timerbar{ flex:1; height:calc(4px*var(--ud-scale)); background:rgba(255,255,255,.12); overflow:hidden; }
.ud-nav__timerbar > i{ display:block; height:100%; background:var(--ud-gold); transform-origin:left; transform:scaleX(1); }
.ud-nav__timer[data-expired="1"] .ud-num,
.ud-nav__timer[data-expired="1"] .ud-label{ color:var(--ud-screen-dim); }
.ud-nav__timer[data-expired="1"] .ud-nav__timerbar > i{ background:var(--ud-screen-dim); }
```

**JS API — signatures unchanged, throttling added:**

```js
setTarget(relBearing, dist, name)   // deliveries.js:229, EVERY RENDER FRAME
setAlt(y, zoneName)                 // deliveries.js:230, EVERY RENDER FRAME
setTimer(secLeft | null)            // deliveries.js:235/237, EVERY RENDER FRAME
```

All three memoise. Needle rotation writes only when the delta exceeds 0.6°:

```js
setTarget(relBearing, dist, name) {
  const deg = (-relBearing - Math.PI / 2) * 57.29578;
  if (Math.abs(deg - this._needleDeg) > 0.6) {
    this._needleDeg = deg;
    this._needle.style.transform = `rotate(${deg.toFixed(1)}deg)`;
  }
  const s = dist > 999 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
  if (s !== this._distS) { this._distS = s; this._dist.textContent = s; }
  if (name !== this._destS) { this._destS = name; this._dest.textContent = name.toUpperCase(); }
}
```

The bearing sign fix from hud.js:123 (`-relBearing - PI/2`) is preserved verbatim; the SVG needle points up at 0° exactly like the old `➤` glyph did after its rotation, so no re-derivation is needed.

---

### D.4 Alert banner — `#hud-banner`

**Purpose:** the mountain, urgently. The only SIGNAGE surface.

```html
<div id="ud-alert" class="ud-sig" role="alert" aria-live="assertive" hidden>
  <span class="ud-alert__stripe" aria-hidden="true"></span>
  <span class="ud-alert__text" id="ud-alert-text"></span>
  <span class="ud-alert__pay ud-num" id="ud-alert-pay" hidden></span>
  <span class="ud-alert__stripe" aria-hidden="true"></span>
</div>
```

```css
#ud-alert{
  position:absolute; top:calc(var(--ud-gutter) + 76px * var(--ud-scale)); left:50%;
  transform:translateX(-50%);
  display:flex; align-items:stretch; gap:var(--ud-s5);
  padding:0 0 0 0; border-radius:var(--ud-r-paper);
  box-shadow:0 6px 20px rgba(0,0,0,.5); contain:layout paint;
  animation:ud-alert-in 180ms var(--ud-e-out) both;
}
.ud-alert__stripe{
  width:calc(22px*var(--ud-scale)); align-self:stretch;
  background-image:repeating-linear-gradient(45deg,var(--ud-sig-ink) 0 8px,transparent 8px 16px);
  background-size:22.6px 22.6px;
  animation:ud-stripe 900ms linear infinite;
}
@keyframes ud-stripe{ to{ background-position:22.6px 0 } }
.ud-alert__text{
  font-family:var(--ud-font-display); font-weight:700;
  font-size:var(--ud-fs-xl); letter-spacing:.09em; text-transform:uppercase;
  padding:var(--ud-s3) 0; align-self:center;
}
.ud-alert__pay{
  align-self:center; font-size:var(--ud-fs-md);
  border-left:2px solid var(--ud-sig-ink); padding-left:var(--ud-s5);
}
@keyframes ud-alert-in{
  from{ opacity:0; transform:translateX(-50%) translateY(-14px) }
  to  { opacity:1; transform:translateX(-50%) translateY(0) }
}
#ud-alert[data-warn="1"] .ud-alert__text{ animation:ud-blink 620ms steps(2,end) infinite; }
```

**API `banner(text)` keeps its exact signature** (director.js:134, 138, 158, 178). But director.js:134 calls it **once per fixed step** while an event is live and cargo is carried — 60 `textContent` writes per second, each forcing style recalc. The Hud must split the string internally and short-circuit:

```js
banner(text) {
  if (!text) { if (this._bannerS !== null) { this._bannerS = null; this._alert.hidden = true; } return; }
  if (text === this._bannerS) return;         // <- kills 59 of 60 writes/sec
  this._bannerS = text;
  const cut = text.indexOf(' · ');
  const head = cut < 0 ? text : text.slice(0, cut);
  const pay  = cut < 0 ? ''   : text.slice(cut + 3);
  this._alertText.textContent = head;
  this._alertPay.textContent = pay;
  this._alertPay.hidden = !pay;
  this._alert.dataset.warn = /INCOMING|ANKUNFT/.test(text) ? '1' : '0';
  this._alert.hidden = false;
}
```

The ` · ` split key is exactly the separator director.js:134 already builds. Nothing in director.js changes.

---

### D.5 Score receipts — replaces `#pop-holder`

**Purpose:** the itemised breakdown from `deliveries.js:158-165`. A thermal receipt that prints line by line, then curls away.

```html
<div id="ud-receipts" aria-hidden="true"></div>
<!-- one receipt, built by Hud.scorePop(lines): -->
<div class="ud-receipt ud-paper--copy" style="--n:5">
  <div class="ud-receipt__hd ud-label">VPS · ITEMISED</div>
  <div class="ud-receipt__l" style="--i:0"><span>BASE</span><b class="ud-num">+240</b></div>
  <div class="ud-receipt__l" style="--i:1"><span>SPEED</span><b class="ud-num">+63</b></div>
  <div class="ud-receipt__l ud-receipt__l--tot" style="--i:4"><span>TOTAL</span><b class="ud-num">+414</b></div>
</div>
```

```css
#ud-receipts{
  position:absolute; top:31%; right:calc(var(--ud-gutter) + 250px * var(--ud-scale));
  display:flex; flex-direction:column; align-items:flex-end; gap:var(--ud-s3);
  pointer-events:none;
}
.ud-receipt{
  width:calc(184px * var(--ud-scale)); padding:var(--ud-s3) var(--ud-s4) var(--ud-s4);
  border:1px solid var(--ud-ink-300); border-radius:var(--ud-r-paper);
  box-shadow:var(--ud-sh-paper-sm); color:var(--ud-ink-carbon);
  transform-origin:top right;
  animation:ud-receipt-out 520ms var(--ud-e-in) forwards;
  animation-delay:calc(1500ms + var(--n) * 55ms);
}
.ud-receipt__hd{ color:var(--ud-ink-500); border-bottom:var(--ud-bd-dash); padding-bottom:var(--ud-s1); margin-bottom:var(--ud-s2); }
.ud-receipt__l{
  display:flex; justify-content:space-between; align-items:baseline; gap:var(--ud-s4);
  font-family:var(--ud-font-mono); font-size:var(--ud-fs-xs); line-height:1.5;
  animation:ud-print 170ms var(--ud-e-out) both;
  animation-delay:calc(var(--i) * 55ms);
}
.ud-receipt__l span{ letter-spacing:.05em; text-transform:uppercase; }
.ud-receipt__l b{ font-size:var(--ud-fs-sm); color:var(--ud-ink-900); }
.ud-receipt__l--tot{
  border-top:var(--ud-bd-rule); margin-top:var(--ud-s2); padding-top:var(--ud-s2);
  color:var(--ud-ink-900);
}
.ud-receipt__l--tot b{ font-size:var(--ud-fs-lg); }
@keyframes ud-print{
  from{ opacity:0; clip-path:inset(0 0 100% 0); transform:translateY(-3px) }
  to  { opacity:1; clip-path:inset(0 0 0 0);    transform:translateY(0) }
}
@keyframes ud-receipt-out{
  0%  { opacity:1; transform:translateY(0) rotate(0) scaleY(1) }
  100%{ opacity:0; transform:translateY(-26px) rotate(4deg) scaleY(.82) }
}
```

**API `scorePop(lines)` unchanged** (deliveries.js:46, 165). Hud parses each line: split on the last space, left half is the label, right half the amount. Lines starting with `=` become `--tot`. Emoji prefixes present in `deliveries.js:159-163` are stripped by `line.replace(/^[^\p{L}\p{N}]+/u,'')` and re-emitted as a `.ud-gl` glyph badge — the copy workstream can then delete them from `deliveries.js` at leisure without breaking anything.

Cap stays at 3 concurrent (hud.js:113).

---

### D.6 Toasts

**Purpose:** company memos. Paper, left-aligned like a real memo, not a centered game banner. 30 call sites across 5 files; the signature `toast(text, small=false)` is untouchable.

```html
<div id="ud-toasts" role="status" aria-live="polite" aria-atomic="false"></div>
<div class="ud-toast ud-paper">
  <span class="ud-toast__re ud-label">RE:</span>
  <span class="ud-toast__b">Gravity: 1 — You: 0. Back to the checkpoint.</span>
</div>
```

```css
#ud-toasts{
  position:absolute; top:24%; left:50%; transform:translateX(-50%);
  display:flex; flex-direction:column; align-items:center; gap:var(--ud-s3);
  width:min(calc(560px * var(--ud-scale)), 88vw);
}
.ud-toast{
  display:flex; align-items:baseline; gap:var(--ud-s4);
  padding:var(--ud-s4) var(--ud-s6); max-width:100%;
  font-family:var(--ud-font-mono),var(--ud-font-emoji);
  font-size:var(--ud-fs-lg); font-weight:700; line-height:1.3;
  transform:rotate(-.6deg); text-align:left;
  animation:ud-toast-in 3.2s var(--ud-e-out) forwards;
}
.ud-toast:nth-child(even){ transform:rotate(.7deg); }
.ud-toast__re{ color:var(--ud-ink-red); flex:0 0 auto; }
.ud-toast--min{
  font-size:var(--ud-fs-sm); font-weight:400; padding:var(--ud-s2) var(--ud-s5);
  background:var(--ud-paper-200); color:var(--ud-ink-700); box-shadow:var(--ud-sh-paper-sm);
}
.ud-toast--min .ud-toast__re{ display:none; }
@keyframes ud-toast-in{
  0%  { opacity:0; transform:translateY(-12px) rotate(-.6deg) scale(.94) }
  6%  { opacity:1; transform:translateY(0)     rotate(-.6deg) scale(1.02) }
  10% { transform:translateY(0) rotate(-.6deg) scale(1) }
  82% { opacity:1 }
  100%{ opacity:0; transform:translateY(-8px) rotate(-.6deg) }
}
```

Timers preserved from hud.js:133-134: remove after 3300 ms, cap 3.

---

### D.7 Glyph badge — `.ud-gl`

Replaces emoji inside company chrome without touching caller strings today.

```css
.ud-gl{
  display:inline-flex; align-items:center; justify-content:center;
  width:1.25em; height:1.25em; flex:0 0 auto;
  border:1px solid currentColor; border-radius:2px;
  font-family:var(--ud-font-display); font-weight:700; font-size:.7em;
  letter-spacing:0; line-height:1;
}
```
Mapping (used by receipts and stamps): speed→`S`, airmail→`A`, chain→`C`, golden→`G`, hazard→`H`, penalty→`−`.

---

### D.8 Waybill slip — replaces `#slip`

The seed of the whole language, now built out. Paper. Appears for 9 s on pickup (packages.js:489).

```html
<aside id="ud-waybill" class="ud-paper ud-perf-b" role="note" aria-label="Waybill" hidden>
  <header class="ud-wb__hd">
    <span class="ud-lockup ud-lockup--mini"><!-- MARK_SVG --><b>VPS</b></span>
    <span class="ud-label" data-i18n="wb.title">WAYBILL</span>
  </header>
  <div class="ud-wb__bar" id="ud-wb-bar" aria-hidden="true"></div>
  <div class="ud-wb__track ud-dotmatrix" id="ud-wb-track">VPS-MW1-0001-7</div>
  <div class="ud-rule"></div>

  <div class="ud-field"><span class="ud-label" data-i18n="wb.contents">CONTENTS</span><span class="ud-lead"></span></div>
  <div class="ud-wb__item ud-value" id="ud-wb-item"></div>
  <div class="ud-wb__note ud-value" id="ud-wb-note"></div>

  <div class="ud-field"><span class="ud-label" data-i18n="wb.to">CONSIGNEE</span><span class="ud-lead"></span>
    <span class="ud-value" id="ud-wb-to"></span></div>

  <div class="ud-wb__warn" id="ud-wb-warn"></div>

  <div class="ud-wb__sig">
    <span class="ud-label" data-i18n="wb.sig">SIGNATURE ON DELIVERY</span>
    <span class="ud-wb__sigline"></span>
  </div>
  <div class="ud-wb__fine ud-label" data-i18n="brand.small">VPS IS A SUBSIDIARY OF NOTHING AND LIABLE FOR LESS.</div>
</aside>
```

```css
#ud-waybill{
  position:absolute; bottom:calc(74px * var(--ud-scale)); right:var(--ud-gutter);
  width:calc(268px * var(--ud-scale)); padding:var(--ud-s4) var(--ud-s5) var(--ud-s6);
  transform:rotate(2.2deg); transform-origin:bottom right;
  animation:ud-wb-in 300ms var(--ud-e-back) both;
}
.ud-wb__hd{ display:flex; justify-content:space-between; align-items:center; }
.ud-wb__bar{ height:calc(26px*var(--ud-scale)); margin:var(--ud-s3) 0 var(--ud-s1); background-repeat:repeat-x; }
.ud-wb__track{ font-size:var(--ud-fs-micro); color:var(--ud-ink-700); text-align:center; letter-spacing:.14em; }
#ud-waybill .ud-rule{ margin:var(--ud-s3) 0; }
.ud-wb__item{ font-weight:700; font-size:var(--ud-fs-md); margin:var(--ud-s1) 0 var(--ud-s1); }
.ud-wb__note{ font-size:var(--ud-fs-xs); color:var(--ud-ink-500); margin-bottom:var(--ud-s4); }
.ud-wb__warn{
  margin-top:var(--ud-s4); padding:var(--ud-s2) var(--ud-s3);
  border:2px solid var(--ud-ink-red); color:var(--ud-ink-red);
  font-family:var(--ud-font-display); font-weight:700; font-size:var(--ud-fs-xs);
  letter-spacing:var(--ud-ls-label); text-transform:uppercase; text-align:center;
}
.ud-wb__sig{ margin-top:var(--ud-s5); }
.ud-wb__sigline{ display:block; margin-top:var(--ud-s4); border-bottom:1px solid var(--ud-ink-700); }
.ud-wb__fine{ margin-top:var(--ud-s3); font-size:calc(7.5px*var(--ud-scale)); color:var(--ud-ink-300); text-align:center; }
@keyframes ud-wb-in{
  from{ opacity:0; transform:rotate(9deg) translate(20px,26px) }
  to  { opacity:1; transform:rotate(2.2deg) translate(0,0) }
}
```

**API `showSlip(num, def, targetName)` / `hideSlip()` unchanged** (packages.js:489, deliveries.js:182).

**Fix the `innerHTML` at hud.js:139** — replace with `textContent` writes. Package names are static constants today so there is no live XSS, but the bilingual workstream will make these strings data-driven and the hole would become real:

```js
showSlip(num, def, targetName) {
  const zoneKey = this.ctx?.deliveries ? zoneAt(this.ctx.deliveries.target.pos.y).key : 'meadow';
  const track = tracking(zoneKey, this._shiftIndex, num);
  this._wbTrack.textContent = track;
  const bc = barcodeCss(track);
  this._wbBar.style.backgroundImage = bc.image;
  this._wbBar.style.backgroundSize  = bc.size;
  this._wbItem.textContent = def.name;
  this._wbNote.textContent = def.note;
  this._wbTo.textContent   = targetName;
  this._wbWarn.textContent = def.warning;
  this.setTracking(track);                       // mirrors into the consignment card
  if (def.golden) this.stamp('golden', { at: this._waybill, quiet: true });
  this._waybill.hidden = false;
  clearTimeout(this._slipTimer);
  this._slipTimer = setTimeout(() => this.hideSlip(), 9000);
}
```

`Hud` needs `ctx` for the zone lookup. **Do not change the `new Hud()` call at main.js:121** — it runs before `ctx.deliveries` exists. Add `hud.ctx = ctx;` immediately after, or have `showSlip` fall back to `'meadow'` when `ctx` is absent. The former is one line at main.js:121 and keeps the ctx architecture intact (the Hud already reaches nothing; giving it a back-reference is consistent with every other subsystem).

---

### D.9 Stamp component — the signature moment

Lives in its own layer above the HUD so it can overlap the ledger and the waybill.

```html
<div id="ud-stamps" aria-hidden="true"></div>
<!-- one stamp: -->
<div class="ud-stamp ud-stamp--ok" style="--rot:-7deg">
  <span class="ud-stamp__t">DELIVERED</span>
  <span class="ud-stamp__s ud-num">+414</span>
</div>
```

```css
#ud-stamps{ position:fixed; inset:0; z-index:var(--ud-z-stamp); pointer-events:none; }
.ud-stamp{
  position:absolute; left:50%; top:42%;
  display:flex; flex-direction:column; align-items:center; gap:var(--ud-s1);
  padding:var(--ud-s4) var(--ud-s7);
  border:calc(4px*var(--ud-scale)) solid currentColor; border-radius:var(--ud-r-stamp);
  box-shadow:inset 0 0 0 calc(2px*var(--ud-scale)) currentColor;
  color:var(--ud-ink-red); background:transparent;
  transform-origin:50% 50%; will-change:transform,opacity;
  animation:
    ud-stamp-slam var(--ud-t-stamp) var(--ud-e-slam) both,
    ud-stamp-fade 420ms var(--ud-e-in) 1180ms forwards;
}
.ud-stamp--ok  { color:var(--ud-ok-ink); }
.ud-stamp--warn{ color:var(--ud-warn-ink); }
.ud-stamp--bad { color:var(--ud-bad-ink); }
.ud-stamp--gold{ color:var(--ud-gold-deep); }
.ud-stamp--sig { color:var(--ud-brand-deep); }
.ud-stamp--ink { color:var(--ud-ink-900); }
.ud-stamp--oval{ border-radius:var(--ud-r-pill); padding:var(--ud-s5) var(--ud-s9); }
.ud-stamp__t{
  font-family:var(--ud-font-display); font-weight:700;
  font-size:var(--ud-fs-stamp); letter-spacing:var(--ud-ls-stamp);
  text-transform:uppercase; line-height:1;
}
.ud-stamp__s{ font-size:var(--ud-fs-lg); }

/* ink bleed: the pigment spreads a beat AFTER the die lands */
.ud-stamp::before{
  content:''; position:absolute; inset:calc(-3px*var(--ud-scale));
  border-radius:inherit; background:currentColor; opacity:0;
  animation:ud-stamp-ink 300ms var(--ud-e-out) 150ms both;
  mix-blend-mode:multiply;
}
/* dust ring kicked up on contact */
.ud-stamp::after{
  content:''; position:absolute; inset:0; border-radius:inherit;
  border:calc(2px*var(--ud-scale)) solid currentColor; opacity:0;
  animation:ud-stamp-dust 400ms var(--ud-e-out) 150ms both;
}

@keyframes ud-stamp-slam{
  0%  { opacity:0; transform:translate(-50%,-50%) rotate(calc(var(--rot) - 9deg)) scale(2.9); filter:blur(3px) }
  30% { opacity:1; }
  /* --- IMPACT at 39.5% of 380ms = 150ms --- */
  39.5%{ opacity:1; transform:translate(-50%,-50%) rotate(var(--rot)) scale(.93); filter:blur(0) }
  54% { transform:translate(-50%,-50%) rotate(var(--rot)) scale(1.09) }
  70% { transform:translate(-50%,-50%) rotate(var(--rot)) scale(.975) }
  86% { transform:translate(-50%,-50%) rotate(var(--rot)) scale(1.02) }
  100%{ transform:translate(-50%,-50%) rotate(var(--rot)) scale(1) }
}
@keyframes ud-stamp-ink{ 0%{ opacity:.30; transform:scale(.86) } 100%{ opacity:0; transform:scale(1.04) } }
@keyframes ud-stamp-dust{ 0%{ opacity:.42; transform:scale(.72) } 100%{ opacity:0; transform:scale(2.05) } }
@keyframes ud-stamp-fade{ to{ opacity:0; transform:translate(-50%,-50%) rotate(var(--rot)) scale(1.04) translateY(-14px) } }
```

**Impact frame = 150 ms.** Exported so the 3D juice can be aligned:

```js
export class Hud { static STAMP_IMPACT_MS = 150; /* … */ }
```

**API:**
```js
stamp(kindId, { sub = '', at = null, rot = null, quiet = false } = {})
```
`at` = an element to anchor over (defaults to viewport center at 42% height); `quiet` skips the dust/ink layers (used for the golden stamp printed onto the waybill, which should look pre-printed, not slammed).

**Sync with the existing 3D juice (deliveries.js:167-180):**

```js
// deliveries.js, replacing lines 173-180
hud.stamp('delivered', { sub: `+${gained}` });
if (conditionPct < 50) setTimeout(() => hud.stamp('damaged', { rot: 6 }), 520);
sfx.jingle();                                       // stays at t=0: the ledger ka-ching is the LEAD-IN
const impact = () => {
  this.ctx.hitstop?.(0.09);
  this.ctx.shake?.(0.22);
  this.ctx.sfx.thud(0.7);                           // the die hitting the paper
  this.ctx.music?.fanfare();
};
if (matchMedia('(prefers-reduced-motion: reduce)').matches) impact();
else setTimeout(impact, Hud.STAMP_IMPACT_MS);
```

The 150 ms pre-roll is the anticipation beat: the money sound fires immediately, the world freezes and shakes exactly when the rubber hits. Under reduced motion the stamp has no travel, so the delay is removed and timing is identical to today's.

The delivery shockwave/confetti at deliveries.js:168-172 stay at t=0 — they are the pad reacting, not the paperwork.

---

### D.10 Damage vignette — `#vignette-damage`

```html
<div id="ud-vignette" aria-hidden="true"></div>
```
```css
#ud-vignette{
  position:fixed; inset:0; z-index:var(--ud-z-vignette); pointer-events:none; opacity:0;
  transition:opacity 100ms linear;
  background:
    radial-gradient(ellipse at center, transparent 52%, rgba(192,50,33,.55) 100%),
    linear-gradient(var(--ud-sig-yellow) 0 0) 0 0/100% calc(5px*var(--ud-scale)) no-repeat,
    linear-gradient(var(--ud-sig-yellow) 0 0) 0 100%/100% calc(5px*var(--ud-scale)) no-repeat;
}
#ud-vignette.on{ opacity:1; }
```
`damageFlash()` unchanged (packages.js:301): add `.on` for 130 ms.

---

### D.11 Controls hint — replaces `#hud-hint`

The `white-space:nowrap` at index.html:127 overflows below ~1180 px. Replaced with a wrapping keycap row.

```html
<div id="ud-controls" class="ud-paper--kraft">
  <span class="ud-key">WASD</span><span data-i18n="ctl.move">move</span>
  <span class="ud-key">SHIFT</span><span data-i18n="ctl.sprint">sprint</span>
  <span class="ud-key">SPACE</span><span data-i18n="ctl.jump">jump / hold: parachute / tap: roll</span>
  <span class="ud-key">F</span><span data-i18n="ctl.throw">throw</span>
  <span class="ud-key">C</span><span data-i18n="ctl.slide">slide</span>
  <span class="ud-key">M</span><span data-i18n="ctl.music">music</span>
  <span class="ud-key ud-key--hi">ESC</span><span data-i18n="ctl.pause">suspend shift</span>
</div>
```
```css
#ud-controls{
  position:absolute; bottom:var(--ud-gutter); left:50%; transform:translateX(-50%);
  display:flex; flex-wrap:wrap; justify-content:center; align-items:center;
  gap:var(--ud-s2) var(--ud-s4); max-width:min(calc(1000px*var(--ud-scale)),92vw);
  padding:var(--ud-s2) var(--ud-s5); border:var(--ud-bd-hair); border-radius:var(--ud-r-paper);
  font-family:var(--ud-font-mono); font-size:var(--ud-fs-xs); color:var(--ud-ink-700);
  box-shadow:var(--ud-sh-paper-sm);
  transition:opacity var(--ud-t-slow) linear;
}
#ud-controls.faded{ opacity:.28; }
.ud-key{
  font-family:var(--ud-font-display); font-weight:700; font-size:var(--ud-fs-micro);
  letter-spacing:.08em; padding:1px var(--ud-s2);
  border:1px solid var(--ud-ink-700); border-bottom-width:2px; border-radius:2px;
  background:var(--ud-paper-100); color:var(--ud-ink-900);
}
.ud-key--hi{ background:var(--ud-gold); }
```
`Hud.setHint(rows)` rebuilds it; `Hud` fades it to 28% after the third delivery (`setDeliveries(n>=3)` adds `.faded`).

---

### D.12 Status chips (read-only)

Bottom-right, non-interactive. Interactive controls live only on screens where the pointer is free — see §E.

```html
<div id="ud-status">
  <span class="ud-chip" id="ud-chip-fps"><span class="ud-label">FPS</span><b class="ud-num">60</b></span>
  <span class="ud-chip" id="ud-chip-q"><span class="ud-label">Q</span><b>HIGH</b></span>
  <span class="ud-chip" id="ud-chip-lang"><b>EN</b></span>
  <span class="ud-chip" id="ud-chip-music"><b>♪</b></span>
</div>
```
```css
#ud-status{ position:absolute; right:var(--ud-gutter); bottom:var(--ud-gutter); display:flex; gap:var(--ud-s2); }
.ud-chip{
  display:inline-flex; align-items:baseline; gap:var(--ud-s2);
  padding:var(--ud-s1) var(--ud-s3); border-radius:var(--ud-r-pill);
  background:rgba(10,15,26,.72); border:var(--ud-bd-screen);
  font-family:var(--ud-font-mono); font-size:var(--ud-fs-micro); color:var(--ud-screen-dim);
}
.ud-chip b{ color:var(--ud-screen-text); }
.ud-chip[data-off="1"]{ opacity:.4; }
.ud-chip[data-warn="1"] b{ color:var(--ud-sig-yellow); }
```
`setFps(n)` writes at most 4 Hz (§E.6); `#ud-chip-fps` gets `data-warn="1"` below 45.

---

## E) SCREENS

All screens are siblings of `#hud` inside `<body>`, each `hidden` by default, each `position:fixed; inset:0; z-index:var(--ud-z-screen)`.

```css
.ud-screenview{ position:fixed; inset:0; display:grid; place-items:center; z-index:var(--ud-z-screen); }
.ud-screenview[hidden]{ display:none; }
.ud-scrim{
  position:absolute; inset:0; background:rgba(6,10,20,.62);
  backdrop-filter:blur(4px) saturate(.85);      /* ONLY here — the sim is paused */
  z-index:var(--ud-z-scrim);
}
.ud-sheet{
  position:relative; z-index:1;
  width:min(calc(640px * var(--ud-scale)), 92vw);
  max-height:88vh; overflow-y:auto; overscroll-behavior:contain;
  padding:var(--ud-s7) var(--ud-s8) var(--ud-s8);
  background:var(--ud-paper-100); color:var(--ud-ink-900);
  border:1px solid var(--ud-ink-700); box-shadow:var(--ud-sh-paper);
}
.ud-sheet::before{           /* franking / cancellation mark */
  content:''; position:absolute; right:calc(-14px*var(--ud-scale)); top:calc(-14px*var(--ud-scale));
  width:calc(120px*var(--ud-scale)); height:calc(120px*var(--ud-scale)); opacity:.16; pointer-events:none;
  background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Cg fill='none' stroke='%23A32B22' stroke-width='3'%3E%3Ccircle cx='60' cy='60' r='52'/%3E%3Ccircle cx='60' cy='60' r='41'/%3E%3Cpath d='M4 78q14-9 28 0t28 0 28 0 28 0M4 90q14-9 28 0t28 0 28 0 28 0'/%3E%3C/g%3E%3C/svg%3E") center/contain no-repeat;
}
```

Buttons (used everywhere, styled as rubber stamps you press):

```css
.ud-btn{
  display:inline-flex; align-items:center; justify-content:center; gap:var(--ud-s3);
  padding:var(--ud-s4) var(--ud-s7); cursor:pointer;
  font-family:var(--ud-font-display); font-weight:700; font-size:var(--ud-fs-md);
  letter-spacing:var(--ud-ls-stamp); text-transform:uppercase;
  color:var(--ud-ink-red); background:transparent;
  border:3px solid currentColor; border-radius:var(--ud-r-stamp);
  box-shadow:inset 0 0 0 1.5px currentColor;
  transform:rotate(-1.2deg);
  transition:transform var(--ud-t-fast) var(--ud-e-out), background-color var(--ud-t-fast) linear, color var(--ud-t-fast) linear;
}
.ud-btn:hover{ transform:rotate(-1.2deg) scale(1.03); background:rgba(163,43,34,.08); }
.ud-btn:active{ transform:rotate(-1.2deg) scale(.965); background:var(--ud-ink-red); color:var(--ud-paper-100); }
.ud-btn:focus-visible{ outline:none; box-shadow:inset 0 0 0 1.5px currentColor, var(--ud-sh-focus); }
.ud-btn--primary{ color:var(--ud-brand-deep); font-size:var(--ud-fs-xl); padding:var(--ud-s5) var(--ud-s9); }
.ud-btn--quiet{ color:var(--ud-ink-500); border-width:1px; box-shadow:none; }

.ud-seg{ display:inline-flex; border:1px solid var(--ud-ink-700); border-radius:var(--ud-r-paper); overflow:hidden; }
.ud-seg button{
  padding:var(--ud-s2) var(--ud-s5); cursor:pointer; border:0; background:var(--ud-paper-200);
  font-family:var(--ud-font-display); font-weight:700; font-size:var(--ud-fs-xs);
  letter-spacing:var(--ud-ls-label); text-transform:uppercase; color:var(--ud-ink-500);
}
.ud-seg button + button{ border-left:1px solid var(--ud-ink-300); }
.ud-seg button[aria-pressed="true"]{ background:var(--ud-ink-900); color:var(--ud-paper-100); }
.ud-seg button:focus-visible{ outline:none; box-shadow:var(--ud-sh-focus) inset; }
```

### E.1 Boot / loading — `#ud-boot`

Replaces the bare `#title-loading` text swap (index.html:43,221; main.js:143).

```html
<div id="ud-boot" class="ud-screenview">
  <div class="ud-boot__term ud-screen">
    <div class="ud-lockup ud-lockup--screen"><!-- MARK --><span class="ud-lockup__type"><b>VPS</b><i>VERTICAL PARCEL SERVICE</i></span></div>
    <pre class="ud-boot__log ud-dotmatrix" id="ud-boot-log"></pre>
    <div class="ud-boot__bar" id="ud-boot-bar">[<span id="ud-boot-fill"></span><span id="ud-boot-gap"></span>]</div>
  </div>
</div>
```
```css
#ud-boot{ z-index:var(--ud-z-boot); background:#070B14; }
.ud-boot__term{ width:min(calc(520px*var(--ud-scale)),90vw); padding:var(--ud-s7); }
.ud-boot__log{
  margin-top:var(--ud-s6); min-height:calc(112px*var(--ud-scale));
  font-family:var(--ud-font-mono); font-size:var(--ud-fs-sm); line-height:1.7;
  color:var(--ud-gold); white-space:pre-wrap;
}
.ud-boot__bar{ font-family:var(--ud-font-mono); font-size:var(--ud-fs-md); color:var(--ud-gold); letter-spacing:.1em; }
#ud-boot-gap{ color:var(--ud-gold-deep); opacity:.4; }
```

`hud.boot(msgKey, pct)` appends a line and redraws `[■■■■■□□□□□]`. Call sites in `boot()` (main.js:118-147):

| main.js line | call |
|---|---|
| after 122 | `ctx.hud.boot('boot.audio', 0.10)` — `AUDIO SUBSYSTEM … OK` |
| after 125 | `ctx.hud.boot('boot.physics', 0.35)` — `PHYSICS ENGINE … OK` |
| after 129 | `ctx.hud.boot('boot.world', 0.65)` — `TERRAIN SURVEY … OK` |
| after 138 | `ctx.hud.boot('boot.courier', 0.90)` — `COURIER ASSIGNED … OK` |
| at 142 | `ctx.hud.boot('boot.ready', 1)` then `ctx.hud.showScreen('title')` |

These are honest stage markers, not a fake percentage; each is a real await boundary.

### E.2 Title / attract — `#ud-title`

Keeps `cover.png`. The bottom third becomes a "job posting" plate.

```html
<div id="ud-title" class="ud-screenview" hidden>
  <div id="ud-title-cover" aria-hidden="true"></div>
  <div class="ud-title__plate ud-paper">
    <div class="ud-lockup ud-lockup--xl"><!-- MARK --><span class="ud-lockup__type"><b>VPS</b><i data-i18n="brand.expand">VERTICAL PARCEL SERVICE</i></span></div>
    <p class="ud-title__tag ud-head" data-i18n="brand.tagline">UPHILL. ON TIME. MOSTLY.</p>
    <div class="ud-rule"></div>

    <dl class="ud-title__form">
      <dt class="ud-label" data-i18n="title.post">POSITION</dt><dd class="ud-value" data-i18n="title.postv">COURIER (PROVISIONAL)</dd>
      <dt class="ud-label" data-i18n="title.route">ROUTE</dt><dd class="ud-value" data-i18n="title.routev">DEPOT → THE SUMMIT COURT</dd>
      <dt class="ud-label" data-i18n="title.equip">EQUIPMENT</dt><dd class="ud-value" data-i18n="title.equipv">NONE PROVIDED</dd>
    </dl>

    <button id="ud-title-start" class="ud-btn ud-btn--primary" data-i18n="title.start">START YOUR SHIFT</button>

    <div class="ud-title__row">
      <div class="ud-seg" id="ud-lang-title" role="group" aria-label="Language">
        <button data-lang="en" aria-pressed="true">EN</button>
        <button data-lang="de" aria-pressed="false">DE</button>
      </div>
      <button class="ud-btn ud-btn--quiet" id="ud-title-settings" data-i18n="title.settings">SETTINGS</button>
    </div>

    <div id="ud-title-controls" class="ud-title__ctl"><!-- same keycap markup as #ud-controls --></div>
    <p class="ud-title__fine ud-label" data-i18n="brand.small">VPS IS A SUBSIDIARY OF NOTHING AND LIABLE FOR LESS.</p>
  </div>
</div>
```
```css
#ud-title{ align-items:end; }
#ud-title-cover{
  position:absolute; inset:0;
  background:url('./assets/cover.png') center 20%/cover no-repeat; filter:saturate(1.05);
}
#ud-title-cover::after{
  content:''; position:absolute; inset:0;
  background:linear-gradient(to bottom,rgba(11,21,48,0) 34%,rgba(11,21,48,.94) 88%);
}
.ud-title__plate{
  position:relative; z-index:1; margin-bottom:5vh; text-align:center;
  width:min(calc(560px*var(--ud-scale)),92vw); padding:var(--ud-s7) var(--ud-s8);
  transform:rotate(-.6deg);
}
.ud-lockup--xl{ font-size:var(--ud-fs-2xl); }
.ud-title__tag{ margin-top:var(--ud-s4); font-size:var(--ud-fs-md); color:var(--ud-ink-500); letter-spacing:.2em; }
.ud-title__form{ display:grid; grid-template-columns:auto 1fr; gap:var(--ud-s2) var(--ud-s5); text-align:left; margin:var(--ud-s5) 0 var(--ud-s6); }
.ud-title__form dd{ font-family:var(--ud-font-mono); font-size:var(--ud-fs-sm); }
.ud-title__row{ display:flex; justify-content:center; align-items:center; gap:var(--ud-s5); margin-top:var(--ud-s5); }
.ud-title__ctl{ display:flex; flex-wrap:wrap; justify-content:center; gap:var(--ud-s2) var(--ud-s4); margin-top:var(--ud-s6); font-family:var(--ud-font-mono); font-size:var(--ud-fs-xs); color:var(--ud-ink-500); }
.ud-title__fine{ margin-top:var(--ud-s5); color:var(--ud-ink-300); font-size:calc(8px*var(--ud-scale)); }
#ud-title-start{ animation:ud-title-press 1.8s var(--ud-e-out) infinite; }
@keyframes ud-title-press{ 0%,72%,100%{ transform:rotate(-1.2deg) scale(1) } 80%{ transform:rotate(-1.2deg) scale(.955) } 88%{ transform:rotate(-1.2deg) scale(1.015) } }
```

**Critical change at main.js:146.** Today the whole `#title-screen` is the click target with `{once:true}`, so the new SETTINGS and EN/DE buttons would also start the game. Replace:

```js
// main.js:146 — was: document.getElementById('title-screen').addEventListener('click', startGame, { once:true });
document.getElementById('ud-title-start').addEventListener('click', startGame, { once: true });
```

### E.3 Pause — `#ud-pause`

```html
<div id="ud-pause" class="ud-screenview" role="dialog" aria-modal="true" aria-labelledby="ud-pause-h" hidden>
  <div class="ud-scrim"></div>
  <div class="ud-sheet">
    <div class="ud-lockup"><!-- MARK --><span class="ud-lockup__type"><b>VPS</b><i data-i18n="brand.expand">VERTICAL PARCEL SERVICE</i></span></div>
    <h2 class="ud-head" id="ud-pause-h" data-i18n="pause.title">SHIFT SUSPENDED</h2>
    <p class="ud-value" data-i18n="pause.sub">The clock does not stop. Neither does the weather.</p>
    <div class="ud-rule"></div>
    <dl class="ud-title__form" id="ud-pause-stats"><!-- SHIFT / CONSIGNMENTS / ACCOUNT / ALTITUDE --></dl>
    <div class="ud-sheet__actions">
      <button class="ud-btn" id="ud-pause-resume" data-i18n="pause.resume">RESUME SHIFT</button>
      <button class="ud-btn ud-btn--quiet" id="ud-pause-settings" data-i18n="pause.settings">SETTINGS</button>
      <button class="ud-btn ud-btn--quiet" id="ud-pause-abandon" data-i18n="pause.abandon">ABANDON SHIFT</button>
    </div>
    <p class="ud-title__fine ud-label" data-i18n="pause.fine">TIME SPENT IN THIS MENU IS UNPAID.</p>
  </div>
</div>
```
```css
.ud-sheet__actions{ display:flex; flex-wrap:wrap; gap:var(--ud-s5); margin-top:var(--ud-s7); }
```

### E.4 Results / end-of-shift — `#ud-results`

The payoff screen: a full ledger printout, printed line by line, then a rank stamp slams onto it.

```html
<div id="ud-results" class="ud-screenview" role="dialog" aria-modal="true" aria-labelledby="ud-res-h" hidden>
  <div class="ud-scrim"></div>
  <div class="ud-sheet ud-perf-b">
    <header class="ud-res__hd">
      <div class="ud-lockup"><!-- MARK --><span class="ud-lockup__type"><b>VPS</b><i>VERTICAL PARCEL SERVICE</i></span></div>
      <div class="ud-res__meta ud-dotmatrix"><span id="ud-res-track">VPS-SS3-0000-Q</span></div>
    </header>
    <h2 class="ud-head" id="ud-res-h" data-i18n="res.title">END-OF-SHIFT STATEMENT</h2>
    <div class="ud-rule"></div>

    <table class="ud-res__tbl">
      <thead><tr>
        <th class="ud-label" data-i18n="res.no">#</th>
        <th class="ud-label" data-i18n="res.item">CONSIGNMENT</th>
        <th class="ud-label" data-i18n="res.cond">COND</th>
        <th class="ud-label" data-i18n="res.pay">PAY</th>
      </tr></thead>
      <tbody id="ud-res-rows"></tbody>
    </table>

    <div class="ud-rule"></div>
    <dl class="ud-res__totals" id="ud-res-totals"></dl>
    <div class="ud-res__net">
      <span class="ud-label" data-i18n="res.net">NET PAYABLE</span>
      <output class="ud-num" id="ud-res-net">0</output>
    </div>

    <div class="ud-sheet__actions">
      <button class="ud-btn ud-btn--primary" id="ud-res-next" data-i18n="res.next">SIGN NEXT SHIFT</button>
      <button class="ud-btn ud-btn--quiet" id="ud-res-title" data-i18n="res.quit">RETURN TO DEPOT</button>
    </div>
  </div>
</div>
```
```css
.ud-res__hd{ display:flex; justify-content:space-between; align-items:flex-start; gap:var(--ud-s5); }
.ud-res__meta{ font-size:var(--ud-fs-micro); color:var(--ud-ink-500); text-align:right; }
.ud-res__tbl{ width:100%; border-collapse:collapse; margin-top:var(--ud-s4); }
.ud-res__tbl th{ text-align:left; padding-bottom:var(--ud-s2); border-bottom:var(--ud-bd-hair); }
.ud-res__tbl th:last-child,.ud-res__tbl td:last-child{ text-align:right; }
.ud-res__tbl td{
  font-family:var(--ud-font-mono); font-size:var(--ud-fs-xs);
  padding:var(--ud-s2) 0; border-bottom:1px dotted var(--ud-ink-300);
  animation:ud-print 150ms var(--ud-e-out) both; animation-delay:calc(var(--i)*70ms);
}
.ud-res__totals{ display:grid; grid-template-columns:1fr auto; gap:var(--ud-s2) var(--ud-s6); margin-top:var(--ud-s4); }
.ud-res__totals dd{ font-family:var(--ud-font-mono); font-size:var(--ud-fs-sm); text-align:right; }
.ud-res__totals dd.neg{ color:var(--ud-ink-red); }
.ud-res__net{
  display:flex; justify-content:space-between; align-items:baseline;
  margin-top:var(--ud-s5); padding-top:var(--ud-s4); border-top:var(--ud-bd-rule);
}
.ud-res__net output{ font-family:var(--ud-font-mono); font-weight:700; font-size:var(--ud-fs-3xl); }
```

`hud.results(data)` renders, animates the row printing (70 ms stagger), counts the net up over 900 ms, then at `rows*70 + 900` ms fires `this.stamp(rankStampId, { at: resultsSheet, rot: -6 })`.

Data contract:
```js
hud.results({
  shift: 3,
  rows: [{ n, item, condition, pay, flags:['golden','airmail'] }],
  totals: [{ key:'res.base', v:1240 }, { key:'res.speed', v:310 }, { key:'res.hazard', v:88 }, { key:'res.penalty', v:-300 }],
  net: 1338,
  band: 2,              // 0..4 -> §A.5
  record: false,
  nextShift: 4,
});
```

### E.5 Settings — `#ud-settings`

A form, because of course it is. Opened from title or pause; renders as a second sheet above whichever is open.

```html
<div id="ud-settings" class="ud-screenview" role="dialog" aria-modal="true" aria-labelledby="ud-set-h" hidden>
  <div class="ud-scrim"></div>
  <div class="ud-sheet">
    <h2 class="ud-head" id="ud-set-h" data-i18n="set.title">FORM 4-B · OPERATING PREFERENCES</h2>
    <div class="ud-rule"></div>
    <div class="ud-set__row">
      <span class="ud-label" data-i18n="set.lang">LANGUAGE</span>
      <div class="ud-seg" id="ud-lang-set" role="group">
        <button data-lang="en" aria-pressed="true">EN</button><button data-lang="de" aria-pressed="false">DE</button>
      </div>
    </div>
    <div class="ud-set__row">
      <span class="ud-label" data-i18n="set.quality">RENDER QUALITY</span>
      <div class="ud-seg" id="ud-quality" role="group">
        <button data-q="auto" aria-pressed="true">AUTO</button><button data-q="low">LOW</button>
        <button data-q="med">MED</button><button data-q="high">HIGH</button>
      </div>
      <span class="ud-value ud-set__hint" id="ud-quality-now">AUTO → HIGH · 58 fps</span>
    </div>
    <div class="ud-set__row">
      <span class="ud-label" data-i18n="set.music">MUSIC</span>
      <div class="ud-seg" id="ud-music"><button data-on="1" aria-pressed="true">ON</button><button data-on="0">OFF</button></div>
    </div>
    <div class="ud-set__row">
      <span class="ud-label" data-i18n="set.motion">REDUCED MOTION</span>
      <div class="ud-seg" id="ud-motion"><button data-on="0" aria-pressed="true">SYSTEM</button><button data-on="1">FORCE</button></div>
    </div>
    <div class="ud-sheet__actions"><button class="ud-btn" id="ud-set-close" data-i18n="set.close">FILE AND CLOSE</button></div>
  </div>
</div>
```
```css
.ud-set__row{ display:grid; grid-template-columns:calc(150px*var(--ud-scale)) auto 1fr; align-items:center; gap:var(--ud-s5); padding:var(--ud-s4) 0; border-bottom:var(--ud-bd-hair); }
.ud-set__hint{ font-size:var(--ud-fs-xs); color:var(--ud-ink-500); }
```

`REDUCED MOTION = FORCE` sets `documentElement.dataset.udMotion = 'reduce'`; the CSS in §F.5 keys on `@media` **or** that attribute.

### E.6 Fault — `#ud-fault`

Replaces the unstyled text swap at main.js:270-273.

```html
<div id="ud-fault" class="ud-screenview" role="alert" hidden>
  <div class="ud-sheet">
    <h2 class="ud-head" data-i18n="fault.title">CONSIGNMENT EXCEPTION</h2>
    <p class="ud-value" data-i18n="fault.sub">The shift could not begin. This has been logged and ignored.</p>
    <pre class="ud-fault__msg ud-dotmatrix" id="ud-fault-msg"></pre>
    <p class="ud-title__fine ud-label" data-i18n="fault.fine">REFERENCE: VPS-ERR. DO NOT QUOTE THIS NUMBER TO ANYONE.</p>
  </div>
</div>
```
```css
.ud-fault__msg{
  margin-top:var(--ud-s5); padding:var(--ud-s4); overflow-x:auto;
  background:var(--ud-paper-300); border-left:4px solid var(--ud-ink-red);
  font-family:var(--ud-font-mono); font-size:var(--ud-fs-xs); white-space:pre-wrap;
}
```
```js
// main.js:270-273
boot().catch((e) => {
  console.error(e);
  state = 'fault';
  ctx.hud.fault(e?.message ?? String(e));
});
```
Note: `console.error` here still trips `verify.mjs:18` — but only if boot actually fails, in which case the suite should fail. Leave it.

---

### E.7 State machine + pointer lock — exact main.js patch

**main.js:114** becomes:
```js
let state = 'boot';          // 'boot' | 'title' | 'playing' | 'paused' | 'results' | 'fault'
let lockWanted = false;
let hadLock = false;
```

**Insert after main.js:163**, replacing lines 160-163 entirely:

```js
function requestLock() {
  if (!lockWanted) return;
  const el = renderer.domElement;
  if (document.pointerLockElement === el) return;
  try {
    const p = el.requestPointerLock?.();          // NO options object: some browsers throw NotSupportedError
    if (p && typeof p.catch === 'function') p.catch(() => { ctx.hud.setLockHint(true); });
  } catch { ctx.hud.setLockHint(true); }
}

// Re-lock when the player clicks back into the game.
renderer.domElement.addEventListener('click', () => {
  if (state === 'playing') { lockWanted = true; ctx.hud.setLockHint(false); requestLock(); }
});

// Esc-driven exits do NOT deliver a keydown — pause must be driven by the lock change.
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (locked) { hadLock = true; ctx.hud.setLockHint(false); return; }
  // hadLock guard: headless (verify.mjs) never acquires lock, so this must not fire there.
  if (hadLock && state === 'playing') { hadLock = false; pause(); }
});
document.addEventListener('pointerlockerror', () => { ctx.hud.setLockHint(true); });

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  lockWanted = false;
  document.exitPointerLock?.();
  ctx.hud.showScreen('pause');
}
function resume() {
  if (state !== 'paused') return;
  ctx.hud.hideScreen('pause');
  ctx.hud.hideScreen('settings');
  state = 'playing';
  lockWanted = true;
  requestLock();               // the RESUME click IS a user gesture; the >1.25 s Chrome
                               // cooldown after an Esc exit has elapsed by then in practice.
                               // If it fails, setLockHint(true) shows "CLICK TO RESUME CONTROL"
                               // and the canvas click listener above re-requests.
}
```

**main.js:165-170** keydown becomes:
```js
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    e.preventDefault();
    if (state === 'playing') pause(); else if (state === 'paused') resume();
    return;
  }
  if (e.code === 'KeyM' && state === 'playing') {
    const on = ctx.music.toggle();
    ctx.hud.setStatus({ music: on });
    ctx.hud.toast(on ? 'Music on' : 'Music off', true);
  }
});
```
`Escape` is the only new binding. `verify.mjs` drives `w/a/d`, `Space`, and `F` only — no collision.

**main.js:149-158 `startGame`:**
```js
function startGame() {
  ctx.hud.hideScreen('title');
  ctx.sfx.start();
  ctx.music.start();
  ctx.hud.show();
  ctx.hud.setPackage(null);
  ctx.hud.setShift({ index: 1, done: 0, total: 8 });
  ctx.hud.toast('Grab your first package at the glowing ring.', false);
  state = 'playing';
  lockWanted = true;
  requestLock();
}
```
`window.__game.start` (main.js:290) still points at this function unchanged — `verify.mjs:30` keeps working.

**main.js:193-197** needs no change. `state !== 'playing'` already short-circuits to a bare render, which is exactly what pause/results want (frozen 3D behind the scrim). `clock.getDelta()` accumulation is already clamped at 0.1 s (main.js:190), so resuming after a long pause produces one 100 ms frame, not a teleport.

**main.js:267**, before `renderer.render`:
```js
if (gameTime - (ctx.hud._fpsT ?? 0) > 0.25) { ctx.hud._fpsT = gameTime; ctx.hud.setFps(fps); }
```

**main.js:85-90** resize handler, append:
```js
ctx.hud?.applyScale();
```
plus one call at module scope after `new Hud()` (main.js:121).

**Lock hint chip:**
```html
<div id="ud-lockhint" class="ud-chip" hidden><b data-i18n="hud.lock">CLICK TO RESUME CONTROL</b></div>
```
```css
#ud-lockhint{ position:absolute; left:50%; bottom:22%; transform:translateX(-50%); background:rgba(10,15,26,.9); animation:ud-blink 1.2s steps(2,end) infinite; }
```

---

## F) MOTION

### F.1 Inventory and timings

| Element | Duration | Easing | Notes |
|---|---|---|---|
| Stamp slam | 380 ms, impact at 150 ms | `--ud-e-slam` | scale 2.9 → 0.93 → 1.09 → 0.975 → 1.02 → 1; rotate −9° offset settles to `--rot`; `blur(3px)` → 0 |
| Stamp ink bleed | 300 ms @ 150 ms delay | `--ud-e-out` | `opacity .30 → 0`, `scale .86 → 1.04`, `mix-blend-mode:multiply` |
| Stamp dust ring | 400 ms @ 150 ms delay | `--ud-e-out` | `scale .72 → 2.05`, `opacity .42 → 0` |
| Stamp exit | 420 ms @ 1180 ms | `--ud-e-in` | drift up 14 px, fade |
| Score count-up | 500 ms | cubic ease-out (existing, hud.js:83) | `+.roll` 190 ms `--ud-e-back` |
| Receipt line print | 170 ms, 55 ms stagger | `--ud-e-out` | `clip-path:inset(0 0 100% 0)` reveal |
| Receipt curl-out | 520 ms @ `1500 + n*55` ms | `--ud-e-in` | rotate 4°, `scaleY .82` |
| Toast | 3200 ms total | `--ud-e-out` | unchanged envelope from index.html:143-149 |
| Alert banner in | 180 ms | `--ud-e-out` | slide down 14 px |
| Alert hazard stripes | 900 ms linear infinite | — | `background-position` only, GPU-cheap |
| Waybill in | 300 ms | `--ud-e-back` | from rotate 9° / translate(20,26) |
| Meter fill | 110 ms linear | — | `transform:scaleX` only, never `width` |
| Condition panic | 480 ms infinite | ease-in-out | ±1.6 px, only in the `bad` band |
| Button press | 110 ms | `--ud-e-out` | `scale .965` + ink invert |

### F.2 Sync with the 3D juice

Covered in §D.9. The rule: **DOM impact frames align with `ctx.hitstop`, not with the function call.** The only three coupling points:

1. `deliveries.js:173-176` — hitstop/shake/fanfare shift to `Hud.STAMP_IMPACT_MS` (150 ms).
2. `packages.js:324` (`hitstop(0.12)` on explosion) — call `hud.stamp('lost')` **at** `packages.js:336`, unshifted: destruction should feel like it already happened, and the stamp is the bureaucratic aftermath. Do not delay this one.
3. `director.js:159-160` (`sfx.wobble()` + `shake(0.25)` on event warning) — `hud.banner()` at line 158 already fires one step earlier; leave as is. The banner slide-in (180 ms) overlaps the shake decay (`trauma` decays at 1.4/s, main.js:241, so 0.25 trauma lasts ~180 ms). Coincidental but correct — do not touch.

### F.3 Reduced motion

```css
@media (prefers-reduced-motion: reduce) {
  :root{ --ud-t-fast:0ms; --ud-t-base:0ms; --ud-t-slow:0ms; --ud-t-stamp:120ms; }
}
:root[data-ud-motion="reduce"]{ --ud-t-fast:0ms; --ud-t-base:0ms; --ud-t-sl

```

<!-- (agent output boundary; the reduced-motion block restarts below) -->


```css
:root[data-ud-motion="reduce"]{ --ud-t-fast:0ms; --ud-t-base:0ms; --ud-t-slow:0ms; --ud-t-stamp:120ms; }

@media (prefers-reduced-motion: reduce) {
  /* stamp: no travel, no blur, no dust, no overshoot — it is simply there */
  .ud-stamp{ animation:ud-fade-in 120ms linear both, ud-stamp-fade 300ms linear 1400ms forwards; }
  .ud-stamp::before,.ud-stamp::after{ animation:none; opacity:0; }
  /* infinite loops all stop */
  #ud-consign.crit,
  .ud-alert__stripe,
  #ud-alert[data-warn="1"] .ud-alert__text,
  .ud-manifest li[data-now="1"],
  #ud-title-start,
  #ud-lockhint{ animation:none; }
  /* replacements that keep the SIGNAL without the movement */
  #ud-consign.crit{ outline:3px solid var(--ud-bad); outline-offset:2px; }
  #ud-alert[data-warn="1"]{ outline:3px solid var(--ud-sig-ink); outline-offset:3px; }
  .ud-manifest li[data-now="1"]{ background:var(--ud-gold); box-shadow:inset 0 0 0 2px var(--ud-ink-900); }
  /* envelopes collapse to opacity-only */
  .ud-toast{ animation:ud-hold-fade 3.2s linear forwards; }
  .ud-receipt__l{ animation:none; }
  .ud-receipt{ animation:ud-hold-fade 2.2s linear forwards; }
  .ud-res__tbl td{ animation:none; }
  #ud-waybill{ animation:ud-fade-in 120ms linear both; }
  #ud-alert{ animation:ud-fade-in 120ms linear both; }
  .ud-meter > i{ transition:none; }
}
@keyframes ud-fade-in{ from{ opacity:0 } to{ opacity:1 } }
@keyframes ud-hold-fade{ 0%,86%{ opacity:1 } 100%{ opacity:0 } }
```

Mirror the whole block for `:root[data-ud-motion="reduce"]` — the settings toggle must win even when the OS says otherwise. Practical way to avoid writing it twice: author the reduced rules once inside `@media (prefers-reduced-motion: reduce)` **and** once under the attribute selector by wrapping the shared declarations in a single selector list per rule, e.g.

```css
@media (prefers-reduced-motion: reduce){ :root{ --ud-rm:1 } }
```
does not work for animation shorthand, so the duplication is unavoidable. **Instruction:** write the reduced-motion rules once in a `@media` block, then repeat the identical block with every selector prefixed `:root[data-ud-motion="reduce"] `. ~60 duplicated lines. Accept it; the alternative is a JS class toggle that fights the OS setting.

**JS side of reduced motion** — three behaviours must change in `hud.js`, not just CSS:

```js
// hud.js constructor
this._rm = matchMedia('(prefers-reduced-motion: reduce)');
this.reduced = () => this._rm.matches || document.documentElement.dataset.udMotion === 'reduce';
```
1. `setScore(n)` — if `reduced()`, write `String(n)` and return; skip the rAF chain (hud.js:76-88).
2. `results()` — if `reduced()`, render all rows at once and stamp immediately.
3. `deliveries.js` impact delay — already branched in §D.9.

### F.4 What must never animate

`transform` and `opacity` only, on every per-frame path. Explicitly forbidden in this codebase:
- `width` on the condition/instability meters (the current `transition: width .15s` at index.html:61 triggers layout on a element that changes 60×/s while the potion ticks).
- `filter` on anything except the 380 ms stamp intro.
- `backdrop-filter` on any element visible during `state === 'playing'`.
- `box-shadow` transitions on hover targets that overlay the canvas.

---

## G) LAYOUT & RESPONSIVENESS

### G.1 The scale variable

CSS cannot divide two lengths, so `--ud-scale` is set from JS. Three lines, in the existing resize handler.

```js
// hud.js
applyScale() {
  const s = Math.min(Math.max(Math.min(innerWidth / 1600, innerHeight / 900), 0.82), 1.30);
  document.documentElement.style.setProperty('--ud-scale', s.toFixed(3));
}
```

| Viewport | raw min | clamped |
|---|---|---|
| 1280×720 | 0.800 | **0.820** |
| 1366×768 | 0.853 | 0.853 |
| 1600×900 | 1.000 | 1.000 |
| 1920×1080 | 1.200 | 1.200 |
| 2560×1440 | 1.600 | **1.300** |
| 3440×1440 | 1.600 | **1.300** |

Every size token in §B.2 is already `calc(Npx * var(--ud-scale))`, so this one property rescales the entire interface with no other code. The inline critical `<style>` sets `--ud-scale:1` so the boot screen renders correctly before `hud.js` runs.

**Call sites:** `hud.js` constructor (immediately), and appended to the resize handler at main.js:85-90.

### G.2 Corner drift on ultrawide

Absolute corners on a 3440 px viewport put the consignment card and the ledger 3.1 m apart in eye-travel terms. Constrain the HUD to a reading frame:

```html
<div id="hud"><div id="ud-frame"> … all HUD components … </div></div>
```
```css
#hud{ position:fixed; inset:0; z-index:var(--ud-z-hud); pointer-events:none; display:none; }
#hud.on{ display:block; }
#ud-frame{
  position:absolute; inset:0;
  max-width:calc(2100px * var(--ud-scale));
  margin-inline:auto;
  padding-inline:max(0px, env(safe-area-inset-left), env(safe-area-inset-right));
}
```
All `#ud-consign`, `#ud-ledger`, `#ud-nav`, `#ud-controls`, `#ud-status` anchor to `#ud-frame`, not the viewport. At 3440 px the HUD sits in a 2730 px band centred on the crosshair; the canvas still fills the screen.

`hud.show()` becomes `this.root.classList.add('on')` instead of `style.display='block'` (hud.js:47) so the screens sibling stack is never affected.

### G.3 Breakpoints

Only two, both about vertical room, not width:

```css
@media (max-height: 700px){
  #ud-controls{ display:none; }                 /* the hint row is the first thing to go */
  #ud-receipts{ top:26%; }
  #ud-toasts{ top:18%; }
}
@media (max-width: 1100px){
  #ud-receipts{ right:var(--ud-gutter); top:44%; }   /* stop colliding with the ledger */
  #ud-nav{ min-width:calc(300px * var(--ud-scale)); }
  #ud-nav .ud-nav__side{ display:none; }             /* altitude folds into the zone line */
}
```
Below 1100 px the altitude readout moves into `.ud-nav__mid` as a suffix on the destination line — `setAlt` writes to whichever node is visible, resolved once in `applyScale()`.

Desktop-first per the standing decision; no touch handling, no pointer-coarse branch.

### G.4 Overflow discipline

- `html,body{ overflow:hidden }` stays (index.html:10). The page must never scroll.
- `.ud-sheet{ max-height:88vh; overflow-y:auto; overscroll-behavior:contain }` — results tables scroll inside the sheet.
- `.ud-res__tbl` wraps in `<div style="overflow-x:auto">` for long consignment names.
- `#ud-controls` wraps (§D.11); `white-space:nowrap` is deleted.
- Every fixed-width panel gets `max-width: calc(100vw - var(--ud-gutter) * 2)`.

---

## H) ACCESSIBILITY

### H.1 Measured contrast (WCAG 2.1, computed, not estimated)

| Pair | Ratio | Verdict |
|---|---|---|
| `--ud-ink-900 #1B1710` on `--ud-paper-100 #F7F1E3` | **15.98:1** | AAA all sizes |
| `--ud-ink-700 #3A2F20` on paper-100 | 11.4:1 | AAA |
| `--ud-ink-500 #6B5C45` on paper-100 | **5.73:1** | AA body, AAA large |
| `--ud-ink-300 #9A8B72` on paper-100 | 2.95:1 | **rules and hairlines only — never text** |
| `--ud-ink-red #A32B22` on paper-100 | 6.33:1 | AA body |
| `--ud-brand #E2552F` on paper-100 | 3.35:1 | **≥18.66 px bold only** (wordmark, primary button) |
| `--ud-screen-text #E7F0FF` on `#0A0F1A` | 16.7:1 | AAA |
| `--ud-screen-dim #8FB0DD` on `#0A0F1A` | 6.9:1 | AA body |
| `--ud-gold #FFD166` on `#0A0F1A` | 13.3:1 | AAA |
| `--ud-sig-ink` on `--ud-sig-yellow #F2B01E` | 9.96:1 | AAA |
| `--ud-ok #2F7DBE` on paper-100 | 3.89:1 | meter fill (needs 3:1) ✓, **not text** |
| `--ud-warn #E8A21C` on paper-100 | 1.94:1 | **meter fill only** — text uses `--ud-warn-ink #8A5A08` at 5.21:1 |
| `--ud-bad #C03221` on paper-100 | 5.01:1 | AA body |

Targets: **4.5:1 for all body text, 3:1 for large text and all meaningful non-text (meter fills, needle, rule weights).** The three tokens that fail body text (`ink-300`, `brand`, `warn`) have documented usage limits above; enforce them in review.

### H.2 Colourblind-safe state palette

Green is not used for state anywhere. The ramp is **blue → amber → red**, which separates under protanopia and deuteranopia by hue *and* by lightness (L\* ≈ 51 / 72 / 42 — no two adjacent states share a lightness band). Tritanopia keeps blue/red separation; amber vs red is carried by lightness.

Four redundant channels on every state indicator (§D.1): word, percentage, countable tick fill, hatch pattern. A greyscale screenshot of the HUD is fully readable — that is the acceptance test.

The chain/streak indicator uses a stamp outline, not a fire emoji. The manifest uses ink checkmarks, not colour.

### H.3 ARIA and live regions

| Region | Attributes | Why |
|---|---|---|
| `#ud-toasts` | `role="status" aria-live="polite" aria-atomic="false"` | non-urgent narration; polite so it never interrupts |
| `#ud-alert` | `role="alert" aria-live="assertive"` | hazard warnings must interrupt |
| `#ud-fault` | `role="alert"` | boot failure |
| `#ud-cond-meter`, `#ud-shake-meter` | `role="meter" aria-valuemin/max/now aria-valuetext` | `aria-valuetext="72 percent, scuffed"` carries the band name |
| `#ud-score` | `<output>` with `aria-live="off"` | count-up would spam SR; the delivery toast already announces the gain |
| `#ud-receipts` | `aria-hidden="true"` | duplicate of the toast; suppress |
| `#ud-nav` | `aria-label="Navigation"`, values not live | changes 60×/s; announcing is useless |
| `#ud-pause`, `#ud-results`, `#ud-settings` | `role="dialog" aria-modal="true" aria-labelledby` | modal semantics |
| `.ud-mark svg` | `aria-hidden="true" focusable="false"` | decorative, and `focusable` matters for IE-era SVG focus bugs in some AT |

`aria-valuenow` updates are gated by the same memoisation as the visual write, so a stationary meter produces zero AT churn.

### H.4 Focus management

```css
:focus-visible{ outline:none; box-shadow:var(--ud-sh-focus); }
.ud-sheet :focus-visible{ scroll-margin:var(--ud-s7); }
```

Rules, implemented in `Hud.showScreen(name)` / `hideScreen(name)`:

1. On open: store `this._focusReturn = document.activeElement`, then focus the sheet's first `.ud-btn`.
2. Focus trap: `keydown` on the dialog, `Tab`/`Shift+Tab` wrap across `dialog.querySelectorAll('button:not([disabled]), [tabindex]:not([tabindex="-1"])')`.
3. `Escape` inside settings closes settings and returns focus to the pause sheet's first button; `Escape` inside pause calls `resume()`.
4. On close: `this._focusReturn?.focus?.()`; when returning to gameplay, focus `renderer.domElement` (give it `tabindex="-1"`) so subsequent keystrokes are not swallowed by a stale focus on a now-hidden button.
5. Nothing inside `#hud` is ever focusable — every element there is `pointer-events:none` and has no tabindex. The status chips are read-only precisely so this stays true.
6. `#ud-title-start` receives focus when the title screen appears, so Enter starts the shift without a mouse.

### H.5 Motion and other prefs

- `prefers-reduced-motion` handled in §F.3, plus a manual `FORCE` override in settings that must win over the OS setting.
- No `prefers-contrast` branch — the base palette already clears AAA on the two surfaces that carry 95% of the text.
- `user-select:none` stays on `body` (index.html:11) but is lifted on the results sheet: `#ud-results .ud-sheet{ user-select:text }` so a player can copy their statement.
- Every interactive target is ≥ 44×28 px at `--ud-scale:0.82` (`.ud-btn` at 0.82 is 46×31 px; `.ud-seg button` is 44×24 px — bump `.ud-seg button` padding to `var(--ud-s3) var(--ud-s5)` to reach 44×30).

---

## I) WHERE THE CSS LIVES

### I.1 Decision

**Move to a single file `src/ui/ud.css`, imported once from `src/main.js` line 15.** Keep a ~30-line critical shell inline in `index.html`.

```js
// src/main.js, new line 15 (after the Hud import)
import './ui/ud.css';
```

One file, not three. Vite emits exactly one stylesheet regardless of how many sources feed it, so splitting buys navigation convenience and costs `@import` ordering risk plus a second place for the token block to drift out of sync with its consumers. Keep the `@font-face` block, the `:root` token block, components, and screens in that order in one ~950-line file with `/* ===== */` section banners.

### I.2 Interaction with the CI check

`.github/workflows/deploy.yml:73` asserts the served HTML **contains** `assets/index-` and **does not contain** `src/main.js`.

Moving the CSS out is safe and in fact strengthens the check. `vite build` extracts imported CSS to `dist/assets/index-<hash>.css` and injects `<link rel="stylesheet" crossorigin href="./assets/index-<hash>.css">` into `dist/index.html`. That link itself matches `assets/index-`, so the grep now has two independent witnesses instead of one. The negative condition is unaffected — nothing about a CSS import reintroduces the literal `src/main.js` into the built HTML.

**The one real risk is the reverse:** leaving the CSS inline while adding webfonts would force `url('/fonts/…')` absolute paths that break under the project-path Pages URL, which `verify.mjs:20` (`requestfailed`) would catch only if the suite ran against the deployed site — and it does not, CI only curls the HTML. That is the concrete argument for moving the CSS into the Vite graph: **it is the only way the font URLs get rewritten correctly for `base:'./'`.**

### I.3 The critical shell that stays inline

Replaces index.html:8-175 entirely. In production the CSS `<link>` is render-blocking so there is no FOUC; this shell exists for `npm run dev`, where Vite injects CSS via JS and would otherwise flash unstyled markup for a frame, and to make the boot screen paint before the bundle parses.

```html
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;overflow:hidden;background:#070B14}
  body{font-family:'Courier New',ui-monospace,monospace;color:#FFD166;user-select:none}
  #app{position:fixed;inset:0}
  canvas{display:block}
  :root{--ud-scale:1}
  #hud{display:none}
  [hidden]{display:none!important}
  #ud-boot{position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:#070B14}
  #ud-boot .ud-boot__term{width:min(520px,90vw);padding:28px;
    background:linear-gradient(180deg,#111A2C,#0A0F1A);border:1px solid rgba(150,190,255,.22);border-radius:4px}
</style>
```

Note `[hidden]{display:none!important}` — required because `.ud-screenview` sets `display:grid`, which would otherwise beat the `hidden` attribute's UA `display:none`.

### I.4 Deleted from index.html

Every rule at index.html:15-174 goes. The IDs `#title-screen`, `#title-cover`, `#title-bottom`, `#title-start`, `#title-controls`, `#title-loading`, `#hud-top-left`, `#hud-top-right`, `#hud-target`, `#hud-banner`, `#hud-hint`, `#pop-holder`, `#toast-holder`, `#slip`, `#vignette-damage`, `.panel`, `.bar`, `.bar-wrap`, `.bar-label`, `.score-pop`, `.toast` are all retired. **`src/main.js:143-145,150` reference four of those IDs directly and must be updated in the same commit** or boot throws on a null `.style`.

---

## J) HUD API — complete surface

```js
// src/ui/hud.js
export class Hud {
  static STAMP_IMPACT_MS = 150;

  constructor()                        // grabs ~40 refs, applyScale(), reads prefers-reduced-motion

  // ---- UNCHANGED SIGNATURES (30 call sites across 5 files — do not touch) ----
  show()
  toast(text, small = false)
  banner(textOrNull)                   // now memoised; splits on ' · '
  setTimer(secLeftOrNull)              // memoised
  setPackage(name, note, hasShake = false)
  setCondition(pct)                    // memoised + band + aria-valuetext
  setShake(pct)                        // memoised
  setScore(n)                          // count-up preserved; instant under reduced motion
  setDeliveries(n)
  setChain(chain)
  scorePop(lines)                      // now renders a receipt
  setAlt(y, zoneName)                  // memoised; writes into #ud-nav
  setTarget(relBearing, dist, name)    // memoised; 0.6° needle threshold
  showSlip(num, def, targetName)       // textContent only, no innerHTML
  hideSlip()
  damageFlash()

  // ---- NEW ----
  stamp(kindId, { sub, at, rot, quiet } = {})
  setTracking(str)
  setShift({ index, done, total })
  setStatus({ quality, lang, music })
  setFps(n)                            // ≤4 Hz, caller-throttled
  setHint(rows)
  setLockHint(on)
  boot(msgKey, pct)
  fault(message)
  results(data)                        // see §E.4 contract
  showScreen(name)                     // 'title'|'pause'|'results'|'settings'|'fault'
  hideScreen(name)
  bindMenu({ onStart, onResume, onAbandon, onNextShift, onQuit, onQuality, onLang, onMusic, onMotion })
  setLang(code)                        // applies the dictionary to every [data-i18n]
  t(key)                               // lookup; returns key when missing
  applyScale()
  reduced()                            // bool
}
```

### J.1 Bilingual hook (mechanism only — copy is another workstream)

Every static string in the markup carries `data-i18n="key"`. `setLang(code)` does one pass:

```js
setLang(code) {
  this.lang = code;
  const d = DICT[code] ?? DICT.en;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const v = d[el.dataset.i18n];
    if (v != null) el.textContent = v;
  }
  for (const el of document.querySelectorAll('[data-i18n-aria]')) {
    const v = d[el.dataset.i18nAria]; if (v != null) el.setAttribute('aria-label', v);
  }
  document.documentElement.lang = code;
  this.setStatus({ lang: code.toUpperCase() });
  this._relabelDynamic();     // re-renders band words, stamp labels, manifest tooltips
}
```

`DICT` is imported from whatever the bilingual workstream produces (`src/ui/i18n.js`, default export `{ en:{}, de:{} }`). `Hud.t(key)` is the runtime lookup used for band words and stamp labels. **Dynamic gameplay strings (toasts, package names, spot names) are not in scope for this mechanism** — those live in `packages.js`/`deliveries.js`/`director.js` and the bilingual workstream owns how they get keyed. The `data-i18n` pass covers chrome only.

`document.documentElement.lang` must be updated so hyphenation and AT pronunciation follow.

---

## K) THINGS THAT WILL BREAK — flagged

### K.1 Would break `scripts/verify.mjs` if done naively

| Risk | Mitigation (mandatory) |
|---|---|
| **Auto-pause on `pointerlockchange`** — headless never acquires lock, so `document.pointerLockElement` is permanently `null`; a naive handler pauses the game on frame 1 and every subsequent assertion (`verify.mjs:32-388`) fails. | The `hadLock` guard in §E.7. Pause fires only on a `true → false` transition. |
| **`requestPointerLock()` promise rejection** — Chrome 113+ returns a Promise; an unhandled rejection becomes a `pageerror`, and `verify.mjs:19` fails the suite. Currently latent because `main.js:157` fires from a non-gesture `page.evaluate`. | Always `const p = el.requestPointerLock?.(); if (p?.catch) p.catch(()=>{})`, inside `try/catch`. Never pass an options object (`{unadjustedMovement}` throws `NotSupportedError` on Firefox). |
| **Dangling `@font-face url()`** — a missing woff2 is a `requestfailed`, and `verify.mjs:20` exits 2. | Either commit all three woff2 files, or delete the three `url()` `@font-face` blocks. No half state. |
| **`#title-screen` click-to-start** at main.js:146 with `{once:true}` — adding buttons to the title makes SETTINGS start the game. | Bind to `#ud-title-start` only. |
| **`window.__game.start`** (main.js:290) — `verify.mjs:30` calls it directly. | `startGame` keeps its name and signature; the new `hideScreen('title')` call must tolerate the screen already being hidden. |
| **New key bindings** — `verify.mjs` drives `w`, `a`, `d`, `Space`, and synthesises `KeyboardEvent{code:'Space'}` at line 293. | Only `Escape` is added. No collision. Do not bind `Tab`, `P`, `R`, or `Enter` globally. |
| **`main.js:143-145,150`** reference `#title-loading`, `#title-start`, `#title-controls`, `#title-screen`, all deleted. | Update in the same commit or `boot()` throws on `null.style`, which lands in the `.catch` at main.js:270 and `verify.mjs:25` times out waiting for `state === 'title'`. |
| **`hud.show()` changing from `style.display` to a class** — nothing external reads it, but `#hud` must default to `display:none` in the critical shell so the boot screen is not overlaid. | Included in §I.3. |
| **Screenshots** — `verify.mjs` writes `shot-title.png`, `shot-spawn.png`, etc. | Only the images change; no assertion reads them. Safe. |

### K.2 ctx architecture

Nothing here introduces an event bus or a state class. Two additions to the existing pattern:

1. **`hud.ctx = ctx;`** — one line after main.js:121, because `showSlip` needs `zoneAt(deliveries.target.pos.y)` for the tracking prefix. This mirrors what every other subsystem already does (they all hold `this.ctx`); the Hud is currently the only one that does not, and it is the reason the tracking number cannot be derived without it. If the implementer objects, the fallback is `showSlip(num, def, targetName, zoneKey = 'meadow')` with `packages.js:489` passing `zoneAt(deliveries.target.pos.y).key` — a signature change at exactly one call site. Either is acceptable; the back-reference is fewer moving parts.

2. **`ctx.hud.setFps(fps)`** at main.js:267 — the `fps` EMA is a module-local at main.js:116 and is not on `ctx`. Pushing it to the Hud is one line and avoids adding `ctx.fps`. The quality-tier workstream will likely want `ctx.fps` anyway; if they add it, `setFps` becomes redundant and should be deleted then, not now.

### K.3 Cross-workstream overlaps

| Overlap | Owner | This spec's contract |
|---|---|---|
| Shift structure, results data, pause semantics | game-design workstream | `hud.results(data)` shape in §E.4; `hud.setShift({index,done,total})`. UI renders whatever it is handed; it computes nothing. |
| German copy | bilingual workstream | `data-i18n` attribute pass + `Hud.t(key)` + a `DICT` default export. Keys used by this spec are listed inline in the markup. |
| Quality tiers / auto-downgrade | perf workstream | `hud.setStatus({quality})` for the chip, `#ud-quality` segmented control emits `onQuality(tier)` via `bindMenu`. The Hud stores nothing and applies nothing. |
| Colour grading / bloom / palette | art-direction workstream | One hard coupling: **`--ud-gold` must stay `#FFD166`** to match `0xffd166` used by the beacon (deliveries.js:89,96,101,104), the depot ring (packages.js:110), and gold particles. If the art workstream retunes that hex, this token moves with it. |
| SFX at the stamp impact | audio workstream | `sfx.thud(0.7)` at `Hud.STAMP_IMPACT_MS`; a dedicated `sfx.stamp()` would be better if they add one. |

### K.4 Pre-existing bugs surfaced while reading

1. **`director.js:134` writes the banner every fixed step** (60 Hz) while an event is live and cargo is carried — 60 `textContent` writes/second, each forcing a style recalculation over a 3D canvas. Fixed by the memoised `banner()` in §D.4 without touching `director.js`.
2. **`hud.js:139` uses `innerHTML`** with `def.name` / `def.note`. Static constants today, so not exploitable, but it becomes live the moment strings are data-driven for German. Replaced with `textContent`.
3. **`hud.js:70`** toggles `.crit` on `pct <= 25 && pct > 0` while `setCondition` recomputes the gradient string on every call — three string allocations per damage event. Absorbed by the band memoisation.
4. **`index.html:127` `white-space:nowrap`** on `#hud-hint` overflows below ~1180 px viewport width. Fixed in §D.11.
5. **`index.html:52` `backdrop-filter: blur(3px)`** on every `.panel` — the most expensive line in the stylesheet, running over a live WebGL composite. Removed everywhere except the pause/results scrim.
6. Unrelated to UI but noticed: `playwright` is used by `scripts/verify.mjs:2` and is not declared in `package.json`. Not this workstream's to fix; mentioning it because adding fonts means someone will touch `package.json` and could fold it in.

### K.5 Implementation order

1. `src/ui/brand.js` + `src/ui/ud.css` (tokens + primitives only) — nothing renders yet.
2. `index.html`: critical shell + full new markup, all screens `hidden`.
3. `src/ui/hud.js`: rewrite with the unchanged-signature methods first. Game is playable and correct at this point; only the new screens are dead.
4. `src/main.js`: the eight patch points in §E.7. Run `npm run build && npm run preview && node scripts/verify.mjs` — must be green here, before any screen work.
5. Stamps, receipts, waybill, boot/fault screens.
6. Pause/results/settings + focus trap.
7. Fonts last, as a separate commit, so a font regression is bisectable.
