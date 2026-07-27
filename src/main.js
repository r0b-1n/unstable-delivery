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
import { Shift } from './game/shift.js';
import { Meta } from './game/meta.js';
import { Particles } from './fx/particles.js';
import { Sfx } from './fx/sfx.js';
import { Music } from './fx/music.js';
import { Hud } from './ui/hud.js';
import { i18n } from './ui/i18n.js';
import './ui/ud.css';
import { Mood } from './art/mood.js';
import { Post } from './fx/post.js';
import { Quality } from './fx/quality.js';

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

// far 8000, not 1200: the horizon range stands at up to 3 km and the sky dome
// that has to enclose it is a 4600 m sphere centred on the courier.
const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 8000);
camera.position.set(0, 30, 60);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Quality owns pixel ratio — re-applying the tier also re-reads devicePixelRatio,
  // which changes when the window is dragged to a different monitor.
  ctx.quality?.apply(ctx.quality.tier);
  ctx.post?.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Game context shared by every subsystem ----------
let trauma = 0;   // screen shake accumulator
let hitstopT = 0; // brief slow-motion on big impacts

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
  shift: null,
  // 0 at clock-in, 1 when the last consignment closes. The light rig reads this
  // every frame; outside a shift it sits at mid-afternoon so the title screen
  // and the endless test mode still get a sun.
  get shift01() { return this.shift?.shift01 ?? 0.35; },
  shake(amt) { trauma = Math.min(1, trauma + amt); },
  hitstop(sec) { hitstopT = Math.max(hitstopT, sec); },
};

ctx.meta = new Meta();
ctx.mood = new Mood(ctx);
ctx.post = new Post(ctx);
ctx.quality = new Quality(ctx);
ctx.onQualityChange = (tier, dir) => {
  ctx.hud?.toast('hud.quality', { tier: tier.key.toUpperCase() }, { small: true });
  ctx.hud?.setStatus({ quality: tier.key });
  if (dir === 'down') console.info('[quality] stepped down to', tier.key);
};

let state = 'loading';
let gameTime = 0;
let fps = 60;
let manualStep = false; // test harness drives the simulation instead of rAF

// Yield to the browser so the loading bar actually paints between steps.
// Without this the whole boot runs inside one task and the bar jumps from
// 0 to gone — which is worse than no bar, because it looks broken.
const yieldFrame = () => new Promise((r) => requestAnimationFrame(r));

async function boot() {
  ctx.sfx = new Sfx();
  ctx.music = new Music(ctx.sfx);
  ctx.hud = new Hud();
  ctx.hud.ctx = ctx;
  ctx.hud.boot('boot.physics', 0.05);
  await yieldFrame();

  ctx.particles = new Particles(scene);
  ctx.physics = new Physics();
  await ctx.physics.init();

  ctx.hud.boot('boot.terrain', 0.2);
  await yieldFrame();
  ctx.terrain = new Terrain(ctx);
  // Quality ran its first apply() before the terrain existed, so the chunk LOD
  // radii and the scatter detail flag never reached it. Re-apply now.
  ctx.quality.apply(ctx.quality.tier);

  ctx.hud.boot('boot.props', 0.5);
  await yieldFrame();
  ctx.props = new Props(ctx);
  ctx.cablecar = new CableCar(ctx);
  ctx.deliveries = new Deliveries(ctx);
  ctx.packages = new Packages(ctx);

  ctx.hud.boot('boot.courier', 0.7);
  await yieldFrame();

  // Spawn beside the depot chute.
  const spawn = ctx.packages.chutePos.clone().add(new THREE.Vector3(-3, 2, -2));
  ctx.checkpoint.copy(ctx.packages.chutePos).add(new THREE.Vector3(-3, 0.5, -2));
  ctx.player = new PlayerController(ctx, spawn);
  ctx.character = new Character(ctx);
  await ctx.character.load();
  ctx.director = new Director(ctx);

  // Compile every shader now, while the loading screen is still up. The first
  // frame otherwise stalls for hundreds of milliseconds on a weak GPU as the
  // grade, the bloom chain and ~30 material variants all compile at once.
  ctx.hud.boot('boot.shaders', 0.85);
  await yieldFrame();
  renderer.compile(scene, camera);

  ctx.hud.boot('boot.ready', 1);
  ctx.hud.bindMenu({
    onStart: () => startGame(),
    onResume: resumeGame,
    onAbandon: () => { if (ctx.shift) endShift(); },
    onNextShift: () => { ctx.hud.hideScreen('results'); ctx.hud.hideScreen('meta'); openBriefing(); },
    onMeta: () => ctx.hud.meta(ctx.meta.screenData(shiftIndex)),
    onBuy: (id) => { if (ctx.meta.buy(id)) ctx.hud.meta(ctx.meta.screenData(shiftIndex)); },
    onLang: () => { ctx.hud.setLang(i18n.toggle()); },
    onMotion: () => { ctx.hud.setReducedMotion(!ctx.hud.reduced()); },
    onQuality: () => { ctx.quality.setTier((ctx.quality.tier + 1) % 3); ctx.hud.setStatus({ quality: ctx.quality.current.key }); },
  });
  ctx.hud.setStatus({ quality: ctx.quality.current.key, lang: i18n.lang, music: true });

  state = 'title';
  ctx.hud.titleReady(shiftIndex, ctx.meta.mp);
  ctx.hud.screens.title.addEventListener('click', openBriefing, { once: true });
}

