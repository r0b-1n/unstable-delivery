import * as THREE from 'three';
import { OBJ } from '../art/palette.js';
import { WORLD_R } from './dims.js';
import { InstancedPool } from '../art/instanced.js';
import { rand2 } from './noise.js';

// Everything past the shoreline: the sea, the range on the horizon, the clouds
// and the birds.
//
// The horizon range is the highest ratio of perceived scale to cost in the
// whole map. Before it, the world ended in fog about 600 m out and no amount of
// mountain made the mountain feel big — there was nothing for it to be big
// AGAINST. Eighteen silhouettes at two to three kilometres, drawn with no
// lighting and tinted straight at the sky's own horizon colour, do the entire
// job of aerial perspective for six draw calls.

const SEA_IN = 820, SEA_OUT = 4600;
const FAR_IN = 1500, FAR_OUT = 3000;
const FAR_COUNT = 18;

// A lumpy cone. Jittering the base ring is what stops eighteen instances of one
// geometry from reading as eighteen copies of one shape.
function ridgeGeometry(sides, seed) {
  const geo = new THREE.ConeGeometry(1, 1, sides);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > -0.4) continue;              // leave the apex alone
    const k = 0.65 + rand2(i, seed) * 0.7;
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
    pos.setY(i, y + (rand2(seed, i) - 0.5) * 0.12);
  }
  geo.computeVertexNormals();
  return geo;
}

export class Backdrop {
  constructor(ctx, terrain) {
    this.ctx = ctx;
    this.terrain = terrain;
    this._haze = new THREE.Color();
    this._sea(ctx.scene);
    this._range(ctx.scene);
    this._clouds(ctx.scene);
    this._birds(ctx.scene);
  }

  _sea(scene) {
    const geo = new THREE.RingGeometry(SEA_IN, SEA_OUT, 64, 8);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: OBJ.sea, roughness: 0.35, metalness: 0.1, flatShading: true,
      transparent: true, opacity: 0.96,
    });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = { value: 0 };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>',
          `#include <begin_vertex>
           transformed.y += sin(position.x * 0.05 + uTime * 1.1) * 0.55 + cos(position.z * 0.06 + uTime * 0.8) * 0.45;`);
      this._seaShader = sh;
    };
    const sea = new THREE.Mesh(geo, mat);
    sea.position.y = 0.5;
    scene.add(sea);
  }

  _range(scene) {
    // MeshBasicMaterial on purpose: a mountain three kilometres away through
    // this much air has no visible form left, only a value. Lighting it would
    // give it detail the eye reads as nearness, which is the opposite of the
    // job. fog is off because the tint below IS the haze.
    this.rangeMat = new THREE.MeshBasicMaterial({ color: 0x8fa8c4, fog: false });
    this.capMat = new THREE.MeshBasicMaterial({ color: 0xc9d8e8, fog: false });
    const geos = [ridgeGeometry(7, 3.1), ridgeGeometry(6, 11.7), ridgeGeometry(9, 23.3)];
    const bodies = geos.map(() => []);
    const caps = [];
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();

    for (let i = 0; i < FAR_COUNT; i++) {
      const a = (i / FAR_COUNT) * Math.PI * 2 + rand2(i, 7.7) * 0.28;
      const r = FAR_IN + rand2(i, 3.3) * (FAR_OUT - FAR_IN);
      const wide = 420 + rand2(i, 9.1) * 700;
      const tall = 260 + rand2(i, 5.5) * 640;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      q.setFromAxisAngle(UP, rand2(i, 13) * 6);
      bodies[i % geos.length].push(
        new THREE.Matrix4().compose(v.set(x, tall * 0.5 - 30, z), q, s.set(wide, tall, wide * 0.8)));
      // A snow cap on the taller half only — an unbroken white line along the
      // horizon reads as cloud, not as summits.
      if (tall > 500) {
        caps.push(new THREE.Matrix4().compose(
          v.set(x, tall * 0.5 - 30 + tall * 0.30, z), q, s.set(wide * 0.42, tall * 0.34, wide * 0.34)));
      }
    }

    const add = (geo, mat, list) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      for (let i = 0; i < list.length; i++) mesh.setMatrixAt(i, list[i]);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;   // it is the horizon; it is always relevant
      mesh.renderOrder = -1;        // behind everything, never over the terrain
      scene.add(mesh);
    };
    geos.forEach((g, i) => add(g, this.rangeMat, bodies[i]));
    add(geos[0], this.capMat, caps);
  }

  // Drifting low-poly clouds. Every blob used to build its OWN
  // IcosahedronGeometry — sixty-odd transparent draw calls for set dressing.
  // One unit icosahedron scaled per instance gives the identical silhouette.
  _clouds(scene) {
    this.clouds = [];
    const mat = new THREE.MeshStandardMaterial({
      color: OBJ.cloud, flatShading: true, roughness: 1, transparent: true, opacity: 0.92,
    });
    this._cloudPool = new InstancedPool(scene, new THREE.IcosahedronGeometry(1, 0), mat, 220,
      { castShadow: false, dynamic: true });
    for (let i = 0; i < 34; i++) {
      const blobs = 2 + ((rand2(i, 61) * 4) | 0);
      const parts = [];
      for (let b = 0; b <= blobs; b++) {
        const r = 7 + rand2(i, b) * 11;
        const proxy = this._cloudPool.obtain();
        proxy.scale.set(r, r * 0.55, r);
        parts.push({ proxy, ox: b * 9 - blobs * 4.5, oy: rand2(b, i) * 5, oz: rand2(i * 3, b) * 8 });
      }
      const a = rand2(i, 71) * Math.PI * 2;
      const r = 120 + rand2(i, 73) * 620;
      this.clouds.push({
        pos: new THREE.Vector3(Math.cos(a) * r, 130 + rand2(i, 79) * 330, Math.sin(a) * r),
        parts, speed: 1.5 + rand2(i, 83) * 3.5,
      });
    }
  }

  _birds(scene) {
    this.birds = [];
    const geo = new THREE.ConeGeometry(0.3, 1.1, 3);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: OBJ.bird, flatShading: true });
    for (let f = 0; f < 5; f++) {
      const cx = Math.cos(f * 2.1) * (140 + f * 90);
      const cz = Math.sin(f * 2.1) * (140 + f * 90);
      const cy = 70 + f * 80;
      for (let b = 0; b < 4; b++) {
        const mesh = new THREE.Mesh(geo, mat);
        scene.add(mesh);
        this.birds.push({ mesh, cx, cz, cy, r: 12 + b * 3.5, phase: b * 1.6 + f, speed: 0.5 + rand2(f, b) * 0.3 });
      }
    }
  }

  update(dt, t) {
    // Tint the range at whatever the sky's horizon is doing right now, so the
    // backdrop tracks the light through the shift instead of sitting at one
    // fixed grey while the rest of the world goes to evening.
    const horizon = this.ctx.mood?.uniforms.horizonColor.value;
    if (horizon) {
      this.rangeMat.color.copy(horizon).lerp(FAR_ROCK, 0.30);
      this.capMat.color.copy(horizon).lerp(WHITE, 0.35);
    }

    for (const c of this.clouds) {
      c.pos.x += c.speed * dt;
      if (c.pos.x > WORLD_R + 200) c.pos.x = -WORLD_R - 200;
      for (const p of c.parts) p.proxy.position.set(c.pos.x + p.ox, c.pos.y + p.oy, c.pos.z + p.oz);
    }
    this._cloudPool.flush();

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

const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(0xffffff);
const FAR_ROCK = new THREE.Color(0x4d5f7a);
