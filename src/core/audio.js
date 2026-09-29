// Procedural audio engine: every SFX is synthesized with WebAudio.
// Layers: transient (click/crack), body (tone/boom), tail (noise/reverb).
import { G } from './context.js';
import { clamp, randRange, rand } from './util.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Voice budget: approximate count of live source nodes. Low-priority sounds
// are dropped first when a fight gets busy; priority 2 always plays.
const VOICE_MAX = 220;
const PRIO = {
  step: 0, fizzle: 0, enemy_hurt: 0, ice_spike: 0, splash: 1, steam: 1, gale: 1, chain: 1, hit: 1, hit_flesh: 1, hit_armor: 1, crit: 1,
  cast_arcane: 1, cast_fire: 1, cast_frost: 1, cast_storm: 1, cast_wind: 1, cast_water: 1,
  impact_arcane: 1, impact_fire: 1, impact_frost: 1, impact_storm: 1, impact_wind: 1, impact_water: 1, zap: 0, sizzle: 0, whoosh: 0, orb_hit: 1,
};
// Random pitch spread in semitones so repeated casts/impacts never sound identical.
const VARY_PREFIX = [['cast_', 0.7], ['impact_', 0.9], ['heavy_', 0.5], ['hit', 1.1], ['enemy_', 0.8], ['react_', 0.4]];
const VARY = {
  explosion: 0.9, thunder: 1.2, ice_spike: 1.4, gale: 0.8, steam: 0.7, shatter: 0.6, chain: 0.8, overload: 0.6, melt: 0.6, freeze: 0.5, fizzle: 1.2, splash: 1.2,
  crit: 0.5, kill: 0.3, zap: 2, sizzle: 1.5, whoosh: 1.2, orb_hit: 1, brute_slam: 0.6, sword: 1, blink: 0.4, charge: 0.4, weave: 0.2, ult_boom: 0.3,
};
function varyFor(name) {
  if (name in VARY) return VARY[name];
  for (const [p, v] of VARY_PREFIX) if (name.startsWith(p)) return v;
  return 0;
}

export class AudioEngine {
  constructor() {
    this.ready = false;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.last = {};
    this.amb = { birdT: 2, cricketT: 1, waterT: 1 };
    this.voices = 0;
    this.active = [];
    this._pr = 1; this._nodes = 0; this._end = 0;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.22;
    this.master = ctx.createGain();
    // master tone filter: muffles everything during slow motion ("울림 가속")
    this.tint = ctx.createBiquadFilter(); this.tint.type = 'lowpass'; this.tint.frequency.value = 20000; this.tint.Q.value = 0.6;
    this.master.connect(this.tint); this.tint.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.connect(this.master);
    this.ambBus = ctx.createGain(); this.ambBus.connect(this.master);
    // Reverb
    this.conv = ctx.createConvolver();
    this.conv.buffer = this._impulse(2.8, 3.0);
    this.revIn = ctx.createGain(); this.revIn.gain.value = 1;
    this.revOut = ctx.createGain(); this.revOut.gain.value = 0.55;
    this.revIn.connect(this.conv); this.conv.connect(this.revOut); this.revOut.connect(this.master);
    // Noise buffers
    this.buf = { white: this._noise('white'), pink: this._noise('pink'), brown: this._noise('brown') };
    this.distCurve = this._distCurve(40);
    this.applyVolumes();
    this._startAmbience();
    this.ready = true;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = G.settings;
    this.master.gain.value = (s.master / 100) * 0.9;
    this.music.gain.value = (s.music / 100) * 0.55;
    this.sfx.gain.value = s.sfx / 100;
    this.ambBus.gain.value = (s.sfx / 100) * 0.9;
  }

  // k: 0 = normal, 1 = fully muffled
  setMuffle(k) {
    if (!this.ctx || Math.abs((this._muffle ?? 0) - k) < 0.01) return;
    this._muffle = k;
    this.tint.frequency.setTargetAtTime(20000 * Math.pow(900 / 20000, k), this.ctx.currentTime, 0.05);
  }

