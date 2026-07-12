import * as THREE from 'three';
import { PEAK, zoneAt, KILL_Y } from '../world/terrain.js';

// The chaos director: ambient hazards (wind, boulders, icicles, lightning)
// plus SCHEDULED EVENTS with a warning banner — avalanches, boulder rain,
// thunderstorms and gales. Intensity scales with deliveries AND altitude,
// and the first climb is already spicy.
export class Director {
  constructor(ctx) {
    this.ctx = ctx;
    this.level = 0;
    this.boulders = [];
    this.icicles = [];
    this.snowballs = [];
    this._boulderTimer = 10;
    this._icicleTimer = 4;
    this._lightningTimer = 7;
    this._windAngle = 0.7;
    this._tmp = new THREE.Vector3();

    // Event machinery
    this.event = null;          // { name, ttl, tick }
    this._eventWarn = null;     // { name, ttl }
    this._eventTimer = 14;      // first event fairly early
    this.windMult = 1;

    this._boulderMat = new THREE.MeshStandardMaterial({ color: 0x5d6480, flatShading: true, roughness: 1 });
    this._snowMat = new THREE.MeshStandardMaterial({ color: 0xf2f8ff, flatShading: true, roughness: 0.9 });
    this._icicleMat = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, flatShading: true, roughness: 0.2, transparent: true, opacity: 0.9 });

    this._bolt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.5, 90, 5),
      new THREE.MeshBasicMaterial({ color: 0xeef4ff, transparent: true, opacity: 0.95 }),
    );
    this._bolt.visible = false;
    ctx.scene.add(this._bolt);
    this._boltTtl = 0;
    this.flash = 0;
  }

  onDelivery(completed) {
    this.level = completed;
    if (completed === 1) this.ctx.hud.toast('🌬️ The mountain has noticed you.', true);
    if (completed === 3) this.ctx.hud.toast('🪨 Insurance premiums rising…', true);
    if (completed === 5) this.ctx.hud.toast('⛈️ The summit storm knows your name.', true);
  }

  // ---------- main tick ----------
  fixedUpdate(dt, t) {
    const { wind, player, sfx } = this.ctx;
    const p = player.body.translation();
    const alt01 = THREE.MathUtils.clamp(p.y / PEAK, 0, 1);
    const zone = zoneAt(p.y);

    // --- Wind: rotating direction, layered gusts, event multiplier ---
    this._windAngle += dt * 0.03;
    const gust01 = Math.max(0,
      Math.sin(t * 0.43) * 0.5 + Math.sin(t * 1.17 + 2) * 0.35 + Math.sin(t * 2.9) * 0.15,
    );
    this.ctx.gust = gust01 * this.windMult;
    const strength = (2.5 + alt01 * 15 + Math.min(this.level, 8) * 1.1) * (0.3 + gust01) * this.windMult;
    wind.set(Math.cos(this._windAngle) * strength, 0, Math.sin(this._windAngle) * strength);
    sfx.setWind(alt01, Math.min(gust01 * this.windMult * 0.5, 1));

    // --- Ambient boulders: active from the FIRST climb, small at first ---
    if (p.y > PEAK * 0.18) {
      this._boulderTimer -= dt;
      if (this._boulderTimer <= 0 && this.boulders.length < 5) {
        this._boulderTimer = Math.max(13 - this.level * 1.2 - alt01 * 4, 3.5);
        this._spawnBoulder(p, 0.7 + Math.min(this.level, 6) * 0.12);
      }
    }
    this._cullList(this.boulders, dt);
    this._cullList(this.snowballs, dt);

    // --- Icicles: always live in the frozen zone and above ---
    if (zone.key === 'frozen' || zone.key === 'summit') {
      this._icicleTimer -= dt;
      if (this._icicleTimer <= 0 && this.icicles.length < 6) {
        this._icicleTimer = Math.max(7 - this.level * 0.5 - alt01 * 2, 2);
        this._spawnIcicle(p, player.body.linvel());
      }
    }
    this._tickIcicles(dt);

    // --- Ambient summit lightning ---
    this.flash = Math.max(0, this.flash - dt * 3);
    this._boltTtl -= dt;
    if (this._boltTtl <= 0) this._bolt.visible = false;
    if (zone.key === 'summit' && !this.event) {
      this._lightningTimer -= dt;
      if (this._lightningTimer <= 0) {
        this._lightningTimer = Math.max(9 - this.level * 0.6, 3.5) + Math.random() * 4;
        this._strike(p);
      }
    }

    // ---------- scheduled events ----------
    if (this.event) {
      this.event.ttl -= dt;
      this.event.tick(dt, t);
      if (this.event.ttl <= 0) {
        this.windMult = 1;
        this.ctx.hud.banner(null);
        this.event = null;
        this._eventTimer = Math.max(26 - this.level * 1.5, 12) + Math.random() * 10;
      }
    } else if (this._eventWarn) {
      this._eventWarn.ttl -= dt;
      if (this._eventWarn.ttl <= 0) {
        this._startEvent(this._eventWarn.name, p, zone);
        this._eventWarn = null;
      }
    } else if (p.y > 12) { // no events while pottering around the depot
      this._eventTimer -= dt;
      if (this._eventTimer <= 0) {
        const name = this._pickEvent(zone);
        this._eventWarn = { name, ttl: 2.5 };
        this.ctx.hud.banner(`⚠ ${EVENT_LABELS[name]} INCOMING`);
        this.ctx.sfx.wobble();
        this.ctx.shake?.(0.25);
      }
    }
  }

  _pickEvent(zone) {
    const table = {
      meadow: ['gale', 'boulderRain'],
      forest: ['boulderRain', 'gale'],
      cliffs: ['gale', 'boulderRain', 'thunder'],
      frozen: ['avalanche', 'gale', 'boulderRain'],
      summit: ['thunder', 'avalanche', 'gale'],
    }[zone.key] ?? ['gale'];
    return table[(Math.random() * table.length) | 0];
  }

  _startEvent(name, p, zone) {
    const { hud, sfx } = this.ctx;
    hud.banner(`${EVENT_LABELS[name]}!`);
    const mkEvent = {
      gale: () => {
        this.windMult = 3.4;
        sfx.setWind(1, 1);
        return { name, ttl: 9, tick: (dt) => {
          if (Math.random() < dt * 8) this.ctx.shake?.(0.12);
        } };
      },
      boulderRain: () => {
        let spawnT = 0;
        return { name, ttl: 8, tick: (dt) => {
          spawnT -= dt;
          if (spawnT <= 0 && this.boulders.length < 9) {
            spawnT = 0.9;
            const pp = this.ctx.player.body.translation();
            this._dropBoulder(pp);
          }
        } };
      },
      avalanche: () => {
        sfx.thunder();
        this.ctx.shake?.(0.7);
        let spawnT = 0;
        return { name, ttl: 7, tick: (dt) => {
          spawnT -= dt;
          if (spawnT <= 0 && this.snowballs.length < 14) {
            spawnT = 0.35;
            this._spawnSnowball();
          }
          if (Math.random() < dt * 5) this.ctx.shake?.(0.1);
        } };
      },
      thunder: () => {
        let strikeT = 0.5;
        return { name, ttl: 8, tick: (dt) => {
          strikeT -= dt;
          if (strikeT <= 0) {
            strikeT = 1.1 + Math.random() * 0.9;
            this._strike(this.ctx.player.body.translation());
          }
        } };
      },
    };
    this.event = mkEvent[name]();
  }

  // ---------- hazard spawners ----------
  _cullList(list, dt) {
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      b.ttl -= dt;
      const bp = b.body.translation();
      if (b.ttl <= 0 || bp.y < KILL_Y) {
        this.ctx.unregisterDynamic(b.body);
        this.ctx.physics.removeBody(b.body);
        this.ctx.scene.remove(b.mesh);
        list.splice(i, 1);
      }
    }
  }

  _spawnBoulder(playerPos, sizeScale = 1) {
    const { terrain, physics, scene, hud } = this.ctx;
    const R = physics.RAPIER;
    const near = terrain._nearestPath(playerPos.x, playerPos.z);
    const t = Math.min(near.p.t + 0.035, 0.99);
    const pp = terrain.pathPoint(t);
    const y = terrain.heightAt(pp.x, pp.z) + 6;
    const r = (0.9 + Math.random() * 0.8) * sizeScale;
    const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), this._boulderMat);
    mesh.castShadow = true;
    scene.add(mesh);
    const { body } = physics.addDynamic(mesh, R.ColliderDesc.ball(r).setFriction(0.8).setRestitution(0.2), {
      pos: { x: pp.x, y, z: pp.z }, mass: 30 + r * 50, angularDamping: 0.05, ccd: true,
    });
    const dx = playerPos.x - pp.x, dz = playerPos.z - pp.z;
    const dl = Math.hypot(dx, dz) || 1;
    body.setLinvel({ x: (dx / dl) * 8, y: 0, z: (dz / dl) * 8 }, true);
    this.ctx.registerDynamic(body, 'boulder');
    this.boulders.push({ body, mesh, ttl: 24 });
    hud.toast('🪨 BOULDER!', true);
  }

  _dropBoulder(playerPos) {
    const { physics, scene } = this.ctx;
    const R = physics.RAPIER;
    const a = Math.random() * Math.PI * 2;
    const d = 3 + Math.random() * 14;
    const x = playerPos.x + Math.cos(a) * d;
    const z = playerPos.z + Math.sin(a) * d;
    const r = 0.8 + Math.random() * 1.0;
    const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), this._boulderMat);
    mesh.castShadow = true;
    scene.add(mesh);
    const { body } = physics.addDynamic(mesh, R.ColliderDesc.ball(r).setFriction(0.8).setRestitution(0.35), {
      pos: { x, y: playerPos.y + 26 + Math.random() * 8, z }, mass: 30 + r * 50, ccd: true,
    });
    this.ctx.registerDynamic(body, 'boulder');
    this.boulders.push({ body, mesh, ttl: 20 });
  }

  _spawnSnowball() {
    // Spawned uphill of the courier, rolling down the slope toward them.
    const { terrain, physics, scene, player } = this.ctx;
    const R = physics.RAPIER;
    const p = player.body.translation();
    const near = terrain._nearestPath(p.x, p.z);
    const t = Math.min(near.p.t + 0.02 + Math.random() * 0.03, 0.99);
    const pp = terrain.pathPoint(t);
    const off = (Math.random() - 0.5) * 14;
    const len = Math.hypot(pp.x, pp.z) || 1;
    const x = pp.x + (pp.x / len) * off;
    const z = pp.z + (pp.z / len) * off;
    const y = terrain.heightAt(x, z) + 3;
    const r = 0.7 + Math.random() * 1.1;
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), this._snowMat);
    mesh.castShadow = true;
    scene.add(mesh);
    const { body } = physics.addDynamic(mesh, R.ColliderDesc.ball(r).setFriction(0.6).setRestitution(0.1), {
      pos: { x, y, z }, mass: 20 + r * 30, ccd: true,
    });
    const dx = p.x - x, dz = p.z - z;
    const dl = Math.hypot(dx, dz) || 1;
    body.setLinvel({ x: (dx / dl) * 10, y: 0, z: (dz / dl) * 10 }, true);
    this.ctx.registerDynamic(body, 'snowball');
    this.snowballs.push({ body, mesh, ttl: 14 });
  }

  _spawnIcicle(playerPos, playerVel) {
    const { physics, scene } = this.ctx;
    const R = physics.RAPIER;
    const x = playerPos.x + playerVel.x * 1.2 + (Math.random() - 0.5) * 10;
    const z = playerPos.z + playerVel.z * 1.2 + (Math.random() - 0.5) * 10;
    const y = playerPos.y + 16 + Math.random() * 6;
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.6, 5), this._icicleMat);
    mesh.rotation.x = Math.PI;
    scene.add(mesh);
    const body = physics.world.createRigidBody(
      R.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation({ x: 1, y: 0, z: 0, w: 0 }),
    );
    physics.world.createCollider(R.ColliderDesc.cone(1.3, 0.5).setDensity(2).setFriction(0.4), body);
    physics.track(body, mesh);
    this.ctx.registerDynamic(body, 'icicle');
    this.ctx.sfx.wobble();
    this.icicles.push({ body, mesh, ttl: 9, dropAt: 9 - 0.9, dropped: false, air: 0 });
  }

  _tickIcicles(dt) {
    for (let i = this.icicles.length - 1; i >= 0; i--) {
      const ic = this.icicles[i];
      ic.ttl -= dt;
      const ip = ic.body.translation();
      const iv = ic.body.linvel();
      const landed = ic.dropped && Math.abs(iv.y) < 0.5 && ic.air > 0.3;
      if (!ic.dropped && ic.ttl < ic.dropAt) {
        ic.body.setBodyType(this.ctx.physics.RAPIER.RigidBodyType.Dynamic, true);
        ic.dropped = true;
      }
      if (ic.dropped && Math.abs(iv.y) > 2) ic.air += dt;
      if (landed || ic.ttl <= 0 || ip.y < KILL_Y) {
        this._tmp.set(ip.x, ip.y, ip.z);
        this.ctx.particles.shards(this._tmp, 0xbfe6ff);
        this.ctx.sfx.crack(1);
        this.ctx.unregisterDynamic(ic.body);
        this.ctx.physics.removeBody(ic.body);
        this.ctx.scene.remove(ic.mesh);
        this.icicles.splice(i, 1);
      }
    }
  }

  _strike(playerPos) {
    const { sfx, particles, player, packages } = this.ctx;
    const a = Math.random() * Math.PI * 2;
    const r = 3 + Math.random() * 18;
    const x = playerPos.x + Math.cos(a) * r;
    const z = playerPos.z + Math.sin(a) * r;
    const y = this.ctx.terrain.heightAt(x, z);
    this._bolt.position.set(x, y + 45, z);
    this._bolt.visible = true;
    this._boltTtl = 0.18;
    this.flash = 1;
    sfx.thunder();
    this.ctx.shake?.(0.5);
    this._tmp.set(x, y + 0.5, z);
    particles.sparks(this._tmp, 0xaad4ff, 20);
    const d = Math.hypot(playerPos.x - x, playerPos.z - z);
    if (d < 5) {
      player.body.applyImpulse({ x: (playerPos.x - x) * 60, y: 500, z: (playerPos.z - z) * 60 }, true);
      player.knockdown(1.1);
      const pkg = packages.current;
      if (pkg && pkg.def.fragile) packages.damage(pkg, 25);
      this.ctx.hud.toast('⚡ DIRECT-ISH HIT', false);
    }
  }
}

const EVENT_LABELS = {
  gale: '🌬️ GALE',
  boulderRain: '🪨 BOULDER RAIN',
  avalanche: '🏔️ AVALANCHE',
  thunder: '⛈️ THUNDERSTORM',
};
