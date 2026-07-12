import * as THREE from 'three';
import { zoneAt, KILL_Y } from '../world/terrain.js';

const WALK = 7.2;
const SPRINT = 10.8;
const JUMP = 10.5;

// Dynamic capsule with force-based movement so the world can still shove,
// launch and bully the courier. Also owns the third-person camera.
export class PlayerController {
  constructor(ctx, spawnPos) {
    this.ctx = ctx;
    this.spawn = spawnPos.clone();
    this.keys = new Set();
    this.grounded = false;
    this.groundIsTerrain = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.knockTimer = 0;
    this.parachute = false;
    this._parachuteWasOn = false;
    this.airborneBySomethingFun = false;
    this.yaw = 2.5;
    this.pitch = 0.32;
    this.camDist = 7;
    this.onIce = false;

    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._anchor = new THREE.Vector3();
    this._camTarget = new THREE.Vector3();
    this._camPos = new THREE.Vector3();

    this._buildBody();
    this._bindInput();
  }

  _buildBody() {
    const { physics } = this.ctx;
    const R = physics.RAPIER;
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(this.spawn.x, this.spawn.y, this.spawn.z)
      .lockRotations()
      .setCcdEnabled(true);
    this.body = physics.world.createRigidBody(desc);
    // Membership group 0x0002; collides with everything except packages (0x0004),
    // so cargo can never bludgeon the courier by spring oscillation.
    const col = R.ColliderDesc.capsule(0.55, 0.35)
      .setFriction(0.15)
      .setMass(80)
      .setCollisionGroups((0x0002 << 16) | 0xfffb)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(30000);
    this.collider = physics.world.createCollider(col, this.body);
    physics.onContactForce(this.collider, (other, mag) => {
      // ~ mass * deltaV / dt: knock down only on truly violent hits (fast
      // boulders, huge falls) — not on ordinary hard landings.
      if (mag > 115000 && this.knockTimer <= 0) this.knockdown(0.9);
    });
    this.ctx.registerDynamic(this.body, 'player');
  }