  _impulse(sec, decay) {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * sec);
    const b = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < sr * 0.01 ? i / (sr * 0.01) : 1);
      }
    }
    return b;
  }
  _noise(kind) {
    const sr = this.ctx.sampleRate, len = sr * 2;
    const b = this.ctx.createBuffer(1, len, sr);
    const d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    }
    return b;
  }
  _distCurve(k) {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; c[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x)); }
    return c;
  }

  setListener(pos, yaw) {
    this.listener.x = pos.x; this.listener.y = pos.y; this.listener.z = pos.z; this.listener.yaw = yaw;
  }

  // ---------- building blocks ----------
  now() { return this.ctx.currentTime; }
  bus(pos, vol = 1, rev = 0.2, dest) {
    const c = this.ctx;
    let gain = vol, pan = 0;
    if (pos) {
      const L = this.listener;
      const dx = pos.x - L.x, dy = (pos.y || 0) - L.y, dz = pos.z - L.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 110) return null;
      gain *= 1 / (1 + Math.max(0, d - 4) * 0.075);
      const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
      pan = clamp((dx * rx + dz * rz) / Math.max(d, 1), -1, 1) * 0.75;
      rev = rev + Math.min(0.35, d * 0.006);
    }
    if (gain < 0.004) return null;
    const g = c.createGain(); g.gain.value = gain;
    const p = c.createStereoPanner(); p.pan.value = pan;
    g.connect(p); p.connect(dest || this.sfx);
    if (rev > 0) { const s = c.createGain(); s.gain.value = rev; g.connect(s); s.connect(this.revIn); }
    return g;
  }
  filter(type, f, q, out) {
    const fl = this.ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; fl.connect(out); return fl;
  }
  dist(out) { const w = this.ctx.createWaveShaper(); w.curve = this.distCurve; w.oversample = '2x'; w.connect(out); return w; }
  env(g, t0, a, v, d) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(v, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }
  tone({ type = 'sine', f = 440, f2 = 0, t = 0, a = 0.004, d = 0.3, v = 0.3, out, detune = 0, lin = false }) {
    if (!out) return;
    const c = this.ctx, t0 = c.currentTime + t;
    const pr = this._pr;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f * pr, t0);
    if (f2) {
      if (lin) o.frequency.linearRampToValueAtTime(f2 * pr, t0 + a + d);
      else o.frequency.exponentialRampToValueAtTime(Math.max(1, f2 * pr), t0 + a + d);
    }
    this._nodes++; if (t0 + a + d > this._end) this._end = t0 + a + d;
    if (detune) o.detune.value = detune;
    const g = c.createGain(); this.env(g, t0, a, v, d);
    o.connect(g); g.connect(out);
    o.start(t0); o.stop(t0 + a + d + 0.05);
    return o;
  }
  noise({ t = 0, a = 0.004, d = 0.3, v = 0.3, out, type = 'bandpass', f = 1000, f2 = 0, q = 1, buf = 'white', rate = 1 }) {
    if (!out) return;
    const c = this.ctx, t0 = c.currentTime + t;
    const pr = this._pr;
    const src = c.createBufferSource(); src.buffer = this.buf[buf]; src.loop = true; src.playbackRate.value = rate * (0.5 + 0.5 * pr);
    const fl = c.createBiquadFilter(); fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(Math.min(20000, f * pr), t0);
    if (f2) fl.frequency.exponentialRampToValueAtTime(Math.min(20000, Math.max(20, f2 * pr)), t0 + a + d);
    this._nodes++; if (t0 + a + d > this._end) this._end = t0 + a + d;
    const g = c.createGain(); this.env(g, t0, a, v, d);
    src.connect(fl); fl.connect(g); g.connect(out);
    src.start(t0, Math.random() * 1.5); src.stop(t0 + a + d + 0.05);
    return src;
  }
  crackle(out, n, span, v = 0.1, f = 2500) {
    for (let i = 0; i < n; i++) this.noise({ out, t: Math.random() * span, d: 0.008 + Math.random() * 0.02, v: v * randRange(0.4, 1), type: 'highpass', f: f * randRange(0.7, 1.6), q: 0.7 });
  }
  shards(out, n, span, v = 0.15) {
    for (let i = 0; i < n; i++) this.noise({ out, t: Math.random() * span, d: randRange(0.025, 0.09), v: v * randRange(0.5, 1), type: 'bandpass', f: randRange(2500, 8500), q: 9 });
  }
  note(out, m, t, v = 0.06, d = 1.2, kind = 'celesta') {
    const f = mtof(m);
    if (kind === 'celesta') {
      this.tone({ out, f, t, a: 0.003, d, v });
      this.tone({ out, f: f * 4, t, a: 0.002, d: d * 0.35, v: v * 0.25 });
      this.tone({ out, f: f * 2, t, a: 0.002, d: d * 0.6, v: v * 0.2, type: 'triangle' });
    } else {
      this.tone({ out, f, t, a: 0.01, d, v, type: 'triangle' });
    }
  }
  // --- layered building blocks: transient / body / tail ---
  click(out, v = 0.25, f = 4000, t = 0) { this.noise({ out, type: 'highpass', f, t, a: 0.0006, d: 0.014, v }); }
  // sub-bass drop that gives impacts weight
  boom(out, { f = 95, f2 = 32, t = 0, d = 0.5, v = 0.5 } = {}) {
    this.tone({ out, f, f2, t, a: 0.003, d, v });
    this.tone({ out, type: 'triangle', f: f * 2.02, f2: f2 * 2, t, a: 0.002, d: d * 0.35, v: v * 0.28 });
  }
  whoosh(out, { f = 350, f2 = 1600, t = 0, a = 0.04, d = 0.3, v = 0.3, q = 1.2, buf = 'pink' } = {}) { this.noise({ out, f, f2, q, t, a, d, v, buf }); }
  // reverse swell: long attack, abrupt release (anticipation)
  swell(out, { f = 500, f2 = 5000, t = 0, d = 0.35, v = 0.25, q = 0.8, buf = 'pink', type = 'bandpass' } = {}) { this.noise({ out, type, f, f2, q, t, a: d, d: 0.04, v, buf }); }
  // noise tail for air / reverb body
  tail(out, { f = 2400, f2 = 600, t = 0, d = 0.6, v = 0.12, type = 'lowpass', buf = 'pink' } = {}) { this.noise({ out, type, f, f2, t, a: 0.01, d, v, buf }); }
  chord(out, notes, t = 0, v = 0.04, d = 1, stagger = 0.03, kind = 'celesta') { notes.forEach((m, i) => this.note(out, m, t + i * stagger, v, d, kind)); }

  // ---------- public ----------
  play(name, o = {}) {
    if (!this.ready || this.ctx.state !== 'running') return;
    const fn = this.S[name];
    if (!fn) return;
    const minGap = o.gap ?? 0.025;
    const k = name + (o.key || '');
    const now = this.ctx.currentTime;
    if (this.last[k] && now - this.last[k] < minGap) return;
    const pr = o.prio ?? PRIO[name] ?? 2;
    if (pr < 2) {
      const load = this._load(now);
      if (load > VOICE_MAX * (pr === 0 ? 0.5 : 0.85)) return;
    }
    this.last[k] = now;
    const vary = o.vary ?? varyFor(name);
    this._pr = (o.pitch || 1) * (vary ? Math.pow(2, randRange(-vary, vary) / 12) : 1);
    this._nodes = 0; this._end = now;
    try { fn.call(this, o); } catch (e) { console.warn('sfx', name, e); }
    this._pr = 1;
    if (this._nodes) { this.active.push({ end: this._end, n: this._nodes }); this.voices = this._load(now); }
  }
  _load(now) {
    let n = 0;
    for (let i = this.active.length - 1; i >= 0; i--) { const a = this.active[i]; if (a.end < now) this.active.splice(i, 1); else n += a.n; }
    return n;
  }

  // Dialogue voice blip (each character has a voice signature)
  blip(voice) {
    if (!this.ready) return;
    const out = this.bus(null, 1, 0.08); if (!out) return;
    const f = voice.f * randRange(0.9, 1.12);
    const bp = this.filter('bandpass', voice.formant || f * 2.2, 1.2, out);
    this.tone({ out: bp, type: voice.type || 'triangle', f, f2: f * (voice.slide || 0.92), d: voice.d || 0.05, v: (voice.v || 0.09) * 2.2 });
    this.tone({ out, type: 'sine', f: f * 0.5, d: 0.04, v: (voice.v || 0.09) * 0.4 });
  }

  // ---------- ambience ----------
  _startAmbience() {
    const c = this.ctx;
    const mk = (buf, type, f, q) => {
      const s = c.createBufferSource(); s.buffer = this.buf[buf]; s.loop = true;
      const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      s.connect(fl); fl.connect(g); g.connect(this.ambBus); s.start();
      return { s, fl, g };
    };
    this.windBed = mk('brown', 'lowpass', 420, 0.5);
    this.glideWind = mk('pink', 'bandpass', 700, 0.7);
    this.riftDrone = mk('brown', 'lowpass', 160, 3);
    this.waterBed = mk('pink', 'lowpass', 900, 0.5);
  }

  updateAmbience(dt, info) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const gust = 0.5 + 0.5 * Math.sin(t * 0.23) * Math.sin(t * 0.61 + 1.3);
    const alt = clamp((info.altitude - 10) / 40, 0, 1);
    const windV = 0.035 + gust * 0.04 + alt * 0.09 + (info.rift ? 0.03 : 0);
    this.windBed.g.gain.setTargetAtTime(windV, t, 0.5);
    this.windBed.fl.frequency.setTargetAtTime(300 + gust * 300 + alt * 400, t, 0.5);
    this.glideWind.g.gain.setTargetAtTime(info.gliding ? 0.12 + info.speed * 0.012 : info.speed > 12 ? 0.05 : 0, t, 0.15);
    this.glideWind.fl.frequency.setTargetAtTime(500 + info.speed * 60, t, 0.2);
    this.riftDrone.g.gain.setTargetAtTime(info.rift ? 0.22 : 0, t, 1.2);
    this.waterBed.g.gain.setTargetAtTime(info.water ? 0.05 * info.water : 0, t, 0.8);

    if (info.rift) return;
    const day = info.hour > 5.5 && info.hour < 19;
    this.amb.birdT -= dt;
    if (day && this.amb.birdT <= 0) {
      this.amb.birdT = randRange(1.5, 6);
      this._bird();
    }
    this.amb.cricketT -= dt;
    if (!day && this.amb.cricketT <= 0) {
      this.amb.cricketT = randRange(0.5, 1.4);
      const out = this.bus(null, 0.6, 0.3);
      const f = randRange(4200, 4800);
      for (let i = 0; i < 3; i++) this.tone({ out, f, t: i * 0.055, a: 0.004, d: 0.03, v: 0.012 });
    }
  }
  _bird() {
    const L = this.listener;
    const pos = { x: L.x + randRange(-30, 30), y: L.y + 8, z: L.z + randRange(-30, 30) };
    const out = this.bus(pos, 0.5, 0.35); if (!out) return;
    const base = randRange(2600, 4200), n = 2 + Math.floor(rand() * 4);
    const c = this.ctx; let t0 = c.currentTime;
    for (let i = 0; i < n; i++) {
      const o = c.createOscillator(); o.type = 'sine';
      const g = c.createGain();
      const f = base * randRange(0.9, 1.15);
      o.frequency.setValueAtTime(f, t0);
      o.frequency.exponentialRampToValueAtTime(f * randRange(1.2, 1.5), t0 + 0.04);
      o.frequency.exponentialRampToValueAtTime(f * 0.85, t0 + 0.09);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.03, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
      o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 0.12);
      t0 += randRange(0.09, 0.16);
    }
  }
}

// ------------------------------------------------------------------
// SFX library
// ------------------------------------------------------------------
const S = {};
AudioEngine.prototype.S = S;

