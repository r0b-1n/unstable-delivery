import * as THREE from 'three';
import { disposeObject } from '../core/physics.js';
import { KILL_Y } from '../world/terrain.js';

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
    id: 'sheep', name: 'Sheep in a Crate', mass: 12, fragile: 0.18, windMult: 0.6,
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
    this.escapee = null;      // a sheep on the run
    this.slipCount = 0;
    this._tmpV = new THREE.Vector3();
    this._buildChute();
    this.rollNext(0);
  }

  // Decide the NEXT package ahead of time so the depot preview can show it
  // (and glow gold for insured cargo).
  rollNext(n) {
    let def = this.typeForDelivery(n);
    if (n >= PACKAGE_TYPES.length && ((n - PACKAGE_TYPES.length) % 4 === 3 || Math.random() < 0.12)) {
      def = {
        ...def, golden: true, name: `Golden ${def.name}`,
        note: `${def.note} Insured for a fortune.`,
        warning: 'GOLDEN — ×3 PAY. DESTRUCTION COSTS 300.',
      };
    }
    this.nextDef = def;
    const m = this.preview.material;
    if (def.golden) { m.color.set(0xffd166); m.emissive.set(0xcf8f1e); m.emissiveIntensity = 1.0; }
    else { m.color.set(0xa9743f); m.emissive.set(0x553311); m.emissiveIntensity = 0.4; }
  }

  _buildChute() {
    const { terrain, scene } = this.ctx;
    const p = terrain.pathPoint(0.012);
    const y = terrain.heightAt(p.x, p.z);
    this.chutePos = new THREE.Vector3(p.x, y, p.z);

    // Depot: a small parcel kiosk + glowing pickup ring.
    // Strong emissive so undersides don't read as black blobs.
    const wood = new THREE.MeshStandardMaterial({ color: 0xc08a52, emissive: 0x6b4826, emissiveIntensity: 0.7, flatShading: true, roughness: 0.85 });
    const kiosk = new THREE.Group();
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 1.1), wood);
    counter.position.y = 0.5;
    const roofPost = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 2.4, 5), wood);
    roofPost.position.set(-0.9, 1.2, 0);
    const roofPost2 = roofPost.clone();
    roofPost2.position.x = 0.9;
    const kioskRoof = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.14, 1.5),
      new THREE.MeshStandardMaterial({ color: 0xc94f4f, emissive: 0x5e2020, emissiveIntensity: 0.6, flatShading: true }),
    );
    kioskRoof.position.y = 2.5;
    kioskRoof.rotation.z = 0.06;
    const parcelPile = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.6), wood);
    parcelPile.position.set(0.4, 1.25, 0);
    kiosk.add(counter, roofPost, roofPost2, kioskRoof, parcelPile);
    kiosk.position.set(p.x + 3.0, y, p.z + 2.6);
    kiosk.lookAt(p.x, y, p.z);
    kiosk.traverse((o) => { o.castShadow = true; });
    scene.add(kiosk);

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
        for (let i = 0; i < 4; i++) {
          const b = add(new THREE.Mesh(new THREE.SphereGeometry(0.34, 7, 5), std(colors[i], { roughness: 0.35 })));
          b.position.set(Math.cos(i * 1.9) * 0.35, 1.5 + (i % 2) * 0.4, Math.sin(i * 1.9) * 0.35);
          b.scale.y = 1.2;
          b.userData.bobY = b.position.y;
          b.userData.ph = i * 1.9;
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
        // Inner group so the flip-tumble can rotate visibly — syncMeshes
        // overwrites the root group's quaternion from the physics body.
        const inner = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 1.0), std(0xcfe3ff, { transparent: true, opacity: 0.55, emissive: 0x88aaff, emissiveIntensity: 0.35 }));
        box.rotation.y = 0.3;
        box.castShadow = true;
        const eL = new THREE.Mesh(new THREE.SphereGeometry(0.09, 5, 4), std(0x222244));
        eL.position.set(-0.2, 0.15, 0.51);
        const eR = eL.clone();
        eR.position.x = 0.2;
        inner.add(box, eL, eR);
        g.add(inner);
        g.userData.inner = inner;
        break;
      }
    }
    return g;
  }

  spawn(def, at = null) {
    const { physics, scene } = this.ctx;
    const R = physics.RAPIER;
    const mesh = this._buildMesh(def);
    if (def.golden) {
      mesh.traverse((o) => {
        if (o.material?.color) {
          o.material.color.lerp(new THREE.Color(0xffd166), 0.45);
          if (o.material.emissive) { o.material.emissive.set(0xcf8f1e); o.material.emissiveIntensity = 0.5; }
        }
      });
    }
    scene.add(mesh);
    const pos = at ?? { x: this.chutePos.x, y: this.chutePos.y + 3.2, z: this.chutePos.z };
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
      grace: 0.9,        // impact + shake immunity right after spawning
      dmgCd: 0,          // impact-damage cooldown (60 Hz contact streams!)
      noGrabT: 0,        // can't re-grab a just-thrown package
      thrownT: 0,        // a thrown package can still score a delivery
      squash: 0,
      prevVel: new THREE.Vector3(),
      heartT: 0,
    };
    physics.onContactForce(collider, (other, mag) => this._onImpact(pkg, mag));
    this.ctx.registerDynamic(body, 'package');
    this.current = pkg;
    return pkg;
  }

  _onImpact(pkg, mag) {
    if (pkg.delivered) return;
    // Convert contact force to an approximate deltaV so damage is
    // mass-independent: gentle bumps are free, real slams hurt.
    const dv = (mag / 60) / pkg.def.mass;
    if (dv > 3) pkg.squash = Math.max(pkg.squash, Math.min(dv / 14, 1));
    if (!pkg.def.fragile) return;
    // Grace right after spawn (the chute drop is free) and a short cooldown
    // so a sustained 60 Hz contact stream can't shred the parcel in frames.
    if (pkg.grace > 0 || pkg.dmgCd > 0) return;
    if (dv < 6) return;
    const dmg = Math.min((dv - 6) * pkg.def.fragile * 4.5, 45);
    if (dmg < 1.5) return;
    pkg.dmgCd = 0.3;
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
    if (pkg.condition <= 0) this.break(pkg);
  }

  break(pkg, exploded = false) {
    const { sfx, particles, hud, deliveries } = this.ctx;
    if (pkg.def.id === 'sheep' && !exploded) return this._sheepEscape(pkg);
    const p = pkg.body.translation();
    this._tmpV.set(p.x, p.y, p.z);
    this.ctx.hitstop?.(exploded ? 0.12 : 0.08);
    if (exploded) {
      particles.explosion(this._tmpV);
      sfx.explosion();
      this.ctx.shake?.(0.9);
      this._blast(this._tmpV);
    } else {
      particles.shards(this._tmpV, pkg.def.id === 'porcelain' ? 0xf0ead6 : 0xa9743f);
      sfx.shatter();
    }
    const golden = !!pkg.def.golden;
    this.remove(pkg);
    hud.toast(exploded ? '💥 THE POTION WENT OFF' : '📦 PACKAGE DESTROYED', false);
    hud.toast('A replacement is at the depot. It comes out of your pay.', true);
    sfx.fail();
    deliveries.onPackageLost(golden);
  }

  // The crate breaks but the sheep survives — and runs. Catch her to re-crate.
  _sheepEscape(pkg) {
    const { sfx, particles, hud, physics, scene } = this.ctx;
    const p = pkg.body.translation();
    this._tmpV.set(p.x, p.y, p.z);
    particles.shards(this._tmpV, 0xa9743f);
    sfx.shatter();
    sfx.baa();
    const def = pkg.def;
    this.remove(pkg);

    const g = new THREE.Group();
    const wool = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), new THREE.MeshStandardMaterial({ color: 0xf5f0e6, flatShading: true, roughness: 1 }));
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0x2b2b2b, flatShading: true }));
    face.position.set(0, 0.05, 0.38);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, flatShading: true });
    for (const [lx, lz] of [[-0.2, -0.15], [0.2, -0.15], [-0.2, 0.2], [0.2, 0.2]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 4), legMat);
      leg.position.set(lx, -0.42, lz);
      g.add(leg);
    }
    g.add(wool, face);
    g.traverse((o) => { o.castShadow = true; });
    scene.add(g);
    const R = physics.RAPIER;
    const { body } = physics.addDynamic(g, R.ColliderDesc.ball(0.45).setFriction(0.9), {
      pos: { x: p.x, y: p.y + 0.5, z: p.z }, mass: 12, angularDamping: 3,
    });
    this.ctx.registerDynamic(body, 'sheep');
    this.escapee = { def, body, mesh: g, ttl: 22, hopT: 0.2 };
    hud.toast('🐑 THE SHEEP IS LOOSE! Catch her!', false);
    hud.setPackage(null);
  }

  _removeEscapee() {
    const e = this.escapee;
    if (!e) return;
    this.ctx.unregisterDynamic(e.body);
    this.ctx.physics.removeBody(e.body);
    this.ctx.scene.remove(e.mesh);
    disposeObject(e.mesh, true);
    this.escapee = null;
  }

  _tickEscapee(dt) {
    const e = this.escapee;
    const { player, particles, sfx, hud } = this.ctx;
    e.ttl -= dt;
    const p = e.body.translation();
    const pp = player.body.translation();
    const dx = p.x - pp.x, dz = p.z - pp.z;
    const d = Math.hypot(dx, dz, p.y - pp.y);
    e.hopT -= dt;
    if (e.hopT <= 0) {
      e.hopT = 0.45 + Math.random() * 0.4;
      // Flee the courier; wander once she feels safe.
      let ax, az;
      if (d < 26) { const l = Math.hypot(dx, dz) || 1; ax = dx / l; az = dz / l; }
      else { const a = Math.random() * Math.PI * 2; ax = Math.cos(a); az = Math.sin(a); }
      const m = e.body.mass();
      e.body.applyImpulse({ x: (ax + (Math.random() - 0.5) * 0.7) * m * 4, y: m * 3.2, z: (az + (Math.random() - 0.5) * 0.7) * m * 4 }, true);
      if (Math.random() < 0.35 && d < 50) sfx.baa();
      this._tmpV.set(p.x, p.y - 0.3, p.z);
      particles.dust(this._tmpV, 0.5);
    }
    if (d < 1.8 && player.knockTimer <= 0) {
      // Caught! Back in the crate (a very dented crate).
      this._removeEscapee();
      const pkg = this.spawn(e.def, { x: pp.x, y: pp.y + 1.5, z: pp.z });
      pkg.carried = true;
      pkg.condition = 40;
      hud.setPackage(e.def.name, e.def.note, false);
      hud.setCondition(40);
      hud.toast('🐑 RECAPTURED! She is not happy about it.', false);
      sfx.baa();
      sfx.pickup();
      return;
    }
    if (e.ttl <= 0 || p.y < KILL_Y) {
      this._tmpV.set(p.x, p.y, p.z);
      if (e.ttl <= 0) particles.dust(this._tmpV, 1);
      this._removeEscapee();
      hud.toast('🐑 The sheep has formally resigned.', false);
      hud.toast('A replacement is at the depot. It comes out of your pay.', true);
      this.ctx.sfx.fail();
      this.ctx.deliveries.onPackageLost(false);
    }
  }

  // F / right-click: hurl the carried package along the camera aim.
  throwCarried(dx, dz) {
    const pkg = this.current;
    if (!pkg?.carried) return;
    const { player, sfx } = this.ctx;
    pkg.carried = false;
    pkg.noGrabT = 0.65;
    pkg.thrownT = 1.8;
    pkg.body.resetForces(true);
    const k = Math.min(1, 16 / pkg.def.mass); // the anvil mostly just plops
    const pv = player.body.linvel();
    pkg.body.setLinvel({
      x: pv.x * 0.6 + dx * 11 * k,
      y: Math.max(pv.y, 0) * 0.3 + 5.5 * k,
      z: pv.z * 0.6 + dz * 11 * k,
    }, true);
    if (pkg.def.id === 'potion') pkg.shake = Math.min(92, pkg.shake + 16);
    sfx.throwWhoosh();
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
    disposeObject(pkg.mesh, true); // package materials are per-instance
    if (pkg.def.id === 'potion') this._liquid = null;
    if (this.current === pkg) this.current = null;
    this.ctx.hud.setPackage(null);
  }

  tryPickup() {
    // Called when the player walks into the depot ring with no package.
    if (this.escapee) return; // no replacement while your sheep is at large
    const { player, hud, sfx, deliveries } = this.ctx;
    const pp = player.body.translation();
    const d = Math.hypot(pp.x - this.chutePos.x, pp.z - this.chutePos.z);
    if (d > 2.6 || Math.abs(pp.y - this.chutePos.y) > 3) return;
    const def = this.nextDef ?? this.typeForDelivery(deliveries.completed);
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
    if (this.escapee) this._tickEscapee(dt);
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
    pkg.grace = Math.max(0, pkg.grace - dt);
    pkg.dmgCd = Math.max(0, pkg.dmgCd - dt);
    pkg.noGrabT = Math.max(0, pkg.noGrabT - dt);
    pkg.thrownT = Math.max(0, pkg.thrownT - dt);

    // --- Carry spring: parcel is yanked toward the hand anchor; the player
    // feels the reaction, so heavy or possessed cargo genuinely hinders. ---
    if (pkg.carried) {
      const anchor = player.getCarryAnchor();
      const dx = anchor.x - p.x, dy = anchor.y - p.y, dz = anchor.z - p.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 4) {
        // Snapped too far (stuck in geometry): teleport back to the hands.
        // That yank absolutely counts as shaking — but the spawn snap is free.
        body.setTranslation({ x: anchor.x, y: anchor.y, z: anchor.z }, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        pkg.prevVel.set(0, 0, 0);
        if (def.id === 'potion' && pkg.grace <= 0) pkg.shake = Math.min(100, pkg.shake + 18);
      } else {
        const m = def.mass;
        const k = 130 * m, c = 14 * m;
        const fx = dx * k - v.x * c;
        const fy = dy * k - v.y * c;
        const fz = dz * k - v.z * c;
        body.resetForces(true);
        body.addForce({ x: fx, y: fy, z: fz }, true);
        // Reaction on the courier: heavy cargo genuinely drags DOWN, but the
        // upward component is clamped hard — a package pushed above the hands
        // (balloons, hopping eggs) must never become a jetpack.
        const r = def.id === 'anvil' ? 0.35 : 0.12;
        let ry = -fy * r * 0.4;
        const playerWeight = player.body.mass() * 22;
        ry = Math.min(ry, playerWeight * 0.15);
        player.body.applyImpulse({ x: -fx * r * dt, y: ry * dt, z: -fz * r * dt }, true);
      }
    } else {
      body.resetForces(true);
      // Loose package near the player: pick it back up by touching it
      // (unless it was just thrown — let it fly).
      const pp = player.body.translation();
      if (pkg.noGrabT <= 0 && Math.hypot(pp.x - p.x, pp.y - p.y, pp.z - p.z) < 1.7 && player.knockTimer <= 0) {
        pkg.carried = true;
        pkg.thrownT = 0;
        sfx.pickup();
        hud.toast('📦 Recovered!', true);
      }
    }

    // --- Wind ---
    body.addForce({ x: wind.x * def.windMult, y: 0, z: wind.z * def.windMult }, true);

    // --- Type behaviours ---
    switch (def.id) {
      case 'balloon': {
        // Floaty for the COURIER, in a controlled way: an upward assist while
        // carried (higher jumps, softer falls), capped so it can't turn into
        // sustained flight.
        if (pkg.carried) {
          const pv = player.body.linvel();
          if (pv.y < 3.5) {
            const assist = player.body.mass() * 22 * 0.42;
            player.body.applyImpulse({ x: 0, y: assist * dt, z: 0 }, true);
          }
        }
        this._tmpV.set(p.x, p.y + 1.6, p.z);
        if (Math.random() < dt * 2) particles.sparks(this._tmpV, 0xff9fd0, 1);
        // The balloons themselves bob on their strings.
        pkg.balloons ??= pkg.mesh.children.filter((c) => c.userData.bobY !== undefined);
        for (const b of pkg.balloons) {
          b.position.y = b.userData.bobY + Math.sin(t * 2.2 + b.userData.ph) * 0.12;
        }
        break;
      }
      case 'egg': {
        if (pkg.timer > 2.0 + Math.random() * 2.2) {
          pkg.timer = 0;
          if (pkg.carried) {
            // Startled egg kicks the COURIER sideways — never upward.
            const a = Math.random() * Math.PI * 2;
            player.body.applyImpulse({ x: Math.cos(a) * 220, y: 0, z: Math.sin(a) * 220 }, true);
            body.applyImpulse({ x: (Math.random() - 0.5) * def.mass * 3, y: 0, z: (Math.random() - 0.5) * def.mass * 3 }, true);
          } else {
            // Loose egg makes a break for it downhill.
            body.applyImpulse({ x: (Math.random() - 0.5) * def.mass * 8, y: def.mass * 5, z: (Math.random() - 0.5) * def.mass * 8 }, true);
          }
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
          // The kick mostly shoves the COURIER around; the crate itself takes
          // a mild horizontal jolt so the sheep doesn't batter itself to death.
          body.applyImpulse({ x: (Math.random() - 0.5) * def.mass * 3 * anger, y: 0, z: (Math.random() - 0.5) * def.mass * 3 * anger }, true);
          if (pkg.carried) {
            const a = Math.random() * Math.PI * 2;
            player.body.applyImpulse({ x: Math.cos(a) * 180 * anger, y: 0, z: Math.sin(a) * 180 * anger }, true);
          }
          sfx.baa();
        }
        break;
      }
      case 'potion': {
        // Shake meter: integrate acceleration spikes (skipped during the
        // spawn grace so the chute drop + first spring snap are free).
        const acc = Math.hypot(v.x - pkg.prevVel.x, v.y - pkg.prevVel.y, v.z - pkg.prevVel.z) / dt;
        if (acc > 35 && pkg.grace <= 0) pkg.shake = Math.min(100, pkg.shake + (acc - 35) * dt * 0.9);
        if (pkg.shake >= 100) { this.break(pkg, true); return; }
        pkg.shake = Math.max(0, pkg.shake - dt * 3.5);
        hud.setShake(pkg.shake);
        if (this._liquid) {
          this._liquid.material.emissiveIntensity = 0.8 + (pkg.shake / 100) * 3 * (0.6 + Math.sin(t * 20) * 0.4);
        }
        // The flask has a heartbeat, and it accelerates. You'll feel it.
        pkg.heartT -= dt;
        if (pkg.shake > 50 && pkg.heartT <= 0) {
          pkg.heartT = 1.25 - (pkg.shake / 100) * 0.85;
          sfx.heartbeat(pkg.shake / 100);
        }
        if (pkg.shake > 82 && Math.random() < dt * 2.5) {
          this._tmpV.set(p.x, p.y + 0.5, p.z);
          particles.sparks(this._tmpV, 0xb64fc8, 3);
          sfx.sizzle();
        }
        break;
      }
      case 'ghost': {
        pkg.ghostPhase += dt;
        if (pkg.ghostFlip > 0) {
          pkg.ghostFlip -= dt;
          body.addForce({ x: 0, y: body.mass() * 40, z: 0 }, true); // "down" is a suggestion
          pkg.mesh.userData.inner.rotation.z += dt * 3;
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
    pkg.prevVel.set(v.x, v.y, v.z);

    // Squash & stretch on impacts (egg has its own pulse animation).
    pkg.squash = Math.max(0, pkg.squash - dt * 5);
    if (def.id !== 'egg') {
      const s0 = 0.9 + 0.1 * (pkg.condition / 100);
      const sq = pkg.squash * 0.3;
      pkg.mesh.scale.set(s0 * (1 + sq), s0 * (1 - sq), s0 * (1 + sq));
    }

    // Battered fragile cargo visibly smokes; critical cargo sparks.
    if (def.fragile && pkg.condition < 50) {
      const crit = pkg.condition < 25;
      if (Math.random() < dt * (crit ? 3.2 : 1.4)) {
        this._tmpV.set(p.x, p.y + 0.4, p.z);
        particles.smoke(this._tmpV);
        if (crit && Math.random() < 0.4) particles.sparks(this._tmpV, 0xffb347, 2);
      }
    }
    // Golden cargo glitters.
    if (def.golden && Math.random() < dt * 5) {
      this._tmpV.set(p.x + (Math.random() - 0.5), p.y + 0.6, p.z + (Math.random() - 0.5));
      particles.sparks(this._tmpV, 0xffd166, 1);
    }

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
