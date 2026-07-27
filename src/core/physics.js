import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

// Free GPU resources of a removed mesh subtree. Materials are only disposed
// when requested — many meshes share module-level materials.
export function disposeObject(root, disposeMaterials = false) {
  root.traverse((o) => {
    o.geometry?.dispose();
    if (disposeMaterials && o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
    }
  });
}

// Thin wrapper around a Rapier world: fixed-step simulation, mesh<->body
// syncing, and contact-force fan-out to registered listeners.
export class Physics {
  constructor() {
    this.RAPIER = RAPIER;
    this.world = null;
    this.eventQueue = null;
    this.synced = []; // { body, mesh }
    this.contactListeners = new Map(); // collider handle -> fn(otherHandle, forceMag)
    this.fixedDt = 1 / 60;
    this._accum = 0;
  }

  async init() {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -22, z: 0 });
    this.world.timestep = this.fixedDt;
    this.eventQueue = new RAPIER.EventQueue(true);
  }

  // Advance simulation in fixed steps; call cb(fixedDt) before every step so
  // gameplay forces are applied at physics rate. Meshes are rendered at the
  // interpolated pose between the last two steps so high-refresh displays
  // (and 60 Hz ones during uneven frames) don't see physics judder.
  step(dt, beforeStep) {
    this._accum = Math.min(this._accum + dt, 0.12); // cap to avoid spiral of death
    while (this._accum >= this.fixedDt) {
      this._snapshot();
      beforeStep?.(this.fixedDt);
      this.world.step(this.eventQueue);
      this._drainEvents();
      this._accum -= this.fixedDt;
    }
    this.alpha = this._accum / this.fixedDt;
    this.syncMeshes(this.alpha);
  }

  _snapshot() {
    for (const s of this.synced) {
      const p = s.body.translation();
      const q = s.body.rotation();
      const v = (s.prev ??= {});
      v.px = p.x; v.py = p.y; v.pz = p.z;
      v.qx = q.x; v.qy = q.y; v.qz = q.z; v.qw = q.w;
    }
  }

  _drainEvents() {
    this.eventQueue.drainContactForceEvents((ev) => {
      const mag = ev.totalForceMagnitude();
      const h1 = ev.collider1();
      const h2 = ev.collider2();
      this.contactListeners.get(h1)?.(h2, mag);
      this.contactListeners.get(h2)?.(h1, mag);
    });
    // Collision start/stop events are drained implicitly (we only use force events).
    this.eventQueue.drainCollisionEvents(() => {});
  }

  onContactForce(collider, fn) {
    this.contactListeners.set(collider.handle, fn);
  }

  offContactForce(collider) {
    this.contactListeners.delete(collider.handle);
  }

  // mesh may be null: the entry then only provides an interpolated pose
  // (entry.pos) for render-rate consumers like the camera. Returns the entry.
  track(body, mesh) {
    const entry = { body, mesh, prev: null, pos: { x: 0, y: 0, z: 0 } };
    this.synced.push(entry);
    return entry;
  }

  untrack(body) {
    const i = this.synced.findIndex((s) => s.body === body);
    if (i >= 0) this.synced.splice(i, 1);
  }

  syncMeshes(alpha = 1) {
    for (const s of this.synced) {
      const p = s.body.translation();
      const q = s.body.rotation();
      const v = s.prev;
      // Teleports (respawn, package snap-back) must not sweep across the map.
      const jump = v && (Math.abs(p.x - v.px) + Math.abs(p.y - v.py) + Math.abs(p.z - v.pz)) > 4;
      if (v && !jump && alpha < 1) {
        s.pos.x = v.px + (p.x - v.px) * alpha;
        s.pos.y = v.py + (p.y - v.py) * alpha;
        s.pos.z = v.pz + (p.z - v.pz) * alpha;
        if (s.mesh) {
          s.mesh.position.set(s.pos.x, s.pos.y, s.pos.z);
          _qa.set(v.qx, v.qy, v.qz, v.qw);
          _qb.set(q.x, q.y, q.z, q.w);
          _qa.slerp(_qb, alpha);
          s.mesh.quaternion.copy(_qa);
        }
      } else {
        s.pos.x = p.x; s.pos.y = p.y; s.pos.z = p.z;
        if (s.mesh) {
          s.mesh.position.set(p.x, p.y, p.z);
          s.mesh.quaternion.set(q.x, q.y, q.z, q.w);
        }
      }
    }
  }

  // Convenience: dynamic body + collider + mesh, tracked for syncing.
  addDynamic(mesh, colliderDesc, { pos, mass, linearDamping = 0.05, angularDamping = 0.1, ccd = false } = {}) {
    const desc = this.RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setLinearDamping(linearDamping)
      .setAngularDamping(angularDamping)
      .setCcdEnabled(ccd);
    const body = this.world.createRigidBody(desc);
    if (mass !== undefined) colliderDesc.setMass(mass);
    const collider = this.world.createCollider(colliderDesc, body);
    this.track(body, mesh);
    return { body, collider };
  }

  removeBody(body) {
    this.untrack(body);
    this.world.removeRigidBody(body);
  }
}
