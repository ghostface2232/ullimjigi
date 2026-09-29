// Traversal and world-system sounds: climbing, weather, wildfire, props.
import { randRange as R } from '../util.js';
import { S, L } from './registry.js';

// hands slap onto rock: short knock + gritty scrape
S.climb_grab = function (o) {
  const out = this.bus(o.pos, 0.8, 0.06); if (!out) return;
  this.tone({ out, f: 170, f2: 90, d: 0.05, v: 0.09 });
  this.noise({ out, f: 1700 * R(0.9, 1.15), q: 1.4, d: 0.06, v: 0.07 });
  this.noise({ out, buf: 'pink', type: 'bandpass', f: 900, q: 0.8, t: 0.04, d: 0.12, v: 0.05 });
};
// effortful lunge up the wall: breathy whoosh + push-off grit
S.climb_jump = function (o) {
  const out = this.bus(o.pos, 0.85, 0.08); if (!out) return;
  this.whoosh(out, { f: 500, f2: 1600, q: 1.6, a: 0.02, d: 0.22, v: 0.09 });
  this.noise({ out, f: 2100, q: 1.2, d: 0.05, v: 0.06 });
  this.tone({ out, f: 150, f2: 70, d: 0.07, v: 0.08 });
};
// pull-up over a ledge: two scuffs and a settle
S.climb_mantle = function (o) {
  const out = this.bus(o.pos, 0.8, 0.06); if (!out) return;
  this.noise({ out, f: 1300, q: 1.1, d: 0.07, v: 0.06 });
  this.noise({ out, f: 1900, q: 1.3, t: 0.12, d: 0.06, v: 0.05 });
  this.tone({ out, f: 130, f2: 70, t: 0.22, d: 0.07, v: 0.07 });
};
// losing grip: gravel trickle and a quick downward sweep
S.climb_slip = function (o) {
  const out = this.bus(o.pos, 0.85, 0.1); if (!out) return;
  this.noise({ out, buf: 'pink', type: 'bandpass', f: 2400, f2: 800, q: 1, d: 0.35, v: 0.08 });
  for (let i = 0; i < 4; i++) this.tone({ out, f: R(900, 1600), t: 0.05 + i * 0.06, d: 0.03, v: 0.018 });
};

// ---- weather ----
// steady rain: broadband hiss, patter band that breathes, low roof-drum rumble
L.loop_rain = function (inp) {
  const hiss = this.lbuf(inp, { buf: 'pink', type: 'highpass', f: 2600, q: 0.5, v: 0.28 });
  this.lfo(hiss.fl.frequency, { f: 0.07, depth: 500 });
  const pat = this.lbuf(inp, { buf: 'crackle', type: 'bandpass', f: 3800, q: 0.6, v: 0.22 });
  this.lfo(pat.fl.frequency, { f: 0.13, depth: 900 });
  this.lbuf(inp, { buf: 'brown', type: 'lowpass', f: 320, q: 0.6, v: 0.16 });
  this.lbuf(inp, { buf: 'white', type: 'bandpass', f: 7000, q: 0.8, v: 0.05 });
  return { dop: false };
};
// thunder: crack (close only) then a long rolling rumble with random swells
S.thunder = function (o) {
  const out = this.bus(null, o.v ?? 0.8, 0.9); if (!out) return;
  if (o.near) {
    this.noise({ out, type: 'highpass', f: 1800, d: 0.18, v: 0.5 });
    this.noise({ out, buf: 'crackle', f: 2400, q: 0.5, d: 0.5, v: 0.45 });
  }
  this.noise({ out, buf: 'brown', type: 'lowpass', f: 420, f2: 90, a: 0.05, d: 3.2, v: 0.55 });
  for (let i = 0; i < 5; i++) this.noise({ out, buf: 'brown', type: 'lowpass', f: R(140, 320), t: 0.3 + i * R(0.35, 0.7), a: 0.2, d: R(0.7, 1.4), v: R(0.2, 0.4) });
  this.sub(out, { f: 60, f2: 32, a: 0.05, d: 1.4, v: 0.35 });
};
// staff gathering static before a strike
S.staff_crackle = function (o) {
  const out = this.bus(o.pos, 0.9, 0.2); if (!out) return;
  for (let i = 0; i < 8; i++) this.noise({ out, buf: 'arcs', type: 'highpass', f: 3000, t: i * R(0.1, 0.28), d: 0.05, v: 0.2 });
  this.tone({ out, type: 'sawtooth', f: 90, f2: 180, a: 1.8, d: 0.2, v: 0.02 });
};
// ---- wildfire ----
// dry grass catching: soft whump and a crackle burst
S.fire_catch = function (o) {
  const out = this.bus(o.pos, 0.9, 0.25); if (!out) return;
  this.noise({ out, buf: 'pink', type: 'lowpass', f: 900, a: 0.03, d: 0.35, v: 0.2 });
  this.noise({ out, buf: 'crackle', f: 2600, q: 0.7, t: 0.05, d: 0.6, v: 0.3 });
  this.sub(out, { f: 90, f2: 50, d: 0.25, v: 0.12 });
};
