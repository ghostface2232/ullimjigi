// Spell sounds: bolt casts / impacts, signature wind-ups (charge_*), releases
// (heavy_*), payoffs (blast_*), projectile fly-bys (whiz_*), elemental generics
// and the ultimate. Most are baked recipes (see AudioEngine.baked).
//
// Element palettes
//   arcane  crystalline glass / FM bells in D major pentatonic, pitch-drop "pew", sparkle
//   fire    ignition puff, resonant multi-band roar, crackle texture, low thump
//   frost   bright crack, inharmonic glass partials, fizz of crystals forming, tinkle
//   storm   distorted crack, chopped electrical buzz, arc crackle, rolling brown-noise thunder
//   wind    swept band-pass rush, whistle, flutter, soft whump
//   water   droplet "bloops" (rising sines), bubble texture, low-passed slap and wash
import { randRange as R } from '../util.js';
import { S, B, mtof, pick, ELS } from './registry.js';

// Register a baked sound + its player. bus: { vol, rev, near }
export function bake(name, spec, bus = {}) {
  B[name] = spec;
  const { vol = 1, rev = 0.25, near } = bus;
  S[name] = function (o) {
    const out = this.bus(o.pos, (o.v ?? 1) * vol, rev, null, near); if (!out) return;
    this.baked(name, out);
    if (spec.extra) spec.extra.call(this, out, o);
  };
}

// =====================================================================
// Bolt casts — fired ~3/s: short, crisp, quiet low end, varied per bake
// =====================================================================
bake('cast_arcane', { dur: 0.5, n: 4, order: 0, fn(out, i) {
  const note = [86, 88, 90, 93][i % 4];
  this.click(out, 0.09, 7000);
  this.tone({ out, f: 3200, f2: 700, a: 0.001, d: 0.02, v: 0.07 });
  this.tone({ out, f: R(1350, 1500), f2: 470, d: 0.11, v: 0.12 });
  this.tone({ out: this.filter('lowpass', 2600, 0.7, out), type: 'triangle', f: 720, f2: 240, d: 0.15, v: 0.1 });
  this.fm({ out, f: mtof(note), ratio: 3.01, idx: 1.1, dm: 0.05, t: 0.012, d: 0.24, v: 0.032 });
  this.tone({ out, f: mtof(note + 12), t: 0.02, d: 0.12, v: 0.01 });
  this.noise({ out, f: 1800, f2: 4200, q: 1.5, a: 0.01, d: 0.12, v: 0.12 });
  this.noise({ out, type: 'highpass', f: 5000, f2: 7500, d: 0.16, v: 0.035 });
} }, { rev: 0.22 });

bake('cast_fire', { dur: 0.5, n: 4, order: 0, fn(out) {
  this.click(out, 0.06, 3000);
  this.noise({ out, type: 'lowpass', f: 2200, d: 0.025, v: 0.36 });
  this.whoosh(out, { f: R(340, 420), f2: R(2200, 2800), q: 0.8, a: 0.012, d: 0.22, v: 0.52 });
  this.roar(out, { f: R(200, 240), f2: 150, a: 0.01, d: 0.24, v: 0.18, flick: 0.5 });
  this.tone({ out, f: 150, f2: 60, d: 0.12, v: 0.13 });
  this.noise({ out, buf: 'crackle', f: 2800, q: 0.7, t: 0.015, a: 0.01, d: 0.3, v: 0.5 });
} }, { vol: 1.25, rev: 0.22 });

bake('cast_frost', { dur: 0.5, n: 4, order: 0, fn(out, i) {
  const f = mtof([93, 95, 98, 100][i % 4]);
  this.click(out, 0.08, 8000);
  this.glass(out, f, { d: 0.35, v: 0.028, bright: 0.8 });
  this.fm({ out, f: f * 1.5, ratio: 1.41, idx: 0.9, dm: 0.04, d: 0.2, v: 0.018 });
  this.noise({ out, type: 'highpass', f: 4500, f2: 9000, a: 0.005, d: 0.16, v: 0.05 });
  this.noise({ out, buf: 'fizz', f: 6500, q: 1.4, a: 0.004, d: 0.13, v: 0.2 });
  this.noise({ out, buf: 'tinkle', type: 'highpass', f: 2000, t: 0.015, d: 0.22, v: 0.35 });
  this.noise({ out, f: 1200, f2: 4200, q: 3, d: 0.1, v: 0.1 });
  this.tone({ out, f: 300, f2: 150, d: 0.05, v: 0.06 });
} }, { vol: 1.25, rev: 0.32 });

bake('cast_storm', { dur: 0.5, n: 4, order: 0, fn(out, i) {
  const d = this.dist(out);
  this.noise({ out: d, type: 'highpass', f: 2400, d: 0.03, v: 0.4 });
  this.noise({ out: d, type: 'highpass', f: 3200, t: 0.028 + i * 0.006, d: 0.025, v: 0.16 });
  this.tone({ out, type: 'square', f: 4200, f2: 900, d: 0.05, v: 0.018 });
  this.buzz(out, { f: R(85, 110), f2: 60, d: 0.17, v: 0.15, am: 55, fc: 1500 });
  this.noise({ out, buf: 'arcs', type: 'highpass', f: 2800, d: 0.2, v: 0.45 });
  this.tone({ out: this.filter('lowpass', 900, 1, out), type: 'sawtooth', f: 170, f2: 55, d: 0.14, v: 0.13 });
  this.tail(out, { buf: 'brown', f: 260, f2: 90, t: 0.03, d: 0.3, v: 0.14 });
} }, { vol: 1.2, rev: 0.28 });

bake('cast_wind', { dur: 0.5, n: 4, order: 0, fn(out) {
  this.whoosh(out, { f: R(330, 400), f2: R(2000, 2600), q: 1.7, a: 0.035, d: 0.22, v: 0.45 });
  this.whoosh(out, { f: 1500, f2: 4000, q: 3.5, a: 0.02, d: 0.16, v: 0.14, buf: 'white' });
  this.tone({ out, f: R(1000, 1200), f2: R(1500, 1800), a: 0.02, d: 0.14, v: 0.02 });
  this.tone({ out, f: 160, f2: 80, d: 0.07, v: 0.06 });
  this.noise({ out, type: 'lowpass', f: 900, f2: 300, d: 0.12, v: 0.12, buf: 'pink' });
} }, { rev: 0.25 });

bake('cast_water', { dur: 0.5, n: 4, order: 0, fn(out) {
  this.click(out, 0.05, 3000);
  this.drop(out, { f: R(380, 460), rise: 2.6, d: 0.06, v: 0.12 });
  this.drop(out, { f: R(650, 800), rise: 2.1, t: 0.045, d: 0.045, v: 0.055 });
  this.noise({ out, f: 700, f2: 2200, q: 2, a: 0.015, d: 0.16, v: 0.26 });
  this.noise({ out, type: 'lowpass', f: 700, d: 0.1, v: 0.12 });
  this.noise({ out, buf: 'bubbles', type: 'highpass', f: 350, t: 0.01, d: 0.22, v: 0.3 });
  this.noise({ out, type: 'highpass', f: 5000, t: 0.02, d: 0.12, v: 0.04 });
} }, { rev: 0.3 });

