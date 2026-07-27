// VPS — Vertical Parcel Service. The brand as data; this module builds no DOM.
//
// The acronym is language-invariant on purpose: wordmark, tracking prefix,
// stamps and favicon never change when the language flips, only the expansion
// line under them. That is how real logistics brands behave, and it means the
// most-repeated element on screen never needs re-measuring for German.

// Three ascending slashes (the climb) plus a taped parcel, pure geometry in
// currentColor — ink black on paper, glowing gold on screen, one asset, and it
// survives being 18 px tall.
export const MARK_SVG = `<svg viewBox="0 0 64 40" fill="currentColor" aria-hidden="true">
  <path d="M2 30 L10 30 L18 14 L10 14 Z"/>
  <path d="M14 30 L22 30 L32 8 L24 8 Z"/>
  <path d="M28 30 L36 30 L48 2 L40 2 Z"/>
  <rect x="44" y="18" width="18" height="16" rx="1.5"/>
  <rect x="44" y="24" width="18" height="3.2" opacity="0.55"/>
  <rect x="51.4" y="18" width="3.2" height="16" opacity="0.55"/>
</svg>`;

// Zone codes for the tracking number. Two letters, always uppercase, never
// localised — the same consignment prints the same number in both languages.
const ZONE_CODE = { meadow: 'MW', forest: 'PW', cliffs: 'WC', frozen: 'FF', summit: 'SS' };

// VPS-<ZZ><S>-<NNNN>-<C>, e.g. VPS-WC3-0042-K.
export function tracking(zoneKey, shiftIndex, serial) {
  const zz = ZONE_CODE[zoneKey] ?? 'XX';
  const s = (shiftIndex % 36).toString(36).toUpperCase();
  const n = String(serial % 10000).padStart(4, '0');
  const body = `${zz}${s}${n}`;
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += body.charCodeAt(i) * (i + 1);
  const check = String.fromCharCode(65 + (sum % 26));
  return `VPS-${zz}${s}-${n}-${check}`;
}

// Fake barcode as one repeating-linear-gradient. Seeded from the tracking
// string so a consignment always prints the same bars — a barcode that
// reshuffles on every render reads as decoration, not as a document.
export function barcodeCss(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const stops = [];
  let x = 0;
  for (let i = 0; i < 42; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    const w = 1 + ((h >>> 16) % 3);
    const ink = i % 2 === 0;
    stops.push(`${ink ? 'currentColor' : 'transparent'} ${x}px ${x + w}px`);
    x += w;
  }
  return `linear-gradient(90deg, ${stops.join(',')})`;
}

// SEVEN stamps, and no more. A stamp that shows up for something trivial stops
// being a reward — the whole device works because it is rationed.
// `tone` maps to a CSS class; `rot` is the deliberate wonk of a hand stamp.
export const STAMPS = {
  delivered: { key: 'stamp.delivered', tone: 'ok', rot: -7 },
  damaged: { key: 'stamp.damaged', tone: 'warn', rot: 5 },
  refused: { key: 'stamp.refused', tone: 'bad', rot: 9 },
  hazard: { key: 'stamp.hazard', tone: 'sig', rot: -4 },
  golden: { key: 'stamp.golden', tone: 'gold', rot: 3, oval: true },
  lost: { key: 'stamp.lost', tone: 'bad', rot: -11 },
  closed: { key: 'stamp.closed', tone: 'ink', rot: -2, oval: true },
};

// Performance ratings as corporate euphemism rather than letter grades. Read
// bottom-up: the first entry whose threshold the quota ratio clears wins.
export const RANKS = [
  { min: 1.35, key: 'rank.exemplary' },
  { min: 1.1, key: 'rank.commendable' },
  { min: 1.0, key: 'rank.satisfactory' },
  { min: 0.75, key: 'rank.review' },
  { min: 0, key: 'rank.pip' },
];

export function rankFor(ratio) {
  return RANKS.find((r) => ratio >= r.min) ?? RANKS[RANKS.length - 1];
}