// ---------- Shift lifecycle: title -> briefing -> playing -> results -> meta ----------
let shiftIndex = 1;
let pipStreak = 0;
let endless = false;

function openBriefing() {
  ctx.sfx.start();
  ctx.music.start();
  ctx.shift = new Shift(ctx, shiftIndex, pipStreak);
  ctx.deliveries.onShiftStart();
  state = 'briefing';
  ctx.hud.hideScreen('title');
  ctx.hud.briefing(ctx.shift.briefing());
}

// `opts.endless` skips shift termination and `opts.skipBriefing` goes straight
// to play. The test harness calls start() bare and immediately asserts
// state === 'playing'; without both defaults on that path the briefing screen
// strands the entire suite on its first line.
function startGame(opts = {}) {
  camera.fov = 68;
  camera.updateProjectionMatrix();
  if (!ctx.shift && !opts.endless) openBriefing();
  endless = !!opts.endless;
  ctx.hud.hideScreen('title');
  ctx.hud.hideScreen('briefing');
  ctx.sfx.start();
  ctx.music.start();
  ctx.hud.show();
  ctx.hud.setPackage(null);
  if (ctx.shift) ctx.hud.setShift({ index: ctx.shift.index, done: ctx.shift.done, total: ctx.shift.total });
  ctx.hud.toast('toast.firstpickup');
  state = 'playing';
  requestLock();
}

function pauseGame() {
  if (state !== 'playing') return;
  state = 'paused';
  ctx.music.duck?.(true);
  document.exitPointerLock?.();
  ctx.hud.showScreen('pause');
}

function resumeGame() {
  if (state !== 'paused') return;
  ctx.hud.hideScreen('pause');
  state = 'playing';
  ctx.music.duck?.(false);
  // Drop the wall time spent paused. frame() calls getDelta() every frame
  // including while paused, so the accumulator never actually banks it — this
  // is belt and braces against a future frame() that returns earlier.
  clock.getDelta();
  requestLock();
}

ctx.onShiftComplete = () => { if (!endless) endShift(); };

function endShift() {
  if (!ctx.shift || state === 'results') return;
  const res = ctx.shift.results();
  pipStreak = ctx.shift.met ? 0 : pipStreak + 1;
  const terminated = pipStreak >= 3;
  ctx.meta?.award(res.mp);
  state = 'results';
  document.exitPointerLock?.();
  ctx.sfx.jingle();
  ctx.music.fanfare?.();
  ctx.hud.results(res);
  // Termination resets the ROUTE, never the progression: merit points,
  // unlocks and records survive. The sting is narrative, not a wipe.
  shiftIndex = terminated ? 1 : ctx.shift.index + 1;
  if (terminated) pipStreak = 0;
  ctx.shift = null;
}

// requestPointerLock returns a Promise in Chrome 113+. An unhandled rejection
// is a pageerror and fails the whole E2E suite, and headless never grants the
// lock at all. Never pass an options object — { unadjustedMovement } throws
// NotSupportedError on Firefox.
function requestLock() {
  try { renderer.domElement.requestPointerLock?.()?.catch?.(() => {}); } catch { /* headless */ }
}

