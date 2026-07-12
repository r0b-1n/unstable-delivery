import * as THREE from 'three';

export const PEAK = 170;          // summit height in meters
export const WORLD_R = 240;       // half-extent of the terrain
export const KILL_Y = -14;

// Vertical difficulty bands (fractions of PEAK).
export const ZONES = [
  { name: 'Sunny Meadows',  y0: -5,          y1: PEAK * 0.12, key: 'meadow' },
  { name: 'Pinewood Ledges', y0: PEAK * 0.12, y1: PEAK * 0.35, key: 'forest' },
  { name: 'Windy Cliffs',   y0: PEAK * 0.35, y1: PEAK * 0.60, key: 'cliffs' },
  { name: 'The Frozen Face', y0: PEAK * 0.60, y1: PEAK * 0.85, key: 'frozen' },
  { name: 'Storm Summit',   y0: PEAK * 0.85, y1: Infinity,    key: 'summit' },
];

export function zoneAt(y) {
  for (const z of ZONES) if (y < z.y1) return z;
  return ZONES[ZONES.length - 1];
}

// --- Tiny deterministic value noise --------------------------------------
function hash2(x, y) {
  let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y) {
  return vnoise(x, y) * 0.55 + vnoise(x * 2.7, y * 2.7) * 0.28 + vnoise(x * 6.1, y * 6.1) * 0.17;
}

const LOOPS = 3.25;
const SEGMENTS = 150;
const SIZE = WORLD_R * 2;

export class Terrain {
  constructor(ctx) {
    this.ctx = ctx;
    this.islands = [];
    this._buildPath();
    this._buildMesh();
    this._buildCollider();
    this._buildIslands();
    this._decorate();
  }

