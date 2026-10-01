// Procedural audio engine: every SFX is synthesized with WebAudio.
// Layers: transient (click/crack), body (tone/boom), tail (noise/reverb).
//
// Signal flow:
//   sound -> bus (distance gain, air-absorption lowpass, pan) -> sfx -> master
//         \-> hall send (revIn, long valley reverb)  \-> room send (revNear, short early reflections)
//   master -> tint (slow-motion muffle) -> compressor -> limiter -> soft clip -> out
//
// Heavy multi-layer sounds are "baked": their recipes (B[name]) are rendered a few
// times with OfflineAudioContext right after init and then played back as buffers
// with small pitch/tone variation. Until a bake is ready the same recipe runs live.
// The sound library lives in ./sfx/ (registry, textures, spells, combat, ui, loops, legacy).
import { G } from './context.js';
import { clamp, randRange } from './util.js';
import { S, B, L, PRIO, varyFor } from './sfx/registry.js';
import { makeTextures, makeIR, softClipCurve } from './sfx/textures.js';
import './sfx/legacy.js';
import './sfx/spells.js';
import './sfx/combat.js';
import './sfx/ui.js';
import './sfx/loops.js';
import './sfx/world.js';

// Voice budget: approximate count of live source nodes. Low-priority sounds
// are dropped first when a fight gets busy; priority 2 always plays.
const VOICE_MAX = 220;
const NOOP = () => {};
const DUMMY_LOOP = Object.freeze({ playing: false, set: NOOP, vol: NOOP, stop: NOOP });

