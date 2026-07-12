import * as THREE from 'three';

// Interactive physics playground scattered along the route:
// bounce mushrooms, geyser vents, seesaw planks, elevator platforms,
// and knockable crate stacks at the stations.
export class Props {
  constructor(ctx) {
    this.ctx = ctx;
    this.mushrooms = [];
    this.geysers = [];
    this.elevators = [];
    this.seesaws = [];
    this._tmp = new THREE.Vector3();
    this._build();
  }

  _build() {
    const { terrain } = this.ctx;
    const path = (t) => {
      const p = terrain.pathPoint(t);
      return new THREE.Vector3(p.x, terrain.heightAt(p.x, p.z), p.z);
    };
    // Side-of-path helper: offset perpendicular to the route.
    const side = (t, dist) => {
      const p0 = terrain.pathPoint(t), p1 = terrain.pathPoint(t + 0.004);
      const dx = p1.x - p0.x, dz = p1.z - p0.z;
      const len = Math.hypot(dx, dz) || 1;
      const x = p0.x + (-dz / len) * dist, z = p0.z + (dx / len) * dist;
      return new THREE.Vector3(x, terrain.heightAt(x, z), z);
    };

    // --- Bounce mushrooms (Pinewood band, some higher up as rescue pads) ---
    for (const [t, off] of [[0.17, 5], [0.2, -6], [0.24, 0], [0.29, 6], [0.33, -5], [0.4, 7], [0.52, -6], [0.66, 6], [0.8, -5]]) {
      this._mushroom(side(t, off));
    }
    // A few placed under big drops as trampolines between path loops.
    for (const t of [0.22, 0.45, 0.7]) {
      const p = path(t);
      this._mushroom(new THREE.Vector3(p.x * 1.12, terrain.heightAt(p.x * 1.12, p.z * 1.12), p.z * 1.12), 1.6);
    }

    // --- Geysers (Windy Cliffs) — ride the steam to skip a loop ---
    for (const [t, off] of [[0.42, 3], [0.47, -3], [0.53, 0], [0.58, 4]]) {
      this._geyser(side(t, off));
    }

    // --- Seesaw planks ---
    for (const [t, off] of [[0.27, 4], [0.49, -4], [0.72, 4]]) {
      this._seesaw(side(t, off), terrain.pathPoint(t).angle);
    }

    // --- Elevator platforms: vertical shortcut lifts between loops ---
    this._elevator(side(0.36, 9), 26, 0);
    this._elevator(side(0.62, 9), 30, 2.1);

    // --- Loose crates at the depot to smash into ---
    const depot = path(0.015);
    this._crateStack(depot.clone().add(new THREE.Vector3(4, 0, 3)), 5);
    this._crateStack(side(0.3, 5), 3);
    this._crateStack(side(0.55, -5), 3);
  }

