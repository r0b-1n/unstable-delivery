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
    this._computeGapWidths();
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

  // Chasms cut across the trail in the upper zones — jump them, ride a
  // mushroom out of them, or trust a crumbling plank. `m` is the physical
  // gap length in meters; every third gap (index 2, 5) is plank-less and
  // sized to be sprint-jumpable. The t-space half-width `w` is derived from
  // the local path speed at construction — a fixed t-width would make gaps
  // WIDER near the base (large spiral radius) and trivial near the summit.
  static GAPS = [
    { t: 0.415, m: 6 },
    { t: 0.505, m: 6.5 },
    { t: 0.585, m: 5 },
    { t: 0.665, m: 7 },
    { t: 0.735, m: 7.5 },
    { t: 0.805, m: 5.5 },
    { t: 0.875, m: 8 },
    { t: 0.94, m: 8.5 },
  ];

  _computeGapWidths() {
    const xz = (t) => {
      const angle = t * LOOPS * Math.PI * 2 + 0.8;
      const radius = 196 - Math.pow(t, 0.95) * 178;
      return [Math.cos(angle) * radius, Math.sin(angle) * radius];
    };
    for (const g of Terrain.GAPS) {
      const e = 0.001;
      const [x0, z0] = xz(g.t - e);
      const [x1, z1] = xz(g.t + e);
      const speed = Math.hypot(x1 - x0, z1 - z0) / (2 * e); // meters per t
      g.w = (g.m / 2) / speed;
    }
  }

  gapAt(t) {
    for (const g of Terrain.GAPS) if (Math.abs(t - g.t) < g.w) return g;
    return null;
  }

  pathPoint(t) {
    const angle = t * LOOPS * Math.PI * 2 + 0.8;
    const radius = 196 - Math.pow(t, 0.95) * 178;
    const h = PEAK * Math.pow(t, 1.25) * 0.97 + 1.5;
    const width = 9.5 - t * 6.7; // 9.5 m at the base, 2.8 m near the summit
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, h, t, width, angle, gap: this.gapAt(t) };
  }

  // Path sample a given number of METERS further up the trail from (x, z).
  pathAheadOf(x, z, meters) {
    let i = this._nearestPath(x, z).i;
    let acc = 0;
    while (acc < meters && i < this.pathSamples.length - 1) {
      const a = this.pathSamples[i], b = this.pathSamples[++i];
      acc += Math.hypot(b.x - a.x, b.z - a.z);
    }
    return this.pathSamples[i];
  }

  _nearestPath(x, z) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < this.pathSamples.length; i++) {
      const p = this.pathSamples[i];
      const dx = p.x - x, dz = p.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return { p: this.pathSamples[best], d: Math.sqrt(bestD), i: best };
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
    const pathMixArr = new Float32Array(count);

    // ---- Pass 1: heights ----
    for (let i = 0; i < count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      let h = this._rawHeight(x, z);

      // Carve the spiral path into the slope — or a chasm where a gap cuts it.
      const { p, d } = this._nearestPath(x, z);
      let pathMix = 0;
      const blend = 7;
      if (p.gap) {
        // Chasm: drop well below trail level so falling in costs real height.
        const chasmH = p.h - 14;
        if (d < p.width + 1.5) { h = Math.min(h, chasmH); }
        else if (d < p.width + blend) {
          const k = 1 - THREE.MathUtils.smoothstep(d - p.width - 1.5, 0, blend - 1.5);
          h = Math.min(h, THREE.MathUtils.lerp(h, chasmH, k));
        }
      } else if (d < p.width) { h = p.h; pathMix = 1; }
      else if (d < p.width + blend) {
        const k = 1 - THREE.MathUtils.smoothstep(d - p.width, 0, blend);
        h = THREE.MathUtils.lerp(h, p.h, k);
        pathMix = k;
      }

      pos.setY(i, h);
      this.grid[i] = h;
      pathMixArr[i] = pathMix;
    }

    // ---- Pass 2: colours, now slope- and curvature-aware ----
    const cMeadow = new THREE.Color(0x74ce3e);
    const cMeadow2 = new THREE.Color(0x9fe25b);
    const cForest = new THREE.Color(0x3d9c50);
    const cRock = new THREE.Color(0x7d87a8);
    const cRock2 = new THREE.Color(0x555e78);
    const cIce = new THREE.Color(0x8ecdf5);
    const cSnow = new THREE.Color(0xf6faff);
    const cDirt = new THREE.Color(0xa8763e);
    const cDirtSnow = new THREE.Color(0xcabb9e);
    const cFlower = [new THREE.Color(0xffd166), new THREE.Color(0xff7bac), new THREE.Color(0xffffff)];
    const col = new THREE.Color();
    const W = SEGMENTS + 1;
    const cell = SIZE / SEGMENTS;

    for (let i = 0; i < count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.grid[i];
      const gx = i % W, gz = (i / W) | 0;
      const hx0 = this.grid[gz * W + Math.max(gx - 1, 0)], hx1 = this.grid[gz * W + Math.min(gx + 1, W - 1)];
      const hz0 = this.grid[Math.max(gz - 1, 0) * W + gx], hz1 = this.grid[Math.min(gz + 1, W - 1) * W + gx];
      const slope = Math.hypot(hx1 - hx0, hz1 - hz0) / (2 * cell);       // rise/run
      const lap = (hx0 + hx1 + hz0 + hz1 - 4 * h) / cell;                 // concavity
      const pathMix = pathMixArr[i];

      const jitter = (fbm(x * 0.08, z * 0.08) - 0.5) * 10;
      const y = h + jitter;
      if (y < 16) {
        col.copy(cMeadow).lerp(cMeadow2, fbm(x * 0.11, z * 0.11));
        // flower speckle
        const f = hash2(Math.round(x * 2.1), Math.round(z * 2.1));
        if (f > 0.965 && slope < 0.5) col.lerp(cFlower[(f * 977) % 3 | 0], 0.85);
      } else if (y < 52) {
        col.copy(cForest).lerp(cMeadow2, fbm(x * 0.13, z * 0.13) * 0.55);
      } else if (y < 96) {
        col.copy(cRock).lerp(cRock2, fbm(x * 0.15, z * 0.15));
      } else if (y < 136) {
        col.copy(cIce).lerp(cSnow, fbm(x * 0.09, z * 0.09) * 0.6);
      } else {
        col.copy(cSnow);
      }
      // Steep faces expose rock everywhere above the meadows.
      if (h > 20) {
        const rockK = THREE.MathUtils.smoothstep(slope, 0.85, 1.7);
        col.lerp(cRock2, rockK * 0.85);
      }
      // Crevice shading: concave areas darken, ridges brighten slightly.
      const shade = THREE.MathUtils.clamp(1 + lap * 0.05 - Math.max(slope - 1.6, 0) * 0.12, 0.72, 1.12);
      col.multiplyScalar(shade);
      // Crisp trail.
      if (pathMix > 0.45) {
        const dirt = h > 100 ? cDirtSnow : cDirt;
        col.lerp(dirt, Math.min((pathMix - 0.45) / 0.4, 1) * 0.9);
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

    // --- Sea around the mountain base: low-poly waves via vertex shader hook ---
    const seaGeo = new THREE.RingGeometry(200, 900, 48, 6);
    seaGeo.rotateX(-Math.PI / 2);
    const seaMat = new THREE.MeshStandardMaterial({
      color: 0x2f74c0, roughness: 0.35, metalness: 0.1, flatShading: true,
      transparent: true, opacity: 0.96,
    });
    seaMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = { value: 0 };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>',
          `#include <begin_vertex>
           transformed.y += sin(position.x * 0.05 + uTime * 1.1) * 0.55 + cos(position.z * 0.06 + uTime * 0.8) * 0.45;`);
      this._seaShader = sh;
    };
    const sea = new THREE.Mesh(seaGeo, seaMat);
    sea.position.y = 0.5;
    scene.add(sea);

    // --- Lanterns lining the trail (emissive, no per-light cost) ---
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 1.7, 4);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x4a3826, flatShading: true });
    const lampGeo = new THREE.SphereGeometry(0.17, 6, 5);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0xffaa33, emissiveIntensity: 2.2 });
    const nLan = 46;
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, nLan);
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, nLan);
    let li = 0;
    for (let k = 0; k < nLan; k++) {
      const t = 0.02 + (k / nLan) * 0.95;
      if (this.gapAt(t)) continue;
      const p = this.pathPoint(t);
      const len = Math.hypot(p.x, p.z) || 1;
      const x = p.x + (p.x / len) * (p.width + 1.2);
      const z = p.z + (p.z / len) * (p.width + 1.2);
      const h = this.heightAt(x, z);
      if (Math.abs(h - p.h) > 4) continue; // off a cliff edge — skip
      m.identity().setPosition(x, h + 0.85, z);
      poles.setMatrixAt(li, m);
      m.identity().setPosition(x, h + 1.8, z);
      lamps.setMatrixAt(li, m);
      li++;
    }
    poles.count = lamps.count = li;
    scene.add(poles, lamps);

    // --- Grass tufts + meadow detail ---
    const tuftGeo = new THREE.ConeGeometry(0.16, 0.55, 4);
    const tuftMat = new THREE.MeshStandardMaterial({ color: 0x57b234, flatShading: true });
    const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, 320);
    let ti = 0;
    for (let i = 0; i < 2200 && ti < 320; i++) {
      const a = hash2(i, 91.3) * Math.PI * 2;
      const r = 120 + hash2(i, 93.7) * 115;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = this.heightAt(x, z);
      if (h < 0.8 || h > 22) continue;
      const s = 0.8 + hash2(i, 97.1) * 1.3;
      m.makeScale(s, s * (0.8 + hash2(i, 5.5)), s).setPosition(x, h + 0.22 * s, z);
      tufts.setMatrixAt(ti, m);
      ti++;
    }
    tufts.count = ti;
    scene.add(tufts);

    // --- Snowy pines up high ---
    const spineGeo = new THREE.ConeGeometry(1.6, 4.4, 6);
    const spineMat = new THREE.MeshStandardMaterial({ color: 0x2c5a46, flatShading: true });
    const scapGeo = new THREE.ConeGeometry(1.15, 1.7, 6);
    const scapMat = new THREE.MeshStandardMaterial({ color: 0xf2f8ff, flatShading: true });
    const spines = new THREE.InstancedMesh(spineGeo, spineMat, 40);
    const scaps = new THREE.InstancedMesh(scapGeo, scapMat, 40);
    spines.castShadow = true;
    let si = 0;
    for (let i = 0; i < 900 && si < 40; i++) {
      const a = hash2(i, 111.3) * Math.PI * 2;
      const r = 30 + hash2(i, 113.9) * 110;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = this.heightAt(x, z);
      if (h < 95 || h > 145) continue;
      const near = this._nearestPath(x, z);
      if (near.d < near.p.width + 2) continue;
      const s = 0.7 + hash2(i, 117.2) * 0.6;
      m.makeScale(s, s, s).setPosition(x, h + 2.2 * s, z);
      spines.setMatrixAt(si, m);
      m.makeScale(s, s, s).setPosition(x, h + 4.4 * s, z);
      scaps.setMatrixAt(si, m);
      si++;
    }
    spines.count = scaps.count = si;
    scene.add(spines, scaps);

    // --- Birds circling thermals ---
    this.birds = [];
    const birdGeo = new THREE.ConeGeometry(0.25, 0.9, 3);
    birdGeo.rotateX(Math.PI / 2);
    const birdMat = new THREE.MeshStandardMaterial({ color: 0x2b2b33, flatShading: true });
    for (let f = 0; f < 3; f++) {
      const cx = Math.cos(f * 2.1) * (60 + f * 40);
      const cz = Math.sin(f * 2.1) * (60 + f * 40);
      const cy = 40 + f * 45;
      for (let b = 0; b < 4; b++) {
        const mesh = new THREE.Mesh(birdGeo, birdMat);
        scene.add(mesh);
        this.birds.push({ mesh, cx, cz, cy, r: 9 + b * 2.5, phase: b * 1.6 + f, speed: 0.5 + hash2(f, b) * 0.3 });
      }
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
    if (this._seaShader) this._seaShader.uniforms.uTime.value = t;
    for (const b of this.birds) {
      const a = t * b.speed + b.phase;
      const nx = b.cx + Math.cos(a) * b.r;
      const nz = b.cz + Math.sin(a) * b.r;
      const ny = b.cy + Math.sin(t * 0.7 + b.phase) * 2;
      b.mesh.lookAt(nx, ny, nz);
      b.mesh.position.set(nx, ny, nz);
    }
  }
}