export class AudioEngine {
  constructor() {
    this.ready = false;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.last = {};
    this.amb = { birdT: 2, cricketT: 1, waterT: 1 };
    this.voices = 0;
    this.active = [];
    this._pr = 1; this._nodes = 0; this._end = 0;
    this.bakes = {};          // name -> AudioBuffer[]
    this.bakeDone = false;
    this._lastVar = {};
    this.loops = new Set();
    this._loopN = 0;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.22;
    // brick-wall-ish limiter + soft clip so stacked explosions never hard-clip
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20;
    lim.attack.value = 0.001; lim.release.value = 0.12;
    const clip = ctx.createWaveShaper(); clip.curve = softClipCurve(); clip.oversample = '2x';
    this.master = ctx.createGain();
    // master tone filter: muffles everything during slow motion ("울림 가속")
    this.tint = ctx.createBiquadFilter(); this.tint.type = 'lowpass'; this.tint.frequency.value = 20000; this.tint.Q.value = 0.6;
    this.master.connect(this.tint); this.tint.connect(comp); comp.connect(lim); lim.connect(clip); clip.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.connect(this.master);
    this.ambBus = ctx.createGain(); this.ambBus.connect(this.master);
    // Reverb: long "valley/hall" (revIn, also used by the music) + short "room/near"
    this.conv = ctx.createConvolver();
    this.conv.buffer = makeIR(ctx, { len: 2.9, pre: 0.024, rt: [3.2, 2.5, 1.05], er: 12, erSpan: 0.1, erGain: 0.55, fade: 0.06 });
    this.revIn = ctx.createGain(); this.revIn.gain.value = 1;
    this.revOut = ctx.createGain(); this.revOut.gain.value = 0.55;
    this.revIn.connect(this.conv); this.conv.connect(this.revOut); this.revOut.connect(this.master);
    this.nearConv = ctx.createConvolver();
    this.nearConv.buffer = makeIR(ctx, { len: 0.75, pre: 0.005, rt: [0.6, 0.48, 0.24], bands: [1, 0.8, 0.45], er: 16, erSpan: 0.03, erGain: 0.9, fade: 0.008 });
    this.revNear = ctx.createGain(); this.revNear.gain.value = 1;
    this.nearOut = ctx.createGain(); this.nearOut.gain.value = 0.4;
    this.revNear.connect(this.nearConv); this.nearConv.connect(this.nearOut); this.nearOut.connect(this.master);
    // Noise + texture buffers
    this.buf = { white: this._noise('white'), pink: this._noise('pink'), brown: this._noise('brown'), ...makeTextures(ctx) };
    this.distCurve = this._distCurve(40);
    this.applyVolumes();
    this._startAmbience();
    this.ready = true;
    this.bakePromise = this._bakeAll();
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
  // odd length so input 0 maps exactly to 0 (an even curve leaves a DC offset that never decays)
  _distCurve(k) {
    const n = 1025, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i * 2) / (n - 1) - 1; c[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x)); }
    return c;
  }

  setListener(pos, yaw) {
    this.listener.x = pos.x; this.listener.y = pos.y; this.listener.z = pos.z; this.listener.yaw = yaw;
  }

  // ---------- spatial ----------
  // gain / pan / reverb / air-absorption for a world position (null = 2D, centred)
  _spat(pos, vol, rev) {
    let gain = vol, pan = 0, lp = 22000, d = 0;
    if (pos) {
      const L = this.listener;
      const dx = pos.x - L.x, dy = (pos.y || 0) - L.y, dz = pos.z - L.z;
      d = Math.hypot(dx, dy, dz);
      if (d > 110) return null;
      gain *= 1 / (1 + Math.max(0, d - 4) * 0.075);
      const sn = Math.sin(L.yaw), cs = Math.cos(L.yaw), id = 1 / Math.max(d, 1);
      pan = clamp((dx * cs - dz * sn) * id, -1, 1) * 0.85;
      const front = (-dx * sn - dz * cs) * id;
      rev = rev + Math.min(0.35, d * 0.006);
      // air absorption: highs fade with distance; sounds behind are slightly darker
      if (d > 8) lp = Math.max(1500, 20000 * Math.pow(0.5, (d - 8) / 24));
      if (front < 0 && d > 3) lp = Math.min(lp, 20000 * (1 + front * 0.5));
    }
    return { gain, pan, rev, lp, d };
  }
  bus(pos, vol = 1, rev = 0.2, dest, near) {
    const sp = this._spat(pos, vol, rev);
    if (!sp || sp.gain < 0.004) return null;
    const c = this.ctx;
    const g = c.createGain(); g.gain.value = sp.gain;
    let tail = g;
    if (sp.lp < 18000) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = sp.lp; f.Q.value = 0.5; g.connect(f); tail = f; }
    const p = c.createStereoPanner(); p.pan.value = sp.pan;
    tail.connect(p); p.connect(dest || this.sfx);
    if (sp.rev > 0) { const s = c.createGain(); s.gain.value = sp.rev; tail.connect(s); s.connect(this.revIn); }
    const nr = (near ?? (pos ? 0.2 : 0.05)) * clamp(1.15 - sp.d / 50, 0.25, 1);
    if (nr > 0.01) { const s = c.createGain(); s.gain.value = nr; tail.connect(s); s.connect(this.revNear); }
    return g;
  }

  // ---------- building blocks ----------
  now() { return this.ctx.currentTime; }
  filter(type, f, q, out) {
    const fl = this.ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; fl.connect(out); return fl;
  }
  dist(out) { const w = this.ctx.createWaveShaper(); w.curve = this.distCurve; w.oversample = '2x'; w.connect(out); return w; }
  pan(out, p) { const n = this.ctx.createStereoPanner(); n.pan.value = p; n.connect(out); return n; }
  gain(out, v) { const g = this.ctx.createGain(); g.gain.value = v; g.connect(out); return g; }
  delay(out, sec) { const d = this.ctx.createDelay(1); d.delayTime.value = sec; d.connect(out); return d; }
  env(g, t0, a, v, d) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(v, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }
  _mark(t0, len, n = 1) { this._nodes += n; if (t0 + len > this._end) this._end = t0 + len; }
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
    this._mark(t0, a + d);
    if (detune) o.detune.value = detune;
    const g = c.createGain(); this.env(g, t0, a, v, d);
    o.connect(g); g.connect(out);
    o.start(t0); o.stop(t0 + a + d + 0.05);
    return o;
  }
  // filtered buffer layer; `buf` may be white/pink/brown or a texture (crackle, fizz, bubbles, tinkle, arcs)
  noise({ t = 0, a = 0.004, d = 0.3, v = 0.3, out, type = 'bandpass', f = 1000, f2 = 0, q = 1, buf = 'white', rate = 1 }) {
    if (!out) return;
    const c = this.ctx, t0 = c.currentTime + t;
    const pr = this._pr;
    const b = this.buf[buf] || this.buf.white;
    const src = c.createBufferSource(); src.buffer = b; src.loop = true; src.playbackRate.value = rate * (0.5 + 0.5 * pr);
    const fl = c.createBiquadFilter(); fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(Math.min(20000, f * pr), t0);
    if (f2) fl.frequency.exponentialRampToValueAtTime(Math.min(20000, Math.max(20, f2 * pr)), t0 + a + d);
    this._mark(t0, a + d);
    const g = c.createGain(); this.env(g, t0, a, v, d);
    src.connect(fl); fl.connect(g); g.connect(out);
    src.start(t0, Math.random() * Math.max(0.1, b.duration - 0.5)); src.stop(t0 + a + d + 0.05);
    return src;
  }
  crackle(out, n, span, v = 0.1, f = 2500) {
    for (let i = 0; i < n; i++) this.noise({ out, t: Math.random() * span, d: 0.008 + Math.random() * 0.02, v: v * randRange(0.4, 1), type: 'highpass', f: f * randRange(0.7, 1.6), q: 0.7 });
  }
  shards(out, n, span, v = 0.15) {
    for (let i = 0; i < n; i++) this.noise({ out, t: Math.random() * span, d: randRange(0.025, 0.09), v: v * randRange(0.5, 1), type: 'bandpass', f: randRange(2500, 8500), q: 9 });
  }
  note(out, m, t, v = 0.06, d = 1.2, kind = 'celesta') {
    const f = 440 * Math.pow(2, (m - 69) / 12);
    if (kind === 'celesta') {
      this.tone({ out, f, t, a: 0.003, d, v });
      this.tone({ out, f: f * 4, t, a: 0.002, d: d * 0.35, v: v * 0.25 });
      this.tone({ out, f: f * 2, t, a: 0.002, d: d * 0.6, v: v * 0.2, type: 'triangle' });
    } else if (kind === 'bell') {
      this.fm({ out, f, t, ratio: 3.5, idx: 1.6, dm: d * 0.25, d, v });
      this.tone({ out, f: f * 2, t, a: 0.002, d: d * 0.5, v: v * 0.25 });
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
  // pure sine sub drop (no harmonic)
  sub(out, { f = 70, f2 = 30, t = 0, a = 0.003, d = 0.6, v = 0.4 } = {}) { this.tone({ out, f, f2, t, a, d, v }); }
  whoosh(out, { f = 350, f2 = 1600, t = 0, a = 0.04, d = 0.3, v = 0.3, q = 1.2, buf = 'pink' } = {}) { this.noise({ out, f, f2, q, t, a, d, v, buf }); }
  // reverse swell: long attack, abrupt release (anticipation)
  swell(out, { f = 500, f2 = 5000, t = 0, d = 0.35, v = 0.25, q = 0.8, buf = 'pink', type = 'bandpass', r = 0.04 } = {}) { this.noise({ out, type, f, f2, q, t, a: d, d: r, v, buf }); }
  // noise tail for air / reverb body
  tail(out, { f = 2400, f2 = 600, t = 0, d = 0.6, v = 0.12, type = 'lowpass', buf = 'pink' } = {}) { this.noise({ out, type, f, f2, t, a: 0.01, d, v, buf }); }
  chord(out, notes, t = 0, v = 0.04, d = 1, stagger = 0.03, kind = 'celesta') { notes.forEach((m, i) => this.note(out, m, t + i * stagger, v, d, kind)); }

  // FM bell / glass: modulation index decays fast, leaving a purer tone (bright attack, soft ring)
  fm({ out, f = 880, ratio = 3.5, idx = 2, dm = 0.08, t = 0, a = 0.002, d = 0.6, v = 0.1, f2 = 0 }) {
    if (!out) return;
    const c = this.ctx, t0 = c.currentTime + t, pr = this._pr;
    const car = c.createOscillator(), mod = c.createOscillator();
    car.frequency.setValueAtTime(f * pr, t0); mod.frequency.setValueAtTime(f * ratio * pr, t0);
    if (f2) { car.frequency.exponentialRampToValueAtTime(f2 * pr, t0 + a + d); mod.frequency.exponentialRampToValueAtTime(f2 * ratio * pr, t0 + a + d); }
    const dev = idx * f * ratio * pr;
    const mg = c.createGain();
    mg.gain.setValueAtTime(dev, t0); mg.gain.exponentialRampToValueAtTime(Math.max(0.5, dev * 0.03), t0 + Math.max(0.005, dm));
    const g = c.createGain(); this.env(g, t0, a, v, d);
    mod.connect(mg); mg.connect(car.frequency); car.connect(g); g.connect(out);
    car.start(t0); mod.start(t0); car.stop(t0 + a + d + 0.05); mod.stop(t0 + a + d + 0.05);
    this._mark(t0, a + d, 2);
  }
  // modal glass / crystal: inharmonic partials, higher ones die faster, beating twins shimmer
  glass(out, f, { t = 0, v = 0.05, d = 1, kind = 'bar', bright = 1, beat = 0.7, a = 0.002 } = {}) {
    const R = kind === 'bowl' ? [1, 2.32, 4.25, 6.63] : kind === 'bell' ? [0.5, 1, 1.19, 1.5, 2, 2.52] : [1, 2.756, 5.404, 8.933];
    const A = kind === 'bell' ? [0.4, 1, 0.5, 0.4, 0.35, 0.2] : [1, 0.42 * bright, 0.22 * bright, 0.1 * bright];
    const lim = (this.ctx.sampleRate || 48000) * 0.45;
    R.forEach((r, i) => {
      const ff = f * r; if (ff * this._pr > lim) return;
      const dd = d / (1 + i * 0.85);
      this.tone({ out, f: ff, t, a, d: dd, v: v * A[i] });
      if (i < 2 && beat) this.tone({ out, f: ff + beat * (i + 1), t, a: a + 0.004, d: dd * 0.9, v: v * A[i] * 0.45 });
    });
  }
  // water drop / bubble: sine with a fast exponential upward sweep
  drop(out, { f = 900, rise = 2, t = 0, d = 0.05, v = 0.08 } = {}) { this.tone({ out, f, f2: f * rise, t, a: 0.0015, d, v }); }
  // electrical buzz: saw/square chopped by irregular AM, driven into a waveshaper, band-limited
  buzz(out, { f = 110, f2 = 0, t = 0, a = 0.005, d = 0.3, v = 0.1, am = 45, fc = 1600, q = 1.2, type = 'sawtooth' } = {}) {
    if (!out) return;
    const c = this.ctx, t0 = c.currentTime + t, pr = this._pr, end = t0 + a + d + 0.05;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f * pr, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(1, f2 * pr), t0 + a + d);
    const chop = c.createGain(); chop.gain.value = 0.55;
    const l1 = c.createOscillator(); l1.type = 'square'; l1.frequency.value = am * randRange(0.8, 1.25);
    const l2 = c.createOscillator(); l2.type = 'sine'; l2.frequency.value = am * randRange(1.5, 1.75);
    const lg1 = c.createGain(); lg1.gain.value = 0.3; const lg2 = c.createGain(); lg2.gain.value = 0.25;
    l1.connect(lg1); lg1.connect(chop.gain); l2.connect(lg2); lg2.connect(chop.gain);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fc * pr; bp.Q.value = q;
    const g = c.createGain(); this.env(g, t0, a, v, d);
    o.connect(chop); chop.connect(this.dist(bp)); bp.connect(g); g.connect(out);
    for (const n of [o, l1, l2]) { n.start(t0); n.stop(end); }
    this._mark(t0, a + d, 3);
  }
  // resonant multi-band noise (roar / flame growl / howl)
  roar(out, { f = 200, f2 = 0, t = 0, a = 0.02, d = 0.5, v = 0.3, q = 3.5, buf = 'pink', ratios = [1, 2.13, 3.4], amps = [1, 0.6, 0.35], flick = 0 } = {}) {
    if (!out) return;
    const c = this.ctx, t0 = c.currentTime + t, pr = this._pr;
    const b = this.buf[buf];
    const src = c.createBufferSource(); src.buffer = b; src.loop = true;
    const g = c.createGain(); this.env(g, t0, a, v, d);
    let dst = g;
    if (flick) { const fg = c.createGain(); this.flicker(fg.gain, t0, a + d, { rate: 22, depth: flick }); fg.connect(g); dst = fg; }
    ratios.forEach((r, i) => {
      const fl = c.createBiquadFilter(); fl.type = 'bandpass'; fl.Q.value = q;
      fl.frequency.setValueAtTime(f * r * pr, t0);
      if (f2) fl.frequency.exponentialRampToValueAtTime(f2 * r * pr, t0 + a + d);
      const ag = c.createGain(); ag.gain.value = amps[i] * Math.sqrt(q);
      src.connect(fl); fl.connect(ag); ag.connect(dst);
    });
    g.connect(out);
    src.start(t0, Math.random() * 1.5); src.stop(t0 + a + d + 0.05);
    this._mark(t0, a + d, 1 + ratios.length);
  }
  // random smooth amplitude flicker on a (dedicated) AudioParam
  flicker(param, t0, dur, { rate = 16, depth = 0.5, base = 1 } = {}) {
    const n = Math.max(3, Math.ceil(dur * rate)), curve = new Float32Array(n);
    let s = Math.random();
    for (let i = 0; i < n; i++) { s = s * 0.45 + Math.random() * 0.55; curve[i] = base * (1 - depth + depth * s * 1.6); }
    try { param.setValueCurveAtTime(curve, t0, Math.max(0.02, dur)); } catch (e) { /* overlapping automation: skip */ }
  }
  // decorrelated stereo: run fn(out) once per side (pans ±w); `dl` delays the right side slightly
  wide(out, fn, w = 0.65, dl = 0) {
    fn(this.pan(out, -w), 0);
    fn(this.pan(dl ? this.delay(out, dl) : out, w), 1);
  }

  // ---------- baked sounds ----------
  // Plays a baked recipe into `out` (random variation, never the same one twice
  // in a row); synthesizes it live while bakes are still rendering.
  baked(name, out, o = {}) {
    const spec = B[name];
    if (!spec || !out) return;
    const arr = this.bakes[name];
    if (!arr) { spec.fn.call(this, o.v != null && o.v !== 1 ? this.gain(out, o.v) : out, Math.floor(Math.random() * spec.n), o); return; }
    let i = Math.floor(Math.random() * arr.length);
    if (arr.length > 1 && i === this._lastVar[name]) i = (i + 1) % arr.length;
    this._lastVar[name] = i;
    const c = this.ctx, t0 = c.currentTime + (o.t || 0), buf = arr[i];
    const s = c.createBufferSource(); s.buffer = buf;
    const rate = this._pr * (1 + (Math.random() - 0.5) * 0.012);
    s.playbackRate.value = rate;
    let dst = out;
    if (o.v != null && o.v !== 1) dst = this.gain(dst, o.v);
    if (o.tilt !== false) {
      const f = c.createBiquadFilter(); f.type = 'highshelf'; f.frequency.value = 2800; f.gain.value = randRange(-2.5, 1.5);
      f.connect(dst); dst = f;
    }
    s.connect(dst); s.start(t0);
    this._mark(t0, buf.duration / rate, 2);
  }
  // Render one variation of a recipe offline. Graph building swaps `this.ctx`
  // synchronously (no await in between), so realtime sounds are never affected.
  // spec.lo renders at 32 kHz (bass-heavy long sounds: a third of the memory, 16 kHz bandwidth)
  renderBake(spec, i = 0) {
    const sr = spec.lo ? Math.min(32000, this.ctx.sampleRate) : this.ctx.sampleRate;
    const off = new OfflineAudioContext(spec.stereo ? 2 : 1, Math.ceil(sr * spec.dur), sr);
    const save = [this.ctx, this._pr, this._nodes, this._end];
    this.ctx = off; this._pr = 1;
    try {
      const out = off.createGain(); out.connect(off.destination);
      spec.fn.call(this, out, i, {});
    } finally { [this.ctx, this._pr, this._nodes, this._end] = save; }
    return off.startRendering().then((b) => this._trim(b));
  }
  // trim trailing silence (saves memory), fade the end, keep peaks under 0.95
  _trim(b) {
    const chs = []; let last = 0, peak = 0;
    for (let ch = 0; ch < b.numberOfChannels; ch++) {
      const d = b.getChannelData(ch); chs.push(d);
      for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; if (a > 0.0004) last = Math.max(last, i); }
    }
    const sr = b.sampleRate, len = Math.min(b.length, last + Math.floor(sr * 0.02) + 1), fade = Math.min(len, Math.floor(sr * 0.03));
    const k = peak > 0.95 ? 0.95 / peak : 1;
    const nb = new AudioBuffer({ numberOfChannels: b.numberOfChannels, length: len, sampleRate: sr });
    chs.forEach((d, ch) => {
      const o = nb.getChannelData(ch);
      for (let i = 0; i < len; i++) o[i] = d[i] * k;
      for (let i = 0; i < fade; i++) o[len - 1 - i] *= i / fade;
    });
    return nb;
  }
  async _bakeAll() {
    if (typeof OfflineAudioContext === 'undefined') return;
    const t0 = performance.now();
    const names = Object.keys(B).sort((a, b) => (B[a].order ?? 5) - (B[b].order ?? 5));
    // Offline rendering runs off the main thread, so several sounds render at once.
    // Graph building is the only main-thread work: it runs in ~6 ms slices, then yields.
    const all = [];
    let inflight = 0, wake = null, slice = performance.now();
    for (const name of names) {
      while (inflight >= 6) await new Promise((r) => (wake = r));
      const spec = B[name], jobs = [];
      try { for (let i = 0; i < spec.n; i++) jobs.push(this.renderBake(spec, i)); } catch (e) { jobs.push(Promise.reject(e)); }
      inflight++;
      all.push(Promise.all(jobs)
        .then((arr) => { this.bakes[name] = arr; }, (e) => console.warn('bake', name, e))
        .finally(() => { inflight--; const w = wake; wake = null; if (w) w(); }));
      if (performance.now() - slice > 6) { await new Promise((r) => setTimeout(r, 0)); slice = performance.now(); }
    }
    await Promise.all(all);
    this.bakeDone = true;
    this.bakeStats = { ms: Math.round(performance.now() - t0), sounds: Object.keys(this.bakes).length, mb: +(this._bakeBytes() / 1048576).toFixed(1) };
  }
  _bakeBytes() { let n = 0; for (const k in this.bakes) for (const b of this.bakes[k]) n += b.length * b.numberOfChannels * 4; return n; }

  // ---------- public ----------
  play(name, o = {}) {
    if (!this.ready || this.ctx.state !== 'running') return;
    const fn = S[name];
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
    let n = this._loopN;
    for (let i = this.active.length - 1; i >= 0; i--) { const a = this.active[i]; if (a.end < now) this.active.splice(i, 1); else n += a.n; }
    return n;
  }

  // ---------- continuous sounds ----------
  // G.audio.loop(name, { pos, v, max = 15, rev, fadeIn }) -> handle { set(pos), vol(v), stop(fade = 0.3), playing }
  // The handle follows a moving world position (pan, distance, air absorption and a
  // little doppler). It stops itself after `max` seconds as a safety net.
  loop(name, o = {}) {
    const fn = L[name];
    if (!this.ready || !fn || this.ctx.state !== 'running') return DUMMY_LOOP;
    const c = this.ctx, now = c.currentTime;
    const fade = c.createGain(), sg = c.createGain(), lp = c.createBiquadFilter(), pn = c.createStereoPanner();
    const rs = c.createGain(), ns = c.createGain();
    lp.type = 'lowpass'; lp.Q.value = 0.5; lp.frequency.value = 20000;
    fade.connect(sg); sg.connect(lp); lp.connect(pn); pn.connect(this.sfx);
    lp.connect(rs); rs.connect(this.revIn); lp.connect(ns); ns.connect(this.revNear);
    const inp = c.createGain(); inp.connect(fade);
    const vol0 = o.v ?? 1, fadeIn = o.fadeIn ?? 0.12, rev = o.rev ?? 0.25;
    fade.gain.setValueAtTime(0, now); fade.gain.linearRampToValueAtTime(vol0, now + fadeIn);
    this._lsrc = []; this._pr = 1;
    let info = {};
    try { info = fn.call(this, inp, o) || {}; } catch (e) { console.warn('loop', name, e); }
    const srcs = this._lsrc; this._lsrc = null;
    const h = { playing: true, name, d: null, t: now, dop: 1 };
    const place = (pos, snap) => {
      const sp = pos ? this._spat(pos, 1, rev) : { gain: 1, pan: 0, rev, lp: 22000, d: 0 };
      const T = c.currentTime, tc = snap ? 0.005 : 0.06;
      if (!sp) { sg.gain.setTargetAtTime(0, T, tc); return; }
      sg.gain.setTargetAtTime(sp.gain, T, tc);
      pn.pan.setTargetAtTime(sp.pan, T, tc);
      lp.frequency.setTargetAtTime(Math.min(20000, sp.lp), T, tc);
      rs.gain.setTargetAtTime(sp.rev, T, tc);
      ns.gain.setTargetAtTime(0.2 * clamp(1.15 - sp.d / 50, 0.25, 1), T, tc);
      // doppler-ish pitch from the radial speed (exaggerated a little, clamped)
      if (pos && info.dop !== false && h.d != null && T - h.t > 0.01) {
        const vr = (sp.d - h.d) / (T - h.t);
        const tgt = clamp(1 - vr / 110, 0.86, 1.14);
        h.dop += (tgt - h.dop) * 0.35;
        const cents = 1200 * Math.log2(h.dop);
        for (const s of srcs) if (s.dop && s.node.detune) s.node.detune.setTargetAtTime(cents, T, 0.05);
      }
      if (pos) { h.d = sp.d; h.t = T; }
    };
    place(o.pos, true);
    this._loopN += srcs.length;
    this.loops.add(h);
    let timer = 0;
    h.set = (pos) => { if (h.playing && pos) place(pos, false); };
    h.vol = (v) => { if (h.playing) fade.gain.setTargetAtTime(Math.max(0, v), c.currentTime, 0.08); };
    h.stop = (f = 0.3) => {
      if (!h.playing) return;
      h.playing = false; clearTimeout(timer);
      this.loops.delete(h); this._loopN -= srcs.length;
      const T = c.currentTime, fd = Math.max(0.01, f);
      const g = fade.gain;
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(T); else { g.cancelScheduledValues(T); g.setValueAtTime(g.value, T); }
      g.linearRampToValueAtTime(0, T + fd);
      for (const s of srcs) { try { s.node.stop(T + fd + 0.05); } catch (e) { /* already stopped */ } }
      setTimeout(() => { try { inp.disconnect(); fade.disconnect(); lp.disconnect(); pn.disconnect(); } catch (e) { /* ignore */ } }, (fd + 0.3) * 1000);
    };
    timer = setTimeout(() => h.stop(0.5), (o.max ?? 15) * 1000);
    return h;
  }
  stopLoops(f = 0.3) { for (const h of [...this.loops]) h.stop(f); }
  // loop building blocks (persistent sources, stopped by the handle)
  _reg(node, dop = true) { if (this._lsrc) this._lsrc.push({ node, dop }); node.start(this.ctx.currentTime, 0); return node; }
  lbuf(out, { buf = 'pink', type = 'bandpass', f = 1000, q = 1, v = 0.2, rate = 1 } = {}) {
    const c = this.ctx, b = this.buf[buf];
    const src = c.createBufferSource(); src.buffer = b; src.loop = true; src.playbackRate.value = rate;
    src.loopStart = 0; src.loopEnd = b.duration;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = c.createGain(); g.gain.value = v;
    src.connect(fl); fl.connect(g); g.connect(out);
    if (this._lsrc) this._lsrc.push({ node: src, dop: true });
    src.start(c.currentTime, Math.random() * (b.duration - 0.1));
    return { src, fl, g };
  }
  losc(out, { type = 'sine', f = 440, v = 0.1 } = {}) {
    const c = this.ctx, o = c.createOscillator(); o.type = type; o.frequency.value = f;
    const g = c.createGain(); g.gain.value = v; o.connect(g); g.connect(out);
    this._reg(o, true);
    return { osc: o, g };
  }
  // sine/other LFO added onto an AudioParam
  lfo(param, { f = 1, depth = 1, type = 'sine' } = {}) {
    const c = this.ctx, o = c.createOscillator(); o.type = type; o.frequency.value = f;
    const g = c.createGain(); g.gain.value = depth; o.connect(g); g.connect(param);
    this._reg(o, false);
    return o;
  }
  // slow random wandering of a param for `dur` seconds (value curve, param must be otherwise idle)
  wander(param, { base = 1, depth = 0.5, rate = 8, dur = 16, smooth = 0.5 } = {}) {
    const n = Math.max(3, Math.ceil(dur * rate)), curve = new Float32Array(n);
    let s = 0;
    for (let i = 0; i < n; i++) { s = s * smooth + (Math.random() * 2 - 1) * (1 - smooth); curve[i] = base + depth * s * 2; }
    try { param.setValueCurveAtTime(curve, this.ctx.currentTime, dur); } catch (e) { param.value = base; }
  }

  // Dialogue voice blip (each character has a voice signature)
  blip(voice) {
    if (!this.ready) return;
    const out = this.bus(null, 1, 0.08, null, 0); if (!out) return;
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
      // birds come back to the vale bell by bell (info.bells: 0..4)
      this.amb.birdT = randRange(1.5, 6) * [4, 2.4, 1.6, 1.2, 1][info.bells ?? 4];
      this._bird();
    }
    this.amb.cricketT -= dt;
    if (!day && this.amb.cricketT <= 0) {
      this.amb.cricketT = randRange(0.5, 1.4);
      const out = this.bus(null, 0.6, 0.3, null, 0);
      const f = randRange(4200, 4800);
      for (let i = 0; i < 3; i++) this.tone({ out, f, t: i * 0.055, a: 0.004, d: 0.03, v: 0.012 });
    }
  }
  _bird() {
    const L = this.listener;
    const pos = { x: L.x + randRange(-30, 30), y: L.y + 8, z: L.z + randRange(-30, 30) };
    const out = this.bus(pos, 0.5, 0.35, null, 0.05); if (!out) return;
    const base = randRange(2600, 4200), n = 2 + Math.floor(Math.random() * 4);
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

// library access for tools/tests (S is also reachable as engine.S like before)
AudioEngine.prototype.S = S;
AudioEngine.prototype.B = B;
AudioEngine.prototype.L = L;