// ----- casts (transient + body + tail) -----
S.cast_arcane = function (o) {
  const out = this.bus(o.pos, 0.9, 0.22); if (!out) return;
  this.click(out, 0.12, 6000);
  this.tone({ out, f: 1500, f2: 470, d: 0.13, v: 0.13 });
  this.tone({ out: this.filter('lowpass', 2800, 0.7, out), type: 'triangle', f: 760, f2: 240, d: 0.17, v: 0.12 });
  this.tone({ out, f: 2640, t: 0.02, d: 0.12, v: 0.03 });
  this.tone({ out, f: 3960, t: 0.04, d: 0.1, v: 0.015 });
  this.tail(out, { type: 'highpass', f: 5000, f2: 7000, d: 0.16, v: 0.05 });
};
S.cast_fire = function (o) {
  const out = this.bus(o.pos, 1, 0.22); if (!out) return;
  this.click(out, 0.1, 3000);
  this.whoosh(out, { f: 380, f2: 2600, q: 0.9, a: 0.01, d: 0.26, v: 0.48 });
  this.noise({ out, type: 'lowpass', f: 900, f2: 300, d: 0.2, v: 0.26, buf: 'brown' });
  this.tone({ out, f: 175, f2: 62, d: 0.16, v: 0.22 });
  this.crackle(out, 6, 0.3, 0.12);
};
S.cast_frost = function (o) {
  const out = this.bus(o.pos, 1, 0.35); if (!out) return;
  this.click(out, 0.1, 7000);
  [1568, 2093, 2794].forEach((f, i) => this.tone({ out, f: f * randRange(0.99, 1.01), t: i * 0.02, a: 0.002, d: 0.34, v: 0.055 }));
  this.tone({ out, type: 'triangle', f: 784, d: 0.18, v: 0.05 });
  this.noise({ out, f: 1200, f2: 4200, q: 3, d: 0.12, v: 0.12 });
  this.shards(out, 3, 0.08, 0.07);
  this.tail(out, { type: 'highpass', f: 6000, f2: 9000, d: 0.24, v: 0.08 });
};
S.cast_storm = function (o) {
  const out = this.bus(o.pos, 1, 0.3); if (!out) return;
  const d = this.dist(out);
  this.noise({ out: d, type: 'highpass', f: 1500, d: 0.08, v: 0.45 });
  this.noise({ out: d, type: 'highpass', f: 2600, t: 0.035, d: 0.05, v: 0.25 });
  this.tone({ out: this.filter('lowpass', 1400, 1, out), type: 'sawtooth', f: 200, f2: 55, d: 0.22, v: 0.16 });
  this.tone({ out, type: 'square', f: 3400, f2: 380, d: 0.06, v: 0.04 });
  this.tail(out, { buf: 'brown', f: 260, f2: 90, t: 0.03, d: 0.45, v: 0.24 });
};
S.cast_wind = function (o) {
  const out = this.bus(o.pos, 1, 0.25); if (!out) return;
  this.whoosh(out, { f: 330, f2: 1800, q: 1.6, a: 0.03, d: 0.34, v: 0.48 });
  this.whoosh(out, { f: 1400, f2: 3800, q: 3.5, a: 0.02, d: 0.22, v: 0.16, buf: 'white' });
  this.tone({ out, f: 420, f2: 940, d: 0.18, v: 0.035 });
};
S.cast_water = function (o) {
  const out = this.bus(o.pos, 1, 0.3); if (!out) return;
  this.tone({ out, f: 360, f2: 1150, d: 0.07, v: 0.1 });
  this.tone({ out, f: 520, f2: 1500, t: 0.05, d: 0.06, v: 0.05 });
  this.noise({ out, f: 600, f2: 1900, q: 2.2, a: 0.015, d: 0.2, v: 0.3 });
  this.noise({ out, type: 'lowpass', f: 700, d: 0.14, v: 0.16 });
  this.tone({ out, type: 'triangle', f: 1300, f2: 700, t: 0.04, d: 0.12, v: 0.035 });
};
// signature-spell casts
S.heavy_arcane = function (o) {
  const out = this.bus(o.pos, 1.1, 0.5); if (!out) return;
  this.click(out, 0.22, 3000);
  this.boom(out, { f: 80, f2: 30, d: 0.7, v: 0.6 });
  this.whoosh(out, { f: 2400, f2: 260, q: 0.9, a: 0.005, d: 0.55, v: 0.4 });
  this.chord(out, [74, 81, 86], 0.02, 0.05, 1.1, 0.025);
  this.tail(out, { type: 'highpass', f: 3500, f2: 8000, d: 0.7, v: 0.08 });
};
S.heavy_fire = function (o) {
  const out = this.bus(o.pos, 1.1, 0.35); if (!out) return;
  this.swell(out, { f: 300, f2: 1400, d: 0.12, v: 0.25, buf: 'brown', type: 'lowpass' });
  this.whoosh(out, { f: 220, f2: 1500, q: 0.7, t: 0.1, a: 0.02, d: 0.55, v: 0.55 });
  this.noise({ out, type: 'lowpass', f: 1100, f2: 250, t: 0.1, d: 0.7, v: 0.4, buf: 'brown' });
  this.tone({ out, f: 110, f2: 42, t: 0.1, d: 0.45, v: 0.4 });
  this.crackle(out, 12, 0.7, 0.13);
};
S.heavy_frost = function (o) {
  const out = this.bus(o.pos, 1, 0.45); if (!out) return;
  this.swell(out, { f: 2000, f2: 7000, d: 0.1, v: 0.12, type: 'highpass', buf: 'white' });
  this.tone({ out, f: 140, f2: 55, t: 0.08, d: 0.35, v: 0.35 });
  this.shards(out, 10, 0.45, 0.1);
  [79, 86, 91].forEach((m, i) => this.note(out, m, 0.06 + i * 0.05, 0.04, 0.9));
};
S.heavy_storm = function (o) {
  const out = this.bus(o.pos, 1, 0.4); if (!out) return;
  this.tone({ out: this.filter('lowpass', 2600, 2, out), type: 'sawtooth', f: 180, f2: 1600, a: 0.3, d: 0.05, v: 0.12 });
  this.swell(out, { f: 600, f2: 7000, d: 0.33, v: 0.22, buf: 'white' });
  this.crackle(out, 8, 0.3, 0.1, 4000);
};
S.heavy_water = function (o) {
  const out = this.bus(o.pos, 1.1, 0.4); if (!out) return;
  this.noise({ out, type: 'lowpass', f: 400, f2: 2600, a: 0.12, d: 0.7, v: 0.55, buf: 'pink' });
  this.whoosh(out, { f: 250, f2: 1100, q: 1, a: 0.06, d: 0.6, v: 0.3 });
  this.tone({ out, f: 70, f2: 38, d: 0.6, v: 0.4 });
  for (let i = 0; i < 5; i++) this.tone({ out, f: randRange(400, 900), f2: randRange(1100, 1900), t: 0.08 + i * 0.05, d: 0.05, v: 0.035 });
};
S.charge = function (o) {
  const out = this.bus(o.pos, 0.8, 0.3); if (!out) return;
  this.tone({ out, f: 220, f2: 880, a: 0.05, d: 0.45, v: 0.06 });
  this.swell(out, { f: 400, f2: 3500, d: 0.4, v: 0.1, q: 2 });
};
S.weave = function (o) {
  const out = this.bus(o.pos, 1, 0.55); if (!out) return;
  [0, 4, 7, 12, 16].forEach((st, i) => this.tone({ out, f: mtof(62 + st), f2: mtof(74 + st), t: i * 0.05, a: 0.08, d: 0.7, v: 0.045 }));
  this.noise({ out, type: 'highpass', f: 3000, f2: 8000, a: 0.25, d: 0.5, v: 0.1 });
  this.tone({ out, f: 70, f2: 140, a: 0.2, d: 0.5, v: 0.2 });
  this.boom(out, { f: 60, f2: 30, t: 0.25, d: 0.6, v: 0.35 });
};
S.magic_circle = function (o) {
  const out = this.bus(o.pos, 0.7, 0.5); if (!out) return;
  this.tone({ out, f: 440, f2: 660, a: 0.05, d: 0.45, v: 0.04 });
  this.tone({ out, f: 1320, t: 0.08, d: 0.5, v: 0.02 });
  this.noise({ out, type: 'highpass', f: 5000, a: 0.1, d: 0.4, v: 0.05 });
};
S.whoosh = function (o) {
  const out = this.bus(o.pos, o.v || 0.8, 0.2); if (!out) return;
  this.whoosh(out, { f: 300, f2: 1400, q: 1.4, a: 0.05, d: o.d || 0.3, v: 0.3 });
};

