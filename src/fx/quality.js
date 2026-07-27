import * as THREE from 'three';

// The ONE auto-quality controller. Two regulators on the same actuator
// (setPixelRatio) oscillate against each other by construction, so nothing
// else in the codebase is allowed to touch pixel ratio, bloom or shadow size.
//
// It judges on p95 frametime over a 120-frame window, not on an FPS average:
// an average hides exactly the hitching that makes a game feel bad, and one
// 200 ms stall from a GC pause must not trigger a downgrade on its own.

export const TIERS = [
  { key: 'low', maxDpr: 1.0, bloom: false, shadowMap: 1024, samples: 0, shadows: true },
  { key: 'medium', maxDpr: 1.5, bloom: true, shadowMap: 1024, samples: 2, shadows: true },
  { key: 'high', maxDpr: 2.0, bloom: true, shadowMap: 2048, samples: 4, shadows: true },
];

const WINDOW = 120;
const BUDGET_MS = 20.8;      // 48 fps — below this and the frame pacing is visibly rough
const GOOD_MS = 13.5;        // 74 fps — enough headroom to consider going back up
const DOWN_STREAK = 3;       // consecutive bad windows before stepping down
const UP_STREAK = 5;         // consecutive good windows before stepping up
const UP_LOCKOUT = 60;       // seconds after any downgrade before an upgrade may fire
const MAX_DOWNGRADES = 2;    // ratchet: after this the controller stops chasing

export class Quality {
  constructor(ctx, { tier = 2, mode = 'auto' } = {}) {
    this.ctx = ctx;
    this.mode = mode;
    this.tier = tier;
    this._frames = new Float32Array(WINDOW);
    this._n = 0;
    this._bad = 0;
    this._good = 0;
    this._downgrades = 0;
    this._lockout = 0;
    this.apply(tier);
  }

  get current() { return TIERS[this.tier]; }

  apply(tier) {
    this.tier = THREE.MathUtils.clamp(tier, 0, TIERS.length - 1);
    const t = this.current;
    const { renderer, mood, post } = this.ctx;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, t.maxDpr));
    renderer.shadowMap.enabled = t.shadows;
    if (mood?.sun.shadow.mapSize.width !== t.shadowMap) {
      mood?.sun.shadow.mapSize.set(t.shadowMap, t.shadowMap);
      // The map is baked into the compiled shadow material; drop it so the
      // next frame allocates at the new size instead of silently keeping the old.
      if (mood?.sun.shadow.map) { mood.sun.shadow.map.dispose(); mood.sun.shadow.map = null; }
    }
    post?.setBloom(t.bloom);
    post?.setSamples(t.samples);
    post?.setSize(window.innerWidth, window.innerHeight);
  }

  setTier(tier) {
    this.mode = 'manual';
    this.apply(tier);
  }

  // Called once per rendered frame with the real (unscaled) frame time.
  sample(dt) {
    this._lockout = Math.max(0, this._lockout - dt);
    if (this.mode !== 'auto') return;

    this._frames[this._n++ % WINDOW] = dt * 1000;
    if (this._n % WINDOW !== 0) return;

    const sorted = Array.from(this._frames).sort((a, b) => a - b);
    const p95 = sorted[Math.floor(WINDOW * 0.95)];

    if (p95 > BUDGET_MS) { this._bad++; this._good = 0; } else if (p95 < GOOD_MS) { this._good++; this._bad = 0; } else { this._bad = 0; this._good = 0; }

    if (this._bad >= DOWN_STREAK && this.tier > 0 && this._downgrades < MAX_DOWNGRADES) {
      this._bad = 0;
      this._downgrades++;
      this._lockout = UP_LOCKOUT;
      this.apply(this.tier - 1);
      this.ctx.onQualityChange?.(this.current, 'down');
    } else if (this._good >= UP_STREAK && this.tier < TIERS.length - 1 && this._lockout <= 0 && this._downgrades === 0) {
      this._good = 0;
      this.apply(this.tier + 1);
      this.ctx.onQualityChange?.(this.current, 'up');
    }
  }
}
