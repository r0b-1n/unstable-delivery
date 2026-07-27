import * as THREE from 'three';

function makeSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// One pooled THREE.Points system. Particles have position, velocity,
// gravity factor, drag, life and per-particle color/size.
class Pool {
  constructor(scene, max, { blending = THREE.NormalBlending, size = 1 } = {}) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.sizes = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.cursor = 0;
    this.alive = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('psize', new THREE.BufferAttribute(this.sizes, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6); // never culled

    const mat = new THREE.PointsMaterial({
      size,
      map: makeSprite(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending,
      sizeAttenuation: true,
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('uniform float size;', 'uniform float size; attribute float psize;')
        .replace('gl_PointSize = size;', 'gl_PointSize = size * psize;');
    };

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(p, v, { life = 1, color = 0xffffff, size = 1, grav = 1, drag = 0 } = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.baseSize[i] = size;
    const c = new THREE.Color(color);
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
  }

  update(dt, gravity) {
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.sizes[i] = 0; continue; }
      this.life[i] -= dt;
      alive++;
      const d = 1 - this.drag[i] * dt;
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d + gravity * this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.sizes[i] = this.baseSize[i] * Math.max(this.life[i] / this.maxLife[i], 0);
    }
    this.alive = alive;
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.points.geometry.attributes.psize.needsUpdate = true;
  }
}

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.normal = new Pool(scene, 1500, { size: 0.55 });
    this.glow = new Pool(scene, 800, { blending: THREE.AdditiveBlending, size: 0.7 });
    // Sized for worst case: ~230 flakes/s at the summit × ~6.5 s max life —
    // a smaller ring buffer overwrites live flakes mid-fall.
    this.snow = new Pool(scene, 1600, { size: 0.8 });
    this._snowTimer = 0;
    this._streakTimer = 0;
    this._v = new THREE.Vector3();
  }

  update(dt, camera, altitude01, windVec, gust = 0) {
    this.normal.update(dt, -9.8);
    this.glow.update(dt, -2);
    this.snow.update(dt, -0.9);

    // Continuous snowfall around the camera, denser with altitude.
    const rate = 12 + altitude01 * 220;
    this._snowTimer += dt * rate;
    while (this._snowTimer > 1) {
      this._snowTimer -= 1;
      const a = Math.random() * Math.PI * 2;
      const r = 8 + Math.random() * 42;
      this._v.set(
        camera.position.x + Math.cos(a) * r + windVec.x * 2,
        camera.position.y + 12 + Math.random() * 20,
        camera.position.z + Math.sin(a) * r + windVec.z * 2,
      );
      this.snow.spawn(this._v, { x: windVec.x * 0.6 + (Math.random() - 0.5), y: -2 - Math.random() * 2, z: windVec.z * 0.6 + (Math.random() - 0.5) }, {
        life: 4 + Math.random() * 2.5, color: 0xf4faff, size: 0.7 + Math.random() * 0.8, grav: 1, drag: 0.1,
      });
    }

    // Wind streaks: make gusts visible as fast white wisps flying downwind.
    const windLen = Math.hypot(windVec.x, windVec.z);
    const streakRate = gust > 0.35 ? (gust * 24) * Math.min(windLen / 12, 1.5) : 0;
    this._streakTimer += dt * streakRate;
    while (this._streakTimer > 1) {
      this._streakTimer -= 1;
      const a = Math.random() * Math.PI * 2;
      const r = 5 + Math.random() * 16;
      this._v.set(
        camera.position.x + Math.cos(a) * r - windVec.x * 1.2,
        camera.position.y - 2 + Math.random() * 7,
        camera.position.z + Math.sin(a) * r - windVec.z * 1.2,
      );
      this.snow.spawn(this._v, { x: windVec.x * 2.2, y: (Math.random() - 0.3) * 1.5, z: windVec.z * 2.2 }, {
        life: 0.45 + Math.random() * 0.3, color: 0xffffff, size: 0.5 + Math.random() * 0.5, grav: 0, drag: 0,
      });
    }
  }

  burst(pos, { count = 20, speed = 5, color = 0xffffff, life = 1, size = 1, glow = false, up = 0.5, grav = 1, drag = 0 } = {}) {
    const pool = glow ? this.glow : this.normal;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = (Math.random() - 0.5) * Math.PI;
      const s = speed * (0.4 + Math.random() * 0.6);
      pool.spawn(pos, {
        x: Math.cos(a) * Math.cos(b) * s,
        y: Math.abs(Math.sin(b)) * s * (0.5 + up) + up * s * 0.5,
        z: Math.sin(a) * Math.cos(b) * s,
      }, {
        life: life * (0.6 + Math.random() * 0.7),
        color: Array.isArray(color) ? color[(Math.random() * color.length) | 0] : color,
        size: size * (0.6 + Math.random() * 0.8),
        grav, drag,
      });
    }
  }

  confetti(pos) {
    this.burst(pos, {
      count: 90, speed: 9, up: 1.2, life: 2.2, size: 0.9, grav: 0.55, drag: 1.2,
      color: [0xff4d6d, 0xffd166, 0x45d17a, 0x4dd0ff, 0xb64fc8, 0xff9f43],
    });
  }

  dust(pos, intensity = 1) {
    this.burst(pos, { count: Math.floor(8 * intensity), speed: 2.4 * intensity, up: 0.5, life: 0.7, size: 1.6, color: 0xcfd8e6, grav: 0.15, drag: 2 });
  }

  smoke(pos) {
    this.burst(pos, { count: 2, speed: 0.8, up: 1.6, life: 1.4, size: 1.8, color: 0x777d88, grav: -0.25, drag: 1.4 });
  }

  steam(pos, strength = 1) {
    this.burst(pos, { count: 3, speed: 2 * strength, up: 3.2, life: 1.3, size: 2.4, color: 0xe8f4ff, grav: -0.4, drag: 1.2 });
  }

  explosion(pos) {
    this.burst(pos, { count: 60, speed: 14, up: 0.8, life: 1.1, size: 2, glow: true, color: [0xffd166, 0xff9f43, 0xff4d6d, 0xffffff], grav: 0.4, drag: 1.5 });
    this.burst(pos, { count: 30, speed: 7, up: 0.7, life: 1.6, size: 2.6, color: 0x555a66, grav: -0.1, drag: 1.4 });
  }

  sparks(pos, color = 0xffb347, count = 6) {
    this.burst(pos, { count, speed: 4, up: 1.4, life: 0.7, size: 0.8, glow: true, color, grav: 0.8 });
  }

  shards(pos, color = 0xffffff) {
    this.burst(pos, { count: 26, speed: 6, up: 0.9, life: 1.0, size: 0.8, color, grav: 1.2 });
  }

  pops(pos, color) {
    this.burst(pos, { count: 16, speed: 5, up: 0.6, life: 0.6, size: 1.1, color, grav: 0.3, drag: 1.6 });
  }
}