// ----- impacts (element variants) -----
S.impact_arcane = function (o) {
  const out = this.bus(o.pos, 1, 0.28); if (!out) return;
  this.click(out, 0.2, 5000);
  this.tone({ out, f: 760, f2: 170, d: 0.15, v: 0.24 });
  this.noise({ out, f: 1800, q: 1.5, d: 0.07, v: 0.26 });
  this.tone({ out, type: 'triangle', f: 1800, f2: 1200, d: 0.1, v: 0.06 });
  this.tone({ out, f: 3100, t: 0.015, d: 0.18, v: 0.02 });
  this.tail(out, { type: 'highpass', f: 4000, f2: 6000, d: 0.2, v: 0.05 });
};
S.impact_fire = function (o) {
  const out = this.bus(o.pos, 1, 0.3); if (!out) return;
  this.click(out, 0.15, 2500);
  this.boom(out, { f: 160, f2: 40, d: 0.28, v: 0.45 });
  this.noise({ out, type: 'lowpass', f: 1800, f2: 200, d: 0.4, v: 0.42 });
  this.crackle(out, 7, 0.45, 0.13);
  this.tail(out, { type: 'highpass', f: 3500, f2: 6000, t: 0.05, d: 0.35, v: 0.06 });
};
S.impact_frost = function (o) {
  const out = this.bus(o.pos, 1, 0.35); if (!out) return;
  this.click(out, 0.18, 6000);
  this.shards(out, 8, 0.12, 0.17);
  this.tone({ out, f: randRange(2300, 2700), f2: 1700, d: 0.25, v: 0.045 });
  this.tone({ out, type: 'triangle', f: randRange(3300, 3900), t: 0.02, d: 0.2, v: 0.02 });
  this.tone({ out, f: 230, f2: 90, d: 0.1, v: 0.24 });
};
S.impact_storm = function (o) {
  const out = this.bus(o.pos, 1, 0.3); if (!out) return;
  const d = this.dist(out);
  this.noise({ out: d, type: 'highpass', f: 900, d: 0.09, v: 0.5 });
  this.noise({ out: d, type: 'highpass', f: 2000, t: 0.04, d: 0.04, v: 0.25 });
  this.tone({ out: this.filter('lowpass', 900, 1, out), type: 'sawtooth', f: 95, f2: 40, d: 0.25, v: 0.16 });
  this.tone({ out: this.filter('lowpass', 700, 1, out), type: 'square', f: 60, d: 0.15, v: 0.06 });
  this.crackle(out, 4, 0.2, 0.08, 5000);
};
S.impact_wind = function (o) {
  const out = this.bus(o.pos, 1, 0.25); if (!out) return;
  this.whoosh(out, { f: 900, f2: 220, q: 1, a: 0.005, d: 0.3, v: 0.38 });
  this.tone({ out, f: 180, f2: 65, d: 0.12, v: 0.25 });
  this.tail(out, { type: 'bandpass', f: 1800, f2: 700, d: 0.3, v: 0.06 });
};
S.impact_water = function (o) {
  const out = this.bus(o.pos, 1, 0.3); if (!out) return;
  this.click(out, 0.12, 2500);
  this.noise({ out, type: 'lowpass', f: 2400, f2: 300, d: 0.3, v: 0.42 });
  this.noise({ out, f: 1400, f2: 500, q: 1.4, d: 0.16, v: 0.24 });
  this.tone({ out, f: 300, f2: 90, d: 0.12, v: 0.2 });
  for (let i = 0; i < 4; i++) this.tone({ out, f: randRange(900, 1700), f2: randRange(1800, 2600), t: 0.03 + i * 0.035, d: 0.05, v: 0.03 });
};
// element-aware hit confirmation. o: el, heavy, v
S.hit = function (o) {
  const hv = !!o.heavy;
  const out = this.bus(o.pos, (o.v || 1) * (hv ? 1.1 : 0.85), 0.15); if (!out) return;
  this.click(out, 0.2, 3500);
  this.tone({ out, f: 190, f2: 48, d: hv ? 0.16 : 0.11, v: hv ? 0.55 : 0.45 });
  this.noise({ out, f: 760, q: 1, d: 0.06, v: hv ? 0.36 : 0.28 });
  if (hv) this.boom(out, { f: 75, f2: 30, d: 0.35, v: 0.35 });
  switch (o.el) {
    case 'fire': this.crackle(out, 3, 0.12, 0.1); break;
    case 'frost': this.shards(out, 3, 0.06, 0.1); break;
    case 'storm': this.noise({ out: this.dist(out), type: 'highpass', f: 2200, d: 0.04, v: 0.2 }); break;
    case 'water': this.noise({ out, type: 'lowpass', f: 1400, f2: 300, d: 0.12, v: 0.2 }); break;
    case 'wind': this.whoosh(out, { f: 1200, f2: 400, q: 1.2, a: 0.004, d: 0.12, v: 0.15 }); break;
    case 'arcane': this.tone({ out, type: 'triangle', f: 1480, f2: 1100, d: 0.08, v: 0.04 }); break;
  }
};
S.hit_flesh = function (o) {
  const out = this.bus(o.pos, o.v || 1, 0.15); if (!out) return;
  this.click(out, 0.15, 3500);
  this.tone({ out, f: 190, f2: 50, d: 0.12, v: 0.52 });
  this.noise({ out, f: 700, q: 1, d: 0.07, v: 0.36 });
};
S.hit_armor = function (o) {
  const out = this.bus(o.pos, 1, 0.25); if (!out) return;
  this.tone({ out, f: 160, f2: 70, d: 0.14, v: 0.45 });
  this.tone({ out, type: 'triangle', f: 1240, d: 0.25, v: 0.05 });
  this.tone({ out, type: 'triangle', f: 1870, d: 0.2, v: 0.04 });
  this.noise({ out, f: 2400, q: 3, d: 0.08, v: 0.3 });
};
S.crit = function (o) {
  const out = this.bus(o.pos, 1, 0.35); if (!out) return;
  this.click(out, 0.25, 5000);
  this.tone({ out, type: 'triangle', f: 2350, f2: 2200, d: 0.28, v: 0.07 });
  this.tone({ out, type: 'triangle', f: 3520, d: 0.2, v: 0.045 });
  this.noise({ out, f: 5200, q: 6, d: 0.12, v: 0.12 });
  this.boom(out, { f: 120, f2: 40, d: 0.2, v: 0.3 });
};
// killing blow: weighty thud + rising chime
S.kill = function (o) {
  const out = this.bus(o.pos, 1.05, 0.4); if (!out) return;
  this.click(out, 0.25, 3000);
  this.boom(out, { f: 115, f2: 34, d: 0.45, v: 0.55 });
  this.noise({ out, type: 'lowpass', f: 2200, f2: 180, d: 0.35, v: 0.32 });
  this.note(out, 86, 0.06, 0.05, 0.8); this.note(out, 93, 0.12, 0.045, 1.0);
  this.tail(out, { type: 'highpass', f: 5000, f2: 9000, t: 0.08, d: 0.5, v: 0.05 });
};
S.explosion = function (o) {
  const out = this.bus(o.pos, o.v || 1, 0.5); if (!out) return;
  this.click(out, 0.3, 2000);
  this.noise({ out: this.dist(out), type: 'lowpass', f: 3000, d: 0.08, v: 0.5 });
  this.boom(out, { f: 110, f2: 26, d: 1.0, v: 0.85 });
  this.noise({ out, type: 'lowpass', f: 3400, f2: 110, d: 1.3, v: 0.72, buf: 'pink' });
  this.noise({ out, f: 480, q: 0.7, d: 0.6, v: 0.28 });
  this.crackle(out, 12, 0.9, 0.12);
  this.tail(out, { buf: 'brown', f: 300, f2: 60, t: 0.2, d: 1.4, v: 0.3 });
};
S.thunder = function (o) {
  const out = this.bus(o.pos, o.v || 1, 0.6); if (!out) return;
  const d = this.dist(out);
  this.noise({ out: d, type: 'highpass', f: 700, d: 0.12, v: 0.8 });
  this.noise({ out: d, type: 'highpass', f: 1100, t: 0.06, d: 0.1, v: 0.55 });
  this.noise({ out: d, type: 'highpass', f: 1800, t: 0.11, d: 0.06, v: 0.3 });
  this.boom(out, { f: 78, f2: 28, d: 0.9, v: 0.55 });
  this.noise({ out, buf: 'brown', type: 'lowpass', f: 300, f2: 80, t: 0.08, a: 0.05, d: 2.4, v: 0.6 });
  for (let i = 0; i < 3; i++) this.noise({ out, buf: 'brown', type: 'lowpass', f: 220, t: 0.4 + i * randRange(0.3, 0.5), a: 0.12, d: 0.6, v: 0.25 * (1 - i * 0.25) });
};
S.ice_spike = function (o) {
  const out = this.bus(o.pos, 0.9, 0.3); if (!out) return;
  this.click(out, 0.12, 6000);
  this.noise({ out, f: 3500, q: 4, d: 0.07, v: 0.22 });
  this.tone({ out, type: 'triangle', f: 700, f2: 1500, d: 0.07, v: 0.08 });
  this.tone({ out, f: 190, f2: 80, d: 0.09, v: 0.24 });
  this.shards(out, 3, 0.05, 0.1);
};
S.gale = function (o) {
  const out = this.bus(o.pos, o.v || 1, 0.4); if (!out) return;
  this.whoosh(out, { f: 200, f2: 1500, q: 1.2, a: 0.05, d: 0.8, v: 0.62 });
  this.whoosh(out, { f: 2200, f2: 800, q: 4, a: 0.05, d: 0.6, v: 0.13, buf: 'white' });
  this.tone({ out, f: 90, f2: 50, d: 0.4, v: 0.25 });
};
S.steam = function (o) {
  const out = this.bus(o.pos, o.v || 1, 0.45); if (!out) return;
  this.click(out, 0.1, 3000);
  this.noise({ out, type: 'highpass', f: 1800, f2: 4800, a: 0.02, d: 1.2, v: 0.34 });
  this.boom(out, { f: 95, f2: 38, d: 0.42, v: 0.42 });
  this.noise({ out, type: 'lowpass', f: 700, d: 0.3, v: 0.28 });
};
S.shatter = function (o) {
  const out = this.bus(o.pos, o.v || 1, 0.5); if (!out) return;
  this.click(out, 0.35, 6000);
  this.shards(out, 20, 0.3, 0.2);
  this.tone({ out, f: 3200, f2: 2000, d: 0.5, v: 0.07 });
  this.boom(out, { f: 150, f2: 42, d: 0.4, v: 0.55 });
  this.noise({ out, type: 'highpass', f: 4000, f2: 9000, d: 0.5, v: 0.1 });
  [88, 91, 95].forEach((m, i) => this.note(out, m, 0.03 + i * 0.03, 0.035, 0.9));
};
S.chain = function (o) {
  const out = this.bus(o.pos, 1, 0.35); if (!out) return;
  const d = this.dist(out);
  for (let i = 0; i < 5; i++) {
    const t = i * randRange(0.04, 0.07);
    this.noise({ out: d, type: 'highpass', f: randRange(1600, 2600), t, d: 0.045, v: 0.33 });
    this.tone({ out, type: 'square', f: randRange(2000, 2800), f2: 300, t, d: 0.06, v: 0.035 });
  }
  this.tone({ out: this.filter('lowpass', 800, 1, out), type: 'sawtooth', f: 110, f2: 50, d: 0.4, v: 0.14 });
  this.tail(out, { buf: 'brown', f: 300, f2: 100, t: 0.05, d: 0.5, v: 0.18 });
};
S.overload = function (o) {
  S.explosion.call(this, { pos: o.pos, v: 0.85 });
  S.chain.call(this, o);
};
S.melt = function (o) {
  const out = this.bus(o.pos, 1, 0.4); if (!out) return;
  this.noise({ out, type: 'highpass', f: 2500, f2: 5500, a: 0.01, d: 0.6, v: 0.3 });
  this.tone({ out, f: 400, f2: 950, d: 0.25, v: 0.08 });
  this.shards(out, 6, 0.1, 0.12);
  this.boom(out, { f: 130, f2: 45, d: 0.3, v: 0.42 });
  this.crackle(out, 5, 0.3, 0.1);
};
S.freeze = function (o) {
  const out = this.bus(o.pos, 1, 0.45); if (!out) return;
  this.noise({ out, f: 6000, f2: 1500, q: 2, d: 0.35, v: 0.2 });
  this.shards(out, 10, 0.3, 0.12);
  [84, 88, 91].forEach((m, i) => this.note(out, m, i * 0.04, 0.04, 0.7));
};
S.fizzle = function (o) {
  const out = this.bus(o.pos, 1, 0.2); if (!out) return;
  this.noise({ out, type: 'highpass', f: 3000, f2: 5000, d: 0.35, v: 0.2 });
  this.tone({ out, f: 600, f2: 200, d: 0.08, v: 0.05 });
};
S.zap = function (o) {
  const out = this.bus(o.pos, o.v || 0.7, 0.2); if (!out) return;
  this.noise({ out: this.dist(out), type: 'highpass', f: randRange(1800, 3200), d: 0.035, v: 0.25 });
  this.tone({ out, type: 'square', f: randRange(1500, 3000), f2: 400, d: 0.04, v: 0.02 });
};
S.sizzle = function (o) {
  const out = this.bus(o.pos, o.v || 0.6, 0.2); if (!out) return;
  this.noise({ out, type: 'highpass', f: 4000, f2: 6000, a: 0.05, d: o.d || 0.5, v: 0.08 });
  this.crackle(out, 4, o.d || 0.5, 0.06);
};

