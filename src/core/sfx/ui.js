// Progression, mana and crystal sounds. Mostly 2D and rare, so they run live
// (richer layering costs nothing noticeable once in a while).
import { randRange as R } from '../util.js';
import { S, mtof } from './registry.js';
import { bake } from './spells.js';

S.element_switch = function (o) {
  const out = this.bus(null, 1, 0.2); if (!out) return;
  const m = { arcane: 81, fire: 76, wind: 79, frost: 84, storm: 83, water: 78 }[o.el] || 80;
  this.fm({ out, f: mtof(m), ratio: 2, idx: 0.7, dm: 0.05, d: 0.4, v: 0.045 });
  this.tone({ out, f: mtof(m + 12), t: 0.03, d: 0.25, v: 0.012 });
  this.noise({ out, type: 'highpass', f: 4000, d: 0.08, v: 0.035 });
  switch (o.el) {
    case 'fire': this.noise({ out, buf: 'crackle', f: 2800, q: 0.7, d: 0.22, v: 0.22 }); this.noise({ out, type: 'lowpass', f: 1200, d: 0.08, v: 0.08, buf: 'pink' }); break;
    case 'frost': this.noise({ out, buf: 'tinkle', type: 'highpass', f: 3000, d: 0.28, v: 0.28 }); break;
    case 'storm': this.noise({ out, buf: 'arcs', type: 'highpass', f: 3000, d: 0.12, v: 0.22 }); break;
    case 'water': this.drop(out, { f: 560, rise: 2.3, t: 0.01, d: 0.05, v: 0.05 }); this.drop(out, { f: 900, rise: 2, t: 0.07, d: 0.04, v: 0.025 }); break;
    case 'wind': this.whoosh(out, { f: 600, f2: 2400, q: 2, a: 0.03, d: 0.15, v: 0.1 }); break;
    case 'arcane': this.tone({ out, f: mtof(m + 19), t: 0.05, d: 0.3, v: 0.01 }); break;
  }
};

S.levelup = function () {
  const out = this.bus(null, 0.7, 0.6); if (!out) return;
  [62, 66, 69, 74, 78, 81, 86].forEach((m, i) => this.note(this.pan(out, (i - 3) * 0.15), m, i * 0.06, 0.05, 1.4, 'bell'));
  [62, 66, 69].forEach((m) => this.tone({ out, type: 'triangle', f: mtof(m), t: 0.45, a: 0.1, d: 1.6, v: 0.045 }));
  [50, 57].forEach((m) => this.tone({ out, f: mtof(m), t: 0.4, a: 0.15, d: 1.6, v: 0.05 }));
  this.wide(out, (o) => this.noise({ out: o, type: 'highpass', f: 5000, t: 0.35, a: 0.2, d: 1.0, v: 0.04 }));
  this.wide(out, (o) => this.noise({ out: o, buf: 'tinkle', type: 'highpass', f: 3000, t: 0.4, a: 0.1, d: 1.0, v: 0.18 }));
};

S.skill_learn = function () {
  const out = this.bus(null, 1, 0.55); if (!out) return;
  [69, 76, 81, 88].forEach((m, i) => this.note(out, m, i * 0.05, 0.06, 1.3, 'bell'));
  this.tone({ out, type: 'triangle', f: mtof(57), a: 0.02, d: 0.9, v: 0.06 });
  this.noise({ out, type: 'highpass', f: 5200, a: 0.05, d: 0.5, v: 0.045 });
  this.sub(out, { f: 110, f2: 55, d: 0.3, v: 0.12 });
};

S.mana_empty = function () {
  const out = this.bus(null, 1, 0.1); if (!out) return;
  const lp = this.filter('lowpass', 1300, 0.7, out);
  this.tone({ out: lp, type: 'triangle', f: 220, f2: 180, d: 0.12, v: 0.1 });
  this.tone({ out: lp, type: 'triangle', f: 196, f2: 150, t: 0.1, d: 0.14, v: 0.1 });
  this.noise({ out, buf: 'fizz', type: 'highpass', f: 2500, d: 0.15, v: 0.06 });
};

