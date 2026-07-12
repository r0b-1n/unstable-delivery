import RAPIER from '@dimforge/rapier3d-compat';

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
  // gameplay forces are applied at physics rate. Returns interpolation alpha.
  step(dt, beforeStep) {
    this._accum = Math.min(this._accum + dt, 0.12); // cap to avoid spiral of death
    while (this._accum >= this.fixedDt) {
      beforeStep?.(this.fixedDt);
      this.world.step(this.eventQueue);
      this._drainEvents();
      this._accum -= this.fixedDt;
    }
    this.syncMeshes();
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

  track(body, mesh) {
    this.synced.push({ body, mesh });
  }

  untrack(body) {
    const i = this.synced.findIndex((s) => s.body === body);
    if (i >= 0) this.synced.splice(i, 1);
  }

  syncMeshes() {
    for (const { body, mesh } of this.synced) {
      const p = body.translation();
      const q = body.rotation();
      mesh.position.set(p.x, p.y, p.z);
      mesh.quaternion.set(q.x, q.y, q.z, q.w);
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