// ----- reactions (each has a signature) -----
S.react_thermal = function (o) {
  const out = this.bus(o.pos, 1.05, 0.5); if (!out) return;
  this.click(out, 0.3, 4500);
  this.boom(out, { f: 120, f2: 36, d: 0.5, v: 0.6 });
  this.shards(out, 10, 0.2, 0.15);
  this.noise({ out, type: 'highpass', f: 2000, f2: 5000, a: 0.01, d: 0.9, v: 0.3 });
  this.tone({ out, type: 'triangle', f: 1800, f2: 900, d: 0.4, v: 0.05 });
};
S.react_flashfreeze = function (o) {
  const out = this.bus(o.pos, 1, 0.5); if (!out) return;
  this.swell(out, { f: 3000, f2: 9000, d: 0.08, v: 0.1, type: 'highpass', buf: 'white' });
  this.noise({ out, f: 7000, f2: 1200, q: 2, t: 0.06, d: 0.4, v: 0.24 });
  this.shards(out, 14, 0.3, 0.13);
  this.boom(out, { f: 110, f2: 40, t: 0.06, d: 0.3, v: 0.35 });
  [84, 91, 96].forEach((m, i) => this.note(out, m, 0.06 + i * 0.035, 0.045, 0.9));
};
S.react_firestorm = function (o) {
  const out = this.bus(o.pos, 1, 0.45); if (!out) return;
  this.whoosh(out, { f: 180, f2: 1900, q: 0.8, a: 0.05, d: 0.7, v: 0.55 });
  this.noise({ out, type: 'lowpass', f: 700, f2: 250, d: 0.8, v: 0.35, buf: 'brown' });
  this.crackle(out, 14, 0.8, 0.12);
  this.boom(out, { f: 90, f2: 40, d: 0.4, v: 0.3 });
};
S.react_blizzard = function (o) {
  const out = this.bus(o.pos, 1, 0.55); if (!out) return;
  this.whoosh(out, { f: 500, f2: 2600, q: 4, a: 0.08, d: 0.8, v: 0.3, buf: 'white' });
  this.whoosh(out, { f: 260, f2: 900, q: 1, a: 0.05, d: 0.7, v: 0.3 });
  this.shards(out, 10, 0.5, 0.09);
  this.tail(out, { type: 'highpass', f: 6000, f2: 9000, d: 0.8, v: 0.08 });
};
S.react_stormspread = function (o) {
  const out = this.bus(o.pos, 1, 0.4); if (!out) return;
  const d = this.dist(out);
  for (let i = 0; i < 6; i++) this.noise({ out: d, type: 'highpass', f: randRange(1500, 3000), t: i * 0.045, d: 0.04, v: 0.28 });
  this.whoosh(out, { f: 400, f2: 2000, q: 1.2, a: 0.03, d: 0.4, v: 0.3 });
  this.tone({ out: this.filter('lowpass', 900, 1, out), type: 'sawtooth', f: 140, f2: 60, d: 0.35, v: 0.12 });
};
S.react_extinguish = function (o) {
  const out = this.bus(o.pos, 1, 0.3); if (!out) return;
  this.noise({ out, type: 'highpass', f: 2800, f2: 1600, a: 0.01, d: 0.55, v: 0.3 });
  this.noise({ out, type: 'lowpass', f: 600, f2: 200, d: 0.25, v: 0.25, buf: 'brown' });
  this.tone({ out, type: 'triangle', f: 330, f2: 150, t: 0.05, d: 0.35, v: 0.06 });
};
S.react_scald = function (o) {
  const out = this.bus(o.pos, 1.05, 0.5); if (!out) return;
  this.click(out, 0.25, 2500);
  this.boom(out, { f: 105, f2: 34, d: 0.55, v: 0.6 });
  this.noise({ out, type: 'highpass', f: 1500, f2: 5000, a: 0.01, d: 1.1, v: 0.36 });
  for (let i = 0; i < 8; i++) this.tone({ out, f: randRange(250, 600), f2: randRange(800, 1400), t: 0.05 + i * randRange(0.03, 0.06), d: 0.05, v: 0.05 });
  this.noise({ out, type: 'lowpass', f: 1600, f2: 300, d: 0.4, v: 0.3 });
};
S.react_shortcircuit = function (o) {
  const out = this.bus(o.pos, 1, 0.35); if (!out) return;
  const d = this.dist(out);
  let t = 0;
  for (let i = 0; i < 7; i++) { t += randRange(0.02, 0.07); this.noise({ out: d, type: 'highpass', f: randRange(1200, 3500), t, d: randRange(0.015, 0.04), v: 0.3 }); }
  this.tone({ out: this.filter('lowpass', 700, 2, out), type: 'sawtooth', f: 60, f2: 58, d: 0.4, v: 0.14 });
  this.noise({ out, type: 'highpass', f: 3000, f2: 5000, t: 0.1, d: 0.4, v: 0.14 });
};
S.react_superconduct = function (o) {
  const out = this.bus(o.pos, 1, 0.5); if (!out) return;
  this.click(out, 0.3, 5000);
  [1240, 1870, 2610, 3300].forEach((f, i) => this.tone({ out, type: 'triangle', f, t: 0.005 * i, d: 0.5 - i * 0.08, v: 0.05 }));
  this.noise({ out: this.dist(out), type: 'highpass', f: 1200, d: 0.07, v: 0.35 });
  this.boom(out, { f: 140, f2: 50, d: 0.3, v: 0.4 });
  this.shards(out, 6, 0.15, 0.1);
};
S.react_monsoon = function (o) {
  const out = this.bus(o.pos, 1, 0.45); if (!out) return;
  this.noise({ out, type: 'lowpass', f: 600, f2: 3000, a: 0.06, d: 0.7, v: 0.45 });
  this.whoosh(out, { f: 350, f2: 1500, q: 1.2, a: 0.04, d: 0.6, v: 0.3 });
  for (let i = 0; i < 6; i++) this.tone({ out, f: randRange(800, 1600), f2: randRange(1800, 2800), t: 0.06 + i * 0.06, d: 0.05, v: 0.03 });
};
S.react_resonance = function (o) {
  const out = this.bus(o.pos, 1, 0.55); if (!out) return;
  this.chord(out, [79, 83, 86, 91], 0, 0.04, 1.1, 0.02);
  this.tone({ out, f: 98, f2: 196, a: 0.02, d: 0.4, v: 0.15 });
  this.tone({ out, f: 760, f2: 170, d: 0.12, v: 0.12 });
};
S.react_prism = function (o) {
  const out = this.bus(o.pos, 1.05, 0.6); if (!out) return;
  this.chord(out, [74, 78, 81, 86, 90, 93], 0, 0.045, 1.4, 0.03);
  this.boom(out, { f: 90, f2: 36, d: 0.5, v: 0.4 });
  this.noise({ out, type: 'highpass', f: 4000, f2: 9000, d: 0.6, v: 0.1 });
};