// =====================================================================
// Bolt impacts
// =====================================================================
bake('impact_arcane', { dur: 0.7, n: 4, order: 0, fn(out) {
  this.click(out, 0.17, 5000);
  this.noise({ out, f: 2200, q: 1.5, d: 0.05, v: 0.26 });
  this.tone({ out, f: 700, f2: 150, d: 0.12, v: 0.2 });
  this.sub(out, { f: 140, f2: 60, d: 0.12, v: 0.13 });
  this.glass(out, R(1900, 2600), { d: 0.35, v: 0.028 });
  this.fm({ out, f: mtof(pick([86, 90, 93])), ratio: 2, idx: 1.4, dm: 0.05, d: 0.3, v: 0.026 });
  this.noise({ out, buf: 'tinkle', type: 'highpass', f: 3000, t: 0.01, d: 0.3, v: 0.35 });
  this.tail(out, { type: 'highpass', f: 4000, f2: 6500, d: 0.2, v: 0.05 });
} }, { rev: 0.28 });

bake('impact_fire', { dur: 0.8, n: 4, order: 0, fn(out) {
  this.click(out, 0.14, 2500);
  this.noise({ out, type: 'lowpass', f: 3500, f2: 300, d: 0.3, v: 0.38 });
  this.boom(out, { f: 155, f2: 42, d: 0.26, v: 0.38 });
  this.roar(out, { f: 250, f2: 120, d: 0.32, v: 0.16, flick: 0.5 });
  this.noise({ out, buf: 'crackle', f: 2500, q: 0.6, t: 0.02, a: 0.01, d: 0.5, v: 0.55 });
  this.noise({ out, buf: 'fizz', type: 'highpass', f: 5000, t: 0.05, a: 0.02, d: 0.35, v: 0.08 });
} }, { rev: 0.3 });

bake('impact_frost', { dur: 0.7, n: 4, order: 0, fn(out) {
  this.click(out, 0.17, 6000);
  this.noise({ out, f: R(3200, 3900), q: 3, d: 0.03, v: 0.4 });
  this.shards(out, 5, 0.1, 0.13);
  this.noise({ out, buf: 'tinkle', type: 'highpass', f: 2500, d: 0.35, v: 0.5 });
  this.glass(out, R(2300, 2900), { d: 0.4, v: 0.03 });
  this.tone({ out, f: 240, f2: 90, d: 0.09, v: 0.22 });
  this.noise({ out, type: 'highpass', f: 6000, d: 0.25, v: 0.05 });
} }, { rev: 0.35 });

bake('impact_storm', { dur: 0.7, n: 4, order: 0, fn(out) {
  const d = this.dist(out);
  this.noise({ out: d, type: 'highpass', f: 900, d: 0.07, v: 0.52 });
  this.noise({ out: d, type: 'highpass', f: 2000, t: R(0.03, 0.045), d: 0.04, v: 0.22 });
  this.noise({ out, buf: 'arcs', type: 'highpass', f: 2500, d: 0.25, v: 0.52 });
  this.tone({ out: this.filter('lowpass', 900, 1, out), type: 'sawtooth', f: 95, f2: 40, d: 0.22, v: 0.14 });
  this.sub(out, { f: 80, f2: 40, d: 0.18, v: 0.14 });
  this.buzz(out, { f: 60, d: 0.2, am: 45, fc: 1200, v: 0.07 });
} }, { rev: 0.3 });

bake('impact_wind', { dur: 0.7, n: 4, order: 0, fn(out) {
  this.noise({ out, type: 'lowpass', f: 3200, f2: 350, a: 0.003, d: 0.26, v: 0.42, buf: 'pink' });
  this.whoosh(out, { f: 1600, f2: 500, q: 1.2, a: 0.004, d: 0.28, v: 0.22 });
  this.tone({ out, f: 170, f2: 65, d: 0.12, v: 0.22 });
  this.tail(out, { type: 'bandpass', f: 1800, f2: 700, d: 0.3, v: 0.06 });
} }, { rev: 0.25 });

bake('impact_water', { dur: 0.8, n: 4, order: 0, fn(out) {
  this.click(out, 0.1, 2500);
  this.noise({ out, type: 'lowpass', f: 4000, f2: 500, d: 0.22, v: 0.38 });
  this.tone({ out, f: 260, f2: 85, d: 0.12, v: 0.18 });
  this.noise({ out, f: 1500, f2: 600, q: 1.2, d: 0.2, v: 0.2 });
  this.noise({ out, type: 'highpass', f: 5000, d: 0.28, v: 0.06 });
  for (let k = 0; k < 5; k++) this.drop(out, { f: R(700, 1600), rise: R(1.6, 2.4), t: 0.03 + k * R(0.02, 0.06), d: R(0.03, 0.05), v: R(0.025, 0.05) });
  this.noise({ out, buf: 'bubbles', type: 'highpass', f: 400, t: 0.05, d: 0.35, v: 0.4 });
} }, { rev: 0.3 });

// =====================================================================
// Signature wind-ups: ~0.25 s reverse swell that snaps into heavy_<el>
// =====================================================================
const CH = { dur: 0.42, n: 3, order: 1 };
bake('charge_arcane', { ...CH, fn(out) {
  this.tone({ out, f: 294, f2: 587, a: 0.24, d: 0.05, v: 0.07 });
  this.fm({ out, f: 587, f2: 1175, ratio: 2, idx: 0.8, dm: 0.3, a: 0.24, d: 0.06, v: 0.035 });
  this.swell(out, { f: 600, f2: 4500, d: 0.25, v: 0.22, q: 1 });
  this.swell(out, { buf: 'tinkle', type: 'highpass', f: 2500, f2: 4000, d: 0.26, v: 0.3 });
  this.swell(out, { type: 'highpass', f: 5000, f2: 9000, d: 0.25, v: 0.06, buf: 'white' });
  this.tone({ out, f: 60, f2: 120, a: 0.24, d: 0.04, v: 0.08 });
} }, { rev: 0.3 });
bake('charge_fire', { ...CH, fn(out) {
  this.swell(out, { buf: 'brown', type: 'lowpass', f: 200, f2: 1600, d: 0.25, v: 0.32 });
  this.roar(out, { f: 140, f2: 260, a: 0.24, d: 0.06, v: 0.18, flick: 0.4 });
  this.swell(out, { buf: 'crackle', f: 2500, f2: 3500, q: 0.7, d: 0.26, v: 0.45 });
  this.tone({ out, f: 80, f2: 160, a: 0.24, d: 0.05, v: 0.11 });
  this.swell(out, { f: 500, f2: 3000, d: 0.25, v: 0.14, q: 1 });
} }, { rev: 0.25 });
bake('charge_frost', { ...CH, fn(out) {
  this.tone({ out, f: 1200, f2: 2400, a: 0.24, d: 0.05, v: 0.022 });
  this.fm({ out, f: mtof(86), f2: mtof(98), ratio: 3.5, idx: 1.2, dm: 0.3, a: 0.24, d: 0.06, v: 0.024 });
  this.swell(out, { buf: 'fizz', f: 5000, f2: 8000, q: 1, d: 0.26, v: 0.32 });
  this.swell(out, { buf: 'tinkle', type: 'highpass', f: 2500, d: 0.26, v: 0.35 });
  this.swell(out, { type: 'highpass', f: 3000, f2: 8000, d: 0.25, v: 0.09, buf: 'white' });
  this.tone({ out, f: 150, f2: 300, a: 0.24, d: 0.04, v: 0.06 });
} }, { rev: 0.32 });
bake('charge_storm', { ...CH, fn(out) {
  this.buzz(out, { f: 55, f2: 180, a: 0.24, d: 0.05, v: 0.11, am: 30, fc: 1200, q: 1 });
  this.swell(out, { buf: 'arcs', type: 'highpass', f: 2000, f2: 3500, d: 0.26, v: 0.42 });
  this.swell(out, { f: 600, f2: 6000, d: 0.25, v: 0.14, buf: 'white', q: 1 });
  this.tone({ out: this.filter('lowpass', 2400, 2, out), type: 'sawtooth', f: 110, f2: 880, a: 0.25, d: 0.04, v: 0.06 });
  const d = this.dist(out);
  for (let k = 0; k < 4; k++) this.noise({ out: d, type: 'highpass', f: 2500, t: 0.06 + k * 0.05 + R(0, 0.02), d: 0.015, v: 0.06 + k * 0.035 });
} }, { rev: 0.28 });
bake('charge_wind', { ...CH, fn(out) {
  this.swell(out, { f: 300, f2: 2600, q: 2, d: 0.26, v: 0.4 });
  this.swell(out, { f: 1500, f2: 5000, q: 4, d: 0.24, v: 0.11, buf: 'white' });
  this.tone({ out, f: 600, f2: 1500, a: 0.24, d: 0.05, v: 0.022 });
  this.tone({ out, f: 70, f2: 140, a: 0.24, d: 0.04, v: 0.1 });
} }, { rev: 0.25 });
bake('charge_water', { ...CH, fn(out) {
  this.swell(out, { buf: 'bubbles', type: 'highpass', f: 300, d: 0.26, v: 0.45 });
  this.swell(out, { f: 400, f2: 2200, q: 1.5, d: 0.25, v: 0.28 });
  [0.06, 0.11, 0.15, 0.185, 0.215, 0.24].forEach((t, k) => this.drop(out, { f: 400 + k * 110, rise: 2, t, d: 0.04, v: 0.03 + k * 0.009 }));
  this.tone({ out, f: 70, f2: 140, a: 0.24, d: 0.04, v: 0.1 });
} }, { rev: 0.3 });

