import * as THREE from 'three';

// The cargo escalation ladder. windMult = how much the wind bullies it,
// fragile = damage multiplier, carryK = spring stiffness scale.
export const PACKAGE_TYPES = [
  {
    id: 'crate', name: 'Plain Crate', mass: 6, fragile: 0.35, windMult: 0.5,
    note: 'Contents: unremarkable. Suspiciously unremarkable.',
    warning: 'Handle however.',
  },
  {
    id: 'porcelain', name: "Grandma's Porcelain", mass: 5, fragile: 1.6, windMult: 0.5,
    note: '1× tea set, 74 years old. Grandma knows where you live.',
    warning: 'EXTREMELY FRAGILE',
  },
  {
    id: 'balloon', name: 'Balloon Bundle', mass: 3, fragile: 0.6, windMult: 9,
    note: 'Party supplies. The wind has already signed for it once.',
    warning: 'LIGHTER THAN AIR-ISH',
  },
  {
    id: 'egg', name: 'Dragon Egg', mass: 9, fragile: 0.8, windMult: 0.5,
    note: 'Keep warm. Do NOT let it roll downhill. It remembers.',
    warning: 'JUMPY WHEN STARTLED',
  },
  {
    id: 'sheep', name: 'Sheep in a Crate', mass: 12, fragile: 0.5, windMult: 0.6,
    note: '1× Angry Sheep. She did not agree to this.',
    warning: 'DO NOT SHAKE. Good luck.',
  },
  {
    id: 'anvil', name: 'Cursed Anvil', mass: 45, fragile: 0, windMult: 0.05,
    note: 'Whispers Latin at night. Indestructible. Unfortunately.',
    warning: 'HEAVY. TAKE THE CABLE CAR.',
  },
  {
    id: 'potion', name: 'Unstable Potion', mass: 6, fragile: 0.7, windMult: 0.6,
    note: 'Alchemist-grade Essence of Regret, 1 flask.',
    warning: 'DO NOT SHAKE — SERIOUSLY. IT EXPLODES.',
  },
  {
    id: 'ghost', name: 'Ghost Package', mass: 5, fragile: 0.4, windMult: 2,
    note: 'Addressee deceased. Deliver anyway.',
    warning: 'OCCASIONALLY FORGETS WHICH WAY IS DOWN',
  },
];

export class Packages {
  constructor(ctx) {
    this.ctx = ctx;
    this.current = null;      // active package instance
    this.slipCount = 0;
    this._tmpV = new THREE.Vector3();
    this._prevVel = new THREE.Vector3();
    this._buildChute();
  }

