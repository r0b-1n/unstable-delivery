import * as THREE from 'three';

const STATION_TS = [0.02, 0.28, 0.52, 0.76, 0.97];
const DROP = 3.55;       // cable point -> cabin centre
const GONDOLAS = 6;
const BASE_SPEED = 7.5;  // m/s along the cable

// A closed-loop cable up the mountain: the "up" line passes low over five
// station pads on the path; the return line runs higher and offset. Gondolas
// are kinematic bodies, so standing inside one carries you (and it sways).
export class CableCar {
  constructor(ctx) {
    this.ctx = ctx;
    this.stations = [];
    this.gondolas = [];
    this._humOn = false;
    this._build();
  }

  _build() {
    const { terrain, scene, physics } = this.ctx;
    const R = physics.RAPIER;

    // --- Stations: flat pads beside the path, cable passes 3.4 m above ---
    const padMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, flatShading: true, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xc94f4f, flatShading: true });
    const upPoints = [];
    STATION_TS.forEach((t, i) => {
      const pp = terrain.pathPoint(t);
      // Offset the pad to the outside of the spiral so it doesn't block the
      // road — but stay inside the carved blend zone and clamp to trail
      // height, or upper-mountain pads end up 20 m down the cliff face.
      const out = 1 + (pp.width + 3) / Math.hypot(pp.x, pp.z);
      const x = pp.x * out, z = pp.z * out;
      const y = Math.max(terrain.heightAt(x, z), pp.h - 3);

      const pad = new THREE.Mesh(new THREE.BoxGeometry(7, 0.8, 7), padMat);
      pad.position.set(x, y + 0.4, z);
      pad.receiveShadow = true;
      scene.add(pad);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(4.4, 1.6, 4), roofMat);
      roof.position.set(x, y + 8.4, z);
      roof.rotation.y = Math.PI / 4;
      scene.add(roof);
      for (const [px, pz] of [[-3, -3], [3, 3], [-3, 3], [3, -3]]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 7.6, 5), padMat);
        pole.position.set(x + px, y + 4.2, z + pz);
        scene.add(pole);
      }
      const body = physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, y + 0.4, z));
      physics.world.createCollider(R.ColliderDesc.cuboid(3.5, 0.4, 3.5).setFriction(0.9), body);

      // Cabin centre = cableY - DROP; floor top lands level with the pad top.
      const cableY = y + 0.8 + 4.4;
      upPoints.push(new THREE.Vector3(x, cableY, z));
      this.stations.push({ name: `Station ${i + 1}`, pos: new THREE.Vector3(x, y + 0.8, z), t, cableY });
    });

    // --- Closed cable loop: up line + elevated return line ---
    const pts = [];
    const clearance = (a, b, k, lift) => {
      const mid = a.clone().lerp(b, k);
      const ground = terrain.heightAt(mid.x, mid.z);
      mid.y = Math.max(mid.y, ground + 14 + lift);
      return mid;
    };
    for (let i = 0; i < upPoints.length; i++) {
      pts.push(upPoints[i]);
      if (i < upPoints.length - 1) {
        pts.push(clearance(upPoints[i], upPoints[i + 1], 0.33, 0));
        pts.push(clearance(upPoints[i], upPoints[i + 1], 0.66, 0));
      }
    }
    // Return line: reversed, pushed outward and raised.
    const ret = [...upPoints].reverse().map((p) => {
      const len = Math.hypot(p.x, p.z) || 1;
      const q = p.clone();
      q.x += (p.x / len) * 14;
      q.z += (p.z / len) * 14;
      q.y += 9;
      return q;
    });
    for (let i = 0; i < ret.length; i++) {
      pts.push(ret[i]);
      if (i < ret.length - 1) {
        pts.push(clearance(ret[i], ret[i + 1], 0.33, 9));
        pts.push(clearance(ret[i], ret[i + 1], 0.66, 9));
      }
    }
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.35);
    this.curve.arcLengthDivisions = 600;
    this.length = this.curve.getLength();

    const cableGeo = new THREE.TubeGeometry(this.curve, 400, 0.07, 4, true);
    const cable = new THREE.Mesh(cableGeo, new THREE.MeshStandardMaterial({ color: 0x2c3040, roughness: 0.5 }));
    scene.add(cable);

    // --- Pylons under the up-line midpoints ---
    const pylonMat = new THREE.MeshStandardMaterial({ color: 0x3a4258, flatShading: true });
    const upLineCount = upPoints.length * 3 - 2; // stations at i % 3 === 0
    for (let i = 1; i < upLineCount; i++) {
      if (i % 3 === 0) continue;
      const p = pts[i];
      // The mast stands BESIDE the cable line (radially outward) with an arm
      // reaching over — a mast on the line itself would impale every gondola.
      const len = Math.hypot(p.x, p.z) || 1;
      const mx = p.x + (p.x / len) * 3.0;
      const mz = p.z + (p.z / len) * 3.0;
      const ground = terrain.heightAt(mx, mz);
      const h = p.y + 0.6 - ground;
      const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, h, 6), pylonMat);
      pylon.position.set(mx, ground + h / 2, mz);
      pylon.castShadow = true;
      scene.add(pylon);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 3.4), pylonMat);
      arm.position.set((p.x + mx) / 2, p.y + 0.45, (p.z + mz) / 2);
      arm.lookAt(mx, p.y + 0.45, mz);
      scene.add(arm);
      const body = physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(mx, ground + h / 2, mz));
      physics.world.createCollider(R.ColliderDesc.cylinder(h / 2, 0.55), body);
    }

    // --- Gondolas ---
    for (let i = 0; i < GONDOLAS; i++) {
      this._gondola(i / GONDOLAS);
    }
  }

  _gondola(u0) {
    const { scene, physics } = this.ctx;
    const R = physics.RAPIER;
    const group = new THREE.Group();
    const cabMat = new THREE.MeshStandardMaterial({ color: 0xe0623d, flatShading: true, roughness: 0.6 });
    const cabMat2 = new THREE.MeshStandardMaterial({ color: 0xf5f0e6, flatShading: true, roughness: 0.7 });

    const floor = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.24, 2.2), cabMat);
    floor.position.y = -1.0;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.2, 2.4), cabMat);
    roof.position.y = 1.5; // tall interior — the capsule must never graze it
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, DROP - 1.5, 5), new THREE.MeshStandardMaterial({ color: 0x2c3040 }));
    arm.position.y = 1.5 + (DROP - 1.5) / 2;
    group.add(floor, roof, arm);
    // Low side walls — open enough to hop in and out (or fall out).
    const wallDefs = [
      [0, -0.55, 1.05, 2.6, 0.75, 0.12],
      [0, -0.55, -1.05, 2.6, 0.75, 0.12],
      [-1.25, -0.55, 0, 0.12, 0.75, 2.2],
      [1.25, -0.55, 0, 0.12, 0.75, 2.2],
    ];
    for (const [x, y, z, w, h, d] of wallDefs) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cabMat2);
      wall.position.set(x, y, z);
      group.add(wall);
    }
    group.traverse((o) => { o.castShadow = true; });
    scene.add(group);

    const body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
    const mk = (hx, hy, hz, x, y, z) =>
      physics.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(1.0), body);
    mk(1.3, 0.12, 1.1, 0, -1.0, 0);   // floor
    mk(1.4, 0.1, 1.2, 0, 1.5, 0);     // roof (standing on top: encouraged)
    mk(1.3, 0.38, 0.06, 0, -0.55, 1.05);
    mk(1.3, 0.38, 0.06, 0, -0.55, -1.05);
    mk(0.06, 0.38, 1.1, -1.25, -0.55, 0);
    mk(0.06, 0.38, 1.1, 1.25, -0.55, 0);

    this.gondolas.push({ group, body, s: u0 * this.length, sway: 0, swayV: 0, phase: Math.random() * 6 });
  }

  _speedAt(pos) {
    // Crawl through stations so boarding is humane.
    let d = Infinity;
    for (const st of this.stations) {
      const dx = pos.x - st.pos.x, dz = pos.z - st.pos.z;
      d = Math.min(d, Math.hypot(dx, dz));
    }
    return BASE_SPEED * (0.22 + 0.78 * Math.min(d / 18, 1));
  }

  fixedUpdate(dt, t) {
    const { gust } = this.ctx;
    const q = new THREE.Quaternion();
    const qSway = new THREE.Quaternion();
    const euler = new THREE.Euler();

    for (const g of this.gondolas) {
      const u = (g.s % this.length) / this.length;
      const pos = this.curve.getPointAt(u);
      const tan = this.curve.getTangentAt(u);
      g.s += this._speedAt(pos) * dt;

      const yaw = Math.atan2(tan.x, tan.z);
      // Pendulum sway driven by wind gusts — VISUAL ONLY. The physics body
      // stays smooth so riders aren't rattled off.
      const target = Math.sin(t * 1.1 + g.phase) * 0.04 * (1 + gust * 2.5);
      g.swayV += (target - g.sway) * 6 * dt;
      g.swayV *= 0.985;
      g.sway += g.swayV;

      const c = { x: pos.x, y: pos.y - DROP, z: pos.z };
      euler.set(0, yaw, 0);
      q.setFromEuler(euler);
      g.body.setNextKinematicTranslation(c);
      g.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });

      euler.set(g.sway, yaw, g.sway * 0.6);
      qSway.setFromEuler(euler);
      g.group.position.set(c.x, c.y, c.z);
      g.group.quaternion.copy(qSway);
    }
  }

  update() {
    // Cable hum when the player is close to a gondola.
    const { player, sfx } = this.ctx;
    const pp = player.body.translation();
    let near = false;
    for (const g of this.gondolas) {
      const gp = g.group.position;
      if (Math.hypot(gp.x - pp.x, gp.y - pp.y, gp.z - pp.z) < 9) { near = true; break; }
    }
    if (near !== this._humOn) {
      this._humOn = near;
      sfx.cableHum(near);
    }
  }
}
