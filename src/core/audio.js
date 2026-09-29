// Procedural audio engine: every SFX is synthesized with WebAudio.
// Layers: transient (click/crack), body (tone/boom), tail (noise/reverb).
import { G } from './context.js';
import { clamp, randRange, rand } from './util.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ready = false;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.last = {};
    this.amb = { birdT: 2, cricketT: 1, waterT: 1 };
    this.voices = 0;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.22;
    this.master = ctx.createGain();
    this.master.connect(comp); comp.connect(ctx.destination);
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
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (f2) {
      if (lin) o.frequency.linearRampToValueAtTime(f2, t0 + a + d);
      else o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t0 + a + d);
    }
    if (detune) o.detune.value = detune;
    const g = c.createGain(); this.env(g, t0, a, v, d);
    o.connect(g); g.connect(out);
    o.start(t0); o.stop(t0 + a + d + 0.05);
    return o;
  }
  noise({ t = 0, a = 0.004, d = 0.3, v = 0.3, out, type = 'bandpass', f = 1000, f2 = 0, q = 1, buf = 'white', rate = 1 }) {
    if (!out) return;
    const c = this.ctx, t0 = c.currentTime + t;
    const src = c.createBufferSource(); src.buffer = this.buf[buf]; src.loop = true; src.playbackRate.value = rate;
    const fl = c.createBiquadFilter(); fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t0);
    if (f2) fl.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + a + d);
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

  // ---------- public ----------
  play(name, o = {}) {
    if (!this.ready || this.ctx.state !== 'running') return;
    const fn = this.S[name];
    if (!fn) return;
    const minGap = o.gap ?? 0.025;
    const k = name + (o.key || '');
    const now = this.ctx.currentTime;
    if (this.last[k] && now - this.last[k] < minGap) return;
    this.last[k] = now;
    try { fn.call(this, o); } catch (e) { console.warn('sfx', name, e); }
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

// ----- casts -----
S.cast_arcane = function (o) {
  const out = this.bus(o.pos, 0.9, 0.2); if (!out) return;
  this.tone({ out, f: 1400, f2: 480, d: 0.14, v: 0.14 });
  this.tone({ out: this.filter('lowpass', 2800, 0.7, out), type: 'triangle', f: 720, f2: 240, d: 0.18, v: 0.12 });
  this.noise({ out, type: 'highpass', f: 5000, d: 0.05, v: 0.07 });
  this.tone({ out, f: 2640, t: 0.03, d: 0.1, v: 0.035 });
};
S.cast_fire = function (o) {
  const out = this.bus(o.pos, 1, 0.2); if (!out) return;
  this.noise({ out, f: 450, f2: 2400, q: 0.9, a: 0.01, d: 0.26, v: 0.5 });
  this.noise({ out, type: 'lowpass', f: 900, d: 0.16, v: 0.25 });
  this.tone({ out, f: 170, f2: 70, d: 0.16, v: 0.22 });
  this.crackle(out, 5, 0.25, 0.12);
};
S.cast_frost = function (o) {
  const out = this.bus(o.pos, 1, 0.35); if (!out) return;
  [1568, 2093, 2794].forEach((f, i) => this.tone({ out, f: f * randRange(0.99, 1.01), t: i * 0.022, a: 0.002, d: 0.36, v: 0.06 }));
  this.tone({ out, type: 'triangle', f: 784, t: 0, d: 0.2, v: 0.05 });
  this.noise({ out, type: 'highpass', f: 6000, d: 0.22, v: 0.1 });
  this.noise({ out, f: 1200, f2: 3500, q: 3, d: 0.12, v: 0.12 });
};
S.cast_storm = function (o) {
  const out = this.bus(o.pos, 1, 0.3); if (!out) return;
  this.noise({ out: this.dist(out), type: 'highpass', f: 1500, d: 0.09, v: 0.45 });
  this.tone({ out: this.filter('lowpass', 1300, 1, out), type: 'sawtooth', f: 190, f2: 55, d: 0.22, v: 0.16 });
  this.tone({ out, type: 'square', f: 3200, f2: 380, d: 0.06, v: 0.045 });
  this.noise({ out, buf: 'brown', type: 'lowpass', f: 200, t: 0.03, d: 0.5, v: 0.25 });
};
S.cast_wind = function (o) {
  const out = this.bus(o.pos, 1, 0.25); if (!out) return;
  this.noise({ out, f: 330, f2: 1700, q: 1.6, a: 0.03, d: 0.36, v: 0.5 });
  this.noise({ out, f: 1200, f2: 3400, q: 3, a: 0.02, d: 0.24, v: 0.18 });
  this.tone({ out, f: 420, f2: 900, d: 0.2, v: 0.04 });
};
S.charge = function (o) {
  const out = this.bus(o.pos, 0.8, 0.3); if (!out) return;
  this.tone({ out, f: 220, f2: 880, a: 0.05, d: 0.45, v: 0.06 });
  this.noise({ out, f: 400, f2: 3000, q: 2, a: 0.1, d: 0.4, v: 0.08 });
};
S.weave = function (o) {
  const out = this.bus(o.pos, 1, 0.55); if (!out) return;
  [0, 4, 7, 12, 16].forEach((st, i) => this.tone({ out, f: mtof(62 + st), f2: mtof(74 + st), t: i * 0.05, a: 0.08, d: 0.7, v: 0.045 }));
  this.noise({ out, type: 'highpass', f: 3000, f2: 8000, a: 0.25, d: 0.5, v: 0.1 });
  this.tone({ out, f: 70, f2: 140, a: 0.2, d: 0.5, v: 0.2 });
};
S.magic_circle = function (o) {
  const out = this.bus(o.pos, 0.7, 0.5); if (!out) return;
  this.tone({ out, f: 440, f2: 660, a: 0.05, d: 0.45, v: 0.04 });
  this.tone({ out, f: 1320, t: 0.08, d: 0.5, v: 0.02 });
  this.noise({ out, type: 'highpass', f: 5000, a: 0.1, d: 0.4, v: 0.05 });
};

// ----- impacts -----
S.impact_arcane = function (o) {
  const out = this.bus(o.pos, 1, 0.25); if (!out) return;
  this.tone({ out, f: 720, f2: 170, d: 0.16, v: 0.25 });
  this.noise({ out, f: 1800, q: 1.5, d: 0.07, v: 0.28 });
  this.tone({ out, type: 'triangle', f: 1800, f2: 1200, d: 0.1, v: 0.06 });
};
S.impact_fire = function (o) {
  const out = this.bus(o.pos, 1, 0.3); if (!out) return;
  this.tone({ out, f: 150, f2: 42, d: 0.3, v: 0.5 });
  this.noise({ out, type: 'lowpass', f: 1600, f2: 200, d: 0.4, v: 0.45 });
  this.crackle(out, 6, 0.4, 0.14);
};
S.impact_frost = function (o) {
  const out = this.bus(o.pos, 1, 0.35); if (!out) return;
  this.shards(out, 8, 0.12, 0.18);
  this.tone({ out, f: 2400, f2: 1700, d: 0.25, v: 0.05 });
  this.tone({ out, f: 230, f2: 90, d: 0.1, v: 0.26 });
};
S.impact_storm = function (o) {
  const out = this.bus(o.pos, 1, 0.3); if (!out) return;
  this.noise({ out: this.dist(out), type: 'highpass', f: 900, d: 0.1, v: 0.5 });
  this.tone({ out: this.filter('lowpass', 900, 1, out), type: 'sawtooth', f: 95, f2: 40, d: 0.25, v: 0.16 });
  this.tone({ out: this.filter('lowpass', 700, 1, out), type: 'square', f: 60, d: 0.15, v: 0.06 });
};
S.impact_wind = function (o) {
  const out = this.bus(o.pos, 1, 0.25); if (!out) return;
  this.noise({ out, f: 800, f2: 240, q: 1, d: 0.28, v: 0.38 });
  this.tone({ out, f: 180, f2: 70, d: 0.12, v: 0.25 });
};
S.hit_flesh = function (o) {
  const out = this.bus(o.pos, o.v || 1, 0.15); if (!out) return;
  this.tone({ out, f: 190, f2: 50, d: 0.12, v: 0.55 });
  this.noise({ out, f: 700, q: 1, d: 0.07, v: 0.38 });
  this.noise({ out, type: 'highpass', f: 3200, d: 0.02, v: 0.15 });
};
S.hit_armor = function (o) {
  const out = this.bus(o.pos, 1, 0.25); if (!out) return;
  this.tone({ out, f: 160, f2: 70, d: 0.14, v: 0.45 });
  this.tone({ out, type: 'triangle', f: 1240, d: 0.25, v: 0.05 });
  this.tone({ out, type: 'triangle', f: 1870, d: 0.2, v: 0.04 });
  this.noise({ out, f: 2400, q: 3, d: 0.08, v: 0.3 });
};
S.explosion = function (o) {
  const out = this.bus(o.pos, o.v || 1, 0.5); if (!out) return;
  this.tone({ out, f: 115, f2: 28, d: 1.0, v: 0.85 });
  this.noise({ out, type: 'lowpass', f: 3200, f2: 120, d: 1.3, v: 0.75 });
  this.noise({ out, f: 500, q: 0.7, d: 0.6, v: 0.3 });
  this.crackle(out, 12, 0.9, 0.12);
};
S.thunder = function (o) {
  const out = this.bus(o.pos, 1, 0.6); if (!out) return;
  const d = this.dist(out);
  this.noise({ out: d, type: 'highpass', f: 700, d: 0.12, v: 0.8 });
  this.noise({ out: d, type: 'highpass', f: 1100, t: 0.06, d: 0.1, v: 0.55 });
  this.tone({ out, f: 75, f2: 30, d: 0.9, v: 0.55 });
  this.noise({ out, buf: 'brown', type: 'lowpass', f: 280, f2: 80, t: 0.08, a: 0.05, d: 2.4, v: 0.6 });
};
S.ice_spike = function (o) {
  const out = this.bus(o.pos, 0.9, 0.3); if (!out) return;
  this.noise({ out, f: 3500, q: 4, d: 0.07, v: 0.22 });
  this.tone({ out, type: 'triangle', f: 700, f2: 1500, d: 0.07, v: 0.08 });
  this.tone({ out, f: 190, f2: 80, d: 0.09, v: 0.24 });
  this.shards(out, 3, 0.05, 0.1);
};
S.gale = function (o) {
  const out = this.bus(o.pos, 1, 0.4); if (!out) return;
  this.noise({ out, f: 200, f2: 1500, q: 1.2, a: 0.05, d: 0.8, v: 0.65 });
  this.noise({ out, f: 2000, f2: 900, q: 4, a: 0.05, d: 0.6, v: 0.14 });
  this.tone({ out, f: 90, f2: 50, d: 0.4, v: 0.25 });
};
S.steam = function (o) {
  const out = this.bus(o.pos, 1, 0.45); if (!out) return;
  this.noise({ out, type: 'highpass', f: 1800, f2: 4500, a: 0.02, d: 1.3, v: 0.35 });
  this.tone({ out, f: 95, f2: 38, d: 0.45, v: 0.45 });
  this.noise({ out, type: 'lowpass', f: 700, d: 0.3, v: 0.3 });
};
S.shatter = function (o) {
  const out = this.bus(o.pos, 1, 0.5); if (!out) return;
  this.shards(out, 18, 0.28, 0.2);
  this.tone({ out, f: 3200, f2: 2000, d: 0.5, v: 0.08 });
  this.tone({ out, f: 150, f2: 45, d: 0.35, v: 0.55 });
  [88, 91, 95].forEach((m, i) => this.note(out, m, 0.03 + i * 0.03, 0.035, 0.9));
};
S.chain = function (o) {
  const out = this.bus(o.pos, 1, 0.35); if (!out) return;
  const d = this.dist(out);
  for (let i = 0; i < 4; i++) {
    this.noise({ out: d, type: 'highpass', f: 2000, t: i * 0.06, d: 0.05, v: 0.35 });
    this.tone({ out, type: 'square', f: 2400, f2: 300, t: i * 0.06, d: 0.07, v: 0.04 });
  }
  this.tone({ out: this.filter('lowpass', 800, 1, out), type: 'sawtooth', f: 110, f2: 50, d: 0.4, v: 0.14 });
};
S.overload = function (o) {
  S.explosion.call(this, { pos: o.pos, v: 0.8 });
  S.chain.call(this, o);
};
S.melt = function (o) {
  const out = this.bus(o.pos, 1, 0.4); if (!out) return;
  this.noise({ out, type: 'highpass', f: 2500, f2: 5000, d: 0.6, v: 0.3 });
  this.tone({ out, f: 400, f2: 900, d: 0.25, v: 0.08 });
  this.shards(out, 6, 0.1, 0.12);
  this.tone({ out, f: 120, f2: 50, d: 0.25, v: 0.4 });
};
S.freeze = function (o) {
  const out = this.bus(o.pos, 1, 0.45); if (!out) return;
  this.noise({ out, f: 6000, f2: 1500, q: 2, d: 0.35, v: 0.2 });
  this.shards(out, 10, 0.3, 0.12);
  [84, 88, 91].forEach((m, i) => this.note(out, m, i * 0.04, 0.04, 0.7));
};
S.fizzle = function (o) {
  const out = this.bus(o.pos, 1, 0.2); if (!out) return;
  this.noise({ out, type: 'highpass', f: 3000, d: 0.35, v: 0.2 });
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
  const m = { arcane: 81, fire: 76, wind: 79, frost: 84, storm: 83 }[o.el] || 80;
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
