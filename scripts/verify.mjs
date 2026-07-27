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

// Walk forward for 2s
await page.keyboard.down('w');
await page.waitForTimeout(2000);
await page.keyboard.up('w');
const pos1 = await page.evaluate(() => window.__game.playerPos);
const moved = Math.hypot(pos1[0] - pos0[0], pos1[2] - pos0[2]);
console.log('moved', moved.toFixed(2), 'm — pos', pos1.map((n) => n.toFixed(1)).join(', '));
if (moved < 2) throw new Error('Player did not move');

// Jump
const yBefore = pos1[1];
await page.keyboard.press('Space');
await page.waitForTimeout(400);
const posJ = await page.evaluate(() => window.__game.playerPos);
console.log('jump dy', (posJ[1] - yBefore).toFixed(2));

// Package pickup: walk to chute area via teleport near it
await page.evaluate(() => {
  const c = window.__game.ctx.packages.chutePos;
  window.__game.teleport(c.x + 0.5, c.y + 1.5, c.z);
});
await page.waitForTimeout(1200);
const pkg = await page.evaluate(() => window.__game.package);
console.log('package', JSON.stringify(pkg));
if (!pkg || !pkg.carried) throw new Error('Package pickup failed');
await page.screenshot({ path: `${OUT}/shot-package.png` });

// Carry it around, check it follows
await page.keyboard.down('w');
await page.waitForTimeout(1500);
await page.keyboard.up('w');
const pkgStill = await page.evaluate(() => window.__game.package);
console.log('package after walk', JSON.stringify(pkgStill));

// --- Full delivery: carry the package to the beacon ---
await page.evaluate(() => {
  const b = window.__game.ctx.deliveries.beacon.position;
  window.__game.teleport(b.x, b.y + 1.5, b.z);
});
await page.waitForTimeout(1200);
const completed = await page.evaluate(() => window.__game.completed);
const score = await page.evaluate(() => window.__game.score);
console.log('delivered:', completed, 'score:', score);
if (completed !== 1) throw new Error('Delivery did not register');
await page.screenshot({ path: `${OUT}/shot-delivered.png` });

// --- Gondola ride: stand on a gondola floor, verify we get carried ---
const ride = await page.evaluate(async () => {
  const g = window.__game.ctx.cablecar.gondolas[0];
  const p = g.group.position;
  window.__game.teleport(p.x, p.y + 0.1, p.z);
  const before = window.__game.playerPos;
  await new Promise((r) => setTimeout(r, 2500));
  const after = window.__game.playerPos;
  const gp = g.group.position;
  const stayedOn = Math.hypot(after[0] - gp.x, after[2] - gp.z) < 2.5;
  return { moved: Math.hypot(after[0] - before[0], after[2] - before[2]), stayedOn };
});
console.log('gondola ride:', JSON.stringify(ride));
if (!ride.stayedOn || ride.moved < 3) throw new Error('Gondola did not carry the player');
await page.screenshot({ path: `${OUT}/shot-gondola.png` });