// =====================================================================
// Signature releases
// =====================================================================
// arcane: the release *is* the shockwave dome around the caster
bake('heavy_arcane', { dur: 2.2, n: 2, stereo: true, lo: true, order: 1, fn(out) {
  this.swell(out, { f: 800, f2: 6000, d: 0.06, v: 0.1 });
  this.click(out, 0.2, 3000);
  this.noise({ out: this.dist(out), type: 'lowpass', f: 3000, d: 0.04, v: 0.25 });
  this.sub(out, { f: 88, f2: 30, d: 0.8, v: 0.5 });
  this.tone({ out, type: 'triangle', f: 180, f2: 60, d: 0.35, v: 0.14 });
  this.wide(out, (o) => this.whoosh(o, { f: 2400, f2: 260, q: 0.9, a: 0.005, d: 0.6, v: 0.3 }), 0.6, 0.008);
  [74, 81, 86, 90].forEach((m, k) => this.fm({ out: this.pan(out, (k - 1.5) * 0.35), f: mtof(m), ratio: 2, idx: 1, dm: 0.1, t: 0.02 + k * 0.025, d: 1.4, v: 0.035 }));
  for (let k = 0; k < 8; k++) this.tone({ out: this.pan(out, R(-0.8, 0.8)), f: mtof(pick([93, 95, 98, 100, 102, 105])) * R(0.997, 1.003), t: 0.04 + R(0, 0.2), a: 0.02, d: R(0.6, 1.2), v: 0.009 });
  this.wide(out, (o) => this.tail(o, { type: 'highpass', f: 3500, f2: 8000, d: 0.8, v: 0.06 }));
} }, { vol: 1.05, rev: 0.5 });

// fire: fireball launch — ignition whump + roaring rush
bake('heavy_fire', { dur: 1.5, n: 2, stereo: true, lo: true, order: 1, fn(out) {
  this.click(out, 0.12, 2500);
  this.noise({ out, type: 'lowpass', f: 2600, d: 0.04, v: 0.35 });
  this.wide(out, (o) => this.whoosh(o, { f: 220, f2: 1600, q: 0.7, t: 0.02, a: 0.02, d: 0.5, v: 0.42 }), 0.55, 0.01);
  this.roar(out, { f: 170, f2: 110, t: 0.01, a: 0.02, d: 0.6, v: 0.26, flick: 0.5 });
  this.boom(out, { f: 110, f2: 42, d: 0.42, v: 0.36 });
  this.wide(out, (o) => this.noise({ out: o, buf: 'crackle', f: 2500, q: 0.6, t: 0.04, a: 0.02, d: 0.7, v: 0.5 }));
  this.noise({ out, buf: 'brown', type: 'lowpass', f: 900, f2: 250, t: 0.04, d: 0.6, v: 0.3 });
} }, { vol: 1.05, rev: 0.35 });

// frost: ice-lance line — crystalline shing + frost gust (ice_spike follows per spike)
bake('heavy_frost', { dur: 1.6, n: 2, stereo: true, lo: true, order: 1, fn(out) {
  this.click(out, 0.14, 7000);
  [86, 93, 98].forEach((m, k) => this.fm({ out: this.pan(out, (k - 1) * 0.5), f: mtof(m), ratio: 3.5, idx: 2, dm: 0.06, t: 0.01 + k * 0.045, d: 0.9, v: 0.035 }));
  this.wide(out, (o) => this.noise({ out: o, f: 5000, f2: 1500, q: 1.5, t: 0.02, a: 0.01, d: 0.5, v: 0.18 }), 0.6, 0.01);
  this.tone({ out, f: 150, f2: 55, t: 0.02, d: 0.3, v: 0.3 });
  this.noise({ out, buf: 'fizz', f: 7000, q: 1, t: 0.02, a: 0.01, d: 0.4, v: 0.28 });
  this.wide(out, (o) => this.noise({ out: o, buf: 'tinkle', type: 'highpass', f: 2500, t: 0.05, d: 0.6, v: 0.45 }));
  this.shards(out, 6, 0.3, 0.08);
} }, { rev: 0.45 });

// storm: sky charging at the target point, ~0.35 s before the strike lands
bake('heavy_storm', { dur: 0.9, n: 2, stereo: true, lo: true, order: 1, fn(out) {
  this.buzz(out, { f: 70, f2: 220, a: 0.3, d: 0.06, v: 0.1, am: 35, fc: 1400 });
  this.tone({ out: this.filter('lowpass', 2600, 2, out), type: 'sawtooth', f: 180, f2: 1600, a: 0.3, d: 0.05, v: 0.1 });
  this.wide(out, (o) => this.swell(o, { f: 600, f2: 7000, d: 0.33, v: 0.18, buf: 'white' }));
  this.wide(out, (o) => this.swell(o, { buf: 'arcs', type: 'highpass', f: 2200, f2: 3500, d: 0.32, v: 0.4 }));
  const d = this.dist(out);
  for (let k = 0; k < 6; k++) this.noise({ out: this.pan(d, R(-0.7, 0.7)), type: 'highpass', f: R(2000, 3500), t: R(0.02, 0.33), d: R(0.01, 0.03), v: 0.08 + k * 0.015 });
  this.tone({ out, f: 50, f2: 90, a: 0.3, d: 0.05, v: 0.12 });
} }, { vol: 0.8, rev: 0.4 });

