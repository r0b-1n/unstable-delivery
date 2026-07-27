// Look development: park a free camera at fixed vantage points and screenshot.
//
// verify.mjs proves the map WORKS — the collider agrees with the mesh, the
// trail lies on the ground, no chunk is missing. It cannot tell whether the
// mountain is worth looking at, and that is the only question this rebuild was
// actually about. So: four compass views of the massif from outside, and seven
// stops along the route. Someone has to look at them.
//
// The third-person rig is neutralised rather than paused, because the pause
// screen dims the scene and puts a menu over the middle of every frame.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = './verify-out/look';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1440, height: 810 } });
p.on('pageerror', e => console.log('PAGEERROR:', e.message));
p.on('console', m => { if (m.type()==='error') console.log('ERR', m.text().slice(0,180)); });
await p.goto('http://localhost:4173/');
await p.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 60000 });
await p.evaluate(() => window.__game.start());
await p.waitForTimeout(1200);
// Free camera: neutralise the third-person rig, hide the HUD, keep rendering.
await p.evaluate(() => {
  const g = window.__game;
  g.ctx.hud.setPhotoMode(true);
  g.ctx.player.update = () => {};
});

const shot = async (name, cam, look, fov = 62, alt = null) => {
  await p.evaluate(([c, l, f, a]) => {
    const g = window.__game, cm = g.ctx.camera;
    cm.fov = f; cm.updateProjectionMatrix();
    cm.position.set(c[0], c[1], c[2]);
    cm.lookAt(l[0], l[1], l[2]);
    g.ctx.mood.update(cm.position, Math.min(Math.max((a ?? c[1]) / 500, 0), 1), 0, 12, 0.3);
  }, [cam, look, fov, alt]);
  await p.waitForTimeout(450);
  await p.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
};

const R = 1250, H = 420;
for (const [n, a] of [['n', -Math.PI/2], ['e', 0], ['s', Math.PI/2], ['w', Math.PI]]) {
  await shot(`massif-${n}`, [Math.cos(a)*R, H, Math.sin(a)*R], [0, 200, 0], 50, 60);
}
const spots = await p.evaluate(() => [0.05, 0.2, 0.35, 0.5, 0.66, 0.8, 0.95].map(t => {
  const T = window.__game.ctx.terrain;
  const a = T.pathPoint(t), c = T.pathPoint(t + 0.03);
  return { t, a: [a.x, T.heightAt(a.x, a.z) + 6, a.z], b: [c.x, T.heightAt(c.x, c.z) + 2, c.z], h: a.h };
}));
for (const s of spots) await shot(`route-${s.t}`, s.a, s.b, 62, s.h);
await b.close();
