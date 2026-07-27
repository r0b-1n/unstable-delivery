import * as THREE from 'three';
import { OBJ, bandOf, bandFloat } from '../art/palette.js';
import { fbm, rand2 } from './noise.js';
import { PEAK } from './dims.js';

const UP = new THREE.Vector3(0, 1, 0);

// Everything that grows on, or has fallen onto, the mountain.
//
// The old placement was `for (i = 0; i < 600; i++) { angle = hash(i); r = hash(i) }`
// and it put ninety trees on a 480 m mountain in a perfectly even dusting. Even
// dusting is the single most recognisable tell of untended procedural
// generation: real forests have edges, clearings and a treeline. So placement
// here walks a jittered lattice and consults a low-frequency density field —
// the same field for every species — which produces stands and gaps for free.

const STEP = 7;              // candidate lattice spacing, meters
const ROUTE_CLEAR = 3.5;     // extra meters kept clear beyond the trail width
const SHADOW_R = 150;        // trees within this of the route cast shadows

function instanced(scene, geo, mat, list, { castShadow = false, receiveShadow = false } = {}) {
  if (!list.length) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  mesh.count = list.length;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  for (let i = 0; i < list.length; i++) mesh.setMatrixAt(i, list[i]);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  scene.add(mesh);
  return mesh;
}

export class Scatter {
  constructor(ctx, terrain) {
    this.ctx = ctx;
    this.terrain = terrain;
    this.crystals = [];
    this.far = [];        // pools the low quality tier switches off
    this._build();
  }