// Re-lock the pointer when the player clicks back into the game.
renderer.domElement.addEventListener('click', () => {
  if (state === 'playing') requestLock();
});

// The hint is only useful once the lock has been LOST, i.e. after a true->false
// transition. Reacting to the raw state would show it permanently headless,
// where document.pointerLockElement is null forever.
let hadLock = false;
let photoMode = false;
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  // Esc is swallowed by the browser while the pointer is locked, so a
  // true->false transition IS the pause request. Gating on the transition
  // rather than the raw state is also what keeps headless playable: there
  // pointerLockElement is null forever and a naive handler pauses on frame 1.
  if (hadLock && !locked && state === 'playing') pauseGame();
  hadLock = locked;
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (state === 'playing') pauseGame();
    else if (state === 'paused') resumeGame();
    return;
  }
  if (state !== 'playing') return;
  if (e.code === 'KeyP') {
    // Photo mode: the art direction deserves a screenshot without the paperwork.
    photoMode = !photoMode;
    ctx.hud.setPhotoMode(photoMode);
    return;
  }
  if (e.code === 'KeyM') {
    const on = ctx.music.toggle();
    ctx.hud.toast(on ? 'toast.music.on' : 'toast.music.off', null, { small: true });
    ctx.hud.setStatus({ music: on });
  }
});

// ---------- Checkpoints: depot + every cable car station ----------
function updateCheckpoint() {
  const p = ctx.player.body.translation();
  for (const st of ctx.cablecar.stations) {
    const d = Math.hypot(p.x - st.pos.x, p.y - st.pos.y, p.z - st.pos.z);
    // Checkpoints only ever move UP. Walking back past a lower station used to
    // demote you, which would send a return trip all the way to the bottom.
    if (d < 6 && st.pos.y > ctx.checkpoint.y + 1) {
      ctx.checkpoint.copy(st.pos).add(new THREE.Vector3(0, 0.5, 0));
      ctx.hud.toast('toast.checkpoint', { name: st.name }, { small: true });
      ctx.sfx.pickup();
    }
  }
}

// ---------- Main loop ----------
const clock = new THREE.Clock();

// Everything the world does in one frame, minus the draw. Split out of frame()
// so the test harness can advance the simulation by exact steps instead of
// racing a wall clock (see __game.runFrames).
function stepGame(realDt) {
  // Hitstop: the world freezes for a few frames on big impacts.
  // 0.06 is a stutter, not a hit: long enough to notice as a frame drop and
  // short enough to miss as punctuation. Near-freeze instead.
  let dt = realDt;
  if (hitstopT > 0) {
    hitstopT -= realDt;
    dt = realDt * 0.02;
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

  // Sky, fog, sun and hemisphere all read the same altitude bands the terrain
  // is coloured from, so ground and air can never drift apart.
  const p = ctx.player.body.translation();
  const alt01 = THREE.MathUtils.clamp(p.y / PEAK, 0, 1);
  ctx.mood.update(p, alt01, ctx.director.flash, gameTime, ctx.shift01);

  // --- Camera juice: trauma shake + speed FOV kick ---
  // Faster decay (2.6, was 1.4) with LARGER amplitudes. A long soft rumble
  // reads as a rendering fault; a short hard one reads as an impact.
  trauma = Math.max(0, trauma - dt * 2.6);
  if (trauma > 0.001) {
    const k = trauma * trauma;
    camera.position.x += (Math.random() - 0.5) * k * 1.15;
    camera.position.y += (Math.random() - 0.5) * k * 1.15;
    camera.rotation.z += (Math.random() - 0.5) * k * 0.1;
  }
  const v = ctx.player.body.linvel();
  const speed = Math.hypot(v.x, v.z);
  // Saturates at 17 m/s, not 14. At 14 the kick was almost permanently on and
  // had stopped signalling anything. Asymmetric response: opens slowly (3),
  // snaps back fast (9), so slowing down feels like braking.
  const targetFov = 68 + THREE.MathUtils.clamp(speed - 9, 0, 8) * 1.35 + (ctx.player.parachute ? 4 : 0);
  const fovRate = targetFov > camera.fov ? 3 : 9;
  camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, Math.min(dt * fovRate, 1));
  camera.updateProjectionMatrix();

  // Airspeed rush: wind-in-the-ears noise swells with total velocity.
  const speed3 = Math.hypot(v.x, v.y, v.z);
  ctx.sfx.setRush(THREE.MathUtils.clamp((speed3 - 9) / 14, 0, 1));

  // Music intensity follows danger: altitude, live events, ticking potion.
  const pkg = ctx.packages.current;
  ctx.music.setIntensity(
    0.22 + alt01 * 0.55
    + (ctx.director.event ? 0.25 : 0)
    + ((pkg?.carried && pkg.shake > 50) ? 0.2 : 0),
  );

  ctx.particles.update(dt, camera, alt01, ctx.wind, ctx.gust);
}

