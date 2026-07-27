import * as THREE from 'three';
import { zoneAt } from '../world/terrain.js';
import { OBJ } from '../art/palette.js';
// `tr`, not `t`: fixedUpdate(dt, t) already binds t to the game clock, and a
// shadowed import fails at runtime as "t is not a function", not at build time.
import { t as tr } from '../ui/i18n.js';

// Delivery spots climb the mountain: one per run up the difficulty ladder,
// finishing on the summit island. After that, endless mode rolls high spots.
const SPOT_TS = [0.12, 0.22, 0.33, 0.45, 0.56, 0.68, 0.8, 0.92];

const SPOT_KEYS = [
  'spot.hermit', 'spot.lumber', 'spot.owl', 'spot.cottage',
  'spot.shrine', 'spot.icefisher', 'spot.yeti', 'spot.stormgate',
  'spot.court',
];

export class Deliveries {
  constructor(ctx) {
    this.ctx = ctx;
    this.completed = 0;
    this.score = 0;
    this.chain = 0;         // consecutive clean deliveries → payout multiplier
    this.spots = [];
    this.target = null;
    this.pickupTime = 0;
    this._tmp = new THREE.Vector3();
    this._shockT = 0;
    this._buildSpots();
    this._buildBeacon();
    this._chooseTarget();
  }

  // The cap is a requisition effect, so it lives in exactly one place and the
  // HUD is handed the same number - patch only the logic and the HUD lies.
  get chainCap() { return this.ctx.meta?.eff('chainCap') ?? 4; }
  get chainMult() { return 1 + 0.5 * Math.min(this.chain, this.chainCap); }

  // Reset for a new manifest. Score is per-shift revenue, not a lifetime total.
  onShiftStart() {
    this.completed = 0;
    this.score = 0;
    this.chain = 0;
    this._chooseTarget();
    this.ctx.hud.setScore(0);
    this.ctx.hud.setDeliveries(0);
    this.ctx.hud.setChain(0, this.chainCap);
    this.ctx.packages.rollNext(0);
  }

  breakChain(reasonKey) {
    if (this.chain === 0) return;
    this.chain = 0;
    this.ctx.hud.setChain(0, this.chainCap);
    this.ctx.hud.toast('toast.chainbroken', { reason: tr(reasonKey) }, { small: true });
  }

  // Flat bonus (close calls, hazard pay, combos) — chain-multiplied.
  addBonus(amount, key, params) {
    const gained = Math.round(amount * this.chainMult);
    this.score += gained;
    this.ctx.hud.setScore(this.score);
    this.ctx.hud.scorePop([{ key, params, amount: gained }]);
  }

