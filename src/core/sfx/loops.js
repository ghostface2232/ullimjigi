// Continuous sounds for G.audio.loop(name, { pos, v, max }).
// Each recipe wires persistent sources (lbuf / losc, modulated by lfo / wander)
// into `inp`; the engine owns fade, spatialisation, doppler and stopping.
// Return { dop: false } for sounds that should not pitch-shift when moving.
import { randRange as R } from '../util.js';
import { L } from './registry.js';

const life = (o) => (o.max ?? 15) + 1;

// flying fireball: roaring, flickering flame rush
L.loop_fireball = function (inp, o) {
  inp = this.gain(inp, 1.2);
  const dur = life(o);
  const fl = this.gain(inp, 1);
  this.wander(fl.gain, { base: 0.85, depth: 0.22, rate: 24, dur, smooth: 0.35 });
  for (const [f, v] of [[170, 0.4], [360, 0.26], [760, 0.14]]) {
    const b = this.lbuf(fl, { buf: 'pink', f: f * R(0.95, 1.05), q: 3.5, v });
    this.lfo(b.fl.frequency, { f: R(0.3, 0.8), depth: f * 0.08 });
  }
  const rush = this.lbuf(fl, { buf: 'pink', f: 1300, q: 0.8, v: 0.2 });
  this.lfo(rush.fl.frequency, { f: 0.9, depth: 250 });
  this.lbuf(fl, { buf: 'crackle', f: 2600, q: 0.7, v: 0.3 });
  this.lbuf(inp, { buf: 'brown', type: 'lowpass', f: 260, q: 0.7, v: 0.22 });
  return { dop: true };
};

// lingering fire field: campfire-like crackle and a breathing flame body
L.loop_fire = function (inp, o) {
  const dur = life(o);
  this.lbuf(inp, { buf: 'crackle', f: 2200, q: 0.6, v: 0.34 });
  this.lbuf(inp, { buf: 'crackle', type: 'lowpass', f: 900, q: 0.7, v: 0.3, rate: 0.7 });
  const body = this.lbuf(inp, { buf: 'brown', type: 'lowpass', f: 420, q: 0.8, v: 0.2 });
  this.wander(body.g.gain, { base: 0.2, depth: 0.08, rate: 6, dur });
  const flame = this.lbuf(inp, { buf: 'pink', f: 600, q: 1.2, v: 0.1 });
  this.wander(flame.g.gain, { base: 0.1, depth: 0.05, rate: 10, dur });
  this.lbuf(inp, { buf: 'fizz', type: 'highpass', f: 5000, q: 0.7, v: 0.035 });
  return { dop: false };
};

// arcane beam channel: chorused hum with a tremolo shimmer of upper partials
L.loop_beam = function (inp) {
  inp = this.gain(inp, 0.5);
  const lp = this.filter('lowpass', 1400, 2, inp);
  this.lfo(lp.frequency, { f: 3.1, depth: 300 });
  this.losc(lp, { type: 'sawtooth', f: 110, v: 0.07 });
  this.losc(lp, { type: 'sawtooth', f: 110.7, v: 0.06 });
  this.losc(lp, { type: 'sawtooth', f: 55.2, v: 0.05 });
  const sh = this.gain(inp, 1);
  this.lfo(sh.gain, { f: 7, depth: 0.4 });
  for (const [f, v] of [[880, 0.025], [1320.5, 0.014], [1761.5, 0.009], [2643, 0.005]]) this.losc(sh, { f, v });
  this.lbuf(inp, { buf: 'tinkle', type: 'highpass', f: 3000, q: 0.7, v: 0.16 });
  const air = this.lbuf(inp, { buf: 'white', f: 2600, q: 2, v: 0.07 });
  this.lfo(air.fl.frequency, { f: 0.8, depth: 600 });
  this.losc(inp, { f: 55, v: 0.1 });
  return { dop: false };
};

// swirling wind vortex (fire/wind tornado, wind ultimate)
L.loop_tornado = function (inp, o) {
  inp = this.gain(inp, 0.7);
  const dur = life(o);
  const pan = this.pan(inp, 0);
  this.lfo(pan.pan, { f: 0.6, depth: 0.5 });
  const a = this.lbuf(pan, { buf: 'pink', f: 700, q: 2, v: 0.42 });
  this.lfo(a.fl.frequency, { f: 0.7, depth: 450 });
  const b = this.lbuf(inp, { buf: 'white', f: 2800, q: 1.5, v: 0.08 });
  this.lfo(b.fl.frequency, { f: 1.13, depth: 900 });
  const lo = this.lbuf(inp, { buf: 'brown', type: 'lowpass', f: 300, q: 0.7, v: 0.3 });
  this.wander(lo.g.gain, { base: 0.3, depth: 0.1, rate: 3, dur });
  const w = this.losc(pan, { f: 720, v: 0.012 });
  this.lfo(w.osc.frequency, { f: 0.7, depth: 120 });
  return { dop: true };
};

