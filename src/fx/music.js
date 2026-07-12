// Procedural music: a WebAudio step sequencer, zero assets.
// Warm plucked pentatonic melody over a gentle bass and soft hats — a small
// adventurous loop, not error noises. Intensity (0..1) layers in more parts
// as you climb and as events kick off.
const A = 220;
const SEMI = Math.pow(2, 1 / 12);
const note = (semisFromA3) => A * Math.pow(SEMI, semisFromA3);

// A minor pentatonic: A C D E G
const SCALE = [0, 3, 5, 7, 10];
const deg = (d, oct = 0) => note(SCALE[((d % 5) + 5) % 5] + Math.floor(d / 5) * 12 + oct * 12);

// 32-step patterns (two bars of 16ths at ~112 BPM feels right at 8ths of 224)
const MELODY = [
  0, null, 2, null, 4, null, 2, null, 3, null, null, 2, 0, null, null, null,
  1, null, 3, null, 5, null, 4, null, 2, null, 1, null, 0, null, null, null,
];
const MELODY_B = [
  4, null, null, 4, 5, null, 4, null, 2, null, 0, null, 2, null, null, null,
  3, null, null, 3, 4, null, 3, null, 1, null, 2, null, 0, null, null, null,
];
const BASS = [
  -10, null, null, null, null, null, -10, null, -12, null, null, null, null, null, null, null,
  -14, null, null, null, null, null, -14, null, -12, null, null, null, -10, null, null, null,
];
const HATS = [
  0.5, 0, 0.15, 0, 0.35, 0, 0.15, 0.1, 0.5, 0, 0.15, 0, 0.35, 0, 0.2, 0.15,
  0.5, 0, 0.15, 0, 0.35, 0, 0.15, 0.1, 0.5, 0, 0.15, 0.25, 0.35, 0.15, 0.2, 0.3,
];
const CHORDS = [ // one per half-bar (8 steps): scale degrees stacked
  [0, 2, 4], [0, 2, 4], [-2, 0, 2], [-1, 1, 3],
];

export class Music {
  constructor(sfx) {
    this.sfx = sfx;         // shares the AudioContext + master gain
    this.enabled = true;
    this.playing = false;
    this.intensity = 0.3;
    this._step = 0;
    this._nextTime = 0;
    this._timer = null;
    this._useB = false;
    this.bpm = 112;
  }

  get ctx() { return this.sfx.ctx; }

  start() {
    if (this.playing || !this.ctx) return;
    this.bus = this.ctx.createGain();
    this.bus.gain.value = 0.5;
    this.bus.connect(this.sfx.master);
    this._nextTime = this.ctx.currentTime + 0.1;
    this._step = 0;
    this.playing = true;
    this._timer = setInterval(() => this._schedule(), 90);
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.bus) this.bus.gain.setTargetAtTime(this.enabled ? 0.5 : 0.0001, this.ctx.currentTime, 0.2);
    return this.enabled;
  }

  setIntensity(v) {
    this.intensity = Math.max(0, Math.min(1, v));
  }

  // Look-ahead scheduler: queue every step due in the next 250 ms.
  _schedule() {
    if (!this.playing || !this.enabled) { this._catchUp(); return; }
    const stepDur = 60 / this.bpm / 2; // 8th notes
    while (this._nextTime < this.ctx.currentTime + 0.25) {
      this._playStep(this._step, this._nextTime, stepDur);
      this._step = (this._step + 1) % 32;
      if (this._step === 0) this._useB = Math.random() < 0.45;
      this._nextTime += stepDur;
    }
  }

  _catchUp() {
    // Keep the transport moving while muted so unmuting stays on the grid.
    const stepDur = 60 / this.bpm / 2;
    while (this._nextTime < this.ctx.currentTime) {
      this._step = (this._step + 1) % 32;
      this._nextTime += stepDur;
    }
  }

  _playStep(step, t, stepDur) {
    const I = this.intensity;
    // Melody (always on, sparser when calm)
    const mel = (this._useB ? MELODY_B : MELODY)[step];
    if (mel !== null && (I > 0.15 || step % 4 === 0)) {
      this._pluck(deg(mel, 1), t, 0.09 + I * 0.05, 0.5);
      if (I > 0.75) this._pluck(deg(mel, 2), t, 0.03, 0.3); // sparkle octave
    }
    // Bass
    const b = BASS[step];
    if (b !== null) this._bass(note(b), t, 0.10 + I * 0.05);
    // Hats
    if (I > 0.25 && HATS[step] > 0) this._hat(t, HATS[step] * (0.03 + I * 0.05));
    // Pad chord at half-bar boundaries
    if (I > 0.45 && step % 8 === 0) {
      const chord = CHORDS[(step / 8) | 0];
      for (const d of chord) this._pad(deg(d, 0), t, 0.016 + I * 0.014, stepDur * 8);
    }
    // Heartbeat kick when things are dire
    if (I > 0.7 && step % 8 === 0) this._kick(t, 0.16);
  }

  _pluck(freq, t, peak, decay) {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 6, t);
    f.frequency.exponentialRampToValueAtTime(freq * 1.5, t + decay);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(f).connect(g).connect(this.bus);
    o.start(t); o.stop(t + decay + 0.05);
  }

  _bass(freq, t, peak) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const o2 = this.ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = freq * 2.005;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    const g2 = this.ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.bus);
    o.start(t); o.stop(t + 0.5);
    o2.start(t); o2.stop(t + 0.5);
  }

  _hat(t, peak) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.sfx._noiseBuffer(0.06);
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    src.connect(f).connect(g).connect(this.bus);
    src.start(t);
  }

  _pad(freq, t, peak, dur) {
    for (const detune of [-4, 4]) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      o.detune.value = detune;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + dur * 0.4);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.bus);
      o.start(t); o.stop(t + dur + 0.05);
    }
  }

  _kick(t, peak) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g).connect(this.bus);
    o.start(t); o.stop(t + 0.2);
  }

  // Triumphant little fanfare on delivery (major arpeggio over the loop).
  fanfare() {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.ctx.currentTime + 0.02;
    const notes = [note(0), note(4), note(7), note(12), note(7), note(12)];
    notes.forEach((f, i) => this._pluck(f * 2, t0 + i * 0.09, 0.14, 0.5));
    this._kick(t0, 0.2);
  }
}