  _buildChute() {
    const { terrain, scene } = this.ctx;
    const p = terrain.pathPoint(0.012);
    const y = terrain.heightAt(p.x, p.z);
    this.chutePos = new THREE.Vector3(p.x, y, p.z);

    // Depot: a wooden funnel chute + glowing pickup ring.
    // Slight emissive so the underside isn't pitch black from below.
    const wood = new THREE.MeshStandardMaterial({ color: 0xc08a52, emissive: 0x53381e, emissiveIntensity: 0.55, flatShading: true, roughness: 0.85 });
    const chute = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.55, 1.6, 6), wood);
    chute.position.set(p.x + 2.2, y + 3.6, p.z + 2.2);
    chute.rotation.z = 0.3;
    chute.castShadow = true;
    scene.add(chute);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 3.6, 5), wood);
    pole.position.set(p.x + 2.6, y + 1.8, p.z + 2.6);
    pole.castShadow = true;
    scene.add(pole);

    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.7, 0.14, 6, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.85 }),
    );
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.set(p.x, y + 0.25, p.z);
    scene.add(this.ring);

    // Spinning preview of the next box above the chute.
    this.preview = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.8, 0.8),
      new THREE.MeshStandardMaterial({ color: 0xa9743f, flatShading: true, emissive: 0x553311, emissiveIntensity: 0.4 }),
    );
    this.preview.position.set(p.x, y + 1.6, p.z);
    scene.add(this.preview);
  }

  typeForDelivery(n) {
    // One new type per delivery; afterwards random weirdness (never the plain crate again).
    if (n < PACKAGE_TYPES.length) return PACKAGE_TYPES[n];
    return PACKAGE_TYPES[1 + Math.floor(Math.random() * (PACKAGE_TYPES.length - 1))];
  }

  // ---------- Mesh factory: chunky low-poly parcels ----------
  _buildMesh(def) {
    const g = new THREE.Group();
    const add = (mesh) => { mesh.castShadow = true; g.add(mesh); return mesh; };
    const std = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8, ...opts });

    switch (def.id) {
      case 'crate': {
        add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), std(0xa9743f)));
        const band = add(new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.22, 1.14), std(0xf5ecd7)));
        band.position.y = 0;
        break;
      }
      case 'porcelain': {
        add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 1.0), std(0xf0ead6)));
        const band = add(new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.18, 1.04), std(0x4d7fd0)));
        band.position.y = 0.15;
        const band2 = add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.04, 1.04), std(0x4d7fd0)));
        band2.position.x = 0;
        break;
      }
      case 'balloon': {
        add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), std(0xc98b4e)));
        const colors = [0xff4d6d, 0xffd166, 0x4dd0ff, 0x45d17a];
        this._balloons = [];
        for (let i = 0; i < 4; i++) {
          const b = add(new THREE.Mesh(new THREE.SphereGeometry(0.34, 7, 5), std(colors[i], { roughness: 0.35 })));
          b.position.set(Math.cos(i * 1.9) * 0.35, 1.5 + (i % 2) * 0.4, Math.sin(i * 1.9) * 0.35);
          b.scale.y = 1.2;
          const str = add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.2, 3), std(0xdddddd)));
          str.position.set(b.position.x * 0.6, 0.8, b.position.z * 0.6);
          str.lookAt(b.position);
          str.rotateX(Math.PI / 2);
        }
        break;
      }
      case 'egg': {
        const egg = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 1), std(0x7ed957, { emissive: 0x2d7a1e, emissiveIntensity: 0.5, roughness: 0.4 })));
        egg.scale.y = 1.3;
        const spots = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.63, 0), std(0x3f9e2f, { transparent: true, opacity: 0.5 })));
        spots.scale.y = 1.3;
        break;
      }
      case 'sheep': {
        // Slatted crate with a woolly head poking out.
        for (let i = -1; i <= 1; i++) {
          const slat = add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.28, 1.2), std(0xa9743f)));
          slat.position.y = i * 0.42;
        }
        const wool = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), std(0xf5f0e6, { roughness: 1 })));
        wool.position.set(0, 0.85, 0.1);
        const face = add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), std(0x2b2b2b)));
        face.position.set(0, 0.8, 0.45);
        break;
      }
      case 'anvil': {
        const base = add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.7), std(0x33363f, { roughness: 0.4, metalness: 0.6 })));
        base.position.y = -0.3;
        const top = add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 0.6), std(0x3d414d, { roughness: 0.4, metalness: 0.6 })));
        top.position.y = 0.15;
        const horn = add(new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.7, 5), std(0x3d414d, { metalness: 0.6 })));
        horn.rotation.z = Math.PI / 2;
        horn.position.set(1.0, 0.15, 0);
        const eye = add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 5, 4), std(0xff2222, { emissive: 0xff2222, emissiveIntensity: 2 })));
        eye.position.set(0.4, 0.28, 0.31);
        break;
      }
      case 'potion': {
        const flask = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), std(0xb64fc8, { emissive: 0x8b2fa8, emissiveIntensity: 0.8, roughness: 0.2, transparent: true, opacity: 0.9 })));
        this._liquid = flask;
        const neck = add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.5, 6), std(0xd8f0f5, { transparent: true, opacity: 0.6 })));
        neck.position.y = 0.6;
        const cork = add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.2, 6), std(0xc98b4e)));
        cork.position.y = 0.92;
        break;
      }
      case 'ghost': {
        const box = add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 1.0), std(0xcfe3ff, { transparent: true, opacity: 0.55, emissive: 0x88aaff, emissiveIntensity: 0.35 })));
        box.rotation.y = 0.3;
        const eL = add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 5, 4), std(0x222244)));
        eL.position.set(-0.2, 0.15, 0.51);
        const eR = eL.clone();
        eR.position.x = 0.2;
        g.add(eR);
        break;
      }
    }
    return g;
  }

  spawn(def) {
    const { physics, scene } = this.ctx;
    const R = physics.RAPIER;
    const mesh = this._buildMesh(def);
    scene.add(mesh);
    const pos = { x: this.chutePos.x, y: this.chutePos.y + 3.2, z: this.chutePos.z };
    const shape = def.id === 'egg' || def.id === 'potion'
      ? R.ColliderDesc.ball(0.62)
      : R.ColliderDesc.cuboid(0.55, 0.55, 0.55);
    shape.setFriction(0.7).setRestitution(def.id === 'egg' ? 0.5 : 0.1)
      .setCollisionGroups((0x0004 << 16) | 0xfffd) // never collides with the player capsule
      .setContactForceEventThreshold(def.mass * 60);
    shape.setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS);
    const { body, collider } = physics.addDynamic(mesh, shape, {
      pos, mass: def.mass, angularDamping: 1.2, ccd: true,
    });
    if (def.id === 'balloon') body.setGravityScale(0.12, true);
    if (def.id === 'ghost') body.setGravityScale(0.8, true);

    const pkg = {
      def, body, collider, mesh,
      condition: 100, shake: 0, carried: false,
      timer: 0, ghostPhase: 0, ghostFlip: 0, delivered: false,
      spawnTime: performance.now(),
    };
    physics.onContactForce(collider, (other, mag) => this._onImpact(pkg, mag));
    this.ctx.registerDynamic(body, 'package');
    this.current = pkg;
    return pkg;
  }

  _onImpact(pkg, mag) {
    if (pkg.delivered || !pkg.def.fragile) return;
    // Convert contact force to an approximate deltaV so damage is
    // mass-independent: gentle bumps are free, real slams hurt.
    const dv = (mag / 60) / pkg.def.mass;
    if (dv < 6) return;
    const dmg = Math.min((dv - 6) * pkg.def.fragile * 4.5, 45);
    if (dmg < 1.5) return;
    this.damage(pkg, dmg);
  }

  damage(pkg, dmg) {
    if (pkg.delivered) return;
    pkg.condition = Math.max(0, pkg.condition - dmg);
    const { sfx, particles, hud } = this.ctx;
    const p = pkg.body.translation();
    this._tmpV.set(p.x, p.y, p.z);
    if (pkg.def.id === 'porcelain') sfx.crack(Math.min(dmg / 15, 1.5));
    else sfx.thud(Math.min(dmg / 20, 1.5));
    particles.sparks(this._tmpV, 0xffd166, 4);
    hud.setCondition(pkg.condition);
    hud.damageFlash();
    // Progressive battering: the parcel visibly darkens and dents.
    const k = pkg.condition / 100;
    pkg.mesh.traverse((o) => {
      if (o.material && o.material.color && !o.userData.tinted) {
        o.userData.baseColor ??= o.material.color.clone();
        o.material = o.material.clone();
        o.userData.tinted = true;
      }
    });
    pkg.mesh.traverse((o) => {
      if (o.material && o.userData.baseColor) {
        o.material.color.copy(o.userData.baseColor).multiplyScalar(0.45 + 0.55 * k);
      }
    });
    pkg.mesh.scale.setScalar(0.9 + 0.1 * k);
    if (pkg.condition <= 0) this.break(pkg);
  }

  break(pkg, exploded = false) {
    const { sfx, particles, hud, deliveries } = this.ctx;
    const p = pkg.body.translation();
    this._tmpV.set(p.x, p.y, p.z);
    if (exploded) {
      particles.explosion(this._tmpV);
      sfx.explosion();
      this._blast(this._tmpV);
    } else {
      particles.shards(this._tmpV, pkg.def.id === 'porcelain' ? 0xf0ead6 : 0xa9743f);
      sfx.shatter();
    }
    this.remove(pkg);
    hud.toast(exploded ? '💥 THE POTION WENT OFF' : '📦 PACKAGE DESTROYED', false);
    hud.toast('A replacement is at the depot. It comes out of your pay.', true);
    sfx.fail();
    deliveries.onPackageLost();
  }

  _blast(center) {
    for (const d of this.ctx.dynamics) {
      const p = d.body.translation();
      const dx = p.x - center.x, dy = p.y - center.y, dz = p.z - center.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 10 || dist < 0.01) continue;
      const k = (1 - dist / 10) * 14 * d.body.mass();
      d.body.applyImpulse({ x: (dx / dist) * k, y: (dy / dist) * k + k * 0.5, z: (dz / dist) * k }, true);
      if (d.kind === 'player') this.ctx.player.knockdown(1.4);
    }
  }

  remove(pkg) {
    const { physics, scene } = this.ctx;
    physics.offContactForce(pkg.collider);
    this.ctx.unregisterDynamic(pkg.body);
    physics.removeBody(pkg.body);
    scene.remove(pkg.mesh);
    if (this.current === pkg) this.current = null;
    this.ctx.hud.setPackage(null);
  }

  tryPickup() {
    // Called when the player walks into the depot ring with no package.
    const { player, hud, sfx, deliveries } = this.ctx;
    const pp = player.body.translation();
    const d = Math.hypot(pp.x - this.chutePos.x, pp.z - this.chutePos.z);
    if (d > 2.6 || Math.abs(pp.y - this.chutePos.y) > 3) return;
    const def = this.typeForDelivery(deliveries.completed);
    const pkg = this.spawn(def);
    pkg.carried = true;
    sfx.pickup();
    this.slipCount++;
    hud.setPackage(def.name, def.note, def.id === 'potion');
    hud.setCondition(100);
    hud.showSlip(this.slipCount, def, deliveries.currentTargetName());
    deliveries.onPackagePicked();
  }

  dropCarried() {
    if (this.current) this.current.carried = false;
  }

  fixedUpdate(dt, t) {
    const { player, wind, particles, sfx, hud } = this.ctx;
    if (!this.current) {
      this.ring.rotation.z += dt;
      this.preview.rotation.y += dt * 1.5;
      this.preview.position.y = this.chutePos.y + 1.6 + Math.sin(t * 2) * 0.15;
      this.tryPickup();
      return;
    }
    const pkg = this.current;
    const def = pkg.def;
    const body = pkg.body;
    const p = body.translation();
    const v = body.linvel();
    pkg.timer += dt;

    // --- Carry spring: parcel is yanked toward the hand anchor; the player
    // feels the reaction, so heavy or possessed cargo genuinely hinders. ---
    if (pkg.carried) {
      const anchor = player.getCarryAnchor();
      const dx = anchor.x - p.x, dy = anchor.y - p.y, dz = anchor.z - p.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 4) {
        // Snapped too far (stuck in geometry): teleport back to the hands.
        // That yank absolutely counts as shaking.
        body.setTranslation({ x: anchor.x, y: anchor.y, z: anchor.z }, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this._prevVel.set(0, 0, 0);
        if (def.id === 'potion') pkg.shake = Math.min(100, pkg.shake + 22);
      } else {
        const m = def.mass;
        const k = 130 * m, c = 14 * m;
        const fx = dx * k - v.x * c;
        const fy = dy * k - v.y * c;
        const fz = dz * k - v.z * c;
        body.resetForces(true);
        body.addForce({ x: fx, y: fy, z: fz }, true);
        // Reaction on the courier (scaled down or the game is unplayable).
        const r = def.id === 'anvil' ? 0.35 : 0.12;
        player.body.applyImpulse({ x: -fx * r * dt, y: -fy * r * 0.4 * dt, z: -fz * r * dt }, true);
      }
    } else {
      body.resetForces(true);
      // Loose package near the player: pick it back up by touching it.
      const pp = player.body.translation();
      if (Math.hypot(pp.x - p.x, pp.y - p.y, pp.z - p.z) < 1.7 && player.knockTimer <= 0) {
        pkg.carried = true;
        sfx.pickup();
        hud.toast('📦 Recovered!', true);
      }
    }

    // --- Wind ---
    body.addForce({ x: wind.x * def.windMult, y: 0, z: wind.z * def.windMult }, true);

    // --- Type behaviours ---
    switch (def.id) {
      case 'balloon': {
        this._tmpV.set(p.x, p.y + 1.6, p.z);
        if (Math.random() < dt * 2) particles.sparks(this._tmpV, 0xff9fd0, 1);
        break;
      }
      case 'egg': {
        if (pkg.timer > 2.2 + Math.random() * 2.5) {
          pkg.timer = 0;
          body.applyImpulse({ x: (Math.random() - 0.5) * def.mass * 5, y: def.mass * (pkg.carried ? 4 : 7), z: (Math.random() - 0.5) * def.mass * 5 }, true);
          this._tmpV.set(p.x, p.y, p.z);
          particles.sparks(this._tmpV, 0x7ed957, 5);
          sfx.wobble();
        }
        pkg.mesh.scale.setScalar(1 + Math.sin(t * 6) * 0.03);
        break;
      }
      case 'sheep': {
        if (pkg.timer > 1.6 + Math.random() * 2.4) {
          pkg.timer = 0;
          const speed = Math.hypot(v.x, v.z);
          const anger = 1 + speed * 0.15;
          body.applyImpulse({ x: (Math.random() - 0.5) * def.mass * 4 * anger, y: Math.random() * def.mass * 2.5 * anger, z: (Math.random() - 0.5) * def.mass * 4 * anger }, true);
          sfx.baa();
        }
        break;
      }
      case 'potion': {
        // Shake meter: integrate acceleration spikes.
        const acc = Math.hypot(v.x - this._prevVel.x, v.y - this._prevVel.y, v.z - this._prevVel.z) / dt;
        if (acc > 35) pkg.shake = Math.min(100, pkg.shake + (acc - 35) * dt * 0.9);
        if (pkg.shake >= 100) { this.break(pkg, true); return; }
        pkg.shake = Math.max(0, pkg.shake - dt * 3.5);
        hud.setShake(pkg.shake);
        if (this._liquid) {
          this._liquid.material.emissiveIntensity = 0.8 + (pkg.shake / 100) * 3 * (0.6 + Math.sin(t * 20) * 0.4);
        }
        if (pkg.shake > 70 && Math.random() < dt * 4) {
          this._tmpV.set(p.x, p.y + 0.5, p.z);
          particles.sparks(this._tmpV, 0xb64fc8, 3);
          sfx.sizzle();
        }
        if (pkg.shake >= 100) { this.break(pkg, true); return; }
        break;
      }
      case 'ghost': {
        pkg.ghostPhase += dt;
        if (pkg.ghostFlip > 0) {
          pkg.ghostFlip -= dt;
          body.addForce({ x: 0, y: body.mass() * 40, z: 0 }, true); // "down" is a suggestion
          pkg.mesh.rotation.z += dt * 3;
          if (Math.random() < dt * 6) {
            this._tmpV.set(p.x, p.y, p.z);
            particles.sparks(this._tmpV, 0x88aaff, 2);
          }
        } else if (pkg.ghostPhase > 4 + Math.random() * 4) {
          pkg.ghostPhase = 0;
          pkg.ghostFlip = 1.4;
          sfx.wobble();
        }
        break;
      }
    }
    this._prevVel.set(v.x, v.y, v.z);

    // Lost below the world: bring it back to the courier, dinged.
    if (p.y < -12) {
      const pp = player.body.translation();
      body.setTranslation({ x: pp.x, y: pp.y + 2.5, z: pp.z }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      if (def.fragile) this.damage(pkg, 20);
      hud.toast('The package took the scenic route back.', true);
    }
  }
}