// water: tidal wave launch — surge, sub push, bubbles
bake('heavy_water', { dur: 1.6, n: 2, stereo: true, lo: true, order: 1, fn(out) {
  this.click(out, 0.1, 2000);
  this.wide(out, (o) => this.noise({ out: o, type: 'lowpass', f: 400, f2: 2600, a: 0.12, d: 0.7, v: 0.4, buf: 'pink' }), 0.6, 0.01);
  this.whoosh(out, { f: 250, f2: 1100, q: 1, a: 0.06, d: 0.6, v: 0.26 });
  this.sub(out, { f: 70, f2: 38, d: 0.6, v: 0.36 });
  this.roar(out, { f: 300, f2: 220, a: 0.05, d: 0.5, v: 0.1, q: 2, buf: 'brown' });
  this.wide(out, (o) => this.noise({ out: o, buf: 'bubbles', f: 1200, q: 0.5, t: 0.05, a: 0.05, d: 0.8, v: 0.55 }));
  for (let k = 0; k < 6; k++) this.drop(out, { f: R(450, 1100), rise: R(1.8, 2.6), t: 0.08 + k * R(0.04, 0.07), d: R(0.04, 0.06), v: 0.035 });
} }, { vol: 1.05, rev: 0.4 });

// wind: compressed gust thrown forward
bake('heavy_wind', { dur: 1.4, n: 2, stereo: true, lo: true, order: 1, fn(out) {
  this.tone({ out, f: 110, f2: 45, d: 0.3, v: 0.32 });
  this.noise({ out, type: 'lowpass', f: 700, f2: 150, d: 0.18, v: 0.28, buf: 'pink' });
  const fg = this.gain(out, 1); this.flicker(fg.gain, this.ctx.currentTime, 0.7, { rate: 18, depth: 0.3 });
  this.wide(fg, (o, s) => this.whoosh(o, { f: 250 * (s ? 1.12 : 1), f2: 2200, q: 1, a: 0.03, d: 0.6, v: 0.45 }), 0.6, 0.012);
  this.whoosh(out, { f: 2500, f2: 5500, q: 4, a: 0.02, d: 0.35, v: 0.1, buf: 'white' });
  this.whoosh(out, { f: 2800, f2: 6000, q: 4, a: 0.03, d: 0.3, v: 0.08, buf: 'white' });
  this.tone({ out, f: 800, f2: 1400, a: 0.02, d: 0.4, v: 0.025 });
} }, { rev: 0.35 });

// =====================================================================
// Signature payoffs
// =====================================================================
const BL = { n: 3, stereo: true, lo: true, order: 2 };
// resonant shockwave dome with a crystalline bloom
bake('blast_arcane', { ...BL, dur: 3.0, fn(out) {
  this.click(out, 0.28, 3000);
  this.noise({ out: this.dist(out), type: 'lowpass', f: 3000, d: 0.05, v: 0.32 });
  this.sub(out, { f: 75, f2: 28, d: 1.1, v: 0.62 });
  this.tone({ out, type: 'triangle', f: 150, f2: 55, d: 0.4, v: 0.18 });
  this.fm({ out, f: 220, f2: 110, ratio: 0.5, idx: 0.4, dm: 0.4, d: 0.8, v: 0.07 });
  this.wide(out, (o) => this.noise({ out: o, f: 2200, f2: 180, q: 0.8, d: 0.9, v: 0.38, buf: 'pink' }), 0.7, 0.01);
  [74, 81, 86, 90, 93, 98].forEach((m, k) => this.glass(this.pan(out, R(-0.7, 0.7)), mtof(m), { t: 0.02 + k * R(0.02, 0.05), d: 2.6, v: 0.03, kind: 'bowl', beat: 0.8 }));
  [86, 93].forEach((m, k) => this.fm({ out, f: mtof(m), ratio: 3.5, idx: 2.5, dm: 0.12, t: 0.03 + k * 0.05, d: 1.6, v: 0.028 }));
  this.wide(out, (o) => this.tail(o, { type: 'highpass', f: 4000, f2: 9000, d: 2.0, v: 0.1 }));
  this.wide(out, (o) => this.noise({ out: o, buf: 'tinkle', type: 'highpass', f: 3000, t: 0.05, a: 0.05, d: 2.2, v: 0.7 }));
} }, { vol: 1.1, rev: 0.55 });

// fireball detonation: deep boom, roaring fireball, debris, crackle tail
bake('blast_fire', { ...BL, dur: 3.2, fn(out) {
  this.click(out, 0.28, 2000);
  this.noise({ out: this.dist(out), type: 'lowpass', f: 3000, d: 0.08, v: 0.45 });
  this.sub(out, { f: 95, f2: 24, d: 1.2, v: 0.75 });
  this.tone({ out, type: 'triangle', f: 190, f2: 50, d: 0.4, v: 0.22 });
  this.wide(out, (o) => this.roar(o, { f: 200, f2: 90, a: 0.02, d: 1.6, v: 0.3, flick: 0.45 }), 0.5);
  this.wide(out, (o) => this.noise({ out: o, type: 'lowpass', f: 3400, f2: 110, d: 1.3, v: 0.5, buf: 'pink' }), 0.7, 0.01);
  for (let k = 0; k < 14; k++) this.noise({ out: this.pan(out, R(-0.8, 0.8)), t: 0.1 + Math.pow(Math.random(), 1.5) * 0.9, d: R(0.03, 0.09), v: R(0.05, 0.13), f: R(300, 1300), q: 3 });
  this.wide(out, (o) => this.noise({ out: o, buf: 'crackle', f: 2200, q: 0.6, t: 0.05, a: 0.05, d: 2.8, v: 1.0 }));
  this.tail(out, { buf: 'brown', f: 300, f2: 60, t: 0.15, d: 2.2, v: 0.4 });
} }, { vol: 1.1, rev: 0.5 });

// glacial eruption: cracking ice, grinding, crystalline ring-out
bake('blast_frost', { ...BL, dur: 3.0, fn(out) {
  const d = this.dist(out);
  [0, 0.02, 0.05, 0.09, 0.14].forEach((t, k) => this.noise({ out: this.pan(d, R(-0.6, 0.6)), f: R(2500, 5000), q: R(2, 4), t: t + R(0, 0.01), d: 0.03, v: 0.28 - k * 0.03 }));
  this.click(out, 0.25, 6000);
  this.sub(out, { f: 120, f2: 35, d: 0.7, v: 0.55 });
  this.tone({ out, f: 260, f2: 80, d: 0.2, v: 0.18 });
  this.noise({ out, f: 900, f2: 400, q: 2, d: 0.5, v: 0.22 });
  this.wide(out, (o) => this.noise({ out: o, buf: 'crackle', f: 4000, q: 1, d: 0.6, v: 0.45 }));
  this.wide(out, (o) => this.noise({ out: o, buf: 'tinkle', type: 'highpass', f: 2500, t: 0.03, d: 1.8, v: 0.8 }));
  this.shards(out, 14, 0.4, 0.12);
  [86, 93, 98, 102, 105].forEach((m, k) => this.glass(this.pan(out, (k - 2) * 0.3), mtof(m), { t: 0.05 + k * 0.035, d: 2.6, v: 0.032, kind: 'bowl' }));
  this.fm({ out, f: mtof(81), ratio: 3.5, idx: 3, dm: 0.1, t: 0.04, d: 1.6, v: 0.03 });
  this.wide(out, (o) => this.noise({ out: o, type: 'highpass', f: 5000, f2: 8000, t: 0.05, a: 0.05, d: 1.2, v: 0.08 }));
} }, { vol: 1.05, rev: 0.55 });