  _mushroom(pos, scale = 1) {
    const { scene, physics } = this.ctx;
    const R = physics.RAPIER;
    const g = new THREE.Group();
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45 * scale, 0.6 * scale, 1.4 * scale, 7),
      new THREE.MeshStandardMaterial({ color: 0xf2e7cf, flatShading: true }),
    );
    stem.position.y = 0.7 * scale;
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(1.5 * scale, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.5),
      new THREE.MeshStandardMaterial({ color: 0xff5d5d, flatShading: true, roughness: 0.7 }),
    );
    cap.scale.y = 0.62;
    cap.position.y = 1.35 * scale;
    const dots = new THREE.Mesh(
      new THREE.SphereGeometry(1.52 * scale, 6, 4, 0, Math.PI * 2, 0, Math.PI * 0.4),
      new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.4 }),
    );
    dots.scale.y = 0.62;
    dots.position.y = 1.4 * scale;
    g.add(stem, cap, dots);
    g.position.copy(pos);
    g.castShadow = true;
    scene.add(g);

    const body = physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z));
    physics.world.createCollider(
      R.ColliderDesc.cylinder(0.5 * scale, 1.45 * scale).setTranslation(0, 1.3 * scale, 0).setRestitution(0.2),
      body,
    );
    this.mushrooms.push({ group: g, pos: pos.clone(), capY: pos.y + 1.6 * scale, r: 1.6 * scale, scale, squish: 0 });
  }

  _geyser(pos) {
    const { scene, physics } = this.ctx;
    const R = physics.RAPIER;
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.8, 1.2, 8),
      new THREE.MeshStandardMaterial({ color: 0x9a8f7c, flatShading: true }),
    );
    rim.position.set(pos.x, pos.y + 0.3, pos.z);
    scene.add(rim);
    const body = physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y + 0.3, pos.z));
    physics.world.createCollider(R.ColliderDesc.cylinder(0.6, 2.5), body);
    this.geysers.push({ pos: pos.clone(), phase: Math.random() * 6, period: 4.2 + Math.random() * 1.6, active: 0 });
  }

  _seesaw(pos, angle) {
    const { scene, physics } = this.ctx;
    const R = physics.RAPIER;
    // Static fulcrum
    const ful = new THREE.Mesh(
      new THREE.ConeGeometry(0.8, 1.4, 5),
      new THREE.MeshStandardMaterial({ color: 0x8a5a2b, flatShading: true }),
    );
    ful.position.set(pos.x, pos.y + 0.7, pos.z);
    scene.add(ful);
    const fulBody = physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y + 0.7, pos.z));
    physics.world.createCollider(R.ColliderDesc.cone(0.7, 0.8), fulBody);

    // Dynamic plank on a revolute joint
    const plank = new THREE.Mesh(
      new THREE.BoxGeometry(7.5, 0.3, 1.7),
      new THREE.MeshStandardMaterial({ color: 0xa9743f, flatShading: true }),
    );
    plank.castShadow = plank.receiveShadow = true;
    scene.add(plank);
    const { body } = physics.addDynamic(
      plank,
      R.ColliderDesc.cuboid(3.75, 0.15, 0.85).setFriction(0.9),
      { pos: { x: pos.x, y: pos.y + 1.55, z: pos.z }, mass: 22, angularDamping: 0.6 },
    );
    body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle), true);
    const axis = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    const params = R.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: -0.85, z: 0 }, axis);
    physics.world.createImpulseJoint(params, fulBody, body, true);
    this.seesaws.push(body);
  }

  _elevator(pos, rise, phase) {
    const { scene, physics } = this.ctx;
    const R = physics.RAPIER;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(2.4, 2.1, 0.5, 8),
      new THREE.MeshStandardMaterial({ color: 0x8fd0e8, emissive: 0x1b5e77, emissiveIntensity: 0.5, flatShading: true }),
    );
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    const body = physics.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + 0.5, pos.z),
    );
    physics.world.createCollider(R.ColliderDesc.cylinder(0.25, 2.3).setFriction(1.0), body);
    this.elevators.push({ mesh, body, base: pos.clone().add(new THREE.Vector3(0, 0.5, 0)), rise, phase });
  }

  _crateStack(pos, n) {
    const { scene, physics } = this.ctx;
    const R = physics.RAPIER;
    const mat = new THREE.MeshStandardMaterial({ color: 0xb5814a, flatShading: true, roughness: 0.9 });
    for (let i = 0; i < n; i++) {
      const s = 0.45 + Math.random() * 0.25;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(s * 2, s * 2, s * 2), mat);
      mesh.castShadow = true;
      scene.add(mesh);
      const { body } = physics.addDynamic(
        mesh,
        R.ColliderDesc.cuboid(s, s, s).setFriction(0.7),
        { pos: { x: pos.x + (Math.random() - 0.5) * 1.4, y: pos.y + 0.6 + i * 1.1, z: pos.z + (Math.random() - 0.5) * 1.4 }, mass: 4 },
      );
      this.ctx.registerDynamic(body, 'crate');
    }
  }

  // Gameplay fields are applied to every registered dynamic body.
  fixedUpdate(dt, t) {
    const { dynamics, particles, sfx, player } = this.ctx;

    // Mushroom bounce: anything falling onto a cap gets launched.
    for (const m of this.mushrooms) {
      m.squish = Math.max(0, m.squish - dt * 4);
      m.group.scale.y = 1 - m.squish * 0.35;
      for (const d of dynamics) {
        const p = d.body.translation();
        const dx = p.x - m.pos.x, dz = p.z - m.pos.z;
        if (dx * dx + dz * dz > m.r * m.r) continue;
        const v = d.body.linvel();
        if (v.y < -1 && p.y > m.capY - 0.6 && p.y < m.capY + 1.6) {
          const launch = 17 + Math.min(-v.y * 0.35, 9);
          d.body.setLinvel({ x: v.x * 0.8, y: launch, z: v.z * 0.8 }, true);
          m.squish = 1;
          this._tmp.set(p.x, m.capY, p.z);
          particles.pops(this._tmp, 0xff5d5d);
          sfx.boing();
          if (d.kind === 'player') player.airborneBySomethingFun = true;
        }
      }
    }

    // Geysers: periodic steam columns that shove everything upward.
    for (const g of this.geysers) {
      const cycle = (t + g.phase) % g.period;
      g.active = cycle < 1.4 ? 1 - cycle / 1.4 : 0;
      if (g.active > 0) {
        this._tmp.set(g.pos.x + (Math.random() - 0.5), g.pos.y + 1, g.pos.z + (Math.random() - 0.5));
        particles.steam(this._tmp, 1 + g.active);
        if (cycle < dt * 2) {
          const pp = player.body.translation();
          const dist = Math.hypot(pp.x - g.pos.x, pp.z - g.pos.z);
          if (dist < 40) sfx.geyser();
        }
        for (const d of dynamics) {
          const p = d.body.translation();
          const dx = p.x - g.pos.x, dz = p.z - g.pos.z;
          const dy = p.y - g.pos.y;
          if (dx * dx + dz * dz < 6.5 && dy > -1 && dy < 16) {
            const m = d.body.mass();
            const falloff = 1 - dy / 18;
            d.body.applyImpulse({ x: 0, y: m * 60 * g.active * falloff * dt, z: 0 }, true);
            if (d.kind === 'player') player.airborneBySomethingFun = true;
          }
        }
      }
    }

    // Elevators: slow vertical loop, pausing at top and bottom.
    for (const e of this.elevators) {
      const cyc = (t * 0.14 + e.phase) % 2;
      let k;
      if (cyc < 0.42) k = cyc / 0.42;
      else if (cyc < 1) k = 1;
      else if (cyc < 1.42) k = 1 - (cyc - 1) / 0.42;
      else k = 0;
      const smooth = k * k * (3 - 2 * k);
      const y = e.base.y + smooth * e.rise;
      e.body.setNextKinematicTranslation({ x: e.base.x, y, z: e.base.z });
      e.mesh.position.set(e.base.x, y, e.base.z);
    }
  }
}
