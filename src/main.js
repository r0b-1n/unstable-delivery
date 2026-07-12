import * as THREE from 'three';
import { Physics } from './core/physics.js';
import { Terrain, PEAK } from './world/terrain.js';
import { Props } from './world/props.js';
import { CableCar } from './world/cablecar.js';
import { Packages } from './packages/packages.js';
import { PlayerController } from './player/controller.js';
import { Character } from './player/character.js';
import { Deliveries } from './game/deliveries.js';
import { Director } from './game/director.js';
import { Particles } from './fx/particles.js';
import { Sfx } from './fx/sfx.js';
import { Music } from './fx/music.js';
import { Hud } from './ui/hud.js';

const app = document.getElementById('app');

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcadef5, 90, 560);

// Sky dome: vertical gradient + sun glow, tinted by altitude and storms.
const skyUniforms = {
  topColor: { value: new THREE.Color(0x3f8be0) },
  horizonColor: { value: new THREE.Color(0xcfe6f8) },
  sunDir: { value: new THREE.Vector3(0.45, 0.55, 0.3).normalize() },
  flash: { value: 0 },
};
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(900, 24, 12),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: skyUniforms,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 topColor, horizonColor, sunDir;
      uniform float flash;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(horizonColor, topColor, pow(h, 0.62));
        float sun = pow(max(dot(normalize(vDir), sunDir), 0.0), 350.0);
        float halo = pow(max(dot(normalize(vDir), sunDir), 0.0), 12.0);
        col += vec3(1.0, 0.93, 0.75) * sun * 1.4 + vec3(1.0, 0.9, 0.7) * halo * 0.22;
        col = mix(col, vec3(1.0), flash * 0.55);
        gl_FragColor = vec4(col, 1.0);
      }`,
  }),
);
sky.frustumCulled = false;
scene.add(sky);

const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 1200);
camera.position.set(0, 30, 60);

const hemi = new THREE.HemisphereLight(0xbcd9ff, 0x8a9389, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 340;
const S = 55;
sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Game context shared by every subsystem ----------
let trauma = 0; // screen shake accumulator

const ctx = {
  scene, camera, renderer,
  physics: null, terrain: null, props: null, cablecar: null,
  packages: null, player: null, character: null,
  deliveries: null, director: null, particles: null, sfx: null, music: null, hud: null,
  wind: new THREE.Vector3(),
  gust: 0,
  checkpoint: new THREE.Vector3(),
  dynamics: [],
  registerDynamic(body, kind) { this.dynamics.push({ body, kind }); },
  unregisterDynamic(body) {
    const i = this.dynamics.findIndex((d) => d.body === body);
    if (i >= 0) this.dynamics.splice(i, 1);
  },
  shake(amt) { trauma = Math.min(1, trauma + amt); },
};

let state = 'loading';
let gameTime = 0;
let fps = 60;

async function boot() {
  ctx.sfx = new Sfx();
  ctx.music = new Music(ctx.sfx);
  ctx.hud = new Hud();
  ctx.particles = new Particles(scene);

  ctx.physics = new Physics();
  await ctx.physics.init();

  ctx.terrain = new Terrain(ctx);
  ctx.props = new Props(ctx);
  ctx.cablecar = new CableCar(ctx);
  ctx.deliveries = new Deliveries(ctx);
  ctx.packages = new Packages(ctx);

  // Spawn beside the depot chute.
  const spawn = ctx.packages.chutePos.clone().add(new THREE.Vector3(-3, 2, -2));
  ctx.checkpoint.copy(ctx.packages.chutePos).add(new THREE.Vector3(-3, 0.5, -2));
  ctx.player = new PlayerController(ctx, spawn);
  ctx.character = new Character(ctx);
  await ctx.character.load();
  ctx.director = new Director(ctx);

  // Title screen ready.
  state = 'title';
  document.getElementById('title-loading').style.display = 'none';
  document.getElementById('title-start').style.display = 'block';
  document.getElementById('title-controls').style.display = 'block';
  document.getElementById('title-screen').addEventListener('click', startGame, { once: true });
}

function startGame() {
  document.getElementById('title-screen').style.display = 'none';
  ctx.sfx.start();
  ctx.music.start();
  ctx.hud.show();
  ctx.hud.setPackage(null);
  ctx.hud.toast('📦 Grab your first package at the glowing ring!', false);
  state = 'playing';
  renderer.domElement.requestPointerLock?.();
}

// Re-lock the pointer when the player clicks back into the game.
renderer.domElement.addEventListener('click', () => {
  if (state === 'playing') renderer.domElement.requestPointerLock?.();
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && ctx.music?.playing !== undefined) {
    const on = ctx.music.toggle();
    ctx.hud?.toast(on ? '🎵 Music on' : '🔇 Music off', true);
  }
});

// ---------- Checkpoints: depot + every cable car station ----------
function updateCheckpoint() {
  const p = ctx.player.body.translation();
  for (const st of ctx.cablecar.stations) {
    const d = Math.hypot(p.x - st.pos.x, p.y - st.pos.y, p.z - st.pos.z);
    if (d < 6 && Math.abs(ctx.checkpoint.y - st.pos.y) > 1) {
      ctx.checkpoint.copy(st.pos).add(new THREE.Vector3(0, 0.5, 0));
      ctx.hud.toast(`🚩 Checkpoint: ${st.name}`, true);
      ctx.sfx.pickup();
    }
  }
}

// ---------- Main loop ----------
const clock = new THREE.Clock();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  fps = fps * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;

  if (state !== 'playing') {
    // Idle orbit behind the title screen (cheap, hidden anyway).
    renderer.render(scene, camera);
    return;
  }

  ctx.physics.step(dt, (fdt) => {
    gameTime += fdt;
    ctx.director.fixedUpdate(fdt, gameTime);
    ctx.terrain.update(fdt, gameTime);
    ctx.props.fixedUpdate(fdt, gameTime);
    ctx.cablecar.fixedUpdate(fdt, gameTime);
    ctx.player.fixedUpdate(fdt);
    ctx.packages.fixedUpdate(fdt, gameTime);
    ctx.deliveries.fixedUpdate(fdt, gameTime);
  });

  ctx.player.update(dt);
  ctx.character.update(dt, gameTime);
  ctx.deliveries.update();
  ctx.cablecar.update();
  updateCheckpoint();

  // Sun follows the player so shadows stay crisp everywhere on the mountain.
  const p = ctx.player.body.translation();
  sun.position.set(p.x + 55, p.y + 150, p.z + 35);
  sun.target.position.set(p.x, p.y, p.z);
  sky.position.set(p.x, 0, p.z);

  // Altitude mood: bright meadows below, steel-gray storm at the summit.
  const alt01 = THREE.MathUtils.clamp(p.y / PEAK, 0, 1);
  const storm = THREE.MathUtils.smoothstep(alt01, 0.5, 0.95);
  const flash = ctx.director.flash;
  skyUniforms.topColor.value.setRGB(0.25 - storm * 0.1, 0.55 - storm * 0.24, 0.88 - storm * 0.42);
  skyUniforms.horizonColor.value.setRGB(0.81 - storm * 0.33, 0.9 - storm * 0.38, 0.97 - storm * 0.4);
  skyUniforms.flash.value = flash;
  scene.fog.color.copy(skyUniforms.horizonColor.value);
  hemi.intensity = 1.0 - storm * 0.3 + flash * 1.5;
  sun.intensity = 2.2 - storm * 0.9 + flash * 2;

  // --- Camera juice: trauma shake + speed FOV kick ---
  trauma = Math.max(0, trauma - dt * 1.4);
  if (trauma > 0.001) {
    const k = trauma * trauma;
    camera.position.x += (Math.random() - 0.5) * k * 0.7;
    camera.position.y += (Math.random() - 0.5) * k * 0.7;
    camera.rotation.z += (Math.random() - 0.5) * k * 0.06;
  }
  const v = ctx.player.body.linvel();
  const speed = Math.hypot(v.x, v.z);
  const targetFov = 68 + THREE.MathUtils.clamp(speed - 7, 0, 7) * 1.3 + (ctx.player.parachute ? 4 : 0);
  camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, Math.min(dt * 5, 1));
  camera.updateProjectionMatrix();

  // Music intensity follows danger: altitude, live events, ticking potion.
  const pkg = ctx.packages.current;
  ctx.music.setIntensity(
    0.22 + alt01 * 0.55
    + (ctx.director.event ? 0.25 : 0)
    + ((pkg?.carried && pkg.shake > 50) ? 0.2 : 0),
  );

  ctx.particles.update(dt, camera, alt01, ctx.wind);
  renderer.render(scene, camera);
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('title-loading').textContent = 'Failed to load: ' + e.message;
});
frame();

// Debug/verification handle (used by the test harness).
window.__game = {
  get state() { return state; },
  get fps() { return fps; },
  get playerPos() { const p = ctx.player?.body.translation(); return p ? [p.x, p.y, p.z] : null; },
  get playerVel() { const v = ctx.player?.body.linvel(); return v ? [v.x, v.y, v.z] : null; },
  get score() { return ctx.deliveries?.score; },
  get completed() { return ctx.deliveries?.completed; },
  get package() {
    const pkg = ctx.packages?.current;
    return pkg ? { id: pkg.def.id, carried: pkg.carried, condition: pkg.condition, shake: pkg.shake } : null;
  },
  get bodies() { return ctx.physics?.world.bodies.len(); },
  ctx,
  start: startGame,
  teleport(x, y, z) { ctx.player.body.setTranslation({ x, y, z }, true); ctx.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true); },
};