  _buildSpots() {
    const { terrain, scene } = this.ctx;
    const hutMat = new THREE.MeshStandardMaterial({ color: OBJ.timberMid, flatShading: true });
    const roofMat = new THREE.MeshStandardMaterial({ color: OBJ.liveryBody, flatShading: true });

    SPOT_TS.forEach((t, i) => {
      const pp = terrain.pathPoint(t);
      // Nudge to the inner side of the path so the pad sits beside the road.
      const inner = 1 - (pp.width + 4) / Math.hypot(pp.x, pp.z);
      const x = pp.x * inner, z = pp.z * inner;
      const y = terrain.heightAt(x, z);
      this.spots.push({ pos: new THREE.Vector3(x, y, z), nameKey: SPOT_KEYS[i], moving: null });

      // A tiny hut marks each drop-off.
      const hut = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 3), hutMat);
      base.position.y = 1.1;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.6, 4), roofMat);
      roof.position.y = 3;
      roof.rotation.y = Math.PI / 4;
      hut.add(base, roof);
      hut.position.set(x + 3.4, y, z);
      hut.traverse((o) => { o.castShadow = true; });
      scene.add(hut);
    });

    // Final spot: the summit island (it moves — beacon follows).
    const isl = terrain.summitIsland;
    this.spots.push({
      pos: isl.base.clone().add(new THREE.Vector3(0, 1.2, 0)),
      nameKey: SPOT_KEYS[SPOT_KEYS.length - 1],
      moving: isl,
    });
  }

  _buildBeacon() {
    const { scene } = this.ctx;
    // Delivery shockwave: an expanding gold ring at the pad.
    this.shock = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.18, 6, 28),
      new THREE.MeshBasicMaterial({ color: OBJ.emBeacon, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.shock.rotation.x = Math.PI / 2;
    scene.add(this.shock);
    this.beacon = new THREE.Group();
    this.pad = new THREE.Mesh(
      new THREE.CylinderGeometry(2.4, 2.7, 0.35, 8),
      new THREE.MeshStandardMaterial({ color: OBJ.emBeacon, emissive: OBJ.emBeaconDeep, emissiveIntensity: 0.8, flatShading: true }),
    );
    this.column = new THREE.Mesh(
      new THREE.CylinderGeometry(1.8, 2.4, 90, 8, 1, true),
      // fog:false so the beacon stays visible from the far side of the mountain
      new THREE.MeshBasicMaterial({ color: OBJ.emBeacon, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false, fog: false }),
    );
    this.column.position.y = 35;
    this.light = new THREE.PointLight(OBJ.emBeacon, 60, 30);
    this.light.position.y = 3;
    this.beacon.add(this.pad, this.column, this.light);
    scene.add(this.beacon);
  }

  _chooseTarget() {
    this.returning = false;
    // A manifest line names its own drop-off. Without a shift (endless test
    // mode) fall back to the original ladder-then-random behaviour.
    const line = this.ctx.shift?.currentLine();
    let idx;
    if (line) idx = line.spotIndex;
    else if (this.completed < this.spots.length) idx = this.completed;
    else idx = 3 + Math.floor(Math.random() * (this.spots.length - 3)); // endless: upper mountain only
    this.target = this.spots[idx];
    this.beacon.position.copy(this.target.pos);
  }

  currentTargetKey() {
    return this.target?.nameKey ?? 'spot.unknown';
  }

  onPackagePicked() {
    this.pickupTime = performance.now();
    const alt = Math.round(this.target.pos.y);
    this.ctx.hud.toast('toast.deliverto', { name: tr(this.target.nameKey), alt });
  }

  onPackageLost(golden = false) {
    const cost = Math.round((golden ? 300 : 50) * (this.ctx.meta?.eff('writeOffScale') ?? 1));
    this.score = Math.max(0, this.score - cost);
    this.ctx.hud.setScore(this.score);
    if (golden) this.ctx.hud.toast('toast.insurance', null, { small: true });
    this.breakChain('reason.lost');
    // The union rest break reissues the line instead of closing it — same
    // consignment, same drop-off, one more try.
    const reissued = this.ctx.shift?.onWrittenOff(false);
    if (!reissued && this.ctx.shift?.complete) { this.ctx.onShiftComplete?.(); return; }
    this.ctx.packages.rollNext(this.completed); // fresh roll — no golden reruns
    if (!reissued) this._chooseTarget();
    this._pushShift();
  }

  _pushShift() {
    const s = this.ctx.shift;
    this.ctx.hud.setShift(s && { index: s.index, done: s.done, total: s.total });
  }

  _deliver(pkg) {
    const { hud, sfx, particles, packages, player } = this.ctx;
    const conditionPct = pkg.def.fragile ? pkg.condition : 100;
    // REFUSED: below a quarter condition the recipient simply will not sign.
    // This is what gives the bottom of the condition bar a cliff instead of a
    // shrug, and it is the only reason the game ever asks you to go BACK DOWN.
    if (conditionPct < 25 && !pkg.refused) return this._refuse(pkg);
    pkg.delivered = true;
    const heightBonus = Math.round(this.target.pos.y * 2);
    const elapsed = (performance.now() - this.pickupTime) / 1000;
    const par = 40 + this.target.pos.y * 1.4;
    const speedBonus = Math.max(0, Math.round((par - elapsed) * 3));
    const airmail = player.parachute || (this._t - player.lastLaunchT < 4) || pkg.thrownT > 0;
    const goldMult = pkg.def.golden ? 3 : 1;

    // Chain: clean delivery extends it, a battered one breaks it.
    if (conditionPct >= 90) this.chain++;
    else if (conditionPct < 50) this.chain = 0;
    const mult = this.chainMult;

    const base = Math.round((100 + heightBonus) * (0.3 + 0.7 * conditionPct / 100));
    const gained = Math.round((base + speedBonus + (airmail ? 75 : 0)) * mult * goldMult);
    this.score += gained;
    this.completed++;

    // Itemized receipt, biggest dopamine first.
    const lines = [{ key: 'score.base', amount: base }];
    if (speedBonus > 0) lines.push({ key: 'score.speed', amount: speedBonus });
    if (airmail) lines.push({ key: 'score.airmail', amount: 75 });
    if (conditionPct < 100) lines.push({ key: 'score.condition', params: { pct: Math.round(conditionPct) } });
    if (mult > 1) lines.push({ key: 'score.chain', params: { mult: mult.toFixed(1) } });
    if (goldMult > 1) lines.push({ key: 'score.golden' });
    lines.push({ key: 'score.total', amount: gained });
    hud.scorePop(lines);

    // Ceremony: shockwave + double confetti + flash + tiny hitstop.
    this._tmp.copy(this.beacon.position).add(new THREE.Vector3(0, 1.5, 0));
    particles.confetti(this._tmp);
    particles.pops(this._tmp, OBJ.emBeacon);
    this.shock.position.copy(this.beacon.position).y += 0.4;
    this._shockT = 0.6;
    this.ctx.hitstop?.(0.09);
    this.ctx.shake?.(0.22);
    sfx.jingle();
    this.ctx.music?.fanfare();
    hud.setScore(this.score);
    hud.setDeliveries(this.completed);
    hud.setChain(this.chain, this.chainCap);
    hud.toast('toast.delivered', { n: gained });
    hud.stamp(pkg.def.golden ? 'golden' : conditionPct < 50 ? 'damaged' : 'delivered');
    if (conditionPct < 50) hud.toast('toast.deliveredrough', { pct: Math.round(conditionPct) }, { small: true });
    setTimeout(() => hud.hideSlip(), 1400); // let the stamp land on the waybill first

    packages.remove(pkg);
    this.ctx.shift?.onDelivered(gained, {
      clean: conditionPct >= 90, golden: !!pkg.def.golden, airmail,
      speed: speedBonus > 0, chain: this.chain,
    });
    this._pushShift();
    this.ctx.director.onDelivery(this.completed);
    if (this.ctx.shift?.complete) { this.ctx.onShiftComplete?.(); return; }
    packages.rollNext(this.completed);
    this._chooseTarget();
    hud.toast('toast.nextpickup', null, { small: true });
  }

  // The consignment is rejected at the door. It stays in your hands and the
  // beacon moves to the depot — carry it back down and the line closes as
  // REFUSED, for a fraction of the write-off.
  _refuse(pkg) {
    const { hud, sfx, packages } = this.ctx;
    pkg.refused = true;
    this.returning = true;
    hud.stamp('refused');
    hud.toast('toast.refused');
    hud.toast('toast.returntosender', null, { small: true });
    sfx.fail();
    this.breakChain('reason.refused');
    this.beacon.position.copy(packages.chutePos).y += 1.2;
    this.target = { pos: this.beacon.position.clone(), nameKey: 'spot.depot', moving: null };
  }

  _completeReturn(pkg) {
    const { hud, sfx, packages } = this.ctx;
    pkg.delivered = true;
    this.returning = false;
    const cost = Math.round(20 * (this.ctx.meta?.eff('writeOffScale') ?? 1));
    this.score = Math.max(0, this.score - cost);
    hud.setScore(this.score);
    hud.scorePop([{ key: 'score.refused', amount: -cost }]);
    hud.toast('toast.returned', null, { small: true });
    hud.hideSlip();
    sfx.pickup();
    packages.remove(pkg);
    const reissued = this.ctx.shift?.onWrittenOff(true);
    this._pushShift();
    if (!reissued && this.ctx.shift?.complete) { this.ctx.onShiftComplete?.(); return; }
    packages.rollNext(this.completed);
    this._chooseTarget();
  }

  fixedUpdate(dt, t) {
    this._t = t;
    // Beacon follows moving targets (summit island) and pulses.
    if (this.target.moving) {
      this.beacon.position.copy(this.target.moving.group.position).y += 1.0;
    }
    this.column.material.opacity = 0.3 + Math.sin(t * 2.5) * 0.08;
    this.pad.rotation.y += dt * 0.6;

    // Shockwave ring expand + fade.
    if (this._shockT > 0) {
      this._shockT -= dt;
      const k = 1 - this._shockT / 0.6;
      this.shock.scale.setScalar(1 + k * 8);
      this.shock.material.opacity = 0.8 * (1 - k);
    } else {
      this.shock.material.opacity = 0;
    }

    const pkg = this.ctx.packages.current;
    // Carried — or freshly thrown: yeet-to-deliver is a valid postal method.
    if (!pkg || pkg.delivered || (!pkg.carried && pkg.thrownT <= 0)) return;
    const p = pkg.body.translation();
    const b = this.beacon.position;
    const dxz = Math.hypot(p.x - b.x, p.z - b.z);
    const dy = Math.abs(p.y - b.y);
    if (dxz < 3.4 && dy < 4.5) {
      if (this.returning) { if (pkg.refused) this._completeReturn(pkg); }
      else this._deliver(pkg);
    }
  }

  // HUD guidance: bearing + distance from the player to the beacon.
  update() {
    const { hud, player, camera, packages } = this.ctx;
    const p = player.body.translation();
    const b = this.beacon.position;
    const dist = Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z);
    const worldBearing = Math.atan2(b.x - p.x, b.z - p.z);
    const camBearing = Math.atan2(camera.position.x - p.x, camera.position.z - p.z);
    let rel = worldBearing - camBearing + Math.PI;
    hud.setTarget(rel, dist, this.target.nameKey);
    hud.setAlt(p.y, zoneAt(p.y).nameKey);
    // Speed-bonus countdown while carrying.
    if (packages.current?.carried) {
      const par = 40 + this.target.pos.y * 1.4;
      const elapsed = (performance.now() - this.pickupTime) / 1000;
      hud.setTimer(par - elapsed);
    } else {
      hud.setTimer(null);
    }
  }
}