// ----- enemies -----
S.enemy_alert = function (o) {
  const out = this.bus(o.pos, 1, 0.25); if (!out) return;
  const bp = this.filter('bandpass', 900, 4, out);
  this.tone({ out: bp, type: 'sawtooth', f: 260, f2: 520, d: 0.12, v: 0.25 });
  this.tone({ out: bp, type: 'sawtooth', f: 340, f2: 720, t: 0.1, d: 0.14, v: 0.25 });
};
S.enemy_swing = function (o) {
  const out = this.bus(o.pos, 1, 0.15); if (!out) return;
  this.noise({ out, f: 400, f2: 1900, q: 1.2, d: 0.2, v: 0.3 });
};
S.enemy_hurt = function (o) {
  const out = this.bus(o.pos, 0.8, 0.15); if (!out) return;
  const bp = this.filter('bandpass', o.f || 700, 3, out);
  this.tone({ out: bp, type: 'sawtooth', f: (o.f || 700) * 0.45, f2: (o.f || 700) * 0.25, d: 0.14, v: 0.25 });
};
S.enemy_die = function (o) {
  const out = this.bus(o.pos, 1, 0.5); if (!out) return;
  this.noise({ out, f: 300, f2: 2400, q: 1, a: 0.25, d: 0.25, v: 0.22 });
  const base = [76, 79, 83, 86, 88];
  const s = Math.floor(Math.random() * 2);
  for (let i = 0; i < 3; i++) this.note(out, base[i + s], 0.22 + i * 0.1, 0.05, 1.1);
};
S.wailer_charge = function (o) {
  const out = this.bus(o.pos, 1, 0.4); if (!out) return;
  this.tone({ out, f: 300, f2: 700, a: 0.2, d: 0.6, v: 0.07 });
  this.tone({ out, f: 310, f2: 690, a: 0.2, d: 0.6, v: 0.07 });
};
S.wailer_shot = function (o) {
  const out = this.bus(o.pos, 1, 0.4); if (!out) return;
  this.tone({ out, f: 520, f2: 950, d: 0.3, v: 0.1 });
  this.noise({ out, f: 1300, q: 6, d: 0.3, v: 0.07 });
};
S.wailer_wail = function (o) {
  const out = this.bus(o.pos, 0.7, 0.5); if (!out) return;
  const bp = this.filter('bandpass', 1100, 5, out);
  this.tone({ out: bp, type: 'sawtooth', f: 420, f2: 300, a: 0.2, d: 0.8, v: 0.18 });
};
S.orb_hit = function (o) {
  const out = this.bus(o.pos, 1, 0.3); if (!out) return;
  this.tone({ out, f: 320, f2: 100, d: 0.22, v: 0.3 });
  this.noise({ out, f: 1400, q: 2, d: 0.15, v: 0.2 });
};
S.brute_slam = function (o) {
  const out = this.bus(o.pos, 1, 0.4); if (!out) return;
  this.tone({ out, f: 85, f2: 28, d: 0.6, v: 0.9 });
  this.noise({ out, type: 'lowpass', f: 900, f2: 100, d: 0.8, v: 0.6 });
  for (let i = 0; i < 10; i++) this.noise({ out, t: Math.random() * 0.5, d: 0.06, v: 0.14, f: randRange(300, 1300), q: 3 });
};
S.brute_roar = function (o) {
  const out = this.bus(o.pos, 1, 0.4); if (!out) return;
  this.tone({ out: this.filter('lowpass', 520, 2, out), type: 'sawtooth', f: 95, f2: 70, a: 0.1, d: 0.8, v: 0.35 });
  this.noise({ out, f: 420, q: 2, a: 0.1, d: 0.8, v: 0.18 });
};
S.sword = function (o) {
  const out = this.bus(o.pos, 1, 0.25); if (!out) return;
  this.noise({ out, f: 600, f2: 3200, q: 2, d: 0.18, v: 0.38 });
  this.tone({ out, f: 1300, f2: 700, d: 0.12, v: 0.04 });
};
S.boss_roar = function (o) {
  const out = this.bus(o.pos, 1, 0.7); if (!out) return;
  this.tone({ out: this.filter('lowpass', 600, 2, out), type: 'sawtooth', f: 70, f2: 45, a: 0.2, d: 1.6, v: 0.45 });
  this.tone({ out: this.filter('bandpass', 900, 6, out), type: 'sawtooth', f: 140, f2: 90, a: 0.2, d: 1.4, v: 0.35 });
  this.noise({ out, buf: 'brown', type: 'lowpass', f: 300, a: 0.2, d: 1.6, v: 0.5 });
};
S.shockwave = function (o) {
  const out = this.bus(o.pos, 1, 0.5); if (!out) return;
  this.tone({ out, f: 60, f2: 30, d: 0.8, v: 0.7 });
  this.noise({ out, f: 300, f2: 1200, q: 1, d: 0.7, v: 0.3 });
};
S.beam = function (o) {
  const out = this.bus(o.pos, 1, 0.4); if (!out) return;
  this.tone({ out: this.filter('lowpass', 1500, 2, out), type: 'sawtooth', f: 110, f2: 105, a: 0.1, d: o.d || 2, v: 0.12 });
  this.tone({ out, type: 'sine', f: 880, f2: 870, a: 0.1, d: o.d || 2, v: 0.03 });
  this.noise({ out, f: 2500, q: 2, a: 0.1, d: o.d || 2, v: 0.08 });
};

