import * as THREE from 'three';
import { zoneAt } from '../world/terrain.js';

// Delivery spots climb the mountain: one per run up the difficulty ladder,
// finishing on the summit island. After that, endless mode rolls high spots.
const SPOT_TS = [0.12, 0.22, 0.33, 0.45, 0.56, 0.68, 0.8, 0.92];

const SPOT_NAMES = [
  'Hermit Hut', 'Lumber Post', 'Owl Watchtower', 'Cliffside Cottage',
  'Wind Shrine', 'Ice Fisher Camp', 'Yeti Outpost', 'Stormgate',
  'The Summit Court',
];

export class Deliveries {
  constructor(ctx) {
    this.ctx = ctx;
    this.completed = 0;
    this.score = 0;
    this.spots = [];
    this.target = null;
    this.pickupTime = 0;
    this._tmp = new THREE.Vector3();
    this._buildSpots();
    this._buildBeacon();
    this._chooseTarget();
  }

  _buildSpots() {
    const { terrain, scene } = this.ctx;
    const hutMat = new THREE.MeshStandardMaterial({ color: 0x9c6b3f, flatShading: true });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xc94f4f, flatShading: true });

    SPOT_TS.forEach((t, i) => {
      const pp = terrain.pathPoint(t);
      // Nudge to the inner side of the path so the pad sits beside the road.
      const inner = 1 - (pp.width + 4) / Math.hypot(pp.x, pp.z);
      const x = pp.x * inner, z = pp.z * inner;
      const y = terrain.heightAt(x, z);
      this.spots.push({ pos: new THREE.Vector3(x, y, z), name: SPOT_NAMES[i], moving: null });

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
      name: SPOT_NAMES[SPOT_NAMES.length - 1],
      moving: isl,
    });
  }

  _buildBeacon() {
    const { scene } = this.ctx;
    this.beacon = new THREE.Group();
    this.pad = new THREE.Mesh(
      new THREE.CylinderGeometry(2.4, 2.7, 0.35, 8),
      new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0xcf8f1e, emissiveIntensity: 0.8, flatShading: true }),
    );
    this.column = new THREE.Mesh(
      new THREE.CylinderGeometry(1.8, 2.4, 90, 8, 1, true),
      // fog:false so the beacon stays visible from the far side of the mountain
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false, fog: false }),
    );
    this.column.position.y = 35;
    this.light = new THREE.PointLight(0xffd166, 60, 30);
    this.light.position.y = 3;
    this.beacon.add(this.pad, this.column, this.light);
    scene.add(this.beacon);
  }

  _chooseTarget() {
    let idx;
    if (this.completed < this.spots.length) idx = this.completed;
    else idx = 3 + Math.floor(Math.random() * (this.spots.length - 3)); // endless: upper mountain only
    this.target = this.spots[idx];
    this.beacon.position.copy(this.target.pos);
  }

  currentTargetName() {
    return this.target?.name ?? '???';
  }

  onPackagePicked() {
    this.pickupTime = performance.now();
    const alt = Math.round(this.target.pos.y);
    this.ctx.hud.toast(`Deliver to: ${this.target.name} (ALT ${alt} m)`, false);
  }

  onPackageLost() {
    this.score = Math.max(0, this.score - 50);
    this.ctx.hud.setScore(this.score);
  }

  _deliver(pkg) {
    const { hud, sfx, particles, packages } = this.ctx;
    pkg.delivered = true;
    const conditionPct = pkg.def.fragile ? pkg.condition : 100;
    const heightBonus = Math.round(this.target.pos.y * 2);
    const elapsed = (performance.now() - this.pickupTime) / 1000;
    const par = 40 + this.target.pos.y * 1.4;
    const speedBonus = Math.max(0, Math.round((par - elapsed) * 3));
    const gained = Math.round((100 + heightBonus) * (0.3 + 0.7 * conditionPct / 100)) + speedBonus;
    this.score += gained;
    this.completed++;

    this._tmp.copy(this.beacon.position).add(new THREE.Vector3(0, 1.5, 0));
    particles.confetti(this._tmp);
    sfx.jingle();
    hud.setScore(this.score);
    hud.setDeliveries(this.completed);
    hud.toast(`✅ DELIVERED! +${gained}`, false);
    if (conditionPct < 50) hud.toast(`…in ${Math.round(conditionPct)}% condition. They noticed.`, true);
    else if (speedBonus > 60) hud.toast(`⚡ Speed bonus +${speedBonus}!`, true);
    hud.hideSlip();

    packages.remove(pkg);
    this._chooseTarget();
    hud.toast(`Next pickup at the depot. It gets worse.`, true);
    this.ctx.director.onDelivery(this.completed);
  }

  fixedUpdate(dt, t) {
    // Beacon follows moving targets (summit island) and pulses.
    if (this.target.moving) {
      this.beacon.position.copy(this.target.moving.group.position).y += 1.0;
    }
    this.column.material.opacity = 0.3 + Math.sin(t * 2.5) * 0.08;
    this.pad.rotation.y += dt * 0.6;

    const pkg = this.ctx.packages.current;
    if (!pkg || pkg.delivered || !pkg.carried) return;
    const p = pkg.body.translation();
    const b = this.beacon.position;
    const dxz = Math.hypot(p.x - b.x, p.z - b.z);
    const dy = Math.abs(p.y - b.y);
    if (dxz < 3.4 && dy < 4.5) this._deliver(pkg);
  }

  // HUD guidance: bearing + distance from the player to the beacon.
  update() {
    const { hud, player, camera } = this.ctx;
    const p = player.body.translation();
    const b = this.beacon.position;
    const dist = Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z);
    const worldBearing = Math.atan2(b.x - p.x, b.z - p.z);
    const camBearing = Math.atan2(camera.position.x - p.x, camera.position.z - p.z);
    let rel = worldBearing - camBearing + Math.PI;
    hud.setTarget(rel, dist, this.target.name);
    hud.setAlt(p.y, zoneAt(p.y).name);
  }
}