  _bindInput() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.jumpBuffer = 0.14;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.ctx.renderer.domElement) return;
      this.yaw -= e.movementX * 0.0026;
      this.pitch = THREE.MathUtils.clamp(this.pitch + e.movementY * 0.0022, -0.55, 1.25);
    });
    window.addEventListener('wheel', (e) => {
      this.camDist = THREE.MathUtils.clamp(this.camDist + Math.sign(e.deltaY) * 0.8, 3.5, 12);
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  getCarryAnchor() {
    // Between the courier's hands when the rig is loaded; fallback in front of chest.
    const hands = this.ctx.character?.loaded && this.ctx.character.getHandsAnchor(this._anchor);
    if (hands) return hands;
    const p = this.body.translation();
    this._fwd.set(Math.sin(this.charYaw ?? this.yaw), 0, Math.cos(this.charYaw ?? this.yaw));
    return this._anchor.set(p.x + this._fwd.x * 0.9, p.y + 0.15, p.z + this._fwd.z * 0.9);
  }

  knockdown(sec) {
    this.knockTimer = Math.max(this.knockTimer, sec);
    this.ctx.sfx.thud(1.6);
    this.ctx.shake?.(0.55);
    this.ctx.packages.dropCarried();
    const p = this.body.translation();
    this.ctx.particles.dust(new THREE.Vector3(p.x, p.y - 0.5, p.z), 2);
  }

  respawn() {
    const cp = this.ctx.checkpoint;
    this.body.setTranslation({ x: cp.x, y: cp.y + 2, z: cp.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.knockTimer = 0.4;
    const pkg = this.ctx.packages.current;
    if (pkg) {
      pkg.body.setTranslation({ x: cp.x + 1, y: cp.y + 2.5, z: cp.z }, true);
      pkg.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      if (pkg.def.fragile) this.ctx.packages.damage(pkg, 15);
      pkg.carried = true;
    }
    this.ctx.hud.toast(pickRespawnQuip(), false);
    this.ctx.sfx.fail();
  }

  _groundCheck() {
    const { physics } = this.ctx;
    const R = physics.RAPIER;
    const p = this.body.translation();
    const shape = new R.Ball(0.3);
    const hit = physics.world.castShape(
      { x: p.x, y: p.y - 0.55, z: p.z },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 0, y: -1, z: 0 },
      shape, 0.42, 0.42, true, undefined, undefined, undefined, this.body,
    );
    this.grounded = !!hit;
    this.groundIsTerrain = !!hit && hit.collider.handle === this.ctx.terrain.collider.handle;
    this.groundVel = { x: 0, y: 0, z: 0 };
    if (this.grounded) {
      this.coyote = 0.13;
      this.airborneBySomethingFun = false;
      // Moving ground (gondolas, elevators, islands): ride along with it.
      const gb = hit.collider.parent();
      if (gb && !gb.isFixed()) this.groundVel = gb.linvel();
    }
  }

  fixedUpdate(dt) {
    const { wind, sfx } = this.ctx;
    const p = this.body.translation();
    const v = this.body.linvel();

    this._groundCheck();
    this.coyote = Math.max(0, this.coyote - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.knockTimer = Math.max(0, this.knockTimer - dt);

    const zone = zoneAt(p.y);
    this.onIce = this.grounded && this.groundIsTerrain && zone.key === 'frozen';
    this.collider.setFriction(this.onIce ? 0.01 : 0.15);

    // --- Input direction, camera-relative ---
    let ix = 0, iz = 0;
    if (this.keys.has('KeyW')) iz += 1;
    if (this.keys.has('KeyS')) iz -= 1;
    if (this.keys.has('KeyA')) ix -= 1;
    if (this.keys.has('KeyD')) ix += 1;
    const hasInput = (ix || iz) && this.knockTimer <= 0;
    this._fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(-1);
    this._right.set(-this._fwd.z, 0, this._fwd.x);
    let dx = this._fwd.x * iz + this._right.x * ix;
    let dz = this._fwd.z * iz + this._right.z * ix;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;

    // Heavy cargo slows you down.
    const pkg = this.ctx.packages.current;
    const carryMass = pkg && pkg.carried ? pkg.def.mass : 0;
    const massFactor = 1 / (1 + carryMass / 60);
    const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? SPRINT : WALK) * massFactor;

    // --- Velocity approach via impulses so external forces still matter ---
    // Desired velocity is relative to whatever we're standing on.
    const wantX = (hasInput ? dx * speed : 0) + this.groundVel.x;
    const wantZ = (hasInput ? dz * speed : 0) + this.groundVel.z;
    let gain;
    if (this.onIce) gain = hasInput ? 2.2 : 0.4;         // skating rink
    else if (this.grounded) gain = hasInput ? 14 : 10;
    else gain = 2.6;                                      // air control
    if (this.knockTimer > 0) gain *= 0.15;
    const m = this.body.mass();
    const k = Math.min(gain * dt, 1);
    this.body.applyImpulse({ x: (wantX - v.x) * m * k, y: 0, z: (wantZ - v.z) * m * k }, true);

    // --- Jump (with buffer + coyote time) ---
    if (this.jumpBuffer > 0 && this.coyote > 0 && this.knockTimer <= 0) {
      this.jumpBuffer = 0;
      this.coyote = 0;
      const jumpV = JUMP * (1 / (1 + carryMass / 90));
      this.body.setLinvel({ x: v.x, y: Math.max(v.y, jumpV), z: v.z }, true);
      sfx.jump();
    }

    // --- Parcel-parachute: hold Space while falling ---
    const falling = !this.grounded && v.y < -3;
    this.parachute = falling && this.keys.has('Space') && this.knockTimer <= 0;
    if (this.parachute) {
      // Strong drag toward a gentle terminal velocity, plus steer authority.
      const targetVy = -3.4;
      this.body.applyImpulse({ x: 0, y: (targetVy - v.y) * m * Math.min(25 * dt, 1), z: 0 }, true);
      if (hasInput) this.body.applyImpulse({ x: dx * m * 8 * dt, y: 0, z: dz * m * 8 * dt }, true);
      this.body.applyImpulse({ x: wind.x * m * 0.04 * dt, y: 0, z: wind.z * m * 0.04 * dt }, true);
      if (!this._parachuteWasOn) sfx.whooshParachute();
    }
    this._parachuteWasOn = this.parachute;

    // --- Wind shoves you around: hard when airborne, and from the cliffs
    // upward it pushes even while your boots are on the ground. ---
    if (!this.grounded) {
      this.body.applyImpulse({ x: wind.x * m * 0.02 * dt, y: 0, z: wind.z * m * 0.02 * dt }, true);
    } else if (zone.key === 'cliffs' || zone.key === 'frozen' || zone.key === 'summit') {
      const g = this.onIce ? 0.016 : 0.009;
      this.body.applyImpulse({ x: wind.x * m * g * dt, y: 0, z: wind.z * m * g * dt }, true);
    }

    // Footsteps
    if (this.grounded && hasInput && Math.hypot(v.x, v.z) > 2) {
      sfx.footstep(zone.key === 'frozen' || zone.key === 'summit' ? 'snow' : zone.key === 'cliffs' ? 'rock' : 'grass');
    }

    // Landing dust + thud + real fall damage
    if (this.grounded && this._wasAirborne && this._lastVy < -8) {
      sfx.thud(Math.min(-this._lastVy / 16, 1.6));
      this.ctx.particles.dust(new THREE.Vector3(p.x, p.y - 0.9, p.z), Math.min(-this._lastVy / 10, 2.4));
      this.ctx.shake?.(Math.min(-this._lastVy / 40, 0.6));
      if (this._lastVy < -17) {
        // Bone-rattler: knockdown, and the cargo feels it too.
        this.knockdown(0.9);
        const pkg = this.ctx.packages.current;
        if (pkg && pkg.def.fragile) this.ctx.packages.damage(pkg, (-this._lastVy - 17) * 1.8);
        this.ctx.hud.toast('🦴 That landing had consequences.', true);
      }
    }
    this._wasAirborne = !this.grounded;
    this._lastVy = v.y;

    // Fell off the world
    if (p.y < KILL_Y) this.respawn();
  }

  // Camera + character facing run at render rate.
  update(dt) {
    const { camera, physics } = this.ctx;
    const p = this.body.translation();
    const v = this.body.linvel();

    // Face movement direction (or camera direction when idle-carrying).
    const hSpeed = Math.hypot(v.x, v.z);
    if (hSpeed > 1.2 && this.knockTimer <= 0) {
      const target = Math.atan2(v.x, v.z);
      this.charYaw = lerpAngle(this.charYaw ?? target, target, Math.min(dt * 10, 1));
    }

    this._camTarget.set(p.x, p.y + 1.35, p.z);
    const cd = Math.cos(this.pitch), sd = Math.sin(this.pitch);
    this._camPos.set(
      this._camTarget.x + Math.sin(this.yaw) * cd * this.camDist,
      this._camTarget.y + sd * this.camDist,
      this._camTarget.z + Math.cos(this.yaw) * cd * this.camDist,
    );
    // Pull the camera in when terrain blocks the view.
    const dir = this._camPos.clone().sub(this._camTarget);
    const len = dir.length();
    dir.normalize();
    const ray = new physics.RAPIER.Ray(this._camTarget, dir);
    const hit = physics.world.castRay(ray, len, true, undefined, undefined, undefined, this.body);
    const dist = hit ? Math.max(hit.timeOfImpact - 0.35, 0.8) : len;
    this._camPos.copy(this._camTarget).addScaledVector(dir, dist);
    camera.position.lerp(this._camPos, Math.min(dt * 14, 1));
    camera.lookAt(this._camTarget);
  }
}

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const QUIPS = [
  '☠️ Gravity: 1 — You: 0. Back to the checkpoint.',
  '📋 That fall has been noted in your performance review.',
  '🏔️ The mountain thanks you for your donation.',
  '📦 Package status: emotionally damaged. So are you.',
  '🧾 Respawn fee waived (this time).',
];
function pickRespawnQuip() {
  return QUIPS[(Math.random() * QUIPS.length) | 0];
}