// mana mote absorbed; o.n (combo count) climbs the pentatonic so streams sound like a run
const ORB = [86, 88, 90, 93, 95, 98, 100, 102, 105];
S.mana_orb = function (o) {
  const out = this.bus(o.pos || null, 1.25 * (o.v ?? 1), 0.25, null, 0.05); if (!out) return;
  const n = Math.max(0, Math.min(ORB.length - 1, o.n | 0));
  const f = mtof(ORB[n]);
  this.fm({ out, f, ratio: 2, idx: 0.6, dm: 0.03, a: 0.003, d: 0.22, v: 0.026 });
  this.tone({ out, f: f * 2, a: 0.002, d: 0.08, v: 0.007 });
  this.noise({ out, buf: 'tinkle', type: 'highpass', f: 4000, d: 0.12, v: 0.1 });
};
// soft warning pulse (low mana)
S.mana_low = function () {
  const out = this.bus(null, 1, 0.15); if (!out) return;
  const lp = this.filter('lowpass', 900, 0.7, out);
  this.tone({ out: lp, type: 'triangle', f: mtof(57), a: 0.02, d: 0.25, v: 0.08 });
  this.tone({ out: lp, type: 'triangle', f: mtof(54), t: 0.18, a: 0.02, d: 0.3, v: 0.07 });
  this.tone({ out, f: 110, a: 0.02, d: 0.2, v: 0.07 });
  this.tone({ out, f: 92.5, t: 0.18, a: 0.02, d: 0.24, v: 0.06 });
  this.noise({ out, f: 500, q: 1, a: 0.05, d: 0.2, v: 0.05, buf: 'pink' });
};
// mana refilled completely
S.mana_full = function () {
  const out = this.bus(null, 1, 0.4); if (!out) return;
  [81, 86, 90, 93].forEach((m, i) => this.fm({ out, f: mtof(m), ratio: 2, idx: 0.5, dm: 0.05, t: i * 0.045, d: 0.5, v: 0.016 }));
  this.swell(out, { type: 'highpass', f: 4000, f2: 8000, d: 0.2, v: 0.035, buf: 'white', r: 0.2 });
  this.noise({ out, buf: 'tinkle', type: 'highpass', f: 3000, a: 0.1, d: 0.4, v: 0.1 });
};

// level-up crossroads panel opens: suspended (Dsus2) swell, unresolved and expectant
S.levelup_open = function () {
  const out = this.bus(null, 1, 0.65); if (!out) return;
  this.wide(out, (o) => this.swell(o, { f: 300, f2: 5000, d: 0.45, v: 0.12, q: 0.8, r: 0.15 }));
  [50, 57, 62, 64, 69].forEach((m, i) => this.tone({ out: this.pan(out, (i - 2) * 0.3), type: i % 2 ? 'triangle' : 'sine', f: mtof(m), a: 0.3, d: 1.6, v: 0.035 }));
  [74, 76, 81, 88].forEach((m, i) => this.fm({ out: this.pan(out, (i - 1.5) * 0.4), f: mtof(m), ratio: 2, idx: 1, dm: 0.08, t: 0.3 + i * 0.07, d: 1.2, v: 0.03 }));
  this.tone({ out, f: 55, a: 0.4, d: 0.8, v: 0.1 });
  this.wide(out, (o) => this.noise({ out: o, buf: 'tinkle', type: 'highpass', f: 3000, t: 0.3, a: 0.2, d: 1.0, v: 0.18 }));
  this.noise({ out, type: 'highpass', f: 2000, f2: 6000, t: 0.35, d: 0.5, v: 0.05 });
};
// choosing a card: confident resolved D major chime
S.skill_pick = function () {
  const out = this.bus(null, 1, 0.5); if (!out) return;
  this.click(out, 0.1, 4000);
  [74, 78, 81].forEach((m, i) => this.note(out, m, i * 0.025, 0.045, 0.9, 'bell'));
  this.fm({ out, f: mtof(86), ratio: 3.5, idx: 1.5, dm: 0.08, t: 0.06, d: 1.2, v: 0.05 });
  this.sub(out, { f: 130, f2: 65, d: 0.25, v: 0.14 });
  this.noise({ out, type: 'highpass', f: 5000, d: 0.3, v: 0.04 });
};
// learning a brand-new technique: short fanfare quoting the theme's opening (A D E F#)
S.skill_unlock_active = function () {
  const out = this.bus(null, 1, 0.7); if (!out) return;
  // warm pad (D major), detuned saws under a lowpass
  [50, 57, 62, 66].forEach((m, i) => {
    const lp = this.filter('lowpass', 1400, 0.7, this.pan(out, (i - 1.5) * 0.4));
    this.tone({ out: lp, type: 'sawtooth', f: mtof(m) * 0.997, a: 0.25, d: 1.9, v: 0.016 });
    this.tone({ out: lp, type: 'sawtooth', f: mtof(m) * 1.003, a: 0.3, d: 1.9, v: 0.016 });
  });
  // brass-ish theme quote, octave-doubled by bells
  const lead = this.filter('lowpass', 2400, 0.9, out);
  [[69, 0, 0.14], [74, 0.11, 0.14], [76, 0.22, 0.14], [78, 0.33, 1.4]].forEach(([m, t, d]) => {
    this.tone({ out: lead, type: 'sawtooth', f: mtof(m), t, a: 0.015, d, v: 0.028 });
    this.tone({ out, type: 'triangle', f: mtof(m), t, a: 0.01, d, v: 0.04 });
    this.note(out, m + 12, t, 0.03, 1.2, 'bell');
  });
  // bloom on arrival
  [86, 93].forEach((m, i) => this.glass(this.pan(out, i ? 0.5 : -0.5), mtof(m), { t: 0.34, d: 1.8, v: 0.03, kind: 'bowl' }));
  this.boom(out, { f: 90, f2: 40, t: 0.33, d: 0.6, v: 0.26 });
  this.click(out, 0.12, 3000, 0.33);
  this.tone({ out, f: mtof(38), t: 0.3, a: 0.3, d: 1.2, v: 0.12 });
  this.wide(out, (o) => this.noise({ out: o, buf: 'tinkle', type: 'highpass', f: 3000, t: 0.3, a: 0.1, d: 1.4, v: 0.28 }));
  this.wide(out, (o) => this.noise({ out: o, type: 'highpass', f: 5000, t: 0.3, a: 0.15, d: 1.2, v: 0.05 }));
};

