import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// The courier model is a single static mesh (no skeleton), so all animation
// is procedural: run-bob, lean, cargo stagger, knockdown tumble.
export class Character {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = new THREE.Group();   // follows the physics body
    this.rig = new THREE.Group();    // procedural animation offsets
    this.root.add(this.rig);
    ctx.scene.add(this.root);
    this._spin = 0;
    this._bobT = 0;

    // Parcel-parachute: a cardboard glider that pops open mid-air.
    const cardboard = new THREE.MeshStandardMaterial({ color: 0xc98b4e, flatShading: true, side: THREE.DoubleSide });
    this.chute = new THREE.Group();
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 1.8), cardboard);
    canopy.rotation.z = 0.06;
    this.chute.add(canopy);
    const tape = new THREE.Mesh(new THREE.BoxGeometry(2.64, 0.09, 0.3), new THREE.MeshStandardMaterial({ color: 0x8a5a2b }));
    this.chute.add(tape);
    for (const [x, z] of [[-1.1, -0.7], [1.1, -0.7], [-1.1, 0.7], [1.1, 0.7]]) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.3, 3), cardboard);
      s.position.set(x * 0.6, -0.65, z * 0.6);
      s.rotation.z = x * 0.4;
      s.rotation.x = -z * 0.4;
      this.chute.add(s);
    }
    this.chute.position.y = 2.6;
    this.chute.visible = false;
    this.rig.add(this.chute);
  }

  async load() {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync('./assets/character.glb');
    const model = gltf.scene;

    // Normalise: 1.72 m tall, feet at local origin.
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = 1.72 / size.y;
    model.scale.setScalar(scale);
    box.setFromObject(model);
    model.position.y -= box.min.y;
    model.position.x -= (box.min.x + box.max.x) / 2;
    model.position.z -= (box.min.z + box.max.z) / 2;
    model.rotation.y = Math.PI; // model's face is -Z; game forward is +Z
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        if (o.material) o.material.roughness = 0.85;
      }
    });
    this.model = model;
    this.rig.add(model);
  }

  update(dt, t) {
    const { player, camera } = this.ctx;
    const p = player.body.translation();
    const v = player.body.linvel();
    const hSpeed = Math.hypot(v.x, v.z);

    // Root follows the capsule (feet at capsule bottom).
    this.root.position.set(p.x, p.y - 0.9, p.z);
    this.root.rotation.y = player.charYaw ?? 0;

    if (player.knockTimer > 0) {
      // Comedic tumble.
      this._spin += dt * 13;
      this.rig.rotation.x = this._spin;
      this.rig.rotation.z = Math.sin(this._spin * 0.7) * 0.5;
      this.rig.position.y = 0.4 + Math.sin(this._spin) * 0.15;
    } else {
      this._spin = 0;
      const pkg = this.ctx.packages.current;
      const carrying = pkg && pkg.carried;
      const heavy = carrying ? pkg.def.mass / 45 : 0;

      // Run bob + waddle.
      if (player.grounded && hSpeed > 1) {
        this._bobT += dt * (4 + hSpeed * 1.1);
        this.rig.position.y = Math.abs(Math.sin(this._bobT)) * 0.09;
        this.rig.rotation.z = Math.sin(this._bobT) * 0.06 * (1 + heavy);
      } else {
        this.rig.position.y = THREE.MathUtils.lerp(this.rig.position.y, 0, dt * 6);
        this.rig.rotation.z = THREE.MathUtils.lerp(this.rig.rotation.z, 0, dt * 6);
      }

      // Lean forward with speed, backwards under heavy load, flail in air.
      let lean = hSpeed * 0.02 - heavy * 0.28;
      if (!player.grounded) lean = v.y > 0 ? -0.15 : 0.12;
      if (player.parachute) lean = 0.35;
      this.rig.rotation.x = THREE.MathUtils.lerp(this.rig.rotation.x % (Math.PI * 2), lean, dt * 8);

      // Ice skating stance.
      if (player.onIce && hSpeed > 3) this.rig.rotation.z += Math.sin(t * 9) * 0.05;
    }

    // Hide the courier when the camera is shoved right into them (wall-squeeze).
    if (this.model) {
      const camD = camera.position.distanceTo(this.root.position);
      this.model.visible = camD > 1.9;
    }

    this.chute.visible = player.parachute;
    if (player.parachute) {
      this.chute.rotation.z = Math.sin(t * 5) * 0.12;
      this.chute.rotation.x = Math.sin(t * 3.7) * 0.1;
    }
  }
}
