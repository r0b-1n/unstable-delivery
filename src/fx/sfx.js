// Fully procedural WebAudio sound engine — no audio assets.
// Every sound is synthesized: thuds, boings, wind, jingles, an angry sheep.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.windGain = null;
    this.windFilter = null;
    this.enabled = false;
    this._lastStep = 0;
    this._lastThud = 0;
    this._lastCrack = 0;
  }

  // Must be called from a user gesture.
  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    this._buildWind();
    this._buildRush();
    this.enabled = true;
  }

  // Airspeed rush: a second persistent noise loop that swells with velocity.
  _buildRush() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(3);
    src.loop = true;
    this.rushFilter = this.ctx.createBiquadFilter();
    this.rushFilter.type = 'highpass';
    this.rushFilter.frequency.value = 900;
    this.rushGain = this.ctx.createGain();
    this.rushGain.gain.value = 0.0;
    src.connect(this.rushFilter).connect(this.rushGain).connect(this.master);
    src.start();
  }

  setRush(v01) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    this.rushGain.gain.setTargetAtTime(Math.min(v01, 1) * 0.09, t, 0.15);
    this.rushFilter.frequency.setTargetAtTime(900 + v01 * 1600, t, 0.2);
  }

  _noiseBuffer(seconds = 2) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _buildWind() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(4);
    src.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 300;
    this.windFilter.Q.value = 0.6;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();
  }

  // altitude 0..1, gust 0..1 — the higher you climb, the angrier the air.
  // Kept LOW and mellow: ambience, not a broken modem.
  setWind(altitude, gust) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const g = 0.008 + altitude * 0.05 + gust * 0.09;
    this.windGain.gain.setTargetAtTime(Math.min(g, 0.16), t, 0.6);
    this.windFilter.frequency.setTargetAtTime(160 + altitude * 260 + gust * 220, t, 0.8);
  }

  _env(gainNode, t0, peak, attack, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  tone({ freq = 440, type = 'sine', peak = 0.2, attack = 0.005, decay = 0.2, slideTo = null, delay = 0 }) {
    if (!this.enabled) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + attack + decay);
    const g = this.ctx.createGain();
    this._env(g, t0, peak, attack, decay);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + attack + decay + 0.05);
  }

  noise({ freq = 800, q = 1, peak = 0.3, attack = 0.003, decay = 0.15, type = 'lowpass', delay = 0 }) {
    if (!this.enabled) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(attack + decay + 0.1);
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    this._env(g, t0, peak, attack, decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
  }

  // ---- Game sounds ----

  footstep(surface = 'grass') {
    const now = performance.now();
    if (now - this._lastStep < 240) return;
    this._lastStep = now;
    const vary = 0.8 + Math.random() * 0.4;
    if (surface === 'snow') this.noise({ freq: 750 * vary, peak: 0.028, decay: 0.08 });
    else if (surface === 'rock') this.noise({ freq: 1300 * vary, peak: 0.022, decay: 0.05, type: 'highpass' });
    else this.noise({ freq: 420 * vary, peak: 0.028, decay: 0.07 });
  }

  thud(intensity = 1) {
    const now = performance.now();
    if (now - this._lastThud < 60) return;
    this._lastThud = now;
    const k = Math.min(intensity, 2);
    this.tone({ freq: 90 + 30 * Math.random(), type: 'sine', peak: 0.28 * k, decay: 0.16 + 0.1 * k, slideTo: 45 });
    this.noise({ freq: 350, peak: 0.14 * k, decay: 0.1 });
  }

  jump() {
    this.noise({ freq: 700, peak: 0.05, decay: 0.06 });
  }

  // pitch > 1 for boing-combo chains: each bounce squeaks a step higher.
  boing(pitch = 1) {
    this.tone({ freq: 160 * pitch, type: 'square', peak: 0.16, decay: 0.32, slideTo: 620 * pitch });
    this.tone({ freq: 80 * pitch, type: 'sine', peak: 0.2, decay: 0.2, slideTo: 300 * pitch });
  }

  whoosh() {
    this.noise({ freq: 900, q: 1.6, peak: 0.2, attack: 0.03, decay: 0.28, type: 'bandpass' });
  }

  throwWhoosh() {
    this.noise({ freq: 1500, q: 2, peak: 0.14, attack: 0.02, decay: 0.22, type: 'bandpass' });
    this.tone({ freq: 240, type: 'triangle', peak: 0.06, decay: 0.12, slideTo: 420 });
  }

  // Two low thumps — the potion's pulse. intensity 0..1 speeds nothing here,
  // callers control the interval; it just gets louder and tighter.
  heartbeat(intensity = 0.5) {
    const peak = 0.1 + intensity * 0.14;
    this.tone({ freq: 62, type: 'sine', peak, attack: 0.01, decay: 0.12, slideTo: 40 });
    this.tone({ freq: 58, type: 'sine', peak: peak * 0.8, attack: 0.01, decay: 0.1, slideTo: 38, delay: 0.17 });
  }

  whooshParachute() {
    this.noise({ freq: 1200, q: 2, peak: 0.16, attack: 0.05, decay: 0.4, type: 'bandpass' });
  }

  crack(severity = 1) {
    const now = performance.now();
    if (now - this._lastCrack < 80) return;
    this._lastCrack = now;
    this.noise({ freq: 2800, peak: 0.22 * severity, decay: 0.08, type: 'highpass' });
    this.tone({ freq: 1200, type: 'triangle', peak: 0.1 * severity, decay: 0.06, slideTo: 500 });
  }

  shatter() {
    for (let i = 0; i < 6; i++) {
      this.tone({ freq: 1400 + Math.random() * 2200, type: 'triangle', peak: 0.09, decay: 0.25, delay: i * 0.03 });
    }
    this.noise({ freq: 3000, peak: 0.25, decay: 0.3, type: 'highpass' });
  }

  explosion() {
    this.tone({ freq: 70, type: 'sine', peak: 0.55, decay: 0.7, slideTo: 30 });
    this.noise({ freq: 500, peak: 0.5, decay: 0.6 });
    this.noise({ freq: 2500, peak: 0.25, decay: 0.25, type: 'highpass' });
  }

  pop() {
    this.tone({ freq: 500, type: 'square', peak: 0.12, decay: 0.05, slideTo: 900 });
    this.noise({ freq: 2000, peak: 0.1, decay: 0.04, type: 'highpass' });
  }

  baa() {
    if (!this.enabled) return;
    // A sawtooth with fast vibrato is uncannily sheep-like.
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    const base = 180 + Math.random() * 60;
    osc.frequency.value = base;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 9;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = base * 0.14;
    lfo.connect(lfoGain).connect(osc.frequency);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 1.2;
    const g = this.ctx.createGain();
    this._env(g, t0, 0.13, 0.06, 0.5);
    osc.connect(f).connect(g).connect(this.master);
    osc.start(t0); lfo.start(t0);
    osc.stop(t0 + 0.7); lfo.stop(t0 + 0.7);
  }

  sizzle() {
    this.noise({ freq: 4000, q: 1.5, peak: 0.07, attack: 0.02, decay: 0.3, type: 'highpass' });
  }

  geyser() {
    this.noise({ freq: 800, q: 0.8, peak: 0.3, attack: 0.05, decay: 0.9, type: 'bandpass' });
    this.tone({ freq: 120, type: 'sine', peak: 0.15, decay: 0.5, slideTo: 250 });
  }

  pickup() {
    this.tone({ freq: 523, type: 'triangle', peak: 0.16, decay: 0.12 });
    this.tone({ freq: 784, type: 'triangle', peak: 0.16, decay: 0.18, delay: 0.09 });
  }

  jingle() {
    const notes = [523, 659, 784, 1047, 784, 1047];
    notes.forEach((f, i) => this.tone({ freq: f, type: 'triangle', peak: 0.17, decay: 0.3, delay: i * 0.11 }));
    this.noise({ freq: 5000, peak: 0.06, decay: 0.5, type: 'highpass', delay: 0.1 });
  }

  fail() {
    this.tone({ freq: 300, type: 'sawtooth', peak: 0.15, decay: 0.4, slideTo: 120 });
    this.tone({ freq: 150, type: 'sawtooth', peak: 0.15, decay: 0.5, slideTo: 70, delay: 0.15 });
  }

  cableHum(on) {
    if (!this.enabled) return;
    if (on && !this._hum) {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 55;
      const g = this.ctx.createGain();
      g.gain.value = 0.0;
      g.gain.setTargetAtTime(0.028, this.ctx.currentTime, 0.3);
      osc.connect(g).connect(this.master);
      osc.start();
      this._hum = { osc, g };
    } else if (!on && this._hum) {
      const { osc, g } = this._hum;
      g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.2);
      osc.stop(this.ctx.currentTime + 0.8);
      this._hum = null;
    }
  }

  thunder() {
    this.tone({ freq: 55, type: 'sine', peak: 0.4, attack: 0.02, decay: 1.4, slideTo: 28 });
    this.noise({ freq: 240, peak: 0.3, attack: 0.04, decay: 1.2 });
  }

  wobble() {
    this.tone({ freq: 220, type: 'sine', peak: 0.06, decay: 0.15, slideTo: 190 });
  }
}