// ----- player -----
S.player_hurt = function (o) {
  const out = this.bus(null, 1, 0.15); if (!out) return;
  this.tone({ out, f: 330, f2: 140, d: 0.22, v: 0.3 });
  this.noise({ out, f: 1000, d: 0.1, v: 0.3 });
  this.tone({ out, type: 'triangle', f: 200, d: 0.1, v: 0.15 });
};
S.jump = function () {
  const out = this.bus(null, 0.8, 0.1); if (!out) return;
  this.noise({ out, f: 900, d: 0.1, v: 0.07 });
  this.tone({ out, f: 260, f2: 420, d: 0.08, v: 0.04 });
};
S.land = function (o) {
  const out = this.bus(null, o.v || 0.8, 0.1); if (!out) return;
  this.tone({ out, f: 120, f2: 55, d: 0.1, v: 0.25 });
  this.noise({ out, type: 'lowpass', f: 700, d: 0.08, v: 0.16 });
};
S.step = function (o) {
  const out = this.bus(o.pos, 0.7, 0.05); if (!out) return;
  const f = o.surface === 'stone' ? 1900 : o.surface === 'snow' ? 520 : o.surface === 'water' ? 1200 : 750;
  this.noise({ out, f: f * randRange(0.85, 1.2), q: o.surface === 'snow' ? 2 : 1.2, d: 0.05, v: o.surface === 'water' ? 0.08 : 0.055 });
  if (o.surface === 'stone') this.tone({ out, f: 140, f2: 80, d: 0.04, v: 0.05 });
};
S.blink = function () {
  const out = this.bus(null, 1, 0.3); if (!out) return;
  this.tone({ out, f: 1700, f2: 280, d: 0.18, v: 0.12 });
  this.noise({ out, type: 'highpass', f: 3000, f2: 800, d: 0.2, v: 0.16 });
  this.tone({ out, f: 200, f2: 900, t: 0.06, d: 0.14, v: 0.05 });
};
S.glide = function () {
  const out = this.bus(null, 0.8, 0.2); if (!out) return;
  this.noise({ out, f: 400, f2: 1500, q: 1, d: 0.35, v: 0.2 });
  this.tone({ out, f: 587, t: 0.02, d: 0.3, v: 0.03 });
};
S.updraft = function (o) {
  const out = this.bus(o.pos, 1, 0.4); if (!out) return;
  this.noise({ out, f: 200, f2: 2600, q: 1, a: 0.05, d: 0.9, v: 0.5 });
  [74, 78, 81, 86].forEach((m, i) => this.note(out, m, i * 0.06, 0.03, 0.8));
};
S.splash = function (o) {
  const out = this.bus(o.pos, 1, 0.2); if (!out) return;
  this.noise({ out, type: 'lowpass', f: 2400, f2: 400, d: 0.35, v: 0.35 });
  this.tone({ out, f: 300, f2: 120, d: 0.15, v: 0.15 });
};
S.mana_empty = function () {
  const out = this.bus(null, 1, 0.1); if (!out) return;
  this.tone({ out, type: 'triangle', f: 220, f2: 180, d: 0.12, v: 0.1 });
  this.tone({ out, type: 'triangle', f: 196, f2: 150, t: 0.1, d: 0.14, v: 0.1 });
};
S.heartbeat = function () {
  const out = this.bus(null, 1, 0.05); if (!out) return;
  this.tone({ out, f: 62, d: 0.12, v: 0.35 });
  this.tone({ out, f: 55, t: 0.2, d: 0.15, v: 0.25 });
};
S.heal = function () {
  const out = this.bus(null, 1, 0.4); if (!out) return;
  [72, 76, 79, 84].forEach((m, i) => this.note(out, m, i * 0.07, 0.04, 0.8));
};