// sky lightning strike: sharp crack, sizzling, rolling thunder
bake('blast_storm', { ...BL, dur: 3.2, fn(out) {
  const d = this.dist(out);
  this.click(out, 0.35, 4000);
  this.noise({ out: d, type: 'highpass', f: 700, d: 0.12, v: 0.7 });
  this.noise({ out: d, type: 'highpass', f: 1100, t: 0.04, d: 0.09, v: 0.45 });
  this.noise({ out: d, type: 'highpass', f: 1800, t: 0.09, d: 0.05, v: 0.28 });
  this.wide(out, (o) => this.noise({ out: o, buf: 'arcs', type: 'highpass', f: 2500, d: 0.7, v: 0.5 }));
  this.noise({ out, buf: 'fizz', type: 'highpass', f: 5000, t: 0.05, d: 0.9, v: 0.2 });
  this.sub(out, { f: 80, f2: 26, d: 1.0, v: 0.62 });
  this.buzz(out, { f: 55, d: 0.5, am: 70, fc: 900, v: 0.08 });
  this.wide(out, (o) => this.noise({ out: o, buf: 'brown', type: 'lowpass', f: 300, f2: 80, t: 0.08, a: 0.05, d: 2.8, v: 0.55 }));
  let t = 0.35;
  for (let k = 0; k < 4; k++) { t += R(0.2, 0.45); this.noise({ out: this.pan(out, k % 2 ? 0.6 : -0.6), buf: 'brown', type: 'lowpass', f: R(180, 280), t, a: 0.1, d: R(0.8, 1.2), v: 0.32 * (1 - k * 0.18) }); }
} }, { vol: 1.05, rev: 0.6 });

// compressed gust blast: whump + rushing air
bake('blast_wind', { ...BL, dur: 2.4, fn(out) {
  this.click(out, 0.15, 1500);
  this.sub(out, { f: 85, f2: 30, d: 0.6, v: 0.55 });
  this.tone({ out, type: 'triangle', f: 160, f2: 60, d: 0.25, v: 0.18 });
  this.noise({ out, type: 'lowpass', f: 600, f2: 150, d: 0.3, v: 0.32, buf: 'pink' });
  const fg = this.gain(out, 1); this.flicker(fg.gain, this.ctx.currentTime, 1.1, { rate: 18, depth: 0.3 });
  this.wide(fg, (o) => this.noise({ out: o, f: 1800, f2: 250, q: 0.7, a: 0.005, d: 2.0, v: 0.8, buf: 'pink' }), 0.7, 0.015);
  this.wide(out, (o, s) => this.noise({ out: o, f: 3000 * (s ? 1.1 : 1), f2: 900, q: 3, a: 0.02, d: 0.8, v: 0.15 }), 0.8);
  this.tone({ out, f: R(900, 1100), f2: 600, a: 0.02, d: 0.6, v: 0.018 });
  this.tail(out, { buf: 'brown', f: 500, f2: 150, t: 0.1, d: 1.6, v: 0.3 });
} }, { vol: 1.05, rev: 0.45 });

// tidal crash: heavy slam, spray, droplets
bake('blast_water', { ...BL, dur: 2.6, fn(out) {
  this.click(out, 0.22, 1800);
  this.noise({ out, type: 'lowpass', f: 5000, f2: 400, d: 0.35, v: 0.5 });
  this.sub(out, { f: 80, f2: 30, d: 0.8, v: 0.58 });
  this.tone({ out, f: 200, f2: 70, d: 0.2, v: 0.22 });
  this.wide(out, (o) => this.noise({ out: o, type: 'lowpass', f: 1200, f2: 250, a: 0.01, d: 1.2, v: 0.42, buf: 'pink' }), 0.6, 0.01);
  this.wide(out, (o) => this.noise({ out: o, type: 'highpass', f: 3000, f2: 6000, t: 0.03, a: 0.02, d: 0.9, v: 0.15 }), 0.7);
  this.wide(out, (o) => this.noise({ out: o, buf: 'bubbles', f: 1400, q: 0.4, t: 0.05, a: 0.03, d: 2.0, v: 0.9 }));
  for (let k = 0; k < 16; k++) this.drop(this.pan(out, R(-0.8, 0.8)), { f: R(600, 2400), rise: R(1.6, 2.6), t: 0.1 + Math.pow(Math.random(), 1.4) * 1.1, d: R(0.025, 0.06), v: R(0.02, 0.05) });
  this.tail(out, { f: 900, f2: 200, t: 0.3, d: 1.8, v: 0.26 });
} }, { vol: 1.1, rev: 0.5 });

// =====================================================================
// Projectile fly-bys: rise-and-fall envelope, falling (doppler) pitch
// =====================================================================
const WZ = { dur: 0.4, n: 3, order: 1 };
bake('whiz_arcane', { ...WZ, fn(out) {
  this.tone({ out, f: R(1700, 1900), f2: 1050, a: 0.1, d: 0.15, v: 0.035 });
  this.noise({ out, f: 4000, f2: 1500, q: 2, a: 0.1, d: 0.15, v: 0.14 });
  this.noise({ out, buf: 'tinkle', type: 'highpass', f: 3000, a: 0.08, d: 0.15, v: 0.2 });
} }, { rev: 0.15, near: 0.1 });
bake('whiz_fire', { ...WZ, fn(out) {
  this.noise({ out, f: 1600, f2: 600, q: 1, a: 0.1, d: 0.18, v: 0.55, buf: 'pink' });
  this.noise({ out, buf: 'crackle', f: 2500, q: 0.7, a: 0.1, d: 0.18, v: 0.45 });
  this.roar(out, { f: 240, f2: 170, a: 0.1, d: 0.18, v: 0.08, flick: 0.5 });
} }, { rev: 0.15, near: 0.1 });
bake('whiz_frost', { ...WZ, fn(out) {
  this.noise({ out, type: 'highpass', f: 6000, f2: 3000, a: 0.1, d: 0.15, v: 0.09 });
  this.tone({ out, f: R(2700, 2900), f2: 2350, a: 0.1, d: 0.15, v: 0.018 });
  this.noise({ out, buf: 'tinkle', type: 'highpass', f: 2500, a: 0.08, d: 0.18, v: 0.25 });
} }, { rev: 0.15, near: 0.1 });
bake('whiz_storm', { ...WZ, fn(out) {
  this.buzz(out, { f: 140, f2: 100, a: 0.1, d: 0.15, v: 0.2, am: 60, fc: 1800 });
  this.noise({ out, buf: 'arcs', type: 'highpass', f: 3000, a: 0.08, d: 0.16, v: 0.7 });
} }, { rev: 0.15, near: 0.1 });
bake('whiz_wind', { ...WZ, fn(out) {
  this.noise({ out, f: 2200, f2: 700, q: 2.5, a: 0.1, d: 0.18, v: 0.5, buf: 'pink' });
  this.tone({ out, f: R(1300, 1500), f2: 900, a: 0.1, d: 0.15, v: 0.02 });
} }, { rev: 0.15, near: 0.1 });
bake('whiz_water', { ...WZ, fn(out) {
  this.noise({ out, f: 1500, f2: 600, q: 1.5, a: 0.1, d: 0.15, v: 0.26 });
  this.noise({ out, buf: 'bubbles', type: 'highpass', f: 500, a: 0.08, d: 0.16, v: 0.3 });
} }, { rev: 0.15, near: 0.1 });

