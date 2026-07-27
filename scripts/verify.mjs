// E2E verification: boots the game headless, drives the player, screenshots.
import { chromium } from 'playwright';

const URL = process.env.GAME_URL || 'http://localhost:4173/';
const OUT = './verify-out';

import { mkdirSync } from 'node:fs';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  // CHROMIUM_PATH lets CI/sandboxes point at a system chromium; software GL
  // flags keep it working headless without a GPU.
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('requestfailed', (r) => errors.push('REQFAIL: ' + r.url()));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });

await page.goto(URL);
// Wait for boot (title ready)
await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 60000 });
await page.screenshot({ path: `${OUT}/shot-title.png` });
console.log('TITLE OK');

// Start the game programmatically (pointer lock will fail silently headless, fine)
await page.evaluate(() => window.__game.start());
await page.waitForTimeout(1500);
const pos0 = await page.evaluate(() => window.__game.playerPos);
console.log('spawn pos', pos0.map((n) => n.toFixed(1)).join(', '));
await page.screenshot({ path: `${OUT}/shot-spawn.png` });

// Walk forward for 2 s of SIMULATION, not 2 s of wall clock. Headless renders
// at ~12 fps and the post-processing chain makes that slower still, so a sleep
// buys an unpredictable amount of movement and this check drifts toward its
// own threshold as the renderer gets heavier.
await page.keyboard.down('w');
const walk = await page.evaluate(() => {
  const g = window.__game;
  const a = g.playerPos;
  g.runFrames(120);
  const b = g.playerPos;
  return { moved: Math.hypot(b[0] - a[0], b[2] - a[2]), pos: b };
});
await page.keyboard.up('w');
const pos1 = walk.pos;
console.log('moved', walk.moved.toFixed(2), 'm in 2 s sim — pos', pos1.map((n) => n.toFixed(1)).join(', '));
if (walk.moved < 6) throw new Error('Player did not move');

// Jump. Fired from inside the page so the 0.14 s jump buffer cannot expire in
// the round trip, and measured as PEAK height — sampling once after a fixed
// delay mostly caught the courier on the way back down.
const jump = await page.evaluate(() => {
  const g = window.__game;
  const y0 = g.playerPos[1];
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
  let peak = y0;
  for (let i = 0; i < 60; i++) { g.runFrames(1); peak = Math.max(peak, g.playerPos[1]); }
  return peak - y0;
});
// v²/2g with JUMP=10.5 and the world's gravity of -22 is 2.5 m; 1.8 leaves
// real headroom while still catching a jump that has stopped working.
console.log('jump peak', jump.toFixed(2), 'm');
if (jump < 1.8) throw new Error(`Jump barely left the ground (${jump.toFixed(2)} m)`);

// Package pickup: walk to chute area via teleport near it
const pkg = await page.evaluate(() => {
  const c = window.__game.ctx.packages.chutePos;
  window.__game.teleport(c.x + 0.5, c.y + 1.5, c.z);
  window.__game.runFrames(72);
  return window.__game.package;
});
console.log('package', JSON.stringify(pkg));
if (!pkg || !pkg.carried) throw new Error('Package pickup failed');
await page.screenshot({ path: `${OUT}/shot-package.png` });

// Carry it around, check it follows
await page.keyboard.down('w');
const pkgStill = await page.evaluate(() => {
  window.__game.runFrames(90);
  return window.__game.package;
});
await page.keyboard.up('w');
console.log('package after walk', JSON.stringify(pkgStill));

// --- Full delivery: carry the package to the beacon ---
const { completed, score } = await page.evaluate(() => {
  const b = window.__game.ctx.deliveries.beacon.position;
  window.__game.teleport(b.x, b.y + 1.5, b.z);
  window.__game.runFrames(72);
  return { completed: window.__game.completed, score: window.__game.score };
});
console.log('delivered:', completed, 'score:', score);
if (completed !== 1) throw new Error('Delivery did not register');
await page.screenshot({ path: `${OUT}/shot-delivered.png` });