// ----- UI & story -----
S.ui_click = function () { const out = this.bus(null, 1, 0.05); if (!out) return; this.tone({ out, f: 1200, d: 0.05, v: 0.07 }); };
S.ui_hover = function () { const out = this.bus(null, 1, 0.05); if (!out) return; this.tone({ out, f: 1900, d: 0.03, v: 0.03 }); };
S.ui_open = function () {
  const out = this.bus(null, 1, 0.3); if (!out) return;
  this.tone({ out, f: 660, d: 0.12, v: 0.06 }); this.tone({ out, f: 990, t: 0.06, d: 0.2, v: 0.06 });
};
S.ui_close = function () {
  const out = this.bus(null, 1, 0.3); if (!out) return;
  this.tone({ out, f: 990, d: 0.1, v: 0.05 }); this.tone({ out, f: 660, t: 0.05, d: 0.16, v: 0.05 });
};
S.element_switch = function (o) {
  const out = this.bus(null, 1, 0.2); if (!out) return;
  const m = { arcane: 81, fire: 76, wind: 79, frost: 84, storm: 83, water: 78 }[o.el] || 80;
  this.note(out, m, 0, 0.05, 0.4);
  this.noise({ out, type: 'highpass', f: 4000, d: 0.08, v: 0.04 });
};
S.quest_start = function () {
  const out = this.bus(null, 1, 0.5); if (!out) return;
  [74, 78, 81, 86].forEach((m, i) => this.note(out, m, i * 0.09, 0.06, 1.2));
};
S.quest_done = function () {
  const out = this.bus(null, 1, 0.6); if (!out) return;
  [74, 81, 86, 90, 93].forEach((m, i) => this.note(out, m, i * 0.1, 0.06, 1.6));
  this.noise({ out, type: 'highpass', f: 6000, t: 0.3, a: 0.2, d: 0.8, v: 0.05 });
};
S.levelup = function () {
  const out = this.bus(null, 1, 0.6); if (!out) return;
  [62, 66, 69, 74, 78, 81, 86].forEach((m, i) => this.note(out, m, i * 0.06, 0.06, 1.4));
  [62, 66, 69].forEach((m) => this.tone({ out, type: 'triangle', f: mtof(m), t: 0.45, a: 0.1, d: 1.6, v: 0.05 }));
};
S.skill_learn = function () {
  const out = this.bus(null, 1, 0.55); if (!out) return;
  [69, 76, 81, 88].forEach((m, i) => this.note(out, m, i * 0.05, 0.07, 1.3));
  this.tone({ out, type: 'triangle', f: mtof(57), a: 0.02, d: 0.9, v: 0.07 });
  this.noise({ out, type: 'highpass', f: 5200, a: 0.05, d: 0.5, v: 0.05 });
};
S.ult_ready = function () {
  const out = this.bus(null, 1, 0.6); if (!out) return;
  [74, 81, 86].forEach((m, i) => this.note(out, m, i * 0.07, 0.06, 1.2));
  this.tone({ out, f: 440, f2: 880, a: 0.1, d: 0.5, v: 0.03 });
};
S.ult_cast = function (o) {
  const out = this.bus(o.pos, 1.2, 0.75); if (!out) return;
  this.swell(out, { f: 200, f2: 6000, d: 0.4, v: 0.3, q: 0.6 });
  [50, 57, 62, 69, 74, 81].forEach((m, i) => this.tone({ out, type: i % 2 ? 'triangle' : 'sine', f: mtof(m), f2: mtof(m + 12), t: i * 0.04, a: 0.12, d: 1.1, v: 0.055 }));
  this.tone({ out, f: 55, f2: 110, a: 0.25, d: 0.9, v: 0.32 });
  this.boom(out, { f: 70, f2: 28, t: 0.38, d: 1.0, v: 0.6 });
  this.click(out, 0.3, 2500, 0.38);
  this.noise({ out, type: 'highpass', f: 2500, f2: 9000, a: 0.3, d: 0.8, v: 0.12 });
  this.tail(out, { buf: 'brown', f: 400, f2: 70, t: 0.4, d: 1.6, v: 0.3 });
};
// ultimate payoff: huge layered impact with an element tint. o: el
S.ult_boom = function (o) {
  const out = this.bus(o.pos, 1.3, 0.8); if (!out) return;
  const d = this.dist(out);
  this.click(out, 0.4, 1800);
  this.noise({ out: d, type: 'lowpass', f: 2600, d: 0.12, v: 0.6 });
  this.boom(out, { f: 70, f2: 20, d: 1.8, v: 1.0 });
  this.noise({ out, type: 'lowpass', f: 3000, f2: 90, d: 1.8, v: 0.8, buf: 'pink' });
  this.tail(out, { buf: 'brown', f: 260, f2: 50, t: 0.15, d: 2.6, v: 0.5 });
  switch (o.el) {
    case 'fire': this.crackle(out, 22, 1.6, 0.14); break;
    case 'frost': this.shards(out, 26, 0.6, 0.18); [84, 91, 96, 100].forEach((m, i) => this.note(out, m, 0.05 + i * 0.05, 0.045, 1.4)); break;
    case 'storm': this.noise({ out: d, type: 'highpass', f: 900, t: 0.05, d: 0.2, v: 0.6 }); break;
    case 'water': this.noise({ out, type: 'lowpass', f: 400, f2: 3000, a: 0.05, d: 1.2, v: 0.5 }); break;
    case 'wind': this.whoosh(out, { f: 150, f2: 2000, q: 1, a: 0.05, d: 1.2, v: 0.5 }); break;
    case 'arcane': this.chord(out, [62, 69, 74, 81, 86], 0.02, 0.05, 1.8, 0.04); break;
  }
};
S.perfect_dodge = function () {
  const out = this.bus(null, 1, 0.8); if (!out) return;
  // reverse "time-stop" swell snapping into a hollow whoomp, then a glassy chime
  this.swell(out, { f: 400, f2: 7000, d: 0.16, v: 0.22, q: 0.7 });
  this.boom(out, { f: 90, f2: 35, t: 0.16, d: 0.9, v: 0.45 });
  this.tone({ out, f: 1760, f2: 440, t: 0.16, d: 0.9, v: 0.05 });
  this.tone({ out, type: 'triangle', f: 220, f2: 110, t: 0.16, a: 0.02, d: 1.2, v: 0.1 });
  this.noise({ out, f: 3000, f2: 400, q: 2, t: 0.16, a: 0.01, d: 0.8, v: 0.12 });
  [86, 93, 98].forEach((m, i) => this.note(out, m, 0.2 + i * 0.08, 0.05, 1.6));
};
S.unlock = function () {
  const out = this.bus(null, 1, 0.8); if (!out) return;
  [50, 57, 62, 66, 69].forEach((m) => this.tone({ out, type: 'triangle', f: mtof(m), a: 0.6, d: 2.6, v: 0.045 }));
  [74, 78, 81, 86, 90, 93, 98].forEach((m, i) => this.note(out, m, 0.4 + i * 0.08, 0.045, 1.8));
  this.noise({ out, type: 'highpass', f: 5000, a: 0.6, d: 1.6, v: 0.06 });
};
S.pickup = function () {
  const out = this.bus(null, 1, 0.3); if (!out) return;
  this.note(out, 88, 0, 0.06, 0.4); this.note(out, 95, 0.07, 0.06, 0.8);
};
S.seed = function (o) {
  const out = this.bus(null, 1, 0.6); if (!out) return;
  this.note(out, o.m || 81, 0, 0.09, 2.2);
  this.note(out, (o.m || 81) + 12, 0.02, 0.03, 1.6);
  this.noise({ out, type: 'highpass', f: 6000, a: 0.1, d: 0.8, v: 0.04 });
};
S.seed_hum = function (o) {
  const out = this.bus(o.pos, 0.5, 0.6); if (!out) return;
  this.note(out, o.m || 86, 0, 0.03, 1.2);
};
S.lantern = function (o) {
  const out = this.bus(o.pos, 1, 0.5); if (!out) return;
  this.noise({ out, f: 400, f2: 2200, q: 0.9, a: 0.02, d: 0.4, v: 0.3 });
  this.note(out, 81, 0.15, 0.05, 1.4); this.note(out, 88, 0.25, 0.05, 1.6);
};
S.bell = function (o) {
  const out = this.bus(o.pos, 1.3, 0.9); if (!out) return;
  const f0 = o.f || 146.8;
  const ratios = [0.5, 1, 1.19, 1.5, 2.0, 2.52, 2.67, 3.0, 4.07, 5.4];
  const amps = [0.5, 1, 0.55, 0.45, 0.42, 0.25, 0.2, 0.18, 0.12, 0.07];
  const decs = [9, 7, 5, 4.2, 4, 3, 2.8, 2.4, 1.8, 1.4];
  ratios.forEach((r, i) => this.tone({ out, f: f0 * r, a: 0.004, d: decs[i], v: amps[i] * 0.09 }));
  this.noise({ out, f: 2400, q: 1, d: 0.06, v: 0.3 });
};
S.cat = function (o) {
  const out = this.bus(o.pos, 1, 0.2); if (!out) return;
  const c = this.ctx, t0 = c.currentTime;
  const osc = c.createOscillator(); osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(520, t0);
  osc.frequency.linearRampToValueAtTime(820, t0 + 0.12);
  osc.frequency.linearRampToValueAtTime(470, t0 + 0.42);
  const bp = this.filter('bandpass', 1300, 3, out);
  const g = c.createGain(); this.env(g, t0, 0.04, 0.12, 0.4);
  osc.connect(g); g.connect(bp); osc.start(t0); osc.stop(t0 + 0.5);
};
S.fox = function () {
  const out = this.bus(null, 1, 0.5); if (!out) return;
  this.tone({ out, f: 1200, f2: 1800, d: 0.1, v: 0.05 });
  this.tone({ out, f: 1700, f2: 1300, t: 0.1, d: 0.15, v: 0.05 });
  this.noise({ out, type: 'highpass', f: 6000, d: 0.3, v: 0.03 });
};
S.stone = function (o) {
  const out = this.bus(o.pos, 1, 0.5); if (!out) return;
  this.noise({ out, buf: 'brown', type: 'lowpass', f: 400, a: 0.1, d: o.d || 1.4, v: 0.45 });
  this.tone({ out: this.filter('lowpass', 200, 1, out), type: 'sawtooth', f: 48, a: 0.1, d: o.d || 1.4, v: 0.08 });
};
S.page = function () {
  const out = this.bus(null, 1, 0.1); if (!out) return;
  this.noise({ out, type: 'highpass', f: 2600, a: 0.02, d: 0.12, v: 0.06 });
};
S.echo = function (o) {
  const out = this.bus(o.pos, 1, 0.9); if (!out) return;
  [62, 69, 74, 78].forEach((m) => this.tone({ out, type: 'triangle', f: mtof(m), a: 0.8, d: 2.5, v: 0.03 }));
  this.noise({ out, type: 'highpass', f: 4000, a: 0.8, d: 1.8, v: 0.05 });
};
S.dissolve = function (o) {
  const out = this.bus(o.pos, 1, 0.6); if (!out) return;
  this.noise({ out, f: 2000, f2: 500, q: 1, a: 0.3, d: 1.2, v: 0.2 });
};