// =====================================================================
// Elemental generics
// =====================================================================
bake('explosion', { dur: 2.4, n: 3, stereo: true, lo: true, order: 2, fn(out) {
  this.click(out, 0.28, 2000);
  this.noise({ out: this.dist(out), type: 'lowpass', f: 3000, d: 0.07, v: 0.45 });
  this.sub(out, { f: 105, f2: 26, d: 1.0, v: 0.72 });
  this.tone({ out, type: 'triangle', f: 210, f2: 52, d: 0.35, v: 0.2 });
  this.wide(out, (o) => this.noise({ out: o, type: 'lowpass', f: 3400, f2: 110, d: 1.2, v: 0.5, buf: 'pink' }), 0.7, 0.01);
  this.noise({ out, f: 480, q: 0.7, d: 0.55, v: 0.24 });
  this.roar(out, { f: 180, f2: 90, d: 0.7, v: 0.16, flick: 0.4 });
  this.wide(out, (o) => this.noise({ out: o, buf: 'crackle', f: 2400, q: 0.6, t: 0.05, a: 0.03, d: 1.0, v: 0.4 }));
  for (let k = 0; k < 8; k++) this.noise({ out: this.pan(out, R(-0.7, 0.7)), t: R(0.08, 0.7), d: R(0.03, 0.08), v: R(0.05, 0.12), f: R(300, 1400), q: 3 });
  this.tail(out, { buf: 'brown', f: 300, f2: 60, t: 0.2, d: 1.8, v: 0.32 });
} }, { rev: 0.5 });

bake('thunder', { dur: 3.3, n: 3, stereo: true, lo: true, order: 2, fn(out) {
  const d = this.dist(out);
  this.click(out, 0.3, 4000);
  this.noise({ out: d, type: 'highpass', f: 700, d: 0.12, v: 0.7 });
  this.noise({ out: d, type: 'highpass', f: 1100, t: 0.05 + R(0, 0.02), d: 0.1, v: 0.45 });
  this.noise({ out: d, type: 'highpass', f: 1800, t: 0.1 + R(0, 0.03), d: 0.06, v: 0.28 });
  this.wide(out, (o) => this.noise({ out: o, buf: 'arcs', type: 'highpass', f: 2200, d: 0.35, v: 0.4 }));
  this.sub(out, { f: 78, f2: 26, d: 0.9, v: 0.52 });
  this.tone({ out, type: 'triangle', f: 156, f2: 52, d: 0.3, v: 0.14 });
  this.wide(out, (o) => this.noise({ out: o, buf: 'brown', type: 'lowpass', f: 320, f2: 80, t: 0.08, a: 0.05, d: 2.2, v: 0.48 }));
  let t = 0.35;
  for (let k = 0; k < 4; k++) { t += R(0.2, 0.45); this.noise({ out: this.pan(out, k % 2 ? 0.6 : -0.6), buf: 'brown', type: 'lowpass', f: R(180, 280), t, a: 0.1, d: R(0.5, 0.8), v: 0.24 * (1 - k * 0.18) }); }
} }, { vol: 0.85, rev: 0.6 });

// fired for every spike of the frost line (8-12 in quick succession): short and varied
bake('ice_spike', { dur: 0.55, n: 4, order: 1, fn(out) {
  this.click(out, 0.1, 6000);
  this.noise({ out, f: R(3000, 4200), q: 4, d: 0.05, v: 0.22 });
  this.tone({ out, type: 'triangle', f: R(650, 800), f2: 1500, d: 0.07, v: 0.07 });
  this.tone({ out, f: 190, f2: 80, d: 0.09, v: 0.22 });
  this.noise({ out, buf: 'crackle', f: 3500, q: 1, d: 0.1, v: 0.3 });
  this.noise({ out, buf: 'tinkle', type: 'highpass', f: 2500, t: 0.01, d: 0.2, v: 0.3 });
  this.glass(out, R(2400, 3400), { t: 0.01, d: 0.25, v: 0.018, beat: 0 });
} }, { vol: 0.9, rev: 0.3 });

bake('gale', { dur: 1.4, n: 3, stereo: true, lo: true, order: 2, fn(out) {
  this.wide(out, (o, s) => this.whoosh(o, { f: 200 * (s ? 1.1 : 1), f2: 1500, q: 1.2, a: 0.05, d: 0.8, v: 0.45 }), 0.6, 0.012);
  this.whoosh(out, { f: 2200, f2: 800, q: 4, a: 0.05, d: 0.6, v: 0.12, buf: 'white' });
  this.tone({ out, f: 90, f2: 50, d: 0.4, v: 0.22 });
  this.tone({ out, f: R(700, 900), f2: R(1100, 1300), a: 0.08, d: 0.5, v: 0.016 });
  const fg = this.gain(out, 1); this.flicker(fg.gain, this.ctx.currentTime, 0.9, { rate: 20, depth: 0.35 });
  this.noise({ out: fg, f: 900, f2: 500, q: 1.5, a: 0.03, d: 0.7, v: 0.2, buf: 'pink' });
} }, { vol: 0.9, rev: 0.4 });

bake('steam', { dur: 1.5, n: 3, stereo: true, lo: true, order: 2, fn(out) {
  this.click(out, 0.1, 3000);
  this.wide(out, (o) => this.noise({ out: o, type: 'highpass', f: 1800, f2: 4800, a: 0.02, d: 1.1, v: 0.26 }), 0.6);
  this.noise({ out, buf: 'fizz', type: 'highpass', f: 3000, a: 0.01, d: 0.8, v: 0.3 });
  this.boom(out, { f: 95, f2: 38, d: 0.42, v: 0.38 });
  this.noise({ out, type: 'lowpass', f: 700, d: 0.3, v: 0.26 });
  this.noise({ out, buf: 'bubbles', f: 900, q: 0.6, d: 0.35, v: 0.25 });
} }, { rev: 0.45 });

bake('shatter', { dur: 1.7, n: 3, stereo: true, order: 2, fn(out) {
  this.click(out, 0.32, 6000);
  this.noise({ out: this.dist(out), f: 4000, q: 2, d: 0.03, v: 0.25 });
  this.shards(this.pan(out, -0.4), 10, 0.3, 0.17);
  this.shards(this.pan(out, 0.4), 10, 0.3, 0.17);
  this.wide(out, (o) => this.noise({ out: o, buf: 'tinkle', type: 'highpass', f: 2500, t: 0.02, d: 0.9, v: 0.5 }));
  this.tone({ out, f: 3200, f2: 2000, d: 0.5, v: 0.05 });
  this.boom(out, { f: 150, f2: 42, d: 0.4, v: 0.5 });
  this.noise({ out, type: 'highpass', f: 4000, f2: 9000, d: 0.5, v: 0.08 });
  [88, 91, 95].forEach((m, k) => this.glass(this.pan(out, (k - 1) * 0.5), mtof(m), { t: 0.03 + k * 0.03, d: 1.1, v: 0.026 }));
} }, { vol: 0.8, rev: 0.5 });