// churning water vortex
L.loop_whirlpool = function (inp, o) {
  inp = this.gain(inp, 0.45);
  const dur = life(o);
  this.lbuf(inp, { buf: 'bubbles', f: 900, q: 0.5, v: 0.4 });
  this.lbuf(inp, { buf: 'bubbles', type: 'lowpass', f: 900, q: 0.7, v: 0.32, rate: 0.6 });
  const ch = this.lbuf(inp, { buf: 'brown', type: 'lowpass', f: 500, q: 1.2, v: 0.32 });
  this.lfo(ch.fl.frequency, { f: 0.5, depth: 200 });
  const sw = this.lbuf(inp, { buf: 'pink', f: 1400, q: 1, v: 0.16 });
  this.lfo(sw.fl.frequency, { f: 0.5, depth: 500 });
  this.wander(sw.g.gain, { base: 0.16, depth: 0.06, rate: 4, dur });
  return { dop: false };
};

// icy howling wind with tinkling ice
L.loop_blizzard = function (inp, o) {
  inp = this.gain(inp, 0.55);
  const dur = life(o);
  const h1 = this.lbuf(inp, { buf: 'pink', f: 520, q: 8, v: 0.5 });
  this.wander(h1.fl.frequency, { base: 520, depth: 130, rate: 2, dur, smooth: 0.8 });
  const h2 = this.lbuf(inp, { buf: 'pink', f: 780, q: 8, v: 0.34 });
  this.wander(h2.fl.frequency, { base: 780, depth: 170, rate: 2, dur, smooth: 0.8 });
  const hs = this.lbuf(inp, { buf: 'white', type: 'highpass', f: 4000, q: 0.7, v: 0.05 });
  this.wander(hs.g.gain, { base: 0.05, depth: 0.025, rate: 4, dur });
  this.lbuf(inp, { buf: 'tinkle', type: 'highpass', f: 2500, q: 0.7, v: 0.15 });
  const lo = this.lbuf(inp, { buf: 'brown', type: 'lowpass', f: 400, q: 0.7, v: 0.25 });
  this.wander(lo.g.gain, { base: 0.25, depth: 0.1, rate: 2, dur });
  return { dop: false };
};

// crackling electric cloud / plasma buzz
L.loop_storm = function (inp, o) {
  inp = this.gain(inp, 0.5);
  const dur = life(o);
  const out = this.gain(inp, 0.5);
  const bp = this.filter('bandpass', 900, 1, out);
  const chop = this.gain(bp, 0.55);
  const sh = this.ctx.createWaveShaper(); sh.curve = this.distCurve; sh.connect(chop);
  this.losc(sh, { type: 'sawtooth', f: 55, v: 0.5 });
  this.losc(sh, { type: 'sawtooth', f: 82.6, v: 0.35 });
  this.lfo(chop.gain, { f: 13, depth: 0.3, type: 'square' });
  this.lfo(chop.gain, { f: 21.7, depth: 0.2 });
  this.lbuf(inp, { buf: 'arcs', type: 'highpass', f: 2000, q: 0.7, v: 0.36 });
  this.lbuf(inp, { buf: 'fizz', type: 'highpass', f: 4000, q: 0.7, v: 0.07 });
  const rum = this.lbuf(inp, { buf: 'brown', type: 'lowpass', f: 160, q: 0.8, v: 0.3 });
  this.wander(rum.g.gain, { base: 0.3, depth: 0.2, rate: 1.5, dur, smooth: 0.7 });
  return { dop: false };
};

// rushing water wall moving forward
L.loop_wave = function (inp, o) {
  inp = this.gain(inp, 0.45);
  const dur = life(o);
  const surge = this.gain(inp, 1);
  this.wander(surge.gain, { base: 1, depth: 0.25, rate: 3, dur, smooth: 0.7 });
  this.lbuf(surge, { buf: 'pink', type: 'lowpass', f: 1800, q: 0.7, v: 0.26 });
  this.lbuf(surge, { buf: 'pink', f: 500, q: 0.7, v: 0.24 });
  this.lbuf(surge, { buf: 'white', type: 'highpass', f: 3500, q: 0.7, v: 0.04 });
  this.lbuf(surge, { buf: 'bubbles', f: 1200, q: 0.5, v: 0.4 });
  this.lbuf(inp, { buf: 'brown', type: 'lowpass', f: 220, q: 0.8, v: 0.32 });
  return { dop: true };
};
