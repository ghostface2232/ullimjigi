// Combat feedback: hit confirmation, crit, kill and the elemental reactions.
import { randRange as R } from '../util.js';
import { S, mtof, pick } from './registry.js';
import { bake } from './spells.js';

// ----- hit confirmation: baked body + a small live element layer -----
const HC = { dur: 0.5, n: 4, order: 0 };
bake('hit_core', { ...HC, fn(out) {
  this.click(out, 0.18, 3500);
  this.tone({ out, f: R(180, 200), f2: 48, d: 0.11, v: 0.42 });
  this.noise({ out, f: 760, q: 1, d: 0.06, v: 0.26 });
  this.noise({ out, type: 'lowpass', f: 2500, f2: 400, d: 0.05, v: 0.14 });
} });
bake('hit_core_heavy', { ...HC, dur: 0.7, fn(out) {
  this.click(out, 0.2, 3000);
  this.tone({ out, f: R(180, 200), f2: 45, d: 0.16, v: 0.5 });
  this.noise({ out, f: 700, q: 1, d: 0.07, v: 0.32 });
  this.boom(out, { f: 75, f2: 30, d: 0.35, v: 0.32 });
  this.noise({ out, type: 'lowpass', f: 2200, f2: 300, d: 0.12, v: 0.2 });
} });
S.hit = function (o) {
  const hv = !!o.heavy;
  const out = this.bus(o.pos, (o.v || 1) * (hv ? 1.1 : 0.85), 0.15); if (!out) return;
  this.baked(hv ? 'hit_core_heavy' : 'hit_core', out);
  switch (o.el) {
    case 'fire': this.noise({ out, buf: 'crackle', f: 2800, q: 0.7, d: 0.16, v: 0.3 }); break;
    case 'frost': this.noise({ out, buf: 'tinkle', type: 'highpass', f: 2500, d: 0.16, v: 0.32 }); this.shards(out, 2, 0.05, 0.08); break;
    case 'storm': this.noise({ out, buf: 'arcs', type: 'highpass', f: 2500, d: 0.08, v: 0.35 }); break;
    case 'water': this.noise({ out, buf: 'bubbles', type: 'highpass', f: 400, d: 0.14, v: 0.3 }); this.noise({ out, type: 'lowpass', f: 1400, f2: 300, d: 0.1, v: 0.14 }); break;
    case 'wind': this.whoosh(out, { f: 1200, f2: 400, q: 1.2, a: 0.004, d: 0.12, v: 0.14 }); break;
    case 'arcane': this.fm({ out, f: mtof(pick([86, 88, 90])), ratio: 2, idx: 0.8, dm: 0.04, d: 0.12, v: 0.025 }); break;
  }
};

bake('crit', { dur: 0.8, n: 3, order: 1, fn(out) {
  this.click(out, 0.24, 5000);
  this.fm({ out, f: R(2300, 2400), f2: 2200, ratio: 1.41, idx: 1.2, dm: 0.04, d: 0.28, v: 0.05 });
  this.tone({ out, type: 'triangle', f: 3520, d: 0.2, v: 0.035 });
  this.noise({ out, f: 5200, q: 6, d: 0.12, v: 0.12 });
  this.boom(out, { f: 120, f2: 40, d: 0.2, v: 0.28 });
  this.noise({ out, buf: 'tinkle', type: 'highpass', f: 3500, d: 0.2, v: 0.2 });
} }, { rev: 0.35 });

// killing blow: weighty thud + rising chime
bake('kill', { dur: 1.4, n: 3, lo: true, order: 1, fn(out, i) {
  this.click(out, 0.24, 3000);
  this.boom(out, { f: 115, f2: 34, d: 0.45, v: 0.52 });
  this.noise({ out, type: 'lowpass', f: 2200, f2: 180, d: 0.35, v: 0.3 });
  const n = [[86, 93], [88, 93], [86, 90]][i % 3];
  this.note(out, n[0], 0.06, 0.045, 0.8, 'bell'); this.note(out, n[1], 0.12, 0.04, 1.0, 'bell');
  this.tail(out, { type: 'highpass', f: 5000, f2: 9000, t: 0.08, d: 0.5, v: 0.045 });
} }, { vol: 1.05, rev: 0.4 });