// glowing crystal: soft resonant hum with slow beating (spatial, ~1.5 s)
bake('crystal_hum', { dur: 1.9, n: 3, lo: true, order: 4, fn(out, i) {
  const f = mtof([74, 76, 78][i % 3]);
  this.tone({ out, f, a: 0.35, d: 1.2, v: 0.04 });
  this.tone({ out, f: f + 0.8, a: 0.4, d: 1.1, v: 0.03 });
  this.tone({ out, f: f * 2.32, a: 0.3, d: 0.9, v: 0.01 });
  this.tone({ out, f: f * 0.5, a: 0.45, d: 1.1, v: 0.03 });
  this.noise({ out, buf: 'tinkle', type: 'highpass', f: 3000, a: 0.3, d: 1.0, v: 0.08 });
  this.noise({ out, f: f * 4, q: 8, a: 0.3, d: 1.0, v: 0.03 });
} }, { vol: 0.8, rev: 0.45 });

// magic crystal shattering: glassy crack, shard spray, descending pentatonic cascade
bake('crystal_break', { dur: 2.0, n: 2, stereo: true, order: 4, fn(out) {
  this.click(out, 0.3, 6000);
  this.noise({ out: this.dist(out), f: 4000, q: 2, d: 0.03, v: 0.22 });
  this.shards(this.pan(out, -0.5), 8, 0.25, 0.15);
  this.shards(this.pan(out, 0.5), 8, 0.25, 0.15);
  this.wide(out, (o) => this.noise({ out: o, buf: 'tinkle', type: 'highpass', f: 2500, t: 0.01, d: 1.0, v: 0.45 }));
  [98, 95, 93, 90, 86].forEach((m, k) => this.glass(this.pan(out, R(-0.7, 0.7)), mtof(m), { t: 0.03 + k * 0.05, d: 1.2, v: 0.028 }));
  this.fm({ out, f: mtof(86), ratio: 3.5, idx: 2.5, dm: 0.1, t: 0.02, d: 1.6, v: 0.028 });
  this.sub(out, { f: 150, f2: 60, d: 0.25, v: 0.24 });
  this.wide(out, (o) => this.noise({ out: o, type: 'highpass', f: 5000, f2: 9000, d: 0.6, v: 0.06 }));
} }, { rev: 0.55 });
