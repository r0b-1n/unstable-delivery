// World dimensions, in their own leaf module.
//
// scatter.js, landmarks.js and backdrop.js all need PEAK and WORLD_R, and
// terrain.js constructs all three — so importing them back out of terrain.js
// would be a cycle. ESM would tolerate it (the reads happen inside constructors,
// long after evaluation) but it is exactly the trap documented at the top of
// art/palette.js, and one that fails as a TDZ ReferenceError at boot rather
// than as anything a build step would catch. A leaf module costs nine lines.
//
// terrain.js re-exports PEAK, WORLD_R and KILL_Y so every existing
// `import { PEAK } from '../world/terrain.js'` keeps working unchanged.

export const PEAK = 500;          // summit height in meters
export const WORLD_R = 800;       // half-extent of the terrain
export const KILL_Y = -14;

export const CELL = 2.0;                          // grid resolution, meters
export const SIZE = WORLD_R * 2;                  // 1600 m across
export const SEGMENTS = Math.round(SIZE / CELL);  // 800 cells
export const W = SEGMENTS + 1;                    // 801 grid points per side

// Two pieces of geography that both the height field and the set pieces need
// to agree on. The terrain carves them; landmarks.js furnishes them. They live
// here because a lake whose water plane and whose basin disagree by two meters
// is either a puddle on a hill or an invisible pond, and nothing in between.
//
// The coordinates are the route at t = 0.10 and t = 0.66, pushed off to the
// outside of the spiral. Move the route and these have to move with it.
export const LAKE = { x: -284, z: 469, r: 88 };
export const CIRQUE = { x: -195, z: -40, r: 150, depth: 52 };