  // The delivery route: a spiral shelf carved around the mountain.
  _buildPath() {
    this.pathSamples = [];
    const N = 700;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = this.pathPoint(t);
      this.pathSamples.push(p);
    }
  }

  pathPoint(t) {
    const angle = t * LOOPS * Math.PI * 2 + 0.8;
    const radius = 196 - Math.pow(t, 0.95) * 178;
    const h = PEAK * Math.pow(t, 1.25) * 0.97 + 1.5;
    const width = 9.5 - t * 5.5; // 9.5 m at the base, 4 m near the summit
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, h, t, width, angle };
  }

  _nearestPath(x, z) {
    let best = null, bestD = Infinity;
    for (const p of this.pathSamples) {
      const dx = p.x - x, dz = p.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = p; }
    }
    return { p: best, d: Math.sqrt(bestD) };
  }

  _rawHeight(x, z) {
    const r = Math.sqrt(x * x + z * z);
    const base = PEAK * Math.pow(THREE.MathUtils.clamp(1 - r / 212, 0, 1), 1.7);
    const frac = base / PEAK;
    const amp = 3.5 + 30 * Math.pow(frac, 1.5);
    const n = fbm(x * 0.021 + 13.7, z * 0.021 - 4.2);
    const rim = THREE.MathUtils.smoothstep(r, 200, 236); // flatten to meadow at the rim
    return (base + (n - 0.5) * 2 * amp) * (1 - rim);
  }

  _buildMesh() {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const count = pos.count;
    const colors = new Float32Array(count * 3);
    this.grid = new Float32Array((SEGMENTS + 1) * (SEGMENTS + 1));

    const cMeadow = new THREE.Color(0x86cf58);
    const cMeadow2 = new THREE.Color(0x5fae43);
    const cForest = new THREE.Color(0x3e8948);
    const cRock = new THREE.Color(0x77809c);
    const cRock2 = new THREE.Color(0x5d6480);
    const cIce = new THREE.Color(0x7fbdf2);
    const cSnow = new THREE.Color(0xf2f8ff);
    const cDirt = new THREE.Color(0xb08a54);
    const cDirtSnow = new THREE.Color(0xcabb9e);
    const col = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      let h = this._rawHeight(x, z);

      // Carve the spiral path into the slope.
      const { p, d } = this._nearestPath(x, z);
      let pathMix = 0;
      const blend = 7;
      if (d < p.width) { h = p.h; pathMix = 1; }
      else if (d < p.width + blend) {
        const k = 1 - THREE.MathUtils.smoothstep(d - p.width, 0, blend);
        h = THREE.MathUtils.lerp(h, p.h, k);
        pathMix = k;
      }

      pos.setY(i, h);
      this.grid[i] = h;

      // Zone colouring with noisy banding.
      const jitter = (fbm(x * 0.08, z * 0.08) - 0.5) * 14;
      const y = h + jitter;
      if (y < 16) col.copy(cMeadow).lerp(cMeadow2, fbm(x * 0.1, z * 0.1));
      else if (y < 52) col.copy(cForest).lerp(cMeadow2, fbm(x * 0.13, z * 0.13) * 0.7);
      else if (y < 96) col.copy(cRock).lerp(cRock2, fbm(x * 0.15, z * 0.15));
      else if (y < 138) col.copy(cIce).lerp(cRock, fbm(x * 0.12, z * 0.12) * 0.3);
      else col.copy(cSnow);
      if (pathMix > 0.25) {
        const dirt = h > 100 ? cDirtSnow : cDirt;
        col.lerp(dirt, pathMix * 0.75);
      }
      colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.ctx.scene.add(this.mesh);
  }

  heightAt(x, z) {
    const gx = ((x + WORLD_R) / SIZE) * SEGMENTS;
    const gz = ((z + WORLD_R) / SIZE) * SEGMENTS;
    const x0 = THREE.MathUtils.clamp(Math.floor(gx), 0, SEGMENTS - 1);
    const z0 = THREE.MathUtils.clamp(Math.floor(gz), 0, SEGMENTS - 1);
    const fx = gx - x0, fz = gz - z0;
    const w = SEGMENTS + 1;
    const h00 = this.grid[z0 * w + x0], h10 = this.grid[z0 * w + x0 + 1];
    const h01 = this.grid[(z0 + 1) * w + x0], h11 = this.grid[(z0 + 1) * w + x0 + 1];
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(h00, h10, fx), THREE.MathUtils.lerp(h01, h11, fx), fz);
  }

  _buildCollider() {
    const { physics } = this.ctx;
    const R = physics.RAPIER;
    const geo = this.mesh.geometry;
    const vertices = new Float32Array(geo.attributes.position.array);
    const indices = new Uint32Array(geo.index.array);
    const body = physics.world.createRigidBody(R.RigidBodyDesc.fixed());
    const desc = R.ColliderDesc.trimesh(vertices, indices).setFriction(0.85);
    this.collider = physics.world.createCollider(desc, body);
  }

  // Floating islands: the last stretch to the summit is an island-hopping
  // gauntlet. They bob and drift — everything up here is barely attached to reality.
  _buildIslands() {
    const { physics, scene } = this.ctx;
    const R = physics.RAPIER;
    const end = this.pathPoint(1);
    const islandMat = new THREE.MeshStandardMaterial({ color: 0xd8e9fa, flatShading: true, roughness: 0.9 });
    const underMat = new THREE.MeshStandardMaterial({ color: 0x8791ad, flatShading: true, roughness: 0.95 });

    const defs = [];
    const n = 6;
    for (let i = 0; i < n; i++) {
      const k = (i + 1) / n;
      const a = end.angle + 0.9 + k * 3.4;
      const r = 26 + Math.sin(i * 2.4) * 9;
      defs.push({
        x: Math.cos(a) * r * (1 - k * 0.75),
        z: Math.sin(a) * r * (1 - k * 0.75),
        y: end.h + 6 + k * 22,
        s: i === n - 1 ? 9 : 4.2 - k * 1.2, // last one is the summit island
        phase: i * 1.7,
        bob: i === n - 1 ? 0.6 : 1.6,
      });
    }
    this.summitIsland = null;

    for (const d of defs) {
      const group = new THREE.Group();
      const top = new THREE.Mesh(new THREE.CylinderGeometry(d.s, d.s * 0.82, 1.6, 7), islandMat);
      top.castShadow = top.receiveShadow = true;
      const bottom = new THREE.Mesh(new THREE.ConeGeometry(d.s * 0.8, d.s * 1.5, 7), underMat);
      bottom.rotation.x = Math.PI;
      bottom.position.y = -d.s * 0.75 - 0.8;
      bottom.castShadow = true;
      group.add(top, bottom);
      scene.add(group);

      const body = physics.world.createRigidBody(
        R.RigidBodyDesc.kinematicPositionBased().setTranslation(d.x, d.y, d.z),
      );
      physics.world.createCollider(R.ColliderDesc.cylinder(0.8, d.s).setFriction(1.0), body);

      const isl = { group, body, base: new THREE.Vector3(d.x, d.y, d.z), phase: d.phase, bob: d.bob, radius: d.s };
      this.islands.push(isl);
      if (d.s > 6) this.summitIsland = isl;
    }
  }

  _decorate() {
    const { scene, physics } = this.ctx;
    const R = physics.RAPIER;
    const staticBody = physics.world.createRigidBody(R.RigidBodyDesc.fixed());

    // Pine trees (forest band) — instanced cones + trunks, cylinder colliders.
    const treeGeo = new THREE.ConeGeometry(1.9, 5.2, 6);
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x2d6a3f, flatShading: true, roughness: 0.9 });
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.45, 2.2, 5);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6e4a2b, flatShading: true, roughness: 0.95 });
    const trees = new THREE.InstancedMesh(treeGeo, treeMat, 90);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, 90);
    trees.castShadow = trunks.castShadow = true;
    const m = new THREE.Matrix4();
    let placed = 0;
    for (let i = 0; i < 600 && placed < 90; i++) {
      const a = hash2(i, 7.7) * Math.PI * 2;
      const r = 90 + hash2(i, 3.1) * 110;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = this.heightAt(x, z);
      if (h < 14 || h > 58) continue;
      const near = this._nearestPath(x, z);
      if (near.d < near.p.width + 3) continue; // keep the road clear
      const s = 0.8 + hash2(i, 9.2) * 0.7;
      m.makeScale(s, s, s).setPosition(x, h + 3.2 * s, z);
      trees.setMatrixAt(placed, m);
      m.makeScale(s, s, s).setPosition(x, h + 1.0 * s, z);
      trunks.setMatrixAt(placed, m);
      physics.world.createCollider(
        R.ColliderDesc.cylinder(2.8 * s, 0.45 * s).setTranslation(x, h + 2.8 * s, z),
        staticBody,
      );
      placed++;
    }
    trees.count = trunks.count = placed;
    scene.add(trees, trunks);

    // Scattered boulders-as-decor (static) in the cliff band.
    const rockGeo = new THREE.DodecahedronGeometry(1.4, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6b748f, flatShading: true, roughness: 1 });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 46);
    rocks.castShadow = rocks.receiveShadow = true;
    let rp = 0;
    for (let i = 0; i < 500 && rp < 46; i++) {
      const a = hash2(i, 17.3) * Math.PI * 2;
      const r = 40 + hash2(i, 23.9) * 140;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = this.heightAt(x, z);
      if (h < 40 || h > 140) continue;
      const near = this._nearestPath(x, z);
      if (near.d < near.p.width + 2) continue;
      const s = 0.7 + hash2(i, 31.7) * 1.8;
      m.makeRotationY(hash2(i, 5) * 6).scale(new THREE.Vector3(s, s * 0.8, s)).setPosition(x, h + 0.6 * s, z);
      rocks.setMatrixAt(rp, m);
      physics.world.createCollider(R.ColliderDesc.ball(1.15 * s).setTranslation(x, h + 0.6 * s, z), staticBody);
      rp++;
    }
    rocks.count = rp;
    scene.add(rocks);

    // Glowing crystals near the summit — pure fantasy set dressing.
    const cryGeo = new THREE.OctahedronGeometry(1.1, 0);
    const cryMat = new THREE.MeshStandardMaterial({ color: 0x7de3ff, emissive: 0x2fb8e6, emissiveIntensity: 1.4, flatShading: true, roughness: 0.3 });
    this.crystals = [];
    for (let i = 0; i < 14; i++) {
      const a = hash2(i, 43.1) * Math.PI * 2;
      const r = 12 + hash2(i, 47.7) * 55;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = this.heightAt(x, z);
      if (h < PEAK * 0.7) continue;
      const c = new THREE.Mesh(cryGeo, cryMat);
      const s = 0.7 + hash2(i, 51) * 1.3;
      c.scale.set(s, s * (1.4 + hash2(i, 3) * 0.8), s);
      c.position.set(x, h + s, z);
      c.rotation.y = hash2(i, 8) * 6;
      scene.add(c);
      this.crystals.push(c);
    }

    // Drifting low-poly clouds.
    this.clouds = [];
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1, transparent: true, opacity: 0.92 });
    for (let i = 0; i < 12; i++) {
      const g = new THREE.Group();
      const blobs = 2 + ((hash2(i, 61) * 3) | 0);
      for (let b = 0; b <= blobs; b++) {
        const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(3 + hash2(i, b) * 4, 0), cloudMat);
        blob.position.set(b * 4 - blobs * 2, hash2(b, i) * 2, hash2(i * 3, b) * 3);
        blob.scale.y = 0.55;
        g.add(blob);
      }
      const a = hash2(i, 71) * Math.PI * 2;
      const r = 60 + hash2(i, 73) * 160;
      g.position.set(Math.cos(a) * r, 60 + hash2(i, 79) * 130, Math.sin(a) * r);
      this.ctx.scene.add(g);
      this.clouds.push({ g, speed: 1 + hash2(i, 83) * 2.5 });
    }
  }

  update(dt, t) {
    // Bobbing islands (kinematic so they carry the player).
    for (const isl of this.islands) {
      const y = isl.base.y + Math.sin(t * 0.6 + isl.phase) * isl.bob;
      const x = isl.base.x + Math.sin(t * 0.35 + isl.phase * 2) * 1.2;
      isl.body.setNextKinematicTranslation({ x, y, z: isl.base.z });
      isl.group.position.set(x, y, isl.base.z);
    }
    for (const c of this.crystals) c.rotation.y += dt * 0.4;
    for (const c of this.clouds) {
      c.g.position.x += c.speed * dt;
      if (c.g.position.x > WORLD_R + 60) c.g.position.x = -WORLD_R - 60;
    }
  }
}