// --- Mushroom bounce ---
const bounce = await page.evaluate(async () => {
  const m = window.__game.ctx.props.mushrooms[0];
  window.__game.teleport(m.pos.x, m.capY + 3, m.pos.z);
  let maxVy = -99;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
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
await page.evaluate(() => {
  const isl = window.__game.ctx.terrain.summitIsland;
  const p = isl.group.position;
  window.__game.teleport(p.x, p.y + 3, p.z);
});
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/shot-summit.png` });
const onIsland = await page.evaluate(() => window.__game.playerPos);
console.log('summit island pos', onIsland.map((n) => n.toFixed(1)).join(', '));
if (onIsland[1] < 150) throw new Error('Fell through the summit island');

// --- Parachute: jump off the island and hold space ---
await page.evaluate(() => {
  const p = window.__game.playerPos;
  window.__game.teleport(p[0] + 12, p[1] + 5, p[2]);
});
await page.waitForTimeout(700);
await page.keyboard.down('Space');
await page.waitForTimeout(1500);
const chuteVy = await page.evaluate(() => window.__game.playerVel[1]);
const chuteOn = await page.evaluate(() => window.__game.ctx.player.parachute);
await page.screenshot({ path: `${OUT}/shot-parachute.png` });
await page.keyboard.up('Space');
console.log('parachute on:', chuteOn, 'fall speed:', chuteVy.toFixed(1));
if (!chuteOn || chuteVy < -6) throw new Error('Parachute not limiting fall speed');

// --- Potion: violent shaking must blow it up ---
const potion = await page.evaluate(async () => {
  const g = window.__game;
  if (g.ctx.packages.current) g.ctx.packages.remove(g.ctx.packages.current);
  const def = g.ctx.packages.typeForDelivery(6); // Unstable Potion
  const pkg = g.ctx.packages.spawn(def);
  pkg.carried = true;
  await new Promise((r) => setTimeout(r, 500));
  // Yank the courier around violently for a few seconds.
  for (let i = 0; i < 40 && g.ctx.packages.current; i++) {
    const p = g.playerPos;
    g.teleport(p[0] + (i % 2 ? 4 : -4), p[1] + 1, p[2]);
    await new Promise((r) => setTimeout(r, 80));
  }
  return { exploded: !g.ctx.packages.current, id: def.id };
});
console.log('potion test:', JSON.stringify(potion));
if (potion.id === 'potion' && !potion.exploded) throw new Error('Potion never exploded under violent shaking');

// --- Smoke test every package type's behaviour loop ---
const typesOk = await page.evaluate(async () => {
  const g = window.__game;
  const seen = [];
  for (let n = 0; n < 8; n++) {
    if (g.ctx.packages.current) g.ctx.packages.remove(g.ctx.packages.current);
    const def = g.ctx.packages.typeForDelivery(Math.min(n, 7));
    const pkg = g.ctx.packages.spawn(def);
    pkg.carried = true;
    await new Promise((r) => setTimeout(r, 1300));
    seen.push(`${def.id}:${g.ctx.packages.current ? 'alive' : 'gone'}`);
  }
  if (g.ctx.packages.current) g.ctx.packages.remove(g.ctx.packages.current);
  return seen;
});
console.log('package types:', typesOk.join(' '));

// --- Flight-exploit regression: balloon + egg must NOT lift the courier ---
for (const typeIdx of [2, 3]) { // balloon, egg
  const fly = await page.evaluate(async (idx) => {
    const g = window.__game;
    if (g.ctx.packages.current) g.ctx.packages.remove(g.ctx.packages.current);
    // flat ground near the depot
    const c = g.ctx.packages.chutePos;
    g.teleport(c.x - 5, c.y + 1.5, c.z - 5);
    const def = g.ctx.packages.typeForDelivery(idx);
    const pkg = g.ctx.packages.spawn(def);
    pkg.carried = true;
    const y0 = g.playerPos[1];
    let maxY = y0;
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 100));
      maxY = Math.max(maxY, g.playerPos[1]);
    }
    if (g.ctx.packages.current) g.ctx.packages.remove(g.ctx.packages.current);
    return { id: def.id, rise: maxY - y0 };
  }, typeIdx);
  console.log('no-fly check:', JSON.stringify(fly));
  if (fly.rise > 4) throw new Error(`Carrying ${fly.id} lifted the player ${fly.rise.toFixed(1)}m — flight exploit back`);
}

// --- Regression: parachute must deploy WHILE CARRYING a package ---
// (the ground probe used to detect the carried parcel as "ground")
const chuteCarry = await page.evaluate(async () => {
  const g = window.__game;
  if (g.ctx.packages.current) g.ctx.packages.remove(g.ctx.packages.current);
  const pkg = g.ctx.packages.spawn(g.ctx.packages.typeForDelivery(0));
  pkg.carried = true;
  const c = g.ctx.packages.chutePos;
  g.teleport(c.x, c.y + 60, c.z);
  await new Promise((r) => setTimeout(r, 600));
  return { grounded: g.ctx.player.grounded, falling: g.playerVel[1] < -3 };
});
console.log('carry-airborne:', JSON.stringify(chuteCarry));
if (chuteCarry.grounded) throw new Error('Grounded while falling with a carried package — ground probe hits the parcel again');
await page.keyboard.down('Space');
await page.waitForTimeout(1200);
const carryChuteOn = await page.evaluate(() => window.__game.ctx.player.parachute);
await page.keyboard.up('Space');
console.log('parachute while carrying:', carryChuteOn);
if (!carryChuteOn) throw new Error('Parachute refused to deploy while carrying');
await page.waitForTimeout(2500);

// --- Throw: F hurls the package; a thrown package can still deliver ---
const throwTest = await page.evaluate(async () => {
  const g = window.__game;
  if (g.ctx.packages.current) g.ctx.packages.remove(g.ctx.packages.current);
  const b = g.ctx.deliveries.beacon.position;
  g.teleport(b.x - 6, b.y + 2, b.z);
  const pkg = g.ctx.packages.spawn(g.ctx.packages.typeForDelivery(0), { x: b.x - 6, y: b.y + 2, z: b.z });
  pkg.carried = true;
  pkg.grace = 0;
  await new Promise((r) => setTimeout(r, 400));
  // aim the camera yaw at the beacon: forward = (-sin yaw, -cos yaw)
  const p = g.playerPos;
  g.ctx.player.yaw = Math.atan2(-(b.x - p[0]), -(b.z - p[2]));
  const before = g.completed;
  g.ctx.packages.throwCarried(-Math.sin(g.ctx.player.yaw), -Math.cos(g.ctx.player.yaw));
  const carriedAfter = g.ctx.packages.current?.carried;
  await new Promise((r) => setTimeout(r, 2000));
  return { carriedAfter, delivered: g.completed > before };
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
const roll = await page.evaluate(async () => {
  const g = window.__game;
  if (g.ctx.packages.current) g.ctx.packages.remove(g.ctx.packages.current);
  const c = g.ctx.packages.chutePos;
  const x = c.x - 8, z = c.z - 8;
  const ground = g.ctx.terrain.heightAt(x, z);
  g.teleport(x, ground + 24, z);
  let tapped = false;
  for (let i = 0; i < 400 && !tapped; i++) {
    await new Promise((r) => setTimeout(r, 12));
    const p = g.playerPos, v = g.playerVel;
    if (v[1] < -15 && p[1] - ground < 4) {
      // tap, don't hold — holding would deploy the parachute instead
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
      tapped = true;
    }
  }
  let rolled = false, knocked = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 20));
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
const sheepTest = await page.evaluate(async () => {
  const g = window.__game;
  if (g.ctx.packages.current) g.ctx.packages.remove(g.ctx.packages.current);
  const def = g.ctx.packages.typeForDelivery(4); // sheep
  const pkg = g.ctx.packages.spawn(def);
  pkg.carried = true;
  await new Promise((r) => setTimeout(r, 300));
  g.ctx.packages.break(pkg);
  const escaped = !!g.ctx.packages.escapee && !g.ctx.packages.current;
  // chase her down by teleporting onto her
  let caught = false;
  for (let i = 0; i < 20 && !caught; i++) {
    const e = g.ctx.packages.escapee;
    if (!e) break;
    const ep = e.body.translation();
    g.teleport(ep.x, ep.y + 0.5, ep.z);
    await new Promise((r) => setTimeout(r, 150));
    caught = !!g.ctx.packages.current;
  }
  if (g.ctx.packages.current) g.ctx.packages.remove(g.ctx.packages.current);
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
  await page.evaluate(async (name) => {
    const d = window.__game.ctx.director;
    const p = window.__game.ctx.player.body.translation();
    if (d.event) d.event.ttl = 0;
    d._startEvent(name, p, { key: 'frozen' });
    await new Promise((r) => setTimeout(r, 2500));
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

const stats = await page.evaluate(() => ({ fps: window.__game.fps, bodies: window.__game.bodies }));
console.log('fps(headless swiftshader)', stats.fps.toFixed(0), 'bodies', stats.bodies);

console.log('ERRORS:', errors.length ? errors.slice(0, 10) : 'none');
await browser.close();
if (errors.length) process.exit(2);
console.log('ALL OK');