bake('chain', { dur: 0.9, n: 3, order: 2, fn(out) {
  const d = this.dist(out);
  let t = 0;
  for (let k = 0; k < 5; k++) {
    this.noise({ out: d, type: 'highpass', f: R(1600, 2600), t, d: 0.045, v: 0.36 });
    this.tone({ out, type: 'square', f: R(2000, 2800), f2: 300, t, d: 0.06, v: 0.028 });
    t += R(0.04, 0.07);
  }
  this.noise({ out, buf: 'arcs', type: 'highpass', f: 2200, d: 0.5, v: 0.6 });
  this.buzz(out, { f: 90, f2: 55, d: 0.4, am: 50, fc: 1100, v: 0.1 });
  this.tone({ out: this.filter('lowpass', 800, 1, out), type: 'sawtooth', f: 110, f2: 50, d: 0.4, v: 0.12 });
  this.tail(out, { buf: 'brown', f: 300, f2: 100, t: 0.05, d: 0.5, v: 0.16 });
} }, { vol: 1.15, rev: 0.35 });

S.overload = function (o) {
  S.explosion.call(this, { pos: o.pos, v: 0.85 * (o.v ?? 1) });
  S.chain.call(this, o);
};

bake('melt', { dur: 1.1, n: 3, order: 2, fn(out) {
  this.noise({ out, type: 'highpass', f: 2500, f2: 5500, a: 0.01, d: 0.6, v: 0.24 });
  this.noise({ out, buf: 'fizz', type: 'highpass', f: 3500, a: 0.01, d: 0.7, v: 0.3 });
  this.tone({ out, f: 400, f2: 950, d: 0.25, v: 0.07 });
  this.shards(out, 6, 0.1, 0.1);
  this.boom(out, { f: 130, f2: 45, d: 0.3, v: 0.38 });
  this.noise({ out, buf: 'crackle', f: 2500, q: 0.7, d: 0.4, v: 0.35 });
  for (let k = 0; k < 4; k++) this.drop(out, { f: R(600, 1200), rise: 2, t: 0.15 + k * R(0.08, 0.15), d: 0.04, v: 0.03 });
} }, { rev: 0.4 });

bake('freeze', { dur: 1.2, n: 3, order: 2, fn(out) {
  this.noise({ out, f: 6000, f2: 1500, q: 2, d: 0.35, v: 0.18 });
  this.noise({ out, buf: 'fizz', f: 6000, f2: 2500, q: 1.2, a: 0.02, d: 0.4, v: 0.3 });
  this.noise({ out, buf: 'crackle', f: 3000, q: 1.2, t: 0.03, d: 0.35, v: 0.3 });
  this.noise({ out, buf: 'tinkle', type: 'highpass', f: 2500, t: 0.05, d: 0.5, v: 0.35 });
  [84, 88, 91].forEach((m, k) => this.fm({ out, f: mtof(m), ratio: 3.5, idx: 1.5, dm: 0.06, t: k * 0.04, d: 0.7, v: 0.03 }));
  this.tone({ out, f: 220, f2: 90, d: 0.12, v: 0.12 });
} }, { rev: 0.45 });

bake('fizzle', { dur: 0.5, n: 3, order: 3, fn(out) {
  this.noise({ out, buf: 'fizz', type: 'highpass', f: 3000, f2: 5000, d: 0.35, v: 0.33 });
  this.noise({ out, type: 'highpass', f: 3000, f2: 5000, d: 0.3, v: 0.12 });
  this.tone({ out, f: 600, f2: 200, d: 0.08, v: 0.045 });
} }, { rev: 0.2 });

bake('zap', { dur: 0.15, n: 4, order: 3, fn(out) {
  this.noise({ out: this.dist(out), type: 'highpass', f: R(1800, 3200), d: 0.035, v: 0.22 });
  this.noise({ out, buf: 'arcs', type: 'highpass', f: 2500, d: 0.06, v: 0.3 });
  this.tone({ out, type: 'square', f: R(1500, 3000), f2: 400, d: 0.04, v: 0.016 });
} }, { vol: 1.0, rev: 0.2 });

// duration is dynamic (o.d), so this one stays live: two texture layers = 2 nodes
S.sizzle = function (o) {
  const out = this.bus(o.pos, o.v || 0.6, 0.2); if (!out) return;
  const d = o.d || 0.5;
  this.noise({ out, buf: 'fizz', type: 'highpass', f: 4000, f2: 6000, a: 0.05, d, v: 0.7 });
  this.noise({ out, buf: 'crackle', f: 3000, q: 0.8, a: 0.03, d, v: 0.55 });
};

bake('splash', { dur: 0.9, n: 4, order: 2, fn(out) {
  this.noise({ out, type: 'lowpass', f: 2400, f2: 400, d: 0.32, v: 0.3 });
  this.tone({ out, f: 300, f2: 120, d: 0.15, v: 0.13 });
  this.noise({ out, type: 'highpass', f: 4000, t: 0.01, d: 0.3, v: 0.06 });
  this.noise({ out, buf: 'bubbles', type: 'highpass', f: 400, t: 0.03, d: 0.45, v: 0.4 });
  for (let k = 0; k < 4; k++) this.drop(out, { f: R(700, 1800), rise: R(1.6, 2.4), t: 0.04 + k * R(0.03, 0.08), d: R(0.03, 0.05), v: R(0.025, 0.045) });
} }, { rev: 0.2 });

// generic energy wind-up (enemies' strikes, geysers, meteor calls)
bake('charge', { dur: 0.7, n: 3, order: 3, fn(out) {
  this.tone({ out, f: 220, f2: 880, a: 0.05, d: 0.45, v: 0.05 });
  this.fm({ out, f: 440, f2: 1320, ratio: 2, idx: 0.6, dm: 0.4, a: 0.3, d: 0.2, v: 0.02 });
  this.swell(out, { f: 400, f2: 3500, d: 0.4, v: 0.1, q: 2 });
  this.swell(out, { buf: 'tinkle', type: 'highpass', f: 2500, d: 0.4, v: 0.2 });
} }, { vol: 0.8, rev: 0.3 });

bake('weave', { dur: 1.8, n: 2, stereo: true, lo: true, order: 3, fn(out) {
  [0, 4, 7, 12, 16].forEach((st, k) => this.tone({ out: this.pan(out, (k - 2) * 0.3), f: mtof(62 + st), f2: mtof(74 + st), t: k * 0.05, a: 0.08, d: 0.7, v: 0.04 }));
  [74, 78, 81, 86].forEach((m, k) => this.fm({ out: this.pan(out, (k - 1.5) * 0.4), f: mtof(m + 12), ratio: 2, idx: 1, dm: 0.1, t: 0.26 + k * 0.03, d: 1.1, v: 0.025 }));
  this.wide(out, (o) => this.noise({ out: o, type: 'highpass', f: 3000, f2: 8000, a: 0.25, d: 0.5, v: 0.08 }));
  this.tone({ out, f: 70, f2: 140, a: 0.2, d: 0.5, v: 0.18 });
  this.sub(out, { f: 60, f2: 30, t: 0.25, d: 0.6, v: 0.32 });
  this.click(out, 0.15, 3000, 0.25);
} }, { vol: 0.85, rev: 0.55 });