// ----- reactions (each has a signature) -----
const RX = { dur: 1.6, n: 2, lo: true, order: 2 };
bake('react_thermal', { ...RX, fn(out) {
  this.click(out, 0.28, 4500);
  this.noise({ out: this.dist(out), f: 3500, q: 2, d: 0.03, v: 0.2 });
  this.boom(out, { f: 120, f2: 36, d: 0.5, v: 0.55 });
  this.shards(out, 10, 0.2, 0.13);
  this.noise({ out, type: 'highpass', f: 2000, f2: 5000, a: 0.01, d: 0.9, v: 0.22 });
  this.noise({ out, buf: 'fizz', type: 'highpass', f: 3000, a: 0.01, d: 0.8, v: 0.25 });
  this.glass(out, R(1700, 1900), { d: 0.5, v: 0.03 });
  this.tone({ out, type: 'triangle', f: 1800, f2: 900, d: 0.4, v: 0.04 });
} }, { vol: 1.05, rev: 0.5 });
bake('react_flashfreeze', { ...RX, fn(out) {
  this.swell(out, { f: 3000, f2: 9000, d: 0.08, v: 0.1, type: 'highpass', buf: 'white' });
  this.noise({ out, f: 7000, f2: 1200, q: 2, t: 0.06, d: 0.4, v: 0.2 });
  this.noise({ out, buf: 'fizz', f: 6000, f2: 2500, q: 1, t: 0.06, d: 0.35, v: 0.3 });
  this.shards(out, 12, 0.3, 0.12);
  this.noise({ out, buf: 'tinkle', type: 'highpass', f: 2500, t: 0.08, d: 0.7, v: 0.4 });
  this.boom(out, { f: 110, f2: 40, t: 0.06, d: 0.3, v: 0.33 });
  [84, 91, 96].forEach((m, k) => this.note(out, m, 0.06 + k * 0.035, 0.04, 0.9, 'bell'));
} }, { rev: 0.5 });
bake('react_firestorm', { ...RX, fn(out) {
  this.whoosh(out, { f: 180, f2: 1900, q: 0.8, a: 0.05, d: 0.7, v: 0.45 });
  this.roar(out, { f: 160, f2: 240, a: 0.05, d: 0.7, v: 0.26, flick: 0.5 });
  this.noise({ out, buf: 'brown', type: 'lowpass', f: 700, f2: 250, d: 0.8, v: 0.3 });
  this.noise({ out, buf: 'crackle', f: 2500, q: 0.6, a: 0.05, d: 0.9, v: 0.55 });
  this.boom(out, { f: 90, f2: 40, d: 0.4, v: 0.28 });
} }, { rev: 0.45 });
bake('react_blizzard', { ...RX, fn(out) {
  this.whoosh(out, { f: 500, f2: 2600, q: 4, a: 0.08, d: 0.8, v: 0.26, buf: 'white' });
  this.whoosh(out, { f: 260, f2: 900, q: 1, a: 0.05, d: 0.7, v: 0.28 });
  this.roar(out, { f: 520, f2: 700, a: 0.1, d: 0.7, v: 0.1, q: 8, ratios: [1, 1.5], amps: [1, 0.6] });
  this.shards(out, 8, 0.5, 0.08);
  this.noise({ out, buf: 'tinkle', type: 'highpass', f: 2500, a: 0.05, d: 0.8, v: 0.4 });
  this.tail(out, { type: 'highpass', f: 6000, f2: 9000, d: 0.8, v: 0.07 });
} }, { rev: 0.55 });
bake('react_stormspread', { ...RX, fn(out) {
  const d = this.dist(out);
  for (let k = 0; k < 6; k++) this.noise({ out: d, type: 'highpass', f: R(1500, 3000), t: k * 0.045 + R(0, 0.015), d: 0.04, v: 0.24 });
  this.noise({ out, buf: 'arcs', type: 'highpass', f: 2200, d: 0.5, v: 0.45 });
  this.whoosh(out, { f: 400, f2: 2000, q: 1.2, a: 0.03, d: 0.4, v: 0.26 });
  this.buzz(out, { f: 140, f2: 60, d: 0.35, am: 50, fc: 1000, v: 0.08 });
  this.tone({ out: this.filter('lowpass', 900, 1, out), type: 'sawtooth', f: 140, f2: 60, d: 0.35, v: 0.1 });
} }, { rev: 0.4 });
bake('react_extinguish', { ...RX, fn(out) {
  this.noise({ out, type: 'highpass', f: 2800, f2: 1600, a: 0.01, d: 0.55, v: 0.24 });
  this.noise({ out, buf: 'fizz', type: 'highpass', f: 3000, f2: 1800, a: 0.01, d: 0.6, v: 0.28 });
  this.noise({ out, buf: 'brown', type: 'lowpass', f: 600, f2: 200, d: 0.25, v: 0.24 });
  this.tone({ out, type: 'triangle', f: 330, f2: 150, t: 0.05, d: 0.35, v: 0.05 });
  this.noise({ out, buf: 'bubbles', f: 800, q: 0.6, d: 0.3, v: 0.2 });
} }, { rev: 0.3 });
bake('react_scald', { ...RX, fn(out) {
  this.click(out, 0.22, 2500);
  this.boom(out, { f: 105, f2: 34, d: 0.55, v: 0.55 });
  this.noise({ out, type: 'highpass', f: 1500, f2: 5000, a: 0.01, d: 1.1, v: 0.26 });
  this.noise({ out, buf: 'fizz', type: 'highpass', f: 2500, a: 0.01, d: 0.9, v: 0.28 });
  this.noise({ out, buf: 'bubbles', f: 1000, q: 0.5, t: 0.03, d: 0.6, v: 0.4 });
  for (let k = 0; k < 6; k++) this.drop(out, { f: R(300, 700), rise: R(2, 2.8), t: 0.05 + k * R(0.03, 0.06), d: 0.05, v: 0.04 });
  this.noise({ out, type: 'lowpass', f: 1600, f2: 300, d: 0.4, v: 0.26 });
} }, { vol: 1.05, rev: 0.5 });
bake('react_shortcircuit', { ...RX, fn(out) {
  const d = this.dist(out);
  let t = 0;
  for (let k = 0; k < 7; k++) { t += R(0.02, 0.07); this.noise({ out: d, type: 'highpass', f: R(1200, 3500), t, d: R(0.015, 0.04), v: 0.26 }); }
  this.buzz(out, { f: 60, f2: 58, d: 0.45, am: 25, fc: 700, q: 2, v: 0.12, type: 'square' });
  this.noise({ out, buf: 'arcs', type: 'highpass', f: 3000, t: 0.08, d: 0.45, v: 0.35 });
  this.noise({ out, buf: 'fizz', type: 'highpass', f: 3000, f2: 5000, t: 0.1, d: 0.4, v: 0.18 });
} }, { rev: 0.35 });
bake('react_superconduct', { ...RX, fn(out) {
  this.click(out, 0.28, 5000);
  [1240, 1870, 2610, 3300].forEach((f, k) => this.tone({ out, type: 'triangle', f: f * R(0.99, 1.01), t: 0.005 * k, d: 0.55 - k * 0.08, v: 0.045 }));
  this.fm({ out, f: 620, ratio: 2.76, idx: 1.5, dm: 0.1, d: 0.6, v: 0.04 });
  this.noise({ out: this.dist(out), type: 'highpass', f: 1200, d: 0.07, v: 0.3 });
  this.noise({ out, buf: 'arcs', type: 'highpass', f: 2500, d: 0.3, v: 0.35 });
  this.boom(out, { f: 140, f2: 50, d: 0.3, v: 0.38 });
  this.shards(out, 6, 0.15, 0.09);
} }, { rev: 0.5 });
bake('react_monsoon', { ...RX, fn(out) {
  this.noise({ out, type: 'lowpass', f: 600, f2: 3000, a: 0.06, d: 0.7, v: 0.38 });
  this.whoosh(out, { f: 350, f2: 1500, q: 1.2, a: 0.04, d: 0.6, v: 0.26 });
  this.noise({ out, buf: 'bubbles', f: 1300, q: 0.5, a: 0.05, d: 0.7, v: 0.5 });
  for (let k = 0; k < 7; k++) this.drop(out, { f: R(800, 1800), rise: R(1.6, 2.4), t: 0.06 + k * R(0.04, 0.08), d: R(0.03, 0.05), v: 0.03 });
  this.sub(out, { f: 75, f2: 40, d: 0.4, v: 0.22 });
} }, { vol: 0.6, rev: 0.45 });
bake('react_resonance', { ...RX, dur: 1.4, fn(out, i) {
  const ch = [[79, 83, 86, 91], [81, 86, 90, 93], [78, 83, 86, 90]][i % 3];
  ch.forEach((m, k) => this.fm({ out, f: mtof(m), ratio: 2, idx: 0.9, dm: 0.08, t: k * 0.02, d: 1.1, v: 0.035 }));
  this.tone({ out, f: 98, f2: 196, a: 0.02, d: 0.4, v: 0.14 });
  this.tone({ out, f: 760, f2: 170, d: 0.12, v: 0.11 });
  this.noise({ out, buf: 'tinkle', type: 'highpass', f: 3000, d: 0.6, v: 0.25 });
} }, { rev: 0.55 });
bake('react_prism', { dur: 2.0, n: 2, stereo: true, lo: true, order: 2, fn(out) {
  [74, 78, 81, 86, 90, 93].forEach((m, k) => this.glass(this.pan(out, (k - 2.5) * 0.28), mtof(m), { t: k * 0.03, d: 1.4, v: 0.035, kind: 'bowl' }));
  [86, 93].forEach((m, k) => this.fm({ out, f: mtof(m), ratio: 3.5, idx: 2, dm: 0.1, t: 0.05 + k * 0.05, d: 1.2, v: 0.025 }));
  this.boom(out, { f: 90, f2: 36, d: 0.5, v: 0.38 });
  this.click(out, 0.2, 4000);
  this.wide(out, (o) => this.noise({ out: o, type: 'highpass', f: 4000, f2: 9000, d: 0.6, v: 0.08 }));
  this.wide(out, (o) => this.noise({ out: o, buf: 'tinkle', type: 'highpass', f: 3000, d: 1.0, v: 0.35 }));
} }, { vol: 0.85, rev: 0.6 });
