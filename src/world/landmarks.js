import * as THREE from 'three';
import { OBJ, bandOf } from '../art/palette.js';
import { rand2 } from './noise.js';
import { LAKE } from './dims.js';

// Ten fixed set pieces along the route.
//
// This is the reason the mountain is hand-built and not seeded per shift. A
// procedural slope is a place you are at; a rock arch you have to duck through
// is a place you have BEEN. Everything here exists so a courier can say "the
// quarry" and mean something, so a route can be learned, and so the eight
// drop-offs have anything to be between.
//
// The lake basin and the glacier cirque are carved into the height field
// itself; world/dims.js holds where, and terrain.lakeLevel holds the water
// level it derived from its own mean surface.

const MAT = {};
function mat(key, color, opts = {}) {
  return (MAT[key] ??= new THREE.MeshStandardMaterial({ color, flatShading: true, ...opts }));
}

export class Landmarks {
  constructor(ctx, terrain) {
    this.ctx = ctx;
    this.terrain = terrain;
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.falls = [];
    const R = ctx.physics.RAPIER;
    this.body = ctx.physics.world.createRigidBody(R.RigidBodyDesc.fixed());

    this._depot(0.02);
    this._tarn();
    this._forestTunnel(0.22);
    this._arch(0.34);
    this._quarry(0.45);
    this._cairns(0.56);
    this._glacier(0.66);
    this._weatherStation(0.80);
    this._shrine(0.95);
  }

  // --- helpers ------------------------------------------------------------

  _at(t, off = 0) {
    const terrain = this.terrain;
    const p0 = terrain.pathPoint(t), p1 = terrain.pathPoint(t + 0.003);
    const dx = p1.x - p0.x, dz = p1.z - p0.z;
    const len = Math.hypot(dx, dz) || 1;
    const x = p0.x + (-dz / len) * off, z = p0.z + (dx / len) * off;
    return {
      x, z, y: terrain.heightAt(x, z),
      yaw: Math.atan2(dx, dz),          // along the trail
      width: p0.width,
    };
  }