  _build() {
    const { scene, physics } = this.ctx;
    const terrain = this.terrain;
    const R = physics.RAPIER;
    const staticBody = physics.world.createRigidBody(R.RigidBodyDesc.fixed());

    const pineNear = [], pineFar = [], trunkNear = [], trunkFar = [];
    const snowPine = [], snowCap = [];
    const rockNear = [], rockFar = [];
    const tuft = [], shrub = [], deadwood = [];
    const flower = [[], [], []];
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();

    const push = (list, x, y, z, sx, sy, sz, ry) => {
      q.setFromAxisAngle(UP, ry);
      list.push(new THREE.Matrix4().compose(v.set(x, y, z), q, s.set(sx, sy, sz)));
    };

    const R_MAX = 760;
    for (let z = -R_MAX; z <= R_MAX; z += STEP) {
      for (let x = -R_MAX; x <= R_MAX; x += STEP) {
        if (x * x + z * z > R_MAX * R_MAX) continue;
        // Jitter off the lattice, or the whole mountain is planted in rows.
        const jx = x + (rand2(x, z) - 0.5) * STEP * 1.6;
        const jz = z + (rand2(z, x + 91) - 0.5) * STEP * 1.6;
        const h = terrain.heightAt(jx, jz);
        if (h < 1.2) continue;

        const slope = terrain.slopeAt(jx, jz);
        const near = terrain._nearestPath(jx, jz);
        const onRoute = near.d < near.p.width + ROUTE_CLEAR;
        if (onRoute) continue;
        const band = bandFloat(h / PEAK);
        // One density field, shared by every species: where it is high you get
        // a stand, where it is low you get a clearing, and the boundary between
        // them is the same line for trees, shrubs and undergrowth. That shared
        // boundary is what makes it read as one ecosystem.
        const dens = fbm(jx * 0.006 + 4.1, jz * 0.006 - 2.3);
        const r1 = rand2(jx * 0.37, jz * 0.41);
        const shadowed = near.d < SHADOW_R;

        if (band < 0.45) {
          // Sunny Meadows: grass, the odd shrub, no canopy.
          if (slope < 0.7 && r1 < 0.55) {
            const sc = 0.9 + rand2(jx, jz + 5) * 1.5;
            push(tuft, jx, h + 0.3 * sc, jz, sc, sc * (0.8 + r1), sc, r1 * 6);
          }
          if (dens > 0.62 && slope < 0.6 && r1 > 0.86) {
            const sc = 0.8 + r1;
            push(shrub, jx, h + 0.45 * sc, jz, sc, sc * 0.8, sc, r1 * 6);
          }
          // Flowers as geometry, not as vertex colour. A tinted vertex on a
          // smooth-shaded 2 m grid bleeds over four square meters, so the
          // meadow ended up wearing pink dinner plates. Three hundred-odd
          // actual blooms per colour cost three draw calls and read correctly
          // at every distance.
          if (slope < 0.55 && r1 > 0.72 && r1 < 0.79) {
            const sc = 0.7 + rand2(jz, jx + 13) * 0.7;
            push(flower[((r1 * 1471) | 0) % 3], jx, h + 0.3 * sc, jz, sc, sc, sc, r1 * 6);
          }
        } else if (band < 2.2) {
          // Pinewood Ledges: the forest proper. Density threshold rises with
          // altitude so the stand thins out into a treeline instead of ending
          // on a contour.
          const thin = 0.40 + 0.18 * Math.max(0, band - 1);
          if (dens > thin && slope < 0.85 && r1 < 0.80) {
            const sc = 0.85 + rand2(jx + 3, jz) * 0.85;
            const ry = r1 * 6;
            push(shadowed ? pineNear : pineFar, jx, h + 3.4 * sc, jz, sc, sc, sc, ry);
            push(shadowed ? trunkNear : trunkFar, jx, h + 1.1 * sc, jz, sc, sc, sc, ry);
            if (shadowed) {
              physics.world.createCollider(
                R.ColliderDesc.cylinder(3.0 * sc, 0.5 * sc).setTranslation(jx, h + 3.0 * sc, jz),
                staticBody,
              );
            }
          } else if (slope < 0.8 && r1 > 0.9) {
            const sc = 0.9 + r1;
            push(tuft, jx, h + 0.3 * sc, jz, sc, sc, sc, r1 * 6);
          }
          if (dens < 0.34 && r1 > 0.93) {
            push(deadwood, jx, h + 0.35, jz, 1, 1, 1, r1 * 6);
          }
        } else if (band < 3.1) {
          // Windy Cliffs: rock, and a dwarf treeline dying out across it.
          // The snow pines used to sit above band 3.1, which on this mountain
          // is 403 m of a 500 m peak — a treeline in the summit snowfield. The
          // stand has to END somewhere the player can watch it end.
          if (band < 2.7 && dens > 0.44 && slope < 0.95 && r1 < 0.34) {
            const sc = 0.7 + r1 * 1.4;
            const ry = r1 * 6;
            push(snowPine, jx, h + 2.4 * sc, jz, sc, sc, sc, ry);
            push(snowCap, jx, h + 4.6 * sc, jz, sc, sc, sc, ry);
          } else if (r1 > 0.63 && slope < 1.5) {
            // Boulders rest ON ground. Above about 1.5 rise-over-run nothing
            // rests anywhere, and a scatter that ignores this papers the cliff
            // faces with stickers. They also sit lower now — half a radius
            // proud of the surface is a ball balanced on a hill, not a rock.
            const sc = 0.7 + rand2(jx, jz * 1.7) * 2.4;
            push(shadowed ? rockNear : rockFar, jx, h + 0.1 * sc, jz, sc, sc * (0.6 + r1 * 0.6), sc, r1 * 6);
            if (shadowed && sc > 1.4) {
              physics.world.createCollider(
                R.ColliderDesc.ball(1.05 * sc).setTranslation(jx, h + 0.5 * sc, jz), staticBody);
            }
          }
        } else {
          // The Frozen Face and Storm Summit: nothing grows, seracs and
          // boulders only.
          if (r1 > 0.72 && slope < 1.5) {
            const sc = 0.8 + rand2(jx + 7, jz) * 2.6;
            push(shadowed ? rockNear : rockFar, jx, h + 0.1 * sc, jz, sc, sc * 0.8, sc, r1 * 6);
          }
        }
      }
    }

    // --- Geometry. Deliberately cheap: a pine is 36 triangles, so four
    // thousand of them cost less than the terrain chunk you are standing on.
    const crownGeo = new THREE.ConeGeometry(2.1, 6.6, 5);
    const trunkGeo = new THREE.CylinderGeometry(0.28, 0.42, 2.6, 4);
    const rockGeo = new THREE.DodecahedronGeometry(1.4, 0);
    const tuftGeo = new THREE.ConeGeometry(0.22, 0.8, 4);
    const shrubGeo = new THREE.IcosahedronGeometry(0.7, 0);
    const logGeo = new THREE.CylinderGeometry(0.3, 0.34, 3.4, 5);
    logGeo.rotateZ(Math.PI / 2);

    const pineMat = new THREE.MeshStandardMaterial({ color: OBJ.pineNeedle, flatShading: true, roughness: 0.9 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: OBJ.timberDark, flatShading: true, roughness: 0.95 });
    // Decor boulders take the cliff band's own rock — warm and clearly NOT
    // OBJ.hazardRock, so scenery never gets mistaken for something incoming.
    const rockMat = new THREE.MeshStandardMaterial({ color: bandOf('cliffs').rock, flatShading: true, roughness: 1 });
    const tuftMat = new THREE.MeshStandardMaterial({ color: bandOf('meadow').veg, flatShading: true });
    const shrubMat = new THREE.MeshStandardMaterial({ color: OBJ.pineNeedle, flatShading: true, roughness: 1 });
    const snowPineMat = new THREE.MeshStandardMaterial({ color: bandOf('frozen').veg, flatShading: true });
    const snowCapMat = new THREE.MeshStandardMaterial({ color: OBJ.snowCap, flatShading: true });

    instanced(scene, crownGeo, pineMat, pineNear, { castShadow: true });
    instanced(scene, trunkGeo, trunkMat, trunkNear);
    instanced(scene, rockGeo, rockMat, rockNear, { castShadow: true, receiveShadow: true });
    instanced(scene, new THREE.ConeGeometry(1.7, 5.0, 5), snowPineMat, snowPine, { castShadow: true });
    instanced(scene, new THREE.ConeGeometry(1.25, 2.0, 5), snowCapMat, snowCap);
    instanced(scene, logGeo, trunkMat, deadwood);
    // These carry no shadow and are the first thing the low tier drops.
    const petalGeo = new THREE.IcosahedronGeometry(0.16, 0);
    const PETAL = [0xffd166, 0xff7bac, 0xfdfbf4];
    this.far = [
      instanced(scene, crownGeo, pineMat, pineFar),
      instanced(scene, trunkGeo, trunkMat, trunkFar),
      instanced(scene, rockGeo, rockMat, rockFar),
      instanced(scene, tuftGeo, tuftMat, tuft),
      instanced(scene, shrubGeo, shrubMat, shrub),
      ...PETAL.map((c, i) => instanced(scene, petalGeo,
        new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.8 }), flower[i])),
    ].filter(Boolean);

    console.info(`[scatter] pines ${pineNear.length + pineFar.length}, rocks ${rockNear.length + rockFar.length},`
      + ` tufts ${tuft.length}, snow pines ${snowPine.length}`);

    this._crystals(scene);
    this._lanterns(scene);
  }

  // Glowing crystals near the summit — pure fantasy set dressing, and the only
  // thing up there that the bloom threshold is allowed to catch.
  _crystals(scene) {
    const geo = new THREE.OctahedronGeometry(1.1, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: OBJ.emCrystalBody, emissive: OBJ.emCrystal, emissiveIntensity: 1.4,
      flatShading: true, roughness: 0.3,
    });
    for (let i = 0; i < 26; i++) {
      const a = rand2(i, 43.1) * Math.PI * 2;
      const r = 20 + rand2(i, 47.7) * 130;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = this.terrain.heightAt(x, z);
      if (h < PEAK * 0.7) continue;
      const c = new THREE.Mesh(geo, mat);
      const sc = 0.9 + rand2(i, 51) * 1.8;
      c.scale.set(sc, sc * (1.4 + rand2(i, 3) * 0.8), sc);
      c.position.set(x, h + sc, z);
      c.rotation.y = rand2(i, 8) * 6;
      scene.add(c);
      this.crystals.push(c);
    }
  }

  // Lanterns lining the trail (emissive, no per-light cost).
  _lanterns(scene) {
    const terrain = this.terrain;
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.09, 2.1, 4);
    const poleMat = new THREE.MeshStandardMaterial({ color: OBJ.timberDark, flatShading: true });
    const lampGeo = new THREE.SphereGeometry(0.19, 6, 5);
    const lampMat = new THREE.MeshStandardMaterial({ color: OBJ.liveryGold, emissive: OBJ.emLantern, emissiveIntensity: 2.2 });
    const poles = [], lamps = [];
    const N = 120;
    const m = new THREE.Matrix4();
    for (let k = 0; k < N; k++) {
      const t = 0.02 + (k / N) * 0.95;
      if (terrain.gapAt(t)) continue;
      const p = terrain.pathPoint(t);
      const len = Math.hypot(p.x, p.z) || 1;
      const x = p.x + (p.x / len) * (p.width + 1.4);
      const z = p.z + (p.z / len) * (p.width + 1.4);
      const h = terrain.heightAt(x, z);
      if (Math.abs(h - p.h) > 4) continue; // off a cliff edge — skip
      poles.push(m.clone().setPosition(x, h + 1.05, z));
      lamps.push(m.clone().setPosition(x, h + 2.2, z));
    }
    instanced(scene, poleGeo, poleMat, poles);
    instanced(scene, lampGeo, lampMat, lamps);
  }

  setDetail(full) {
    for (const mesh of this.far) mesh.visible = full;
  }

  update(dt) {
    for (const c of this.crystals) c.rotation.y += dt * 0.4;
  }
}
