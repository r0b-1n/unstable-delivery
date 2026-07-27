// Merit Points and requisitions. Persisted, and the ONLY thing that survives a
// termination — losing your route back to shift one has to sting narratively
// without wiping the progression the player actually built.
//
// Effects are precomputed into `_eff` on load and on every purchase.
// controller.fixedUpdate reads eff() at 60 Hz and must never walk a table.

const STORE_KEY = 'vps.meta';
const VERSION = 1;

// BASE cost doubles per level: BASE · 2^level. `from` is the shift index the
// requisition unlocks at. Ten of these, not eighteen — a shop where most cards
// are noise teaches the player to stop reading the shop.
export const UNLOCKS = [
  { id: 'harness', group: 'equipment', levels: 3, base: 5, from: 1 },
  { id: 'boots', group: 'equipment', levels: 2, base: 6, from: 1 },
  { id: 'packaging', group: 'equipment', levels: 3, base: 8, from: 1 },
  { id: 'chute', group: 'equipment', levels: 2, base: 8, from: 2 },
  { id: 'seniority', group: 'certification', levels: 4, base: 5, from: 2 },
  { id: 'hazardGrade', group: 'certification', levels: 3, base: 6, from: 2 },
  { id: 'cablePass', group: 'certification', levels: 1, base: 10, from: 3 },
  { id: 'insurance', group: 'insurance', levels: 3, base: 6, from: 1 },
  { id: 'waiver', group: 'insurance', levels: 1, base: 14, from: 4 },
  { id: 'restBreak', group: 'union', levels: 1, base: 12, from: 4 },
];

const GROUPS = [
  { id: 'equipment', key: 'meta.group.equipment' },
  { id: 'certification', key: 'meta.group.certification' },
  { id: 'insurance', key: 'meta.group.insurance' },
  { id: 'union', key: 'meta.group.union' },
];

export class Meta {
  constructor() {
    this.mp = 0;
    this.owned = {};
    this.best = { shift: 0, revenue: 0 };
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
      // One version field, and a mismatch wipes. A migration framework for a
      // save file this small costs more than it can ever return.
      if (raw && raw.v === VERSION) {
        this.mp = raw.mp ?? 0;
        this.owned = raw.owned ?? {};
        this.best = raw.best ?? this.best;
      }
    } catch { /* corrupt or unavailable: start clean rather than crash boot */ }
    this._recompute();
  }

  save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ v: VERSION, mp: this.mp, owned: this.owned, best: this.best }));
    } catch { /* private browsing */ }
  }

  reset() {
    this.mp = 0;
    this.owned = {};
    this.best = { shift: 0, revenue: 0 };
    this._recompute();
    this.save();
  }

  level(id) { return this.owned[id] ?? 0; }
  cost(id) {
    const u = UNLOCKS.find((x) => x.id === id);
    return u ? u.base * Math.pow(2, this.level(id)) : Infinity;
  }

  award(mp) { this.mp += mp; this.save(); }

  buy(id) {
    const u = UNLOCKS.find((x) => x.id === id);
    if (!u || this.level(id) >= u.levels) return false;
    const c = this.cost(id);
    if (this.mp < c) return false;
    this.mp -= c;
    this.owned[id] = this.level(id) + 1;
    this._recompute();
    this.save();
    return true;
  }

  // Effect VALUES, not levels. Call sites read a number and apply it; none of
  // them needs to know what a level means.
  _recompute() {
    const L = (id) => this.level(id);
    this._eff = {
      carryDivisor: 60 + 20 * L('harness'),        // controller: mass slowdown
      fallThreshold: 17 + 3 * L('boots'),          // controller: knockdown floor
      impactScale: 1 - 0.12 * L('packaging'),      // packages: impact damage
      writeOffScale: 1 - 0.3 * L('insurance'),     // deliveries: write-off cost
      chainCap: 4 + L('seniority'),                // deliveries AND hud must agree
      chuteSteer: 8 + 3 * L('chute'),              // controller: glider authority
      hazardRate: 6 + 3 * L('hazardGrade'),        // director: hazard pay per second
      cableSpeed: L('cablePass') ? 1.35 : 1,       // cablecar
      cableCrawl: L('cablePass') ? 0.35 : 0.22,
      restBreak: L('restBreak'),                   // shift: one reissue per shift
      waiver: L('waiver'),                         // controller: respawn keeps the run
    };
  }

  eff(key) { return this._eff[key]; }

  snapshot() { return { mp: this.mp, owned: { ...this.owned } }; }

  screenData(shiftIndex) {
    return {
      mp: this.mp,
      groups: GROUPS.map((g) => ({
        key: g.key,
        items: UNLOCKS.filter((u) => u.group === g.id).map((u) => ({
          id: u.id,
          levels: u.levels,
          level: this.level(u.id),
          cost: this.cost(u.id),
          from: u.from,
          locked: shiftIndex < u.from,
        })),
      })),
    };
  }
}