// Slow orbit around the mountain behind the title card. The scene was already
// built and already being rendered here; all that was ever missing was
// somewhere to point the camera. Highest impact per line in the whole plan —
// until now the entire art investment never reached the first thing anyone sees.
function titleCamera(t) {
  const a = 0.8 + t * 0.045;
  const r = 205 - Math.sin(t * 0.09) * 45;
  const h = 96 + Math.sin(t * 0.13) * 34;
  camera.position.set(Math.cos(a) * r, h, Math.sin(a) * r);
  camera.lookAt(0, 74, 0);
  if (camera.fov !== 58) { camera.fov = 58; camera.updateProjectionMatrix(); }
}

function frame() {
  requestAnimationFrame(frame);
  const realDt = Math.min(clock.getDelta(), 0.1);
  fps = fps * 0.95 + (1 / Math.max(realDt, 1e-4)) * 0.05;
  ctx.quality.sample(realDt);

  if (state !== 'playing') {
    // Paused, briefing, results: keep drawing, stop simulating. Behind the
    // title screen the world is still on camera too, so the sky and light rig
    // have to keep running or the scene renders as an unlit void.
    if (state === 'title') titleCamera(clock.elapsedTime);
    if (ctx.player) {
      // On the title screen the light rig follows the CAMERA, not the parked
      // courier — otherwise the sun sits over the depot while the shot is on
      // the summit, and the whole art direction misses the first thing anyone
      // ever sees.
      const p = state === 'title' ? camera.position : ctx.player.body.translation();
      ctx.mood.update(p, THREE.MathUtils.clamp(p.y / PEAK, 0, 1), 0, clock.elapsedTime, ctx.shift01);
    }
    ctx.post.render(realDt, clock.elapsedTime);
    return;
  }

  if (!manualStep) stepGame(realDt);
  ctx.post.render(realDt, gameTime);
}

boot().catch((e) => {
  console.error(e);
  ctx.hud?.fault(e?.stack ?? e?.message ?? e);
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
  // Bare start() means "put me in the world now, and never take me out" —
  // otherwise the briefing screen strands the suite and a completed manifest
  // would flip state to 'results' halfway through the checks.
  start: (opts = {}) => startGame({ endless: true, skipBriefing: true, ...opts }),
  teleport(x, y, z) { ctx.player.body.setTranslation({ x, y, z }, true); ctx.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true); },
  // Advance the world by exact fixed steps, no rendering. Headless runs on
  // SwiftShader render at ~13 fps, so a wall-clock sleep buys wildly varying
  // amounts of simulation and the timing-sensitive checks fail at random.
  // Stepping directly is both deterministic and far faster than waiting.
  runFrames(n, dt = 1 / 60) {
    if (state !== 'playing') return 0;
    manualStep = true;
    try {
      for (let i = 0; i < n; i++) stepGame(dt);
    } finally {
      manualStep = false;
      clock.getDelta(); // drop the time spent stepping so fps/dt do not spike
    }
    return gameTime;
  },
  get gameTime() { return gameTime; },
  get shift() {
    const s = ctx.shift;
    return s && { index: s.index, cursor: s.cursor, quota: s.quota, revenue: s.revenue, manifest: s.manifest };
  },
  pause: pauseGame,
  resume: resumeGame,
  endShift,
  get meta() { return ctx.meta?.snapshot(); },
  resetMeta() { ctx.meta.reset(); },
  get lang() { return i18n.lang; },
  setLang(code) { ctx.hud.setLang(code); },
  i18nAudit() { return i18n.audit(); },
  get tier() { return ctx.quality?.tier; },
  get qmode() { return ctx.quality?.mode; },
  setTier(t) { ctx.quality.setTier(t); },
};
