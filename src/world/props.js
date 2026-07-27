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
    this.pendulums = [];
    this.planks = [];
    this.rollers = [];
    this._rollTimer = 5;
    this._tmp = new THREE.Vector3();
    this.boingCombo = 0;    // chained launches without settling on the ground
    this._groundT = 0;
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

    // --- Pendulum logs sweeping across the trail ---
    for (const t of [0.445, 0.56, 0.7, 0.83]) this._pendulum(t);

    // --- Chasms: crumbling planks over most, a rescue mushroom at the bottom
    // of each so falling in is a detour, not a death sentence ---
    const GAPS = terrain.constructor.GAPS;
    GAPS.forEach((g, i) => {
      if (i % 3 !== 2) this._plank(g.t); // every third gap is plank-less: jump it
      const pp = terrain.pathPoint(g.t);
      const y = terrain.heightAt(pp.x, pp.z);
      this._mushroom(new THREE.Vector3(pp.x, y, pp.z), 1.25);
    });
  }

  _pendulum(t) {
    const { terrain, scene, physics } = this.ctx;
    const R = physics.RAPIER;
    const p0 = terrain.pathPoint(t);
    const p1 = terrain.pathPoint(t + 0.004);
    const y = terrain.heightAt(p0.x, p0.z);
    // Swing plane is ACROSS the trail: axis = path direction.
    const dir = new THREE.Vector3(p1.x - p0.x, 0, p1.z - p0.z).normalize();
    const anchor = new THREE.Vector3(p0.x, y + 7.5, p0.z);

    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5230, flatShading: true, roughness: 0.9 });
    // Frame: two A-posts + crossbar.
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 7.5, 5), wood);
      post.position.set(p0.x + dir.x * s * 2.2, y + 3.75, p0.z + dir.z * s * 2.2);
      post.castShadow = true;
      scene.add(post);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 4.8, 5), wood);
    bar.position.copy(anchor);
    bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    scene.add(bar);

    // The log itself: kinematic, swung by code, hits like a truck.
    const group = new THREE.Group();
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5.2, 4), new THREE.MeshStandardMaterial({ color: 0x4a3826 }));
    rope.position.y = 2.6;
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 3.4, 7), wood);
    log.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    group.add(rope, log);
    group.traverse((o) => { o.castShadow = true; });
    scene.add(group);
    const body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    physics.world.createCollider(
      R.ColliderDesc.cylinder(1.7, 0.78).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.4),
      body,
    );
    this.pendulums.push({
      group, body, anchor, dir,
      len: 5.2, amp: 1.05, omega: 1.15 + Math.random() * 0.25, phase: Math.random() * 6,
      swingAxis: dir.clone(),
    });
  }

  _plank(gapT) {
    const { terrain, scene, physics } = this.ctx;
    const R = physics.RAPIER;
    const p = terrain.pathPoint(gapT);
    const before = terrain.pathPoint(gapT - 0.006);
    const after = terrain.pathPoint(gapT + 0.006);
    const a = new THREE.Vector3(before.x, before.h, before.z);
    const b = new THREE.Vector3(after.x, after.h, after.z);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const len = a.distanceTo(b) + 1;
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    const pitch = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 0.22, len),
      new THREE.MeshStandardMaterial({ color: 0x9a7040, flatShading: true, roughness: 0.95 }),
    );
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, yaw, 0, 'YXZ'));
    const body = physics.world.createRigidBody(
      R.RigidBodyDesc.fixed().setTranslation(mid.x, mid.y, mid.z)
        .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }),
    );
    const col = physics.world.createCollider(R.ColliderDesc.cuboid(1.0, 0.11, len / 2).setFriction(0.9), body);
    mesh.position.copy(mid);
    mesh.quaternion.copy(quat);
    this.planks.push({
      mesh, body, col, mid: mid.clone(), quat: quat.clone(), len,
      state: 'solid', timer: 0, respawn: 0,
    });
  }

  _spawnRoller(t) {
    const { terrain, scene, physics } = this.ctx;
    const R = physics.RAPIER;
    const p0 = terrain.pathPoint(t);
    const p1 = terrain.pathPoint(t - 0.004); // downhill direction
    const y = terrain.heightAt(p0.x, p0.z);
    const across = new THREE.Vector3(p1.x - p0.x, 0, p1.z - p0.z).normalize().cross(new THREE.Vector3(0, 1, 0));
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 0.85, 3.6, 8),
      new THREE.MeshStandardMaterial({ color: 0x6e4a2b, flatShading: true, roughness: 0.9 }),
    );
    mesh.castShadow = true;
    scene.add(mesh);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), across);
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(p0.x, y + 2, p0.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setCcdEnabled(true);
    const body = physics.world.createRigidBody(desc);
    physics.world.createCollider(R.ColliderDesc.cylinder(1.8, 0.85).setFriction(0.9).setMass(90), body);
    physics.track(body, mesh);
    const dl = new THREE.Vector3(p1.x - p0.x, 0, p1.z - p0.z).normalize();
    body.setLinvel({ x: dl.x * 6, y: 0, z: dl.z * 6 }, true);
    this.ctx.registerDynamic(body, 'roller');
    this.rollers.push({ mesh, body, ttl: 16 });
    this.ctx.sfx.wobble();
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
    // The revolute axis is interpreted in BOTH bodies' local frames, so the
    // fulcrum must carry the same yaw as the plank or the hinge fights itself.
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle);
    const fulBody = physics.world.createRigidBody(
      R.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y + 0.7, pos.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    );
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
    body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    // Shared local frame → hinge across the plank's length is local Z.
    const params = R.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: -0.85, z: 0 }, { x: 0, y: 0, z: 1 });
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

    // Boing-combo bookkeeping: settle on real ground for a beat → reset.
    const ppc = player.body.translation();
    if (player.grounded && player.groundIsTerrain) this._groundT += dt;
    else this._groundT = 0;
    if (this._groundT > 0.9) this.boingCombo = 0;

    // Mushroom bounce: anything falling onto a cap gets launched.
    for (const m of this.mushrooms) {
      m.squish = Math.max(0, m.squish - dt * 4);
      m.cool = Math.max(0, (m.cool ?? 0) - dt);
      m.group.scale.y = 1 - m.squish * 0.35;
      for (const d of dynamics) {
        const p = d.body.translation();
        const dx = p.x - m.pos.x, dz = p.z - m.pos.z;
        if (dx * dx + dz * dz > m.r * m.r) continue;
        const v = d.body.linvel();
        if (v.y < -1 && p.y > m.capY - 0.6 && p.y < m.capY + 1.6 && m.cool <= 0) {
          m.cool = 0.3;
          const isPlayer = d.kind === 'player';
          let launch = 17 + Math.min(-v.y * 0.35, 9);
          let pitch = 1;
          if (isPlayer) {
            // Chained boings launch higher and squeak higher.
            this.boingCombo++;
            this._groundT = 0;
            launch *= 1 + 0.1 * Math.min(this.boingCombo - 1, 5);
            pitch = 1 + 0.13 * Math.min(this.boingCombo - 1, 6);
            player.airborneBySomethingFun = true;
            player.lastLaunchT = t;
            if (this.boingCombo >= 3) {
              this.ctx.deliveries.addBonus(10 * this.boingCombo, `🍄 BOING ×${this.boingCombo}`);
            }
          }
          d.body.setLinvel({ x: v.x * 0.8, y: launch, z: v.z * 0.8 }, true);
          m.squish = 1;
          this._tmp.set(p.x, m.capY, p.z);
          particles.pops(this._tmp, 0xff5d5d);
          // Unattended debris bouncing three loops away must not spam audio.
          const dp = Math.hypot(ppc.x - m.pos.x, ppc.y - m.pos.y, ppc.z - m.pos.z);
          if (dp < 45) sfx.boing(pitch);
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
        if (cycle < dt) { // exactly one tick per eruption
          const dist = Math.hypot(ppc.x - g.pos.x, ppc.z - g.pos.z);
          if (dist < 40) sfx.geyser();
        }
        for (const d of dynamics) {
          const p = d.body.translation();
          const dx = p.x - g.pos.x, dz = p.z - g.pos.z;
          const dy = p.y - g.pos.y;
          const isPlayer = d.kind === 'player';
          // Parachute = thermal glider: the steam grips it harder, higher.
          const chute = isPlayer && player.parachute;
          const reach = chute ? 30 : 16;
          if (dx * dx + dz * dz < 6.5 && dy > -1 && dy < reach) {
            const m = d.body.mass();
            const falloff = 1 - dy / (reach + 2);
            d.body.applyImpulse({ x: 0, y: m * 60 * (chute ? 2.1 : 1) * g.active * falloff * dt, z: 0 }, true);
            if (isPlayer) {
              player.airborneBySomethingFun = true;
              player.lastLaunchT = t;
            }
          }
        }
      }
    }

    // Pendulum logs: kinematic swing across the trail.
    for (const pd of this.pendulums) {
      const a = Math.sin(t * pd.omega + pd.phase) * pd.amp;
      // Swing in the plane perpendicular to the trail (axis = trail direction).
      const swing = new THREE.Quaternion().setFromAxisAngle(pd.swingAxis, a);
      const offset = new THREE.Vector3(0, -pd.len, 0).applyQuaternion(swing);
      const pos = pd.anchor.clone().add(offset);
      pd.body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
      pd.group.position.copy(pos);
      pd.group.quaternion.copy(swing);
      // visual rope points back to the anchor
      pd.group.children[0].quaternion.identity();
    }

    // Crumbling planks: stand on one and the clock starts.
    const pp = player.body.translation();
    for (const pl of this.planks) {
      if (pl.state === 'solid') {
        const d = Math.hypot(pp.x - pl.mid.x, pp.z - pl.mid.z);
        if (d < pl.len / 2 && pp.y > pl.mid.y - 1 && pp.y < pl.mid.y + 2.2 && player.grounded) {
          pl.state = 'cracking';
          pl.timer = 0.7;
          sfx.crack(0.7);
        }
      } else if (pl.state === 'cracking') {
        pl.timer -= dt;
        pl.mesh.position.copy(pl.mid).x += (Math.random() - 0.5) * 0.06;
        pl.mesh.position.z += (Math.random() - 0.5) * 0.06;
        if (pl.timer <= 0) {
          pl.state = 'falling';
          pl.respawn = 9;
          pl.body.setBodyType(this.ctx.physics.RAPIER.RigidBodyType.Dynamic, true);
          pl.body.setLinvel({ x: 0, y: -2, z: 0 }, true);
          this.ctx.physics.track(pl.body, pl.mesh);
          sfx.shatter();
        }
      } else if (pl.state === 'falling') {
        pl.respawn -= dt;
        if (pl.respawn <= 0) {
          // Never materialize the fixed plank inside the courier.
          if (Math.hypot(pp.x - pl.mid.x, pp.y - pl.mid.y, pp.z - pl.mid.z) < 3.5) {
            pl.respawn = 1;
            continue;
          }
          pl.state = 'solid';
          this.ctx.physics.untrack(pl.body);
          pl.body.setBodyType(this.ctx.physics.RAPIER.RigidBodyType.Fixed, true);
          pl.body.setTranslation({ x: pl.mid.x, y: pl.mid.y, z: pl.mid.z }, true);
          pl.body.setRotation({ x: pl.quat.x, y: pl.quat.y, z: pl.quat.z, w: pl.quat.w }, true);
          pl.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          pl.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          pl.mesh.position.copy(pl.mid);
          pl.mesh.quaternion.copy(pl.quat);
        }
      }
    }

    // Rolling logs in the forest band: spawned uphill of the courier.
    const nearT = this.ctx.terrain._nearestPath(pp.x, pp.z).p.t;
    if (nearT > 0.13 && nearT < 0.38) {
      this._rollTimer -= dt;
      if (this._rollTimer <= 0 && this.rollers.length < 3) {
        this._rollTimer = 6 + Math.random() * 5 - Math.min(this.ctx.director?.level ?? 0, 5) * 0.6;
        this._spawnRoller(Math.min(nearT + 0.03, 0.38));
      }
    }
    for (let i = this.rollers.length - 1; i >= 0; i--) {
      const r = this.rollers[i];
      r.ttl -= dt;
      if (r.ttl <= 0 || r.body.translation().y < -12) {
        this.ctx.unregisterDynamic(r.body);
        this.ctx.physics.removeBody(r.body);
        this.ctx.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        r.mesh.material.dispose();
        this.rollers.splice(i, 1);
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
