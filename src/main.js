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
scene.background = new THREE.Color(0x8fc3f2);
scene.fog = new THREE.Fog(0xcadef5, 90, 560);

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
const ctx = {
  scene, camera, renderer,
  physics: null, terrain: null, props: null, cablecar: null,
  packages: null, player: null, character: null,
  deliveries: null, director: null, particles: null, sfx: null, hud: null,
  wind: new THREE.Vector3(),
  gust: 0,
  checkpoint: new THREE.Vector3(),
  dynamics: [],
  registerDynamic(body, kind) { this.dynamics.push({ body, kind }); },
  unregisterDynamic(body) {
    const i = this.dynamics.findIndex((d) => d.body === body);
    if (i >= 0) this.dynamics.splice(i, 1);
  },
};

let state = 'loading';
let gameTime = 0;
let fps = 60;

async function boot() {
  ctx.sfx = new Sfx();
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

  // Altitude mood: sky darkens toward the storm summit; lightning flashes.
  const alt01 = THREE.MathUtils.clamp(p.y / PEAK, 0, 1);
  const storm = THREE.MathUtils.smoothstep(alt01, 0.55, 0.95);
  const flash = ctx.director.flash;
  scene.background.setRGB(
    0.56 - storm * 0.3 + flash * 0.4,
    0.76 - storm * 0.38 + flash * 0.4,
    0.95 - storm * 0.42 + flash * 0.4,
  );
  scene.fog.color.copy(scene.background).lerp(new THREE.Color(0xffffff), 0.25);
  hemi.intensity = 1.0 - storm * 0.25 + flash * 1.5;

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