// --- Gondola ride: stand on a gondola floor, verify we get carried ---
const ride = await page.evaluate(() => {
  const g = window.__game.ctx.cablecar.gondolas[0];
  const p = g.group.position;
  window.__game.teleport(p.x, p.y + 0.1, p.z);
  const before = window.__game.playerPos;
  window.__game.runFrames(150); // 2.5 s of simulation
  const after = window.__game.playerPos;
  const gp = g.group.position;
  const stayedOn = Math.hypot(after[0] - gp.x, after[2] - gp.z) < 2.5;
  return { moved: Math.hypot(after[0] - before[0], after[2] - before[2]), stayedOn };
});
console.log('gondola ride:', JSON.stringify(ride));
if (!ride.stayedOn || ride.moved < 3) throw new Error('Gondola did not carry the player');
await page.screenshot({ path: `${OUT}/shot-gondola.png` });

// --- Mushroom bounce ---
const bounce = await page.evaluate(() => {
  const m = window.__game.ctx.props.mushrooms[0];
  window.__game.teleport(m.pos.x, m.capY + 3, m.pos.z);
  let maxVy = -99;
  for (let i = 0; i < 180; i++) {
    window.__game.runFrames(1);
    maxVy = Math.max(maxVy, window.__game.playerVel[1]);
  }
  return maxVy;
});
console.log('mushroom max vy after drop:', bounce.toFixed(1));
if (bounce < 10) throw new Error('Mushroom did not bounce the player');

// --- Mid-mountain path view (walk along path, camera view) ---
await page.evaluate(() => {
  const t = window.__game.ctx.terrain.pathPoint(0.45);
  const y = window.__game.ctx.terrain.heightAt(t.x, t.z);
  window.__game.teleport(t.x, y + 2, t.z);
});
await page.waitForTimeout(1500);
await page.keyboard.down('w');
await page.waitForTimeout(1200);
await page.keyboard.up('w');
await page.screenshot({ path: `${OUT}/shot-cliffs.png` });

