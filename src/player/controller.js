import * as THREE from 'three';
import { zoneAt, KILL_Y } from '../world/terrain.js';

// WALK dropped from 7.2 so the sprint delta reads as a GEAR CHANGE (1.64x,
// was 1.50x) instead of a nudge. JUMP up from 10.5 with a harsher mass penalty
// (/70, was /90): unladen you clear more, loaded you clear noticeably less,
// which is the whole point of carrying something.
const WALK = 6.6;
const SPRINT = 10.8;
const JUMP = 11.2;

// Scratch for the moving-platform carry, which runs 60 times a second.
const _carryV = new THREE.Vector3();
const _carryT = new THREE.Vector3();
const _carryQa = new THREE.Quaternion();
const _carryQb = new THREE.Quaternion();

// Dynamic capsule with force-based movement so the world can still shove,
// launch and bully the courier. Also owns the third-person camera.
export class PlayerController {
  constructor(ctx, spawnPos) {
    this.ctx = ctx;
    this.spawn = spawnPos.clone();
    this.keys = new Set();
    this.grounded = false;
    this.groundIsTerrain = false;
    this.groundBody = null;
    this._carrier = null;      // handle of the platform currently carrying us
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.knockTimer = 0;
    this.parachute = false;
    this._parachuteWasOn = false;
    this.airborneBySomethingFun = false;
    this.lastLaunchT = -99;   // gameTime of the last mushroom/geyser launch (airmail bonus)
    this.rollTimer = 0;       // recovery-roll animation window
    this.slide = false;       // belly-slide state
    this._slideCd = 0;
    this._puntCd = 0;
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
      // boulders, huge falls) — not on ordinary hard landings. A buffered
      // Space (recovery roll incoming) or an active roll absorbs the hit.
      if (mag > 115000 && this.knockTimer <= 0 && this.jumpBuffer <= 0 && this.rollTimer <= 0) this.knockdown(0.9);
    });
    this.ctx.registerDynamic(this.body, 'player');
    // Interpolated pose for render-rate consumers (camera, character root).
    this.syncEntry = physics.track(this.body, null);
    this._groundBall = new R.Ball(0.3);
    this._camRay = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  // Render-rate position, interpolated between physics steps.
  renderPos() {
    return this.syncEntry?.pos ?? this.body.translation();
  }

  _bindInput() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.jumpBuffer = 0.14;
      if (e.code === 'KeyF') this._throwOrPunt();
      // Set down rather than hurl. Seesaws and crate stacks have been in the
      // world since the first commit with no way to put weight on them.
      if (e.code === 'KeyG') this.ctx.packages.setDown();
    });
    window.addEventListener('mousedown', (e) => {
      if (e.button === 2 && document.pointerLockElement === this.ctx.renderer.domElement) this._throwOrPunt();
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
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

  // F / right-click: throw the carried package, or punt whatever's in front.
  _throwOrPunt() {
    if (this.knockTimer > 0) return;
    const { packages } = this.ctx;
    const dx = -Math.sin(this.yaw), dz = -Math.cos(this.yaw); // camera forward
    if (packages.current?.carried) {
      packages.throwCarried(dx, dz);
      this.throwAnimT = 0.3;
      return;
    }
    if (this._puntCd > 0) return;
    const p = this.body.translation();
    let best = null, bestD = Infinity;
    for (const d of this.ctx.dynamics) {
      if (d.kind === 'player') continue;
      const bp = d.body.translation();
      const ox = bp.x - p.x, oy = bp.y - p.y, oz = bp.z - p.z;
      const dist = Math.hypot(ox, oy, oz);
      if (dist > 2.0 || ox * dx + oz * dz < 0) continue; // in front only
      if (dist < bestD) { bestD = dist; best = d; }
    }
    if (!best) return;
    this._puntCd = 0.5;
    this.throwAnimT = 0.25;
    const m = best.body.mass();
    best.body.applyImpulse({ x: dx * m * 7, y: m * 3.5, z: dz * m * 7 }, true);
    const bp = best.body.translation();
    this.ctx.particles.dust(new THREE.Vector3(bp.x, bp.y, bp.z), 1);
    this.ctx.sfx.pop();
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
    this.ctx.hud.toast(`quip.${(Math.random() * 5) | 0}`);
    this.ctx.sfx.fail();
    if (this.ctx.shift) this.ctx.shift.stats.falls++;
    if (!this.ctx.meta?.eff('waiver')) this.ctx.deliveries?.breakChain('reason.respawn');
  }

  _groundCheck() {
    const { physics } = this.ctx;
    const p = this.body.translation();
    // targetDistance 0.02 (contact skin), maxToi 0.42 — the old 0.42/0.42 made
    // "grounded" trip up to 0.8 m above the surface. filterGroups mirrors the
    // capsule's own groups so the carried package (group 0x0004) is never
    // mistaken for ground (scene queries ignore collider groups otherwise).
    const hit = physics.world.castShape(
      { x: p.x, y: p.y - 0.55, z: p.z },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 0, y: -1, z: 0 },
      this._groundBall, 0.02, 0.42, true, undefined, (0x0002 << 16) | 0xfffb, undefined, this.body,
    );
    this.grounded = !!hit;
    this.groundIsTerrain = !!hit && hit.collider.handle === this.ctx.terrain.collider.handle;
    this.groundVel = { x: 0, y: 0, z: 0 };
    this.groundBody = null;
    if (this.grounded) {
      this.coyote = 0.13;
      // Moving ground (gondolas, elevators, islands).
      const gb = hit.collider.parent();
      if (gb && !gb.isFixed()) { this.groundBody = gb; this.groundVel = gb.linvel(); }
    }
  }

  // Rigid carry on moving ground.
  //
  // This used to be done by adding the platform's velocity to the movement
  // target and letting the impulse controller chase it. That works on a lift,
  // which only translates. It does not work on a gondola, which YAWS: the
  // controller approaches the new target with a time constant of a tenth of a
  // second, and on every curve the rider slides outward by exactly that lag.
  // At 8.6 m/s it was survivable, which is why the cable car was capped there
  // for three commits while the anvil's own label said TAKE THE CABLE CAR. At
  // anything faster the rider is scraped over the bordwall.
  //
  // So: take the platform's frame-to-frame transform and apply it to the
  // courier outright. Position within the cabin is preserved through turns, and
  // the movement controller below only ever has to produce motion RELATIVE to
  // the floor — which is what a person walking about in a cable car is doing.
  _carryPlatform() {
    const gb = this.groundBody;
    if (!gb) {
      // Two frames of grace before declaring the ride over. A cabin crossing a
      // pylon jostles its passenger enough to break contact for a single step,
      // and handing them 24 m/s of launch momentum for that would fire them
      // out of a gondola they never left.
      this._carryLost = (this._carryLost ?? 0) + 1;
      if (this._carrier !== null && this._carryLost >= 2) {
        // Stepping off keeps the momentum. Without this the courier would leave
        // a gondola doing 24 m/s and simply drop, which is both wrong and much
        // less funny than the alternative.
        if (this._carryVel) {
          const v = this.body.linvel();
          this.body.setLinvel({ x: v.x + this._carryVel.x, y: v.y, z: v.z + this._carryVel.z }, true);
        }
        this._carrier = null;
      }
      return;
    }
    this._carryLost = 0;
    const tr = gb.translation(), rot = gb.rotation();
    if (this._carrier === gb.handle) {
      const p = this.body.translation();
      // Express the courier in the platform's OLD frame, then read them back
      // out of its new one.
      _carryQa.set(this._prevRot.x, this._prevRot.y, this._prevRot.z, this._prevRot.w).conjugate();
      _carryQb.set(rot.x, rot.y, rot.z, rot.w);
      _carryV.set(p.x - this._prevPos.x, p.y - this._prevPos.y, p.z - this._prevPos.z)
        .applyQuaternion(_carryQa)
        .applyQuaternion(_carryQb)
        .add(_carryT.set(tr.x, tr.y, tr.z));
      this.body.setTranslation({ x: _carryV.x, y: _carryV.y, z: _carryV.z }, true);
    }
    this._carrier = gb.handle;
    this._prevPos = { x: tr.x, y: tr.y, z: tr.z };
    this._prevRot = { x: rot.x, y: rot.y, z: rot.z, w: rot.w };
    this._carryVel = gb.linvel();
  }

  fixedUpdate(dt) {
    const { wind, sfx } = this.ctx;
    const p = this.body.translation();
    const v = this.body.linvel();

    this._groundCheck();
    this._carryPlatform();
    this.coyote = Math.max(0, this.coyote - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.knockTimer = Math.max(0, this.knockTimer - dt);
    this.rollTimer = Math.max(0, this.rollTimer - dt);
    this._puntCd = Math.max(0, this._puntCd - dt);
    this._slideCd = Math.max(0, this._slideCd - dt);
    this.throwAnimT = Math.max(0, (this.throwAnimT ?? 0) - dt);

    const zone = zoneAt(p.y);
    this.onIce = this.grounded && this.groundIsTerrain && zone.key === 'frozen';

    // --- Belly slide: hold C while moving to toboggan on your stomach ---
    const hSpeedNow = Math.hypot(v.x, v.z);
    const wantSlide = this.keys.has('KeyC') && this.knockTimer <= 0;
    if (!this.slide && wantSlide && this.grounded && hSpeedNow > 5 && this._slideCd <= 0) {
      this.slide = true;
      const dl = hSpeedNow || 1;
      this.body.applyImpulse({ x: (v.x / dl) * this.body.mass() * 3, y: 0, z: (v.z / dl) * this.body.mass() * 3 }, true);
      sfx.whooshParachute();
      this.ctx.particles.dust(new THREE.Vector3(p.x, p.y - 0.8, p.z), 1.2);
    }
    // Ends on release, when we bog down, or when the parachute takes over —
    // sliding off a ledge briefly airborne is fine and keeps the flow.
    if (this.slide && (!wantSlide || this.parachute || (this.grounded && hSpeedNow < 2.5))) {
      this.slide = false;
      this._slideCd = 0.6;
    }
    this.collider.setFriction(this.onIce || this.slide ? 0.01 : 0.15);

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
    const massFactor = 1 / (1 + carryMass / (this.ctx.meta?.eff('carryDivisor') ?? 60));
    const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? SPRINT : WALK) * massFactor;

    // --- Velocity approach via impulses so external forces still matter ---
    // Desired velocity is relative to whatever we're standing on — and on
    // moving ground that is now literally true, because _carryPlatform has
    // already applied the floor's own motion. Adding groundVel here as well
    // would move the courier twice per step and post them out the front of
    // the cabin.
    const wantX = hasInput ? dx * speed : 0;
    const wantZ = hasInput ? dz * speed : 0;
    let gain;
    if (this.slide && !this.grounded) gain = 2.6;         // airborne: normal air control
    else if (this.slide) gain = hasInput ? 1.5 : 0.25;    // steer, don't brake
    else if (this.onIce) gain = hasInput ? 2.2 : 0.4;     // skating rink
    // On moving ground the carry already supplies the floor's motion, so this
    // controller only has to hold the courier still RELATIVE to it. The contact
    // solver disagrees: friction against a floor doing 24 m/s keeps injecting
    // world velocity, which the carry then adds to, and the courier slides out
    // the front of the cabin at about 1.6 m/s. A much stiffer gain drains that
    // faster than friction can fill it.
    else if (this.grounded) gain = this.groundBody ? 40 : (hasInput ? 14 : 10);
    else gain = 2.6;                                      // air control
    if (this.knockTimer > 0) gain *= 0.15;
    const m = this.body.mass();
    const k = Math.min(gain * dt, 1);
    this.body.applyImpulse({ x: (wantX - v.x) * m * k, y: 0, z: (wantZ - v.z) * m * k }, true);

    // --- Jump (with buffer + coyote time) ---
    // On a hard-landing frame the buffered Space belongs to the recovery
    // roll (below), not to an instant re-jump — otherwise the roll is
    // unreachable: coyote refreshes the moment we touch down.
    const fallLimit = this.ctx.meta?.eff('fallThreshold') ?? 17;
    const hardLandingNow = this.grounded && this._wasAirborne && this._lastVy < -fallLimit && !this.airborneBySomethingFun;
    if (this.jumpBuffer > 0 && this.coyote > 0 && this.knockTimer <= 0 && !hardLandingNow) {
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.slide = false;
      const jumpV = JUMP * (1 / (1 + carryMass / 70));
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
      const steer = this.ctx.meta?.eff('chuteSteer') ?? 8;
      if (hasInput) this.body.applyImpulse({ x: dx * m * steer * dt, y: 0, z: dz * m * steer * dt }, true);
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
    if (this.grounded && hasInput && !this.slide && Math.hypot(v.x, v.z) > 2) {
      sfx.footstep(zone.key === 'frozen' || zone.key === 'summit' ? 'snow' : zone.key === 'cliffs' ? 'rock' : 'grass');
    }
    // Slide scrape: snow spray behind the toboggan.
    if (this.slide && this.grounded && Math.hypot(v.x, v.z) > 4 && Math.random() < dt * 18) {
      this.ctx.particles.dust(new THREE.Vector3(p.x, p.y - 0.85, p.z), 0.7);
    }

    // Landing dust + thud + real fall damage
    if (this.grounded && this._wasAirborne && this._lastVy < -8) {
      sfx.thud(Math.min(-this._lastVy / 16, 1.6));
      this.ctx.particles.dust(new THREE.Vector3(p.x, p.y - 0.9, p.z), Math.min(-this._lastVy / 10, 2.4));
      this.ctx.shake?.(Math.min(-this._lastVy / 40, 0.6));
      if (this._lastVy < -fallLimit && !this.airborneBySomethingFun) {
        if (this.jumpBuffer > 0) {
          // RECOVERY ROLL: Space just before touchdown converts the crash
          // into a shoulder roll — no knockdown, no cargo damage, keep speed.
          this.jumpBuffer = 0;
          this.rollTimer = 0.45;
          this.knockTimer = 0; // the roll absorbs any same-tick contact hit
          const hs = Math.hypot(v.x, v.z) || 1;
          this.body.applyImpulse({ x: (v.x / hs) * m * 2.5, y: 0, z: (v.z / hs) * m * 2.5 }, true);
          sfx.whooshParachute();
          this.ctx.shake?.(0.18);
          this.ctx.hud.toast('toast.rolled', null, { small: true });
        } else {
          // Bone-rattler: knockdown, and the cargo feels it too.
          this.knockdown(0.9);
          const pkg = this.ctx.packages.current;
          if (pkg && pkg.def.fragile) this.ctx.packages.damage(pkg, (-this._lastVy - fallLimit) * 1.8);
          this.ctx.hud.toast('toast.hardlanding', null, { small: true });
        }
      }
    }
    if (this.grounded) this.airborneBySomethingFun = false; // after the landing branch read it
    this._wasAirborne = !this.grounded;
    this._lastVy = v.y;

    // Fell off the world
    if (p.y < KILL_Y) this.respawn();
  }

  // Camera + character facing run at render rate.
  update(dt) {
    const { camera, physics } = this.ctx;
    const p = this.renderPos();
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
    this._camRay.origin = this._camTarget;
    this._camRay.dir = dir;
    const hit = physics.world.castRay(this._camRay, len, true, undefined, (0x0002 << 16) | 0xfffb, undefined, this.body);
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

