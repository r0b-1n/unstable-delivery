import * as THREE from 'three';
import { PEAK, zoneAt, KILL_Y } from '../world/terrain.js';

// The chaos director: wind, boulders, icicles and summit lightning, all
// scaled by how many deliveries the courier has survived.
export class Director {
  constructor(ctx) {
    this.ctx = ctx;
    this.level = 0;
    this.boulders = [];
    this.icicles = [];
    this._boulderTimer = 8;
    this._icicleTimer = 5;
    this._lightningTimer = 7;
    this._windAngle = 0.7;
    this._tmp = new THREE.Vector3();

    this._boulderMat = new THREE.MeshStandardMaterial({ color: 0x5d6480, flatShading: true, roughness: 1 });
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
    if (completed === 2) this.ctx.hud.toast('🌬️ The wind is picking up…', true);
    if (completed === 3) this.ctx.hud.toast('🪨 Was that a boulder?', true);
    if (completed === 5) this.ctx.hud.toast('⛈️ The summit storm has noticed you.', true);
  }

  fixedUpdate(dt, t) {
    const { wind, player, sfx } = this.ctx;
    const p = player.body.translation();
    const alt01 = THREE.MathUtils.clamp(p.y / PEAK, 0, 1);
    const zone = zoneAt(p.y);

    // --- Wind: slow rotating direction, layered gusts, scales with altitude+level ---
    this._windAngle += dt * 0.03;
    const gust01 = Math.max(0,
      Math.sin(t * 0.43) * 0.5 + Math.sin(t * 1.17 + 2) * 0.35 + Math.sin(t * 2.9) * 0.15,
    );
    this.ctx.gust = gust01;
    const strength = (2 + alt01 * 14 + Math.min(this.level, 8) * 1.2) * (0.25 + gust01);
    wind.set(Math.cos(this._windAngle) * strength, 0, Math.sin(this._windAngle) * strength);
    sfx.setWind(alt01, gust01 * Math.min(0.4 + this.level * 0.1, 1));

    // --- Rolling boulders (level 3+, above the meadows) ---
    if (this.level >= 3 && p.y > PEAK * 0.3) {
      this._boulderTimer -= dt;
      if (this._boulderTimer <= 0 && this.boulders.length < 4) {
        this._boulderTimer = Math.max(11 - this.level, 4);
        this._spawnBoulder(p);
      }
    }
    for (let i = this.boulders.length - 1; i >= 0; i--) {
      const b = this.boulders[i];
      b.ttl -= dt;
      const bp = b.body.translation();
      if (b.ttl <= 0 || bp.y < KILL_Y) {
        this.ctx.unregisterDynamic(b.body);
        this.ctx.physics.removeBody(b.body);
        this.ctx.scene.remove(b.mesh);
        this.boulders.splice(i, 1);
      }
    }

    // --- Icicles (level 2+, frozen zone and up) ---
    if (this.level >= 2 && (zone.key === 'frozen' || zone.key === 'summit')) {
      this._icicleTimer -= dt;
      if (this._icicleTimer <= 0 && this.icicles.length < 5) {
        this._icicleTimer = Math.max(8 - this.level * 0.5, 2.5);
        this._spawnIcicle(p, player.body.linvel());
      }
    }
    for (let i = this.icicles.length - 1; i >= 0; i--) {
      const ic = this.icicles[i];
      ic.ttl -= dt;
      const ip = ic.body.translation();
      const iv = ic.body.linvel();
      // Shatter on any real impact (velocity suddenly killed) or timeout.
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

    // --- Summit lightning ---
    this.flash = Math.max(0, this.flash - dt * 3);
    this._boltTtl -= dt;
    if (this._boltTtl <= 0) this._bolt.visible = false;
    if (zone.key === 'summit') {
      this._lightningTimer -= dt;
      if (this._lightningTimer <= 0) {
        this._lightningTimer = Math.max(9 - this.level * 0.6, 3.5) + Math.random() * 4;
        this._strike(p);
      }
    }
  }

  _spawnBoulder(playerPos) {
    const { terrain, physics, scene, hud } = this.ctx;
    const R = physics.RAPIER;
    // Drop onto the path a bit above the courier, rolling downhill toward them.
    const near = terrain._nearestPath(playerPos.x, playerPos.z);
    const t = Math.min(near.p.t + 0.035, 0.99);
    const pp = terrain.pathPoint(t);
    const y = terrain.heightAt(pp.x, pp.z) + 6;
    const r = 1.0 + Math.random() * 0.8;
    const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), this._boulderMat);
    mesh.castShadow = true;
    scene.add(mesh);
    const { body } = physics.addDynamic(mesh, R.ColliderDesc.ball(r).setFriction(0.8).setRestitution(0.2), {
      pos: { x: pp.x, y, z: pp.z }, mass: 40 + r * 40, angularDamping: 0.05, ccd: true,
    });
    const dx = playerPos.x - pp.x, dz = playerPos.z - pp.z;
    const dl = Math.hypot(dx, dz) || 1;
    body.setLinvel({ x: (dx / dl) * 7, y: 0, z: (dz / dl) * 7 }, true);
    this.ctx.registerDynamic(body, 'boulder');
    this.boulders.push({ body, mesh, ttl: 26 });
    hud.toast('🪨 BOULDER!', true);
  }

  _spawnIcicle(playerPos, playerVel) {
    const { physics, scene } = this.ctx;
    const R = physics.RAPIER;
    // Aim ahead of the courier, with generous scatter — menace, not murder.
    const x = playerPos.x + playerVel.x * 1.2 + (Math.random() - 0.5) * 10;
    const z = playerPos.z + playerVel.z * 1.2 + (Math.random() - 0.5) * 10;
    const y = playerPos.y + 16 + Math.random() * 6;
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.6, 5), this._icicleMat);
    mesh.rotation.x = Math.PI; // point down
    scene.add(mesh);
    const body = physics.world.createRigidBody(
      R.RigidBodyDesc.fixed().setTranslation(x, y, z)
        .setRotation({ x: 1, y: 0, z: 0, w: 0 }),
    );
    physics.world.createCollider(R.ColliderDesc.cone(1.3, 0.5).setDensity(2).setFriction(0.4), body);
    physics.track(body, mesh);
    this.ctx.registerDynamic(body, 'icicle');
    this.ctx.sfx.wobble();
    this.icicles.push({ body, mesh, ttl: 9, dropAt: 9 - 0.9, dropped: false, air: 0 });
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
