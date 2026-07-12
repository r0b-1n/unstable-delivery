# 📦 Unstable Delivery

*A low-poly, fully physics-driven delivery disaster on a fantasy mountain.*

![Cover](public/assets/cover.png)

You are a mountain courier with terrible luck and worse cargo. Grab a package
at the base-camp depot, haul it up an increasingly hostile mountain — on foot,
by bounce mushroom, geyser, elevator platform, or cable car — drop it at the
glowing beacon, then get back down and collect the next, even worse one.

Everything is simulated: packages hang off your hands on a real spring, wind
shoves you, boulders roll, gondolas actually carry you, and the sheep never
agreed to any of this.

## Run it

```bash
npm install
npm run dev        # open the printed URL
```

Production build: `npm run build` (output in `dist/`, servable from any static host).

## Controls

| Input | Action |
|---|---|
| **WASD** | Move (camera-relative) |
| **Shift** | Sprint |
| **Space** | Jump — **hold in mid-air** to deploy the parcel-parachute |
| **Mouse** | Camera (click the window to lock the pointer) |
| **Wheel** | Camera zoom |

Walk into the glowing ring at the depot to pick up a package. Walk into a
dropped package to pick it back up. Carry it into the beacon to deliver.

## The cargo escalation ladder

1. **Plain Crate** — suspiciously unremarkable
2. **Grandma's Porcelain** — fragile; every impact is remembered
3. **Balloon Bundle** — near-weightless; the wind has opinions
4. **Dragon Egg** — periodically leaps; hates being carried
5. **Sheep in a Crate** — kicks harder the faster you run
6. **Cursed Anvil** — 45 kg; you will be taking the cable car
7. **Unstable Potion** — watch the instability meter; do not shake
8. **Ghost Package** — occasionally forgets which way is down

Deliveries pay by altitude, condition and speed. Destroyed packages come out
of your pay, and a replacement is waiting at the depot.

## The mountain

Five vertical bands, each meaner than the last: **Sunny Meadows** →
**Pinewood Ledges** (bounce mushrooms, seesaws) → **Windy Cliffs** (geysers,
elevator platforms, gusts) → **The Frozen Face** (ice, icicles, boulders) →
**Storm Summit** (floating islands, lightning). A cable car with five
stations loops from base camp to the summit — hop into a passing gondola,
stations double as respawn checkpoints. The more you deliver, the more the
chaos director turns everything up.

## Tech

- [Three.js](https://threejs.org/) rendering, procedural low-poly world (the
  only art assets are the character model and the cover)
- [Rapier](https://rapier.rs/) physics — terrain trimesh, kinematic gondolas
  and platforms, spring-carried cargo, contact-force damage
- Fully procedural WebAudio SFX (wind, thuds, boings, jingles, one synthesized sheep)
- Vite, plain ES modules, no framework

## Headless E2E check

```bash
npm run build && npx vite preview --port 4173 &
node scripts/verify.mjs        # needs playwright + a chromium (CHROMIUM_PATH)
```

Drives the whole loop headlessly: boot, movement, pickup, delivery, gondola
ride, mushroom launch, parachute, potion detonation, chaos soak — and fails
on any console error.
