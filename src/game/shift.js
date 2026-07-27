import { PACKAGE_TYPES } from '../packages/packages.js';

// A shift is a MANIFEST of N consignments. It ends when the last line closes,
// and a line closes exactly twice: DELIVERED or WRITTEN OFF. Both already
// existed and were already the only terminal states, so the end condition
// costs nothing new.
//
// Time is a SCORING axis, never a terminator. The game already has a clock
// (the par timer); a second dominant clock makes the speed bonus unreadable,
// and a hard timer takes the most emotional object in the game out of the
// player's hands mid-carry.
//
// FAILURE IS SOFT. The shift always ends and always pays; "failed" means under
// quota. The whole comic register of this game rests on things going wrong
// being FUNNY — a hard game over would punish exactly the moments it
// celebrates and turn fragile cargo from a joke into a trap.

const MANIFEST_LEN = (n) => 3 + Math.min(n - 1, 5);          // 3,4,5,6,7,8,8…
const MAX_TYPE_IDX = (n) => Math.min(n, PACKAGE_TYPES.length - 1);
const QUOTA_SLACK = [1.0, 1.15, 1.3, 1.45, 1.6, 1.75];
const GOLDEN_CHANCE = (n) => (n < 3 ? 0 : n >= 5 ? 1 : 0.5);

export class Shift {
  constructor(ctx, index = 1, pipStreak = 0) {
    this.ctx = ctx;
    this.index = index;
    this.pipStreak = pipStreak;
    this.cursor = 0;
    this.revenue = 0;
    this.restBreakUsed = false;
    this.stats = {
      delivered: 0, writtenOff: 0, refused: 0, clean: 0, bestChain: 0,
      falls: 0, hazard: 0, speed: 0, airmail: 0, golden: 0, distance: 0, peak: 0,
    };
    this._build();
  }

  _build() {
    const n = this.index;
    const spots = this.ctx.deliveries.spots;
    const len = MANIFEST_LEN(n);
    const maxType = MAX_TYPE_IDX(n);
    const reach = Math.min(2 + n, spots.length); // shift 1 -> lower three, shift 7+ -> all of them
    this.manifest = [];
    for (let i = 0; i < len; i++) {
      // Line 1 is guaranteed to be the newest unlocked type — that is the beat
      // the briefing memo announces, and it has to actually happen.
      const typeIdx = i === 0 ? maxType : Math.floor(Math.random() * (maxType + 1));
      // Spots climb with the line index so a shift is a climb, not a shuffle —
      // but the REACH grows with the shift number. Spreading three lines over
      // all nine drop-offs sent shift 1 straight to the summit and put its
      // quota at 1039 instead of the ~500 the curve was designed around.
      const spotIndex = Math.min(Math.floor(((i + 1) / len) * reach), reach - 1);
      this.manifest.push({
        no: i + 1,
        defId: PACKAGE_TYPES[typeIdx].id,
        spotIndex,
        spotKey: spots[spotIndex].nameKey,
        golden: i > 0 && Math.random() < GOLDEN_CHANCE(n) / len,
        status: 'pending',
      });
    }
    if (this.manifest.length) this.manifest[0].status = 'transit';

    // The quota is DERIVED from the manifest, never hand-written, so it cannot
    // drift away from the real spot heights the way a hardcoded table would.
    const linePar = (l) => Math.round(100 + Math.round(spots[l.spotIndex].pos.y * 2)) * (l.golden ? 3 : 1);
    this.quota = Math.round(this.manifest.reduce((s, l) => s + linePar(l), 0) * QUOTA_SLACK[Math.min(n - 1, 5)]);
  }

  currentLine() { return this.manifest[this.cursor] ?? null; }
  get total() { return this.manifest.length; }
  get done() { return this.manifest.filter((l) => l.status !== 'pending' && l.status !== 'transit').length; }
  get complete() { return this.cursor >= this.manifest.length; }

  // 0 at clock-in, 1 when the last consignment closes. The light rig reads this
  // every frame; without it the sun sits at 0.35 forever and nobody notices.
  get shift01() { return this.total ? Math.min(this.done / this.total, 1) : 0; }

  _advance(status) {
    const line = this.currentLine();
    if (!line) return;
    line.status = status;
    this.cursor++;
    const next = this.currentLine();
    if (next) next.status = 'transit';
  }

  onDelivered(gained, meta = {}) {
    this.revenue += gained;
    this.stats.delivered++;
    if (meta.clean) this.stats.clean++;
    if (meta.golden) this.stats.golden++;
    if (meta.airmail) this.stats.airmail++;
    if (meta.speed) this.stats.speed++;
    this.stats.bestChain = Math.max(this.stats.bestChain, meta.chain ?? 0);
    this._advance('delivered');
  }

  // Returns true if the union rest break reissued the line instead of closing
  // it — the caller then keeps the same consignment rather than moving on.
  onWrittenOff(refused = false) {
    if (!refused && !this.restBreakUsed && this.ctx.meta?.eff('restBreak') > 0) {
      this.restBreakUsed = true;
      return true;
    }
    this.stats[refused ? 'refused' : 'writtenOff']++;
    this._advance(refused ? 'refused' : 'writtenOff');
    return false;
  }

  get met() { return this.revenue >= this.quota; }

  // Merit points: a good shift pays roughly 12 at index 1 and 31 at index 5;
  // a shift under quota still pays about 5, because a run that pays nothing is
  // a run the player replays instead of continuing.
  meritPoints() {
    const base = Math.round(this.revenue / 120);
    return Math.max(2, this.met ? base + 2 * this.index : Math.round(base * 0.4));
  }

  results() {
    const s = this.stats;
    return {
      index: this.index,
      quota: this.quota,
      revenue: this.revenue,
      met: this.met,
      mp: this.meritPoints(),
      verdictKey: this.met ? 'results.met' : this.pipStreak >= 2 ? 'results.terminated' : 'results.missed',
      stats: [
        { key: 'results.delivered', value: s.delivered },
        { key: 'results.clean', value: s.clean },
        { key: 'results.writtenoff', value: s.writtenOff },
        { key: 'results.refused', value: s.refused },
        { key: 'results.bestchain', value: `×${(1 + 0.5 * Math.min(s.bestChain, 4)).toFixed(1)}` },
        { key: 'results.falls', value: s.falls },
        { key: 'results.speed', value: s.speed },
        { key: 'results.airmail', value: s.airmail },
        { key: 'results.golden', value: s.golden },
        { key: 'results.hazard', value: Math.round(s.hazard) },
        { key: 'results.peak', value: `${Math.round(s.peak)} m` },
        { key: 'results.mp', value: this.meritPoints() },
      ],
    };
  }

  briefing() {
    const first = this.index === 1;
    const newType = MAX_TYPE_IDX(this.index) > MAX_TYPE_IDX(this.index - 1);
    return {
      index: this.index,
      quota: this.quota,
      manifest: this.manifest,
      memoKey: first ? 'brief.memo.first'
        : this.pipStreak > 0 ? 'brief.memo.pip'
          : newType ? 'brief.memo.newtype' : 'brief.memo.normal',
    };
  }
}
