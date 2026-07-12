import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// The courier model ships as ONE fused static mesh (no skeleton). We split it
// into body parts at load time by triangle position — head, torso, arms, legs
// — re-pivot each at its joint, cap the cut seams with spheres, and drive the
// whole thing with a procedural animation state machine. Segmented-figure
// style, but he actually RUNS.
//
// Measured anatomy of the model (fractions of total height, after rotating
// the mesh to face +Z; left-right axis becomes X):
const HIP_Y = 0.31;      // legs below this
const NECK_Y = 0.695;    // head above this
const SHOULDER_Y = 0.645;
const ARM_MIN_Y = 0.23;  // hands reach this low
const ARM_X = 0.155;     // |x| beyond this (within arm band) = arm

const HEIGHT = 1.72;

export class Character {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = new THREE.Group();   // follows the physics body
    this.rig = new THREE.Group();    // squash/stretch + tumble
    this.root.add(this.rig);
    ctx.scene.add(this.root);
    this._runT = 0;
    this._spin = 0;
    this._squash = 0;
    this._prevGrounded = true;

    this._buildChute();
  }

  _buildChute() {
    // Parcel-parachute: cardboard glider that pops open mid-air.
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
    const gltf = await new GLTFLoader().loadAsync('./assets/character.glb');
    let source = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => { if (o.isMesh && !source) source = o; });

    // Bake world transform, rotate to face +Z, normalise to HEIGHT with feet at 0.
    // Keep it INDEXED for the connected-component analysis.
    const geo = source.geometry.clone();
    geo.applyMatrix4(source.matrixWorld);
    geo.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const scale = HEIGHT / (bb.max.y - bb.min.y);
    geo.applyMatrix4(new THREE.Matrix4()
      .makeScale(scale, scale, scale)
      .multiply(new THREE.Matrix4().makeTranslation(
        -(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2)));

    const mat = source.material;
    mat.roughness = 0.85;

    // ---- Connected components: the arms are separate shells in this mesh,
    // so they split out EXACTLY. Legs/head are fused and use positional cuts. ----
    const pos = geo.attributes.position;
    const index = geo.index.array;
    const vCount = pos.count;
    const parent = new Int32Array(vCount);
    for (let i = 0; i < vCount; i++) parent[i] = i;
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
    for (let t = 0; t < index.length; t += 3) { union(index[t], index[t + 1]); union(index[t + 1], index[t + 2]); }
    // Weld duplicated vertices at identical positions so seams don't split shells.
    const seen = new Map();
    for (let i = 0; i < vCount; i++) {
      const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
      const prev = seen.get(key);
      if (prev !== undefined) union(i, prev); else seen.set(key, i);
    }
    // Component bounds → identify arm shells (mid-height, hugging one side).
    const compBounds = new Map();
    for (let i = 0; i < vCount; i++) {
      const r = find(i);
      let b = compBounds.get(r);
      if (!b) { b = { yMin: Infinity, yMax: -Infinity, xMin: Infinity, xMax: -Infinity, count: 0 }; compBounds.set(r, b); }
      const y = pos.getY(i), x = pos.getX(i);
      b.yMin = Math.min(b.yMin, y); b.yMax = Math.max(b.yMax, y);
      b.xMin = Math.min(b.xMin, x); b.xMax = Math.max(b.xMax, x);
      b.count++;
    }
    const armComp = new Map(); // root -> 'armL' | 'armR'
    const armBounds = {};
    for (const [root, b] of compBounds) {
      const yf0 = b.yMin / HEIGHT, yf1 = b.yMax / HEIGHT;
      const inner = Math.min(Math.abs(b.xMin), Math.abs(b.xMax));
      const oneSided = b.xMin > 0.05 || b.xMax < -0.05;
      if (yf0 > 0.15 && yf1 < 0.72 && oneSided && inner > 0.1) {
        const key = b.xMax < 0 ? 'armL' : 'armR';
        armComp.set(root, key);
        armBounds[key] = b;
      }
    }

    // ---- Bucket triangles ----
    const buckets = { head: [], torso: [], armL: [], armR: [], legL: [], legR: [] };
    const triCount = index.length / 3;
    const c = new THREE.Vector3();
    for (let t = 0; t < triCount; t++) {
      const arm = armComp.get(find(index[t * 3]));
      if (arm) { buckets[arm].push(t); continue; }
      c.set(0, 0, 0);
      for (let v = 0; v < 3; v++) c.add(new THREE.Vector3().fromBufferAttribute(pos, index[t * 3 + v]));
      c.multiplyScalar(1 / 3);
      const yf = c.y / HEIGHT;
      let key;
      if (yf > NECK_Y) key = 'head';
      else if (yf < HIP_Y) key = c.x < 0 ? 'legL' : 'legR';
      else key = 'torso';
      buckets[key].push(t);
    }

    // Pivots (in model space). Arm pivots derive from the discovered shells.
    const armPivot = (key, fallbackX) => {
      const b = armBounds[key];
      if (!b) return new THREE.Vector3(fallbackX, SHOULDER_Y * HEIGHT, 0);
      return new THREE.Vector3((b.xMin + b.xMax) / 2, b.yMax - 0.02, 0);
    };
    const pivots = {
      head: new THREE.Vector3(0, NECK_Y * HEIGHT, 0),
      torso: new THREE.Vector3(0, HIP_Y * HEIGHT, 0),
      armL: armPivot('armL', -0.19 * HEIGHT),
      armR: armPivot('armR', 0.19 * HEIGHT),
      legL: new THREE.Vector3(-0.055 * HEIGHT, HIP_Y * HEIGHT, 0),
      legR: new THREE.Vector3(0.055 * HEIGHT, HIP_Y * HEIGHT, 0),
    };
    const armLen = armBounds.armR ? (armBounds.armR.yMax - armBounds.armR.yMin) : (SHOULDER_Y - ARM_MIN_Y) * HEIGHT;

    const partMesh = (key) => {
      const tris = buckets[key];
      if (!tris.length) return null;
      const attrs = {};
      for (const name of Object.keys(geo.attributes)) {
        const src = geo.attributes[name];
        const dst = new Float32Array(tris.length * 3 * src.itemSize);
        let w = 0;
        for (const t of tris) {
          for (let v = 0; v < 3; v++) {
            const vi = index[t * 3 + v];
            for (let i = 0; i < src.itemSize; i++) dst[w++] = src.array[vi * src.itemSize + i];
          }
        }
        attrs[name] = new THREE.BufferAttribute(dst, src.itemSize);
      }
      const g = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(attrs)) g.setAttribute(name, attr);
      // Shift so the pivot is the local origin.
      const p = pivots[key];
      g.translate(-p.x, -p.y, -p.z);
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = true;
      return mesh;
    };

    // ---- Assemble the rig ----
    // root(feet) -> rig -> pelvis(at hip height) -> torsoG(torso+head+arms) ; legs attach to pelvis.
    this.pelvis = new THREE.Group();
    this.pelvis.position.y = HIP_Y * HEIGHT;
    this.rig.add(this.pelvis);

    this.torsoG = new THREE.Group();
    this.pelvis.add(this.torsoG);
    const torso = partMesh('torso');
    torso.position.set(0, 0, 0); // torso pivot == pelvis origin
    this.torsoG.add(torso);

    this.headG = new THREE.Group();
    this.headG.position.set(0, (NECK_Y - HIP_Y) * HEIGHT, 0);
    const head = partMesh('head');
    if (head) this.headG.add(head);
    this.torsoG.add(this.headG);

    const mkLimb = (key, parent, px, py) => {
      const g = new THREE.Group();
      g.position.set(px, py, 0);
      const m = partMesh(key);
      if (m) g.add(m);
      parent.add(g);
      return g;
    };
    this.armL = mkLimb('armL', this.torsoG, pivots.armL.x, pivots.armL.y - HIP_Y * HEIGHT);
    this.armR = mkLimb('armR', this.torsoG, pivots.armR.x, pivots.armR.y - HIP_Y * HEIGHT);
    this.legL = mkLimb('legL', this.pelvis, pivots.legL.x, 0);
    this.legR = mkLimb('legR', this.pelvis, pivots.legR.x, 0);

    // Joint caps to hide the cut seams.
    const capMat = new THREE.MeshStandardMaterial({ color: 0xb7a894, flatShading: true, roughness: 0.9 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0x8d8577, flatShading: true, roughness: 0.9 });
    const cap = (parent, r, x, y, m = capMat) => {
      const s = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 5), m);
      s.position.set(x, y, 0);
      s.castShadow = true;
      parent.add(s);
    };
    cap(this.armL, 0.07, 0, 0);
    cap(this.armR, 0.07, 0, 0);
    cap(this.legL, 0.09, 0, 0, pantsMat);
    cap(this.legR, 0.09, 0, 0, pantsMat);
    cap(this.headG, 0.085, 0, 0.01);
    this.armLen = armLen;

    this.loaded = true;
  }

  // World-space point between the hands — the package hangs here.
  getHandsAnchor(out) {
    if (!this.loaded) return null;
    out.set(0, -this.armLen * 0.9, 0.12);
    this.armR.localToWorld(out);
    const l = new THREE.Vector3(0, -this.armLen * 0.9, 0.12);
    this.armL.localToWorld(l);
    return out.add(l).multiplyScalar(0.5);
  }

  update(dt, t) {
    if (!this.loaded) return;
    const { player, camera } = this.ctx;
    const p = player.body.translation();
    const v = player.body.linvel();
    const hSpeed = Math.hypot(v.x, v.z);

    this.root.position.set(p.x, p.y - 0.9, p.z);
    this.root.rotation.y = player.charYaw ?? 0;

    // Landing squash.
    if (player.grounded && !this._prevGrounded) this._squash = Math.min(0.35, Math.max(0.12, -this._lastVy * 0.018));
    this._prevGrounded = player.grounded;
    this._lastVy = v.y;
    this._squash = Math.max(0, this._squash - dt * 2.2);
    this.rig.scale.set(1 + this._squash * 0.7, 1 - this._squash, 1 + this._squash * 0.7);

    const pkg = this.ctx.packages.current;
    const carrying = pkg && pkg.carried;
    const heavy = carrying ? Math.min(pkg.def.mass / 45, 1) : 0;
    const lerp = (o, k, target, rate = 10) => { o[k] = THREE.MathUtils.lerp(o[k], target, Math.min(dt * rate, 1)); };

    if (player.knockTimer > 0) {
      // Floppy comedic tumble: whole rig spins, limbs flail out of phase.
      this._spin += dt * 12;
      this.rig.rotation.x = this._spin;
      this.rig.rotation.z = Math.sin(this._spin * 0.7) * 0.6;
      this.rig.position.y = 0.45;
      this.armL.rotation.x = Math.sin(this._spin * 2.1) * 1.6;
      this.armR.rotation.x = Math.sin(this._spin * 2.4 + 1) * 1.6;
      this.legL.rotation.x = Math.sin(this._spin * 1.8 + 2) * 1.2;
      this.legR.rotation.x = Math.sin(this._spin * 2.2 + 3) * 1.2;
      this.chute.visible = false;
      return;
    }
    this._spin = 0;
    lerp(this.rig.rotation, 'x', 0, 8);
    lerp(this.rig.position, 'y', 0, 8);

    let legSwing = 0, cadence = 0;
    if (player.grounded && hSpeed > 0.8) {
      cadence = 5.5 + hSpeed * 1.35;
      this._runT += dt * cadence;
      legSwing = Math.min(0.35 + hSpeed * 0.075, 1.15);
    } else {
      // settle legs toward rest phase
      this._runT += dt * 2;
    }
    const s1 = Math.sin(this._runT), s2 = Math.sin(this._runT + Math.PI);

    if (!player.grounded) {
      if (player.parachute) {
        // Dangling under the glider: limbs hang, gentle sway.
        lerp(this.legL.rotation, 'x', 0.25 + Math.sin(t * 3) * 0.1, 6);
        lerp(this.legR.rotation, 'x', 0.32 + Math.cos(t * 2.6) * 0.1, 6);
        lerp(this.armL.rotation, 'z', 2.5, 6);   // arms up gripping strings
        lerp(this.armR.rotation, 'z', -2.5, 6);
        lerp(this.armL.rotation, 'x', 0, 6);
        lerp(this.armR.rotation, 'x', 0, 6);
        lerp(this.torsoG.rotation, 'x', 0.28, 6);
      } else if (v.y > 1) {
        // Jump: tuck.
        lerp(this.legL.rotation, 'x', -1.0, 12);
        lerp(this.legR.rotation, 'x', -0.7, 12);
        if (!carrying) { lerp(this.armL.rotation, 'x', -2.4, 10); lerp(this.armR.rotation, 'x', -2.4, 10); }
        lerp(this.torsoG.rotation, 'x', 0.15, 8);
      } else {
        // Falling: flail.
        lerp(this.legL.rotation, 'x', 0.5 + Math.sin(t * 9) * 0.25, 8);
        lerp(this.legR.rotation, 'x', 0.2 + Math.cos(t * 8) * 0.25, 8);
        if (!carrying) {
          lerp(this.armL.rotation, 'z', 1.9 + Math.sin(t * 11) * 0.4, 8);
          lerp(this.armR.rotation, 'z', -1.9 - Math.cos(t * 10) * 0.4, 8);
          lerp(this.armL.rotation, 'x', 0, 8);
          lerp(this.armR.rotation, 'x', 0, 8);
        }
        lerp(this.torsoG.rotation, 'x', -0.12, 6);
      }
    } else if (hSpeed > 0.8) {
      // Run cycle.
      lerp(this.legL.rotation, 'x', s1 * legSwing, 18);
      lerp(this.legR.rotation, 'x', s2 * legSwing, 18);
      if (!carrying) {
        lerp(this.armL.rotation, 'x', s2 * legSwing * 1.25, 14);
        lerp(this.armR.rotation, 'x', s1 * legSwing * 1.25, 14);
        lerp(this.armL.rotation, 'z', 0.18, 8);
        lerp(this.armR.rotation, 'z', -0.18, 8);
      }
      lerp(this.torsoG.rotation, 'x', 0.12 + hSpeed * 0.014 + heavy * 0.1, 8);
      this.pelvis.position.y = HIP_Y * HEIGHT + Math.abs(Math.sin(this._runT)) * 0.05;
      lerp(this.pelvis.rotation, 'z', Math.sin(this._runT) * 0.05 * (1 + heavy), 12);
      if (player.onIce && hSpeed > 3) this.pelvis.rotation.z += Math.sin(t * 9) * 0.06;
    } else {
      // Idle: breathe, slight arm sway, look around occasionally.
      lerp(this.legL.rotation, 'x', 0, 8);
      lerp(this.legR.rotation, 'x', 0, 8);
      if (!carrying) {
        lerp(this.armL.rotation, 'x', Math.sin(t * 1.7) * 0.06, 6);
        lerp(this.armR.rotation, 'x', Math.sin(t * 1.7 + 1) * 0.06, 6);
        lerp(this.armL.rotation, 'z', 0.09, 6);
        lerp(this.armR.rotation, 'z', -0.09, 6);
      }
      lerp(this.torsoG.rotation, 'x', Math.sin(t * 1.7) * 0.025 + heavy * 0.12, 6);
      lerp(this.pelvis.position, 'y', HIP_Y * HEIGHT, 8);
      lerp(this.pelvis.rotation, 'z', 0, 8);
      lerp(this.headG.rotation, 'y', Math.sin(t * 0.43) > 0.92 ? 0.5 : 0, 4);
    }

    // Carry pose: both arms forward, hands cradling the package.
    if (carrying) {
      const armPitch = -1.35 + heavy * 0.5; // heavier = arms sag lower
      lerp(this.armL.rotation, 'x', armPitch, 12);
      lerp(this.armR.rotation, 'x', armPitch, 12);
      lerp(this.armL.rotation, 'z', 0.35, 10);
      lerp(this.armR.rotation, 'z', -0.35, 10);
      lerp(this.torsoG.rotation, 'x', (this.torsoG.rotation.x ?? 0) * 0.5 - heavy * 0.22, 10);
    }

    // Hide the courier when the camera is shoved right into them.
    this.rig.visible = camera.position.distanceTo(this.root.position) > 1.6;

    this.chute.visible = player.parachute;
    if (player.parachute) {
      this.chute.rotation.z = Math.sin(t * 5) * 0.12;
      this.chute.rotation.x = Math.sin(t * 3.7) * 0.1;
    }
  }
}