// Teleport high up to check frozen zone + snow
await page.evaluate(() => {
  const t = window.__game.ctx.terrain.pathPoint(0.72);
  const y = window.__game.ctx.terrain.heightAt(t.x, t.z);
  window.__game.teleport(t.x, y + 2, t.z);
});
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/shot-high.png` });
const posH = await page.evaluate(() => window.__game.playerPos);
console.log('high pos', posH.map((n) => n.toFixed(1)).join(', '));

// Summit island
const onIsland = await page.evaluate(() => {
  const isl = window.__game.ctx.terrain.summitIsland;
  const p = isl.group.position;
  window.__game.teleport(p.x, p.y + 3, p.z);
  window.__game.runFrames(120);
  return window.__game.playerPos;
});
await page.screenshot({ path: `${OUT}/shot-summit.png` });
console.log('summit island pos', onIsland.map((n) => n.toFixed(1)).join(', '));
if (onIsland[1] < 150) throw new Error('Fell through the summit island');

// --- Parachute: jump off the island and hold space ---
await page.evaluate(() => {
  const p = window.__game.playerPos;
  window.__game.teleport(p[0] + 12, p[1] + 5, p[2]);
  window.__game.runFrames(42);
});
await page.keyboard.down('Space');
const chute = await page.evaluate(() => {
  window.__game.runFrames(90);
  return { vy: window.__game.playerVel[1], on: window.__game.ctx.player.parachute };
});
const chuteVy = chute.vy, chuteOn = chute.on;
await page.screenshot({ path: `${OUT}/shot-parachute.png` });
await page.keyboard.up('Space');
console.log('parachute on:', chuteOn, 'fall speed:', chuteVy.toFixed(1));
if (!chuteOn || chuteVy < -6) throw new Error('Parachute not limiting fall speed');

// --- Potion: violent shaking must blow it up ---
const potion = await page.evaluate(() => {
  const g = window.__game;
  while (g.ctx.packages.current) g.ctx.packages.remove(g.ctx.packages.current);
  const def = g.ctx.packages.typeForDelivery(6); // Unstable Potion
  const pkg = g.ctx.packages.spawn(def);
  pkg.carried = true;
  // The spawn grace is 0.9 s of SIMULATION. Sleeping 500 ms of wall clock used
  // to cover it; under the composer the simulation runs slower than real time,
  // so the grace was still live and the first yanks were free.
  g.runFrames(60);
  // Track THIS parcel, not "is any parcel still held". With a stack of up to
  // three, packages.current is the bottom of the stack and says nothing about
  // whether the potion specifically survived.
  for (let i = 0; i < 40 && g.ctx.packages.active.includes(pkg); i++) {
    const p = g.playerPos;
    g.teleport(p[0] + (i % 2 ? 4 : -4), p[1] + 1, p[2]);
    g.runFrames(5);
  }
  return { exploded: !g.ctx.packages.active.includes(pkg), id: def.id, shake: Math.round(pkg.shake) };
});
console.log('potion test:', JSON.stringify(potion));
if (potion.id === 'potion' && !potion.exploded) throw new Error('Potion never exploded under violent shaking');

// --- Smoke test every package type's behaviour loop ---
const typesOk = await page.evaluate(() => {
  const g = window.__game;
  const seen = [];
  for (let n = 0; n < 8; n++) {
    while (g.ctx.packages.current) g.ctx.packages.remove(g.ctx.packages.current);
    const def = g.ctx.packages.typeForDelivery(Math.min(n, 7));
    const pkg = g.ctx.packages.spawn(def);
    pkg.carried = true;
    g.runFrames(78);
    seen.push(`${def.id}:${g.ctx.packages.active.includes(pkg) ? 'alive' : 'gone'}`);
  }
  while (g.ctx.packages.current) g.ctx.packages.remove(g.ctx.packages.current);
  return seen;
});
console.log('package types:', typesOk.join(' '));

// --- Flight-exploit regression: balloon + egg must NOT lift the courier ---
for (const typeIdx of [2, 3]) { // balloon, egg
  const fly = await page.evaluate((idx) => {
    const g = window.__game;
    while (g.ctx.packages.current) g.ctx.packages.remove(g.ctx.packages.current);
    // flat ground near the depot
    const c = g.ctx.packages.chutePos;
    g.teleport(c.x - 5, c.y + 1.5, c.z - 5);
    const def = g.ctx.packages.typeForDelivery(idx);
    const pkg = g.ctx.packages.spawn(def);
    pkg.carried = true;
    const y0 = g.playerPos[1];
    let maxY = y0;
    // 10 s of simulation. This one has to be simulation time or the check
    // silently weakens: fewer steps means less chance for a lift exploit to
    // accumulate, and it would pass on a slow machine for the wrong reason.
    for (let i = 0; i < 600; i++) {
      g.runFrames(1);
      maxY = Math.max(maxY, g.playerPos[1]);
    }
    while (g.ctx.packages.current) g.ctx.packages.remove(g.ctx.packages.current);
    return { id: def.id, rise: maxY - y0 };
  }, typeIdx);
  console.log('no-fly check:', JSON.stringify(fly));
  if (fly.rise > 4) throw new Error(`Carrying ${fly.id} lifted the player ${fly.rise.toFixed(1)}m — flight exploit back`);
}

// --- Regression: parachute must deploy WHILE CARRYING a package ---
// (the ground probe used to detect the carried parcel as "ground")
const chuteCarry = await page.evaluate(() => {
  const g = window.__game;
  while (g.ctx.packages.current) g.ctx.packages.remove(g.ctx.packages.current);
  const pkg = g.ctx.packages.spawn(g.ctx.packages.typeForDelivery(0));
  pkg.carried = true;
  const c = g.ctx.packages.chutePos;
  g.teleport(c.x, c.y + 60, c.z);
  g.runFrames(36);
  return { grounded: g.ctx.player.grounded, falling: g.playerVel[1] < -3 };
});
console.log('carry-airborne:', JSON.stringify(chuteCarry));
if (chuteCarry.grounded) throw new Error('Grounded while falling with a carried package — ground probe hits the parcel again');
await page.keyboard.down('Space');
const carryChuteOn = await page.evaluate(() => {
  window.__game.runFrames(72);
  return window.__game.ctx.player.parachute;
});
await page.keyboard.up('Space');
console.log('parachute while carrying:', carryChuteOn);
if (!carryChuteOn) throw new Error('Parachute refused to deploy while carrying');
await page.evaluate(() => window.__game.runFrames(150)); // land before the next check

// --- Throw: F hurls the package; a thrown package can still deliver ---
// Driven by __game.runFrames, not by wall clock: headless renders at ~13 fps, so
// a fixed sleep buys a wildly varying amount of simulation. The courier also
// free-falls while the carry spring settles, so the shot has to be fired from a
// re-asserted pose or the parcel lands short by a metre or two at random.
const throwTest = await page.evaluate(() => {
  const g = window.__game;
  while (g.ctx.packages.current) g.ctx.packages.remove(g.ctx.packages.current);
  const b = g.ctx.deliveries.beacon.position;
  // 5 m, not 6. At 6 the throw only just reaches the delivery volume and flips
  // between pass and fail depending on the world state the earlier checks leave
  // behind. 5 m clears it comfortably while still keeping the HELD parcel
  // outside the volume — if it did not, delivery would fire during the settle
  // frames below, before `before` is sampled, and this check would fail loudly
  // rather than silently pass for the wrong reason.
  const from = { x: b.x - 5, y: b.y + 2, z: b.z };
  g.teleport(from.x, from.y, from.z);
  const pkg = g.ctx.packages.spawn(g.ctx.packages.typeForDelivery(0), { ...from });
  pkg.carried = true;
  pkg.grace = 0;

  g.runFrames(20);                       // carry spring snaps the parcel into the hands
  g.teleport(from.x, from.y, from.z);    // re-assert the firing pose
  g.runFrames(8);                        // let the spring drag the parcel back up
  const held = pkg.body.translation();
  const inHand = Math.hypot(held.x - from.x, held.y - from.y, held.z - from.z) < 2.5;
  if (!inHand) throw new Error('Carry spring never brought the parcel to hand — cannot test the throw');
  g.teleport(from.x, from.y, from.z);

  // aim the camera yaw at the beacon: forward = (-sin yaw, -cos yaw)
  const p = g.playerPos;
  g.ctx.player.yaw = Math.atan2(-(b.x - p[0]), -(b.z - p[2]));
  const before = g.completed;
  g.ctx.packages.throwCarried(-Math.sin(g.ctx.player.yaw), -Math.cos(g.ctx.player.yaw));
  const carriedAfter = g.ctx.packages.current?.carried;

  // 6 m at 11 m/s is ~0.55 s of simulation (~33 frames); 90 frames is headroom.
  // Report the frame the delivery landed on, not the closest approach: the loop
  // stops the moment the gate opens, so a "closest" reading can never be much
  // below the 3.4 m threshold and says nothing about margin. A rising frame
  // count is the signal that a throw has been weakened.
  let frames = -1;
  for (let i = 0; i < 90 && frames < 0; i++) {
    g.runFrames(1);
    if (g.completed > before) frames = i + 1;
  }
  return { carriedAfter, delivered: frames >= 0, frames };
});
console.log('throw test:', JSON.stringify(throwTest));
if (throwTest.carriedAfter) throw new Error('Throw did not release the package');
if (!throwTest.delivered) throw new Error('Thrown package did not deliver (yeet-to-deliver broken)');

// --- Jump-gap sanity: plank-less gaps must be physically jumpable ---
const gaps = await page.evaluate(() => {
  const T = window.__game.ctx.terrain.constructor.GAPS;
  const path = (t) => window.__game.ctx.terrain.pathPoint(t);
  return T.map((g) => {
    const a = path(g.t - g.w), b = path(g.t + g.w);
    return { m: g.m, actual: Math.hypot(b.x - a.x, b.z - a.z) };
  });
});
console.log('gap spans:', gaps.map((g) => `${g.m}m→${g.actual.toFixed(1)}m`).join(' '));
for (const g of gaps) if (Math.abs(g.actual - g.m) > 2) throw new Error(`Gap width off: wanted ${g.m}m got ${g.actual.toFixed(1)}m`);

// --- Recovery roll: tap Space just before a hard landing → no knockdown ---
// Frame-stepped, and the tap window is 2.5 m rather than the old 4 m. That is
// forced by the determinism, not a loosening: the jump buffer lasts 0.14 s
// (8 frames) and a tap fired at 4 m above ground still has ~12 frames of fall
// left, so the buffer would expire before touchdown every single time. Polling
// a wall clock against a starved rAF loop only ever passed because it sampled
// coarsely enough to land inside the window by luck.
const roll = await page.evaluate(() => {
  const g = window.__game;
  while (g.ctx.packages.current) g.ctx.packages.remove(g.ctx.packages.current);
  const c = g.ctx.packages.chutePos;
  const x = c.x - 8, z = c.z - 8;
  const ground = g.ctx.terrain.heightAt(x, z);
  g.teleport(x, ground + 24, z);
  let tapped = false;
  for (let i = 0; i < 240 && !tapped; i++) {
    g.runFrames(1);
    const p = g.playerPos, v = g.playerVel;
    // Height above the ground UNDER the courier, not above the launch point —
    // wind pushes a 24 m fall several metres sideways onto different terrain,
    // and against a fixed reference the trigger can be missed entirely.
    if (v[1] < -15 && p[1] - g.ctx.terrain.heightAt(p[0], p[2]) < 2.5) {
      // tap, don't hold — holding would deploy the parachute instead
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
      tapped = true;
    }
  }
  let rolled = false, knocked = false;
  for (let i = 0; i < 60; i++) {
    g.runFrames(1);
    rolled ||= g.ctx.player.rollTimer > 0;
    knocked ||= g.ctx.player.knockTimer > 0.3;
  }
  return { tapped, rolled, knocked };
});
console.log('recovery roll:', JSON.stringify(roll));
if (!roll.tapped) throw new Error('Roll test never reached the tap window');
if (!roll.rolled) throw new Error('Recovery roll did not trigger on a pre-landing Space tap');
if (roll.knocked) throw new Error('Recovery roll still caused a knockdown');

// --- Sheep escape: breaking the crate frees the sheep; catching re-crates ---
const sheepTest = await page.evaluate(() => {
  const g = window.__game;
  while (g.ctx.packages.current) g.ctx.packages.remove(g.ctx.packages.current);
  const def = g.ctx.packages.typeForDelivery(4); // sheep
  const pkg = g.ctx.packages.spawn(def);
  pkg.carried = true;
  g.runFrames(18);
  g.ctx.packages.break(pkg);
  const escaped = !!g.ctx.packages.escapee && !g.ctx.packages.current;
  // chase her down by teleporting onto her
  let caught = false;
  for (let i = 0; i < 20 && !caught; i++) {
    const e = g.ctx.packages.escapee;
    if (!e) break;
    const ep = e.body.translation();
    g.teleport(ep.x, ep.y + 0.5, ep.z);
    g.runFrames(9);
    caught = !!g.ctx.packages.current;
  }
  while (g.ctx.packages.current) g.ctx.packages.remove(g.ctx.packages.current);
  return { escaped, caught };
});
console.log('sheep escape:', JSON.stringify(sheepTest));
if (!sheepTest.escaped) throw new Error('Sheep crate break did not spawn an escapee');
if (!sheepTest.caught) throw new Error('Could not recapture the escaped sheep');

// --- Character rig sanity: parts exist and run cycle actually rotates the legs ---
const rig = await page.evaluate(async () => {
  const ch = window.__game.ctx.character;
  const counts = {};
  for (const k of ['armL', 'armR', 'legL', 'legR', 'headG']) {
    counts[k] = ch[k] ? ch[k].children.reduce((n, c) => n + (c.geometry?.attributes.position?.count ?? 0), 0) : 0;
  }
  return counts;
});
console.log('rig parts (vertex counts):', JSON.stringify(rig));
for (const [k, n] of Object.entries(rig)) if (n < 30) throw new Error(`Rig part ${k} nearly empty (${n} verts)`);

// --- Event smoke test: force each event, run it, no errors ---
for (const ev of ['gale', 'boulderRain', 'avalanche', 'thunder']) {
  await page.evaluate((name) => {
    const d = window.__game.ctx.director;
    const p = window.__game.ctx.player.body.translation();
    if (d.event) d.event.ttl = 0;
    d._startEvent(name, p, { key: 'frozen' });
    window.__game.runFrames(150);
    if (d.event) { d.event.ttl = 0; }
  }, ev);
}
console.log('events smoke: ok');

// --- Chaos soak: force high level, wander the frozen zone + summit for 25 s ---
await page.evaluate(() => {
  window.__game.ctx.director.level = 7;
  const t = window.__game.ctx.terrain.pathPoint(0.78);
  const y = window.__game.ctx.terrain.heightAt(t.x, t.z);
  window.__game.teleport(t.x, y + 2, t.z);
});
for (let i = 0; i < 12; i++) {
  await page.keyboard.down(['w', 'a', 'd'][i % 3]);
  await page.waitForTimeout(1000);
  await page.keyboard.up(['w', 'a', 'd'][i % 3]);
  if (i === 6) {
    await page.evaluate(() => {
      const t = window.__game.ctx.terrain.pathPoint(0.95);
      const y = window.__game.ctx.terrain.heightAt(t.x, t.z);
      window.__game.teleport(t.x, y + 2, t.z);
    });
  }
}
await page.screenshot({ path: `${OUT}/shot-chaos.png` });
const soak = await page.evaluate(() => ({
  boulders: window.__game.ctx.director.boulders.length,
  icicles: window.__game.ctx.director.icicles.length,
  pos: window.__game.playerPos.map((n) => Math.round(n)),
}));
console.log('soak:', JSON.stringify(soak));

// --- The stack: three parcels, spring chain, and current stays the bottom ---
const stack = await page.evaluate(() => {
  const g = window.__game;
  while (g.ctx.packages.current) g.ctx.packages.remove(g.ctx.packages.current);
  const ids = ['crate', 'porcelain', 'ghost'];
  const c = g.ctx.packages.chutePos;
  g.teleport(c.x - 4, c.y + 1.5, c.z - 4);
  for (const id of ids) {
    const def = g.ctx.packages.typeForDelivery(0);
    const pk = g.ctx.packages.spawn({ ...def, id });
    pk.carried = true;
    pk.grace = 0;
    g.runFrames(20);
  }
  g.runFrames(60);
  const pp = g.playerPos;
  const held = g.ctx.packages.active.map((pk) => {
    const t = pk.body.translation();
    return { id: pk.def.id, dist: +Math.hypot(t.x - pp[0], t.y - pp[1], t.z - pp[2]).toFixed(2) };
  });
  const bottomIsCurrent = g.ctx.packages.current === g.ctx.packages.active[0];
  // Anvils dispatch alone.
  const anvilCap = (() => {
    while (g.ctx.packages.current) g.ctx.packages.remove(g.ctx.packages.current);
    const def = g.ctx.packages.typeForDelivery(5);
    const pk = g.ctx.packages.spawn(def);
    pk.carried = true;
    const cap = g.ctx.packages.stackCap();
    while (g.ctx.packages.current) g.ctx.packages.remove(g.ctx.packages.current);
    return cap;
  })();
  return { count: held.length, held, bottomIsCurrent, anvilCap };
});
console.log('stack:', JSON.stringify(stack));
if (stack.count !== 3) throw new Error(`Stack did not hold three parcels (${stack.count})`);
if (!stack.bottomIsCurrent) throw new Error('packages.current is no longer the bottom of the stack');
if (stack.anvilCap !== 1) throw new Error(`Anvil did not force single-item dispatch (cap ${stack.anvilCap})`);
// Every parcel must actually be near the courier — a broken spring chain
// leaves the upper ones behind at the depot and the check above still passes.
for (const h of stack.held) if (h.dist > 5) throw new Error(`Stacked ${h.id} is ${h.dist} m away — spring chain broken`);
await page.screenshot({ path: `${OUT}/shot-stack.png` });

// --- Bilingual: switch mid-game, nothing may show a raw key or undefined ---
const audit = await page.evaluate(() => window.__game.i18nAudit());
if (audit.en.length || audit.de.length) throw new Error(`i18n gaps — en:${audit.en} de:${audit.de}`);
const langSwap = await page.evaluate(() => {
  const g = window.__game;
  const read = () => document.getElementById('hud').innerText;
  g.setLang('de');
  const de = read();
  g.setLang('en');
  const en = read();
  const bad = [de, en].filter((s) => /undefined|\b(hud|toast|pkg|spot|zone|score)\.[a-z]/i.test(s));
  return { de: de.slice(0, 80), bad: bad.length };
});
console.log('lang swap:', JSON.stringify(langSwap));
if (langSwap.bad) throw new Error('Raw key or undefined visible in the HUD after a language switch');

// --- Render budget + quality tiers ---
const gfx = await page.evaluate(() => {
  const r = window.__game.ctx.renderer.info.render;
  return { calls: r.calls, tris: r.triangles, tier: window.__game.tier, qmode: window.__game.qmode };
});
console.log('render:', JSON.stringify(gfx));

for (const t of [0, 1, 2]) {
  await page.evaluate((n) => window.__game.setTier(n), t);
  await page.waitForTimeout(250);
}
const tierBack = await page.evaluate(() => window.__game.tier);
if (tierBack !== 2) throw new Error(`setTier did not stick (got ${tierBack})`);
console.log('quality tiers: ok');

const stats = await page.evaluate(() => ({ fps: window.__game.fps, bodies: window.__game.bodies }));
console.log('fps(headless swiftshader)', stats.fps.toFixed(0), 'bodies', stats.bodies);

// --- Pause determinism: 20 cycles must not let the accumulator spiral ---
const pauseTest = await page.evaluate(() => {
  const g = window.__game;
  const c = g.ctx.packages.chutePos;
  g.teleport(c.x - 6, c.y + 1.2, c.z - 6);
  g.runFrames(30);
  const before = g.playerPos;
  let steppedWhilePaused = 0;
  for (let i = 0; i < 20; i++) {
    g.pause();
    const t0 = g.gameTime;
    g.runFrames(5);                       // must be a no-op while paused
    if (g.gameTime !== t0) steppedWhilePaused++;
    g.resume();
    g.runFrames(5);
  }
  const after = g.playerPos;
  return {
    state: g.state,
    steppedWhilePaused,
    drift: Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]),
  };
});
console.log('pause/resume x20:', JSON.stringify(pauseTest));
if (pauseTest.steppedWhilePaused) throw new Error('Physics advanced while paused');
if (pauseTest.state !== 'playing') throw new Error(`Resume did not restore play (state ${pauseTest.state})`);
if (pauseTest.drift > 3) throw new Error(`Pause/resume moved the courier ${pauseTest.drift.toFixed(1)} m — accumulator spiral`);

// --- Full shift on a fresh page: briefing -> manifest -> results ---
await page.evaluate(() => window.__game.resetMeta());
await page.reload();
await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 60000 });
const shiftFlow = await page.evaluate(() => {
  const g = window.__game;
  document.getElementById('ud-title').click();
  const briefingState = g.state;
  const total = g.shift?.manifest.length ?? 0;
  const quota = g.shift?.quota ?? 0;
  document.querySelector('#ud-briefing .ud-btn').click();
  const playingState = g.state;

  // Close every line the fast way: collect at the chute, teleport to the beacon.
  for (let i = 0; i < total + 2 && g.state === 'playing'; i++) {
    const c = g.ctx.packages.chutePos;
    g.teleport(c.x + 0.5, c.y + 1.5, c.z);
    g.runFrames(72);
    const b = g.ctx.deliveries.beacon.position;
    g.teleport(b.x, b.y + 1.5, b.z);
    g.runFrames(90);
  }
  return {
    briefingState, playingState, total, quota,
    endState: g.state,
    resultsOpen: document.getElementById('ud-results').classList.contains('on'),
    resultsText: document.getElementById('ud-results').innerText.slice(0, 60),
  };
});
console.log('shift flow:', JSON.stringify(shiftFlow));
if (shiftFlow.briefingState !== 'briefing') throw new Error(`Title click did not open the briefing (${shiftFlow.briefingState})`);
if (shiftFlow.playingState !== 'playing') throw new Error('Accepting the manifest did not start play');
if (shiftFlow.total < 3) throw new Error(`Shift 1 manifest too short (${shiftFlow.total})`);
if (shiftFlow.quota < 200) throw new Error(`Quota looks unset (${shiftFlow.quota})`);
if (shiftFlow.endState !== 'results') throw new Error(`Completing the manifest did not end the shift (${shiftFlow.endState})`);
if (!shiftFlow.resultsOpen) throw new Error('Results sheet did not open');
await page.screenshot({ path: `${OUT}/shot-results.png` });

// --- Meta: buy a requisition, reload, it must still be owned ---
const metaTest = await page.evaluate(() => {
  const g = window.__game;
  g.ctx.meta.mp = 99;
  const bought = g.ctx.meta.buy('harness');
  return { bought, mp: g.meta.mp, owned: g.meta.owned };
});
await page.reload();
await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 60000 });
const metaBack = await page.evaluate(() => window.__game.meta);
console.log('meta round-trip:', JSON.stringify(metaTest), '->', JSON.stringify(metaBack));
if (!metaTest.bought) throw new Error('Requisition purchase failed');
if (metaBack.owned.harness !== 1) throw new Error('Requisition did not survive a reload');
if (metaBack.mp !== metaTest.mp) throw new Error('Merit points did not survive a reload');
await page.evaluate(() => window.__game.resetMeta());

console.log('ERRORS:', errors.length ? errors.slice(0, 10) : 'none');
await browser.close();
if (errors.length) process.exit(2);
console.log('ALL OK');