  _add(geo, material, x, y, z, { yaw = 0, pitch = 0, roll = 0, shadow = true, solid = null } = {}) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.rotation.set(pitch, yaw, roll);
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    this.group.add(m);
    if (solid) {
      const R = this.ctx.physics.RAPIER;
      const q = new THREE.Quaternion().setFromEuler(m.rotation);
      this.ctx.physics.world.createCollider(
        solid.setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }), this.body);
    }
    return m;
  }

  // --- 0.02  The valley depot -------------------------------------------

  _depot(t) {
    const R = this.ctx.physics.RAPIER;
    const wall = mat('wall', OBJ.timberMid, { roughness: 0.9 });
    const roof = mat('roof', OBJ.liveryBody);
    const hutGeo = new THREE.BoxGeometry(5, 3.4, 4.2);
    const roofGeo = new THREE.ConeGeometry(4.2, 2.2, 4);
    for (let i = 0; i < 5; i++) {
      const p = this._at(t + i * 0.006, (i % 2 ? 1 : -1) * (13 + i * 3));
      const yaw = rand2(i, 5) * 6;
      this._add(hutGeo, wall, p.x, p.y + 1.7, p.z, {
        yaw, solid: R.ColliderDesc.cuboid(2.5, 1.7, 2.1),
      });
      this._add(roofGeo, roof, p.x, p.y + 4.5, p.z, { yaw: yaw + Math.PI / 4 });
    }
    // A company sign, because the company signs everything.
    const post = this._at(t, 12);
    this._add(new THREE.BoxGeometry(0.3, 5, 0.3), wall, post.x, post.y + 2.5, post.z, {});
    this._add(new THREE.BoxGeometry(6, 1.6, 0.25), mat('sign', OBJ.liveryTrim),
      post.x, post.y + 5.4, post.z, { yaw: post.yaw });
  }

  // --- 0.10  Tarn, waterfall and a log bridge ----------------------------

  _tarn() {
    const level = this.terrain.lakeLevel;
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(LAKE.r * 0.94, 40),
      new THREE.MeshStandardMaterial({
        color: OBJ.sea, roughness: 0.2, metalness: 0.15, transparent: true, opacity: 0.88,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(LAKE.x, level + 0.35, LAKE.z);
    water.receiveShadow = true;
    this.group.add(water);

    // The fall itself: six thin slabs sliding down a scarp, each looping on its
    // own phase. Six moving boxes read as falling water at any speed a courier
    // is ever travelling, and cost nothing a shader would have cost.
    const dir = Math.atan2(LAKE.z, LAKE.x);
    const topR = Math.hypot(LAKE.x, LAKE.z) - LAKE.r * 0.9;
    const tx = Math.cos(dir) * topR, tz = Math.sin(dir) * topR;
    const ty = this.terrain.heightAt(tx, tz);
    const foam = mat('foam', 0xdff1ff, { transparent: true, opacity: 0.75, roughness: 0.4 });
    const drop = Math.max(ty - level, 8);
    for (let i = 0; i < 6; i++) {
      const w = 1.4 + rand2(i, 2.2) * 1.6;
      const m = this._add(new THREE.BoxGeometry(w, drop * 0.42, 0.7), foam,
        tx + Math.cos(dir + 1.57) * (i - 2.5) * 2.4, 0,
        tz + Math.sin(dir + 1.57) * (i - 2.5) * 2.4, { yaw: dir, shadow: false });
      this.falls.push({ mesh: m, top: ty, bottom: level, phase: rand2(i, 9) });
    }
    this._add(new THREE.CylinderGeometry(LAKE.r * 0.22, LAKE.r * 0.3, 0.6, 16), foam,
      tx + Math.cos(dir) * 6, level + 0.5, tz + Math.sin(dir) * 6, { shadow: false });

    // The trail crosses the outflow on a felled trunk.
    const R = this.ctx.physics.RAPIER;
    const b = this._at(0.105, 0);
    const log = new THREE.CylinderGeometry(0.55, 0.62, 14, 7);
    log.rotateZ(Math.PI / 2);
    this._add(log, mat('log', OBJ.timberDark), b.x, b.y + 0.4, b.z,
      { yaw: b.yaw + Math.PI / 2, solid: R.ColliderDesc.cuboid(7, 0.5, 0.6) });
  }

  // --- 0.22  Pinewood tunnel ---------------------------------------------

  // The stand is dense enough here that the canopy meets over the trail. The
  // scatter pass keeps a clearance corridor along the route by design; this is
  // the one place that rule is deliberately broken, with trees leaning in from
  // both verges so the light drops and the route narrows visually.
  _forestTunnel(t) {
    const crown = new THREE.ConeGeometry(2.4, 8.5, 5);
    const trunk = new THREE.CylinderGeometry(0.3, 0.5, 3.2, 5);
    const cMat = mat('tunnelCrown', bandOf('forest').veg, { roughness: 0.9 });
    const tMat = mat('tunnelTrunk', OBJ.timberDark, { roughness: 0.95 });
    for (let i = 0; i < 26; i++) {
      const tt = t + (i / 26) * 0.055;
      const sideSign = i % 2 ? 1 : -1;
      const p = this._at(tt, sideSign * (this.terrain.pathPoint(tt).width + 2.2));
      const lean = sideSign * (0.22 + rand2(i, 3) * 0.16);
      const sc = 1.0 + rand2(i, 7) * 0.5;
      this._add(trunk, tMat, p.x, p.y + 1.5 * sc, p.z, { roll: lean * 0.5, shadow: false });
      this._add(crown, cMat, p.x - Math.sin(lean) * 5 * sc, p.y + 5.4 * sc, p.z, { roll: lean, shadow: true });
    }
  }

  // --- 0.34  The arch -----------------------------------------------------

  _arch(t) {
    const R = this.ctx.physics.RAPIER;
    const rock = mat('archRock', bandOf('cliffs').rock, { roughness: 1 });
    const p = this._at(t, 0);
    const w = this.terrain.pathPoint(t).width + 4;
    const H = 16;
    for (const s of [-1, 1]) {
      const px = p.x + Math.cos(p.yaw) * s * w;
      const pz = p.z - Math.sin(p.yaw) * s * w;
      const py = this.terrain.heightAt(px, pz);
      this._add(new THREE.CylinderGeometry(3.6, 5.2, H, 6), rock, px, py + H / 2, pz,
        { yaw: rand2(s, 4) * 6, solid: R.ColliderDesc.cylinder(H / 2, 4.2) });
    }
    // The span. A flattened, slightly rotated box reads as a natural bridge far
    // better than a torus arc, and it is one draw call.
    this._add(new THREE.BoxGeometry(w * 2 + 10, 4.4, 9), rock, p.x, p.y + H + 1.4, p.z,
      { yaw: p.yaw + Math.PI / 2, roll: 0.05, solid: R.ColliderDesc.cuboid(w + 5, 2.2, 4.5) });
  }

  // --- 0.45  The quarry ---------------------------------------------------

  _quarry(t) {
    const R = this.ctx.physics.RAPIER;
    const rock = mat('archRock', bandOf('cliffs').rock, { roughness: 1 });
    const timber = mat('wall', OBJ.timberMid, { roughness: 0.9 });
    const base = this._at(t, 26);
    // Cut benches, stepping back into the hillside.
    for (let i = 0; i < 4; i++) {
      const p = this._at(t + i * 0.004, 24 + i * 9);
      this._add(new THREE.BoxGeometry(26 - i * 3, 5, 12), rock,
        p.x, this.terrain.heightAt(p.x, p.z) + 2 + i * 4, p.z,
        { yaw: p.yaw, solid: R.ColliderDesc.cuboid(13 - i * 1.5, 2.5, 6) });
    }
    // Timber scaffolding against the face.
    for (let i = 0; i < 10; i++) {
      const ox = (i % 5) * 4 - 8, oy = ((i / 5) | 0) * 6;
      this._add(new THREE.BoxGeometry(0.4, 12, 0.4), timber,
        base.x + Math.cos(base.yaw) * ox, base.y + 6 + oy, base.z - Math.sin(base.yaw) * ox, { shadow: true });
    }
    this._add(new THREE.BoxGeometry(24, 0.5, 3), timber, base.x, base.y + 12, base.z, { yaw: base.yaw + Math.PI / 2 });
  }

  // --- 0.56  Cairns on the ridge -----------------------------------------

  _cairns(t) {
    const stone = mat('cairn', bandOf('frozen').rock, { roughness: 1 });
    const geo = new THREE.DodecahedronGeometry(0.8, 0);
    for (let i = 0; i < 7; i++) {
      const p = this._at(t + i * 0.012, (i % 2 ? 1 : -1) * (this.terrain.pathPoint(t).width + 3));
      for (let s = 0; s < 4; s++) {
        const k = 1 - s * 0.18;
        this._add(geo, stone, p.x, p.y + 0.6 + s * 1.1, p.z, { yaw: rand2(i, s) * 6 }).scale.setScalar(k);
      }
    }
  }

  // --- 0.66  The glacier --------------------------------------------------

  // Sits in the cirque the height field scoops out of the north-east flank.
  // Seracs are just tilted boxes; on ice, at speed, in a whiteout, that is
  // exactly as much fidelity as anyone gets to see.
  _glacier(t) {
    const R = this.ctx.physics.RAPIER;
    const ice = mat('ice', OBJ.hazardIce, { roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.93 });
    const deep = mat('deepIce', 0x7fb9e6, { roughness: 0.3 });
    for (let i = 0; i < 22; i++) {
      const tt = t + (rand2(i, 1.3) - 0.5) * 0.09;
      const off = (rand2(i, 4.4) - 0.35) * 70;
      const p = this._at(tt, off);
      if (Math.abs(off) < this.terrain.pathPoint(tt).width + 5) continue;
      if (this.terrain.slopeAt(p.x, p.z) > 1.3) continue;   // no seracs glued to a wall
      const w = 3 + rand2(i, 8) * 7, h = 4 + rand2(i, 2) * 9;
      this._add(new THREE.BoxGeometry(w, h, w * 0.8), i % 3 ? ice : deep,
        p.x, p.y + h * 0.35, p.z,
        {
          yaw: rand2(i, 6) * 6, roll: (rand2(i, 11) - 0.5) * 0.5,
          solid: R.ColliderDesc.cuboid(w / 2, h / 2, w * 0.4),
        });
    }
  }

  // --- 0.80  Storm weather station ---------------------------------------

  _weatherStation(t) {
    const R = this.ctx.physics.RAPIER;
    const wall = mat('wall', OBJ.timberMid, { roughness: 0.9 });
    const steel = mat('steel', OBJ.pylon ?? 0x3a4258, { roughness: 0.6 });
    const p = this._at(t, 14);
    this._add(new THREE.BoxGeometry(6, 3.6, 5), wall, p.x, p.y + 1.8, p.z,
      { yaw: p.yaw, solid: R.ColliderDesc.cuboid(3, 1.8, 2.5) });
    this._add(new THREE.ConeGeometry(4.6, 1.8, 4), mat('roof', OBJ.liveryBody),
      p.x, p.y + 4.4, p.z, { yaw: p.yaw + Math.PI / 4 });
    // Mast plus guys. The guy wires are what sell "it is windy here".
    this._add(new THREE.CylinderGeometry(0.16, 0.22, 18, 5), steel, p.x, p.y + 9, p.z, {});
    this.dish = this._add(new THREE.CylinderGeometry(2.2, 2.2, 0.4, 12), steel, p.x, p.y + 18.4, p.z,
      { pitch: 0.5, shadow: true });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const gx = p.x + Math.cos(a) * 9, gz = p.z + Math.sin(a) * 9;
      const gy = this.terrain.heightAt(gx, gz);
      const mid = new THREE.Vector3((p.x + gx) / 2, (p.y + 16 + gy) / 2, (p.z + gz) / 2);
      const len = Math.hypot(gx - p.x, gy - (p.y + 16), gz - p.z);
      const wire = this._add(new THREE.CylinderGeometry(0.05, 0.05, len, 3), steel,
        mid.x, mid.y, mid.z, { shadow: false });
      wire.lookAt(gx, gy, gz);
      wire.rotateX(Math.PI / 2);
    }
  }

  // --- 0.95  The summit shrine -------------------------------------------

  _shrine(t) {
    const stone = mat('cairn', bandOf('frozen').rock, { roughness: 1 });
    const p = this._at(t, 8);
    this._add(new THREE.CylinderGeometry(4.2, 5.4, 1.2, 8), stone, p.x, p.y + 0.6, p.z, {});
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this._add(new THREE.BoxGeometry(0.7, 3.4, 0.7), stone,
        p.x + Math.cos(a) * 3.2, p.y + 2.9, p.z + Math.sin(a) * 3.2, { yaw: a });
    }
    this._add(new THREE.OctahedronGeometry(1.5, 0),
      mat('shrineGem', OBJ.emCrystalBody, { emissive: OBJ.emCrystal, emissiveIntensity: 1.6, roughness: 0.3 }),
      p.x, p.y + 5.6, p.z, {});
  }

  update(dt, t) {
    // Slabs of falling water loop from lip to pool on staggered phases.
    for (const f of this.falls) {
      const span = f.top - f.bottom;
      const k = (t * 0.55 + f.phase) % 1;
      f.mesh.position.y = f.top - k * span - span * 0.2;
    }
    if (this.dish) this.dish.rotation.y += dt * 0.25;
  }
}