// channelled beam (dynamic duration o.d): live chorus hum + shimmer + sparkle
S.beam = function (o) {
  const out = this.bus(o.pos, (o.v || 1) * 0.7, 0.4); if (!out) return;
  const d = o.d || 2;
  const lp = this.filter('lowpass', 1500, 2, out);
  this.tone({ out: lp, type: 'sawtooth', f: 110, f2: 105, a: 0.1, d, v: 0.09 });
  this.tone({ out: lp, type: 'sawtooth', f: 110.8, f2: 106, a: 0.12, d, v: 0.07 });
  this.tone({ out, f: 880, f2: 870, a: 0.1, d, v: 0.025 });
  this.tone({ out, f: 1321, f2: 1306, a: 0.2, d: d * 0.9, v: 0.012 });
  this.noise({ out, f: 2500, q: 2, a: 0.1, d, v: 0.07 });
  this.noise({ out, buf: 'tinkle', type: 'highpass', f: 3000, a: 0.1, d, v: 0.18 });
  this.click(out, 0.12, 3000);
  this.sub(out, { f: 90, f2: 45, d: 0.4, v: 0.18 });
};

bake('updraft', { dur: 1.5, n: 2, stereo: true, lo: true, order: 3, fn(out) {
  this.wide(out, (o, s) => this.noise({ out: o, f: 200 * (s ? 1.1 : 1), f2: 2600, q: 1, a: 0.05, d: 0.9, v: 0.22, buf: 'pink' }), 0.5, 0.01);
  this.whoosh(out, { f: 1200, f2: 4500, q: 3, a: 0.1, d: 0.6, v: 0.08, buf: 'white' });
  this.tone({ out, f: 80, f2: 55, d: 0.3, v: 0.18 });
  [74, 78, 81, 86].forEach((m, k) => this.note(this.pan(out, (k - 1.5) * 0.35), m, k * 0.06, 0.028, 0.8, 'bell'));
} }, { vol: 0.6, rev: 0.4 });

bake('blink', { dur: 0.8, n: 3, stereo: true, order: 3, fn(out) {
  this.swell(out, { f: 1200, f2: 6000, d: 0.05, v: 0.12, q: 1 });
  this.tone({ out, f: 1700, f2: 280, t: 0.04, d: 0.18, v: 0.1 });
  this.wide(out, (o) => this.noise({ out: o, type: 'highpass', f: 3000, f2: 800, t: 0.04, d: 0.2, v: 0.12 }), 0.7, 0.008);
  this.tone({ out, f: 200, f2: 900, t: 0.1, d: 0.14, v: 0.045 });
  this.sub(out, { f: 110, f2: 55, t: 0.04, d: 0.15, v: 0.14 });
  this.fm({ out, f: mtof(pick([90, 93, 95])), ratio: 3.01, idx: 1, dm: 0.05, t: 0.06, d: 0.35, v: 0.022 });
  this.wide(out, (o) => this.noise({ out: o, buf: 'tinkle', type: 'highpass', f: 3500, t: 0.06, d: 0.3, v: 0.25 }));
} }, { rev: 0.3 });

// "time-stop": reverse swell snapping into a hollow whoomp, then a glassy chime
bake('perfect_dodge', { dur: 2.2, n: 2, stereo: true, lo: true, order: 3, fn(out) {
  this.wide(out, (o) => this.swell(o, { f: 400, f2: 7000, d: 0.16, v: 0.18, q: 0.7 }));
  this.boom(out, { f: 90, f2: 35, t: 0.16, d: 0.9, v: 0.42 });
  this.tone({ out, f: 1760, f2: 440, t: 0.16, d: 0.9, v: 0.045 });
  this.tone({ out, type: 'triangle', f: 220, f2: 110, t: 0.16, a: 0.02, d: 1.2, v: 0.09 });
  this.wide(out, (o) => this.noise({ out: o, f: 3000, f2: 400, q: 2, t: 0.16, a: 0.01, d: 0.8, v: 0.1 }), 0.6, 0.01);
  [86, 93, 98].forEach((m, k) => this.glass(this.pan(out, (k - 1) * 0.5), mtof(m), { t: 0.2 + k * 0.08, d: 1.6, v: 0.04, kind: 'bowl' }));
  this.wide(out, (o) => this.noise({ out: o, buf: 'tinkle', type: 'highpass', f: 3000, t: 0.2, a: 0.1, d: 1.0, v: 0.2 }));
} }, { vol: 0.85, rev: 0.8 });

// =====================================================================
// Ultimate
// =====================================================================
bake('ult_cast', { dur: 2.6, n: 2, stereo: true, lo: true, order: 3, fn(out) {
  this.wide(out, (o) => this.swell(o, { f: 200, f2: 6000, d: 0.4, v: 0.24, q: 0.6 }));
  [50, 57, 62, 69, 74, 81].forEach((m, k) => this.tone({ out: this.pan(out, (k - 2.5) * 0.25), type: k % 2 ? 'triangle' : 'sine', f: mtof(m), f2: mtof(m + 12), t: k * 0.04, a: 0.12, d: 1.1, v: 0.05 }));
  [62, 69, 74].forEach((m, k) => {
    const lp = this.filter('lowpass', 1800, 0.8, this.pan(out, (k - 1) * 0.6));
    this.tone({ out: lp, type: 'sawtooth', f: mtof(m) * 0.998, f2: mtof(m + 12), a: 0.35, d: 0.9, v: 0.02 });
    this.tone({ out: lp, type: 'sawtooth', f: mtof(m) * 1.003, f2: mtof(m + 12) * 1.003, a: 0.35, d: 0.9, v: 0.02 });
  });
  this.tone({ out, f: 55, f2: 110, a: 0.25, d: 0.9, v: 0.28 });
  this.boom(out, { f: 70, f2: 28, t: 0.38, d: 1.0, v: 0.55 });
  this.click(out, 0.28, 2500, 0.38);
  [86, 93, 98].forEach((m, k) => this.fm({ out: this.pan(out, (k - 1) * 0.6), f: mtof(m), ratio: 3.5, idx: 2, dm: 0.1, t: 0.38 + k * 0.04, d: 1.3, v: 0.03 }));
  this.wide(out, (o) => this.noise({ out: o, type: 'highpass', f: 2500, f2: 9000, a: 0.3, d: 0.8, v: 0.1 }));
  this.wide(out, (o) => this.tail(o, { buf: 'brown', f: 400, f2: 70, t: 0.4, d: 1.6, v: 0.24 }));
} }, { vol: 1.0, rev: 0.75 });

// core of the ultimate impact; the element's blast is layered on top
bake('ult_core', { dur: 3.2, n: 2, stereo: true, lo: true, order: 3, fn(out) {
  this.click(out, 0.38, 1800);
  this.noise({ out: this.dist(out), type: 'lowpass', f: 2600, d: 0.12, v: 0.5 });
  this.sub(out, { f: 70, f2: 20, d: 1.8, v: 0.85 });
  this.tone({ out, type: 'triangle', f: 140, f2: 40, d: 0.6, v: 0.24 });
  this.wide(out, (o) => this.noise({ out: o, type: 'lowpass', f: 3000, f2: 90, d: 1.8, v: 0.55, buf: 'pink' }), 0.7, 0.012);
  this.wide(out, (o) => this.tail(o, { buf: 'brown', f: 260, f2: 50, t: 0.15, d: 2.6, v: 0.36 }));
} }, { rev: 0.8 });
S.ult_boom = function (o) {
  const out = this.bus(o.pos, (o.v ?? 1), 0.8); if (!out) return;
  this.baked('ult_core', out);
  if (ELS.includes(o.el)) this.baked('blast_' + o.el, out, { v: 0.45 });
};
