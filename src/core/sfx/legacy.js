// Non-spell sounds carried over from the original library (enemies, player
// movement, UI, story props). Spell / element / progression sounds live in
// spells.js, combat.js and ui.js.
import { randRange, rand } from '../util.js';
import { S, mtof } from './registry.js';

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
S.glide = function () {
  const out = this.bus(null, 0.8, 0.2); if (!out) return;
  this.noise({ out, f: 400, f2: 1500, q: 1, d: 0.35, v: 0.2 });
  this.tone({ out, f: 587, t: 0.02, d: 0.3, v: 0.03 });
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
S.quest_start = function () {
  const out = this.bus(null, 1, 0.5); if (!out) return;
  [74, 78, 81, 86].forEach((m, i) => this.note(out, m, i * 0.09, 0.06, 1.2));
};
S.quest_done = function () {
  const out = this.bus(null, 1, 0.6); if (!out) return;
  [74, 81, 86, 90, 93].forEach((m, i) => this.note(out, m, i * 0.1, 0.06, 1.6));
  this.noise({ out, type: 'highpass', f: 6000, t: 0.3, a: 0.2, d: 0.8, v: 0.05 });
};
S.ult_ready = function () {
  const out = this.bus(null, 1, 0.6); if (!out) return;
  [74, 81, 86].forEach((m, i) => this.note(out, m, i * 0.07, 0.06, 1.2));
  this.tone({ out, f: 440, f2: 880, a: 0.1, d: 0.5, v: 0.03 });
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

// ----- enemies (overhaul) -----
// Bright "ting" right before a dangerous enemy attack lands (BotW-style glint)
S.enemy_glint = function (o) {
  const out = this.bus(o.pos, 1, 0.45); if (!out) return;
  this.tone({ out, f: 2640, f2: 3520, d: 0.35, v: 0.07 });
  this.tone({ out, type: 'triangle', f: 5280, d: 0.22, v: 0.03 });
  this.noise({ out, type: 'highpass', f: 7000, d: 0.12, v: 0.06 });
};
S.shield_clang = function (o) {
  const out = this.bus(o.pos, 1, 0.3); if (!out) return;
  this.tone({ out, f: 210, f2: 120, d: 0.18, v: 0.4 });
  [820, 1330, 1960, 2710].forEach((f, i) => this.tone({ out, type: 'triangle', f: f * randRange(0.97, 1.03), d: 0.5 - i * 0.08, v: 0.06 }));
  this.noise({ out, f: 3200, q: 4, d: 0.07, v: 0.35 });
};
S.shield_break = function (o) {
  const out = this.bus(o.pos, 1, 0.4); if (!out) return;
  this.tone({ out, f: 140, f2: 45, d: 0.4, v: 0.6 });
  this.noise({ out, type: 'lowpass', f: 1800, f2: 200, d: 0.5, v: 0.45 });
  [640, 990, 1450].forEach((f, i) => this.tone({ out, type: 'triangle', f, f2: f * 0.8, t: i * 0.05, d: 0.6, v: 0.05 }));
  this.crackle(out, 10, 0.35, 0.14, 1800);
};
S.arrow_draw = function (o) {
  const out = this.bus(o.pos, 0.9, 0.2); if (!out) return;
  this.noise({ out, f: 500, f2: 1600, q: 5, a: 0.5, d: 0.25, v: 0.12 });
  this.tone({ out, type: 'sawtooth', f: 180, f2: 260, a: 0.55, d: 0.2, v: 0.02 });
};
S.arrow_loose = function (o) {
  const out = this.bus(o.pos, 1, 0.3); if (!out) return;
  this.tone({ out, type: 'triangle', f: 330, f2: 180, d: 0.18, v: 0.18 });
  this.noise({ out, f: 1200, f2: 4200, q: 1.5, d: 0.16, v: 0.3 });
  this.tone({ out, f: 1760, f2: 1400, d: 0.25, v: 0.03 });
};
S.burrow = function (o) {
  const out = this.bus(o.pos, 0.9, 0.2); if (!out) return;
  this.noise({ out, buf: 'brown', type: 'lowpass', f: 320, f2: 140, a: 0.1, d: o.d || 0.7, v: 0.5 });
  this.crackle(out, 6, 0.5, 0.06, 900);
};
S.root_burst = function (o) {
  const out = this.bus(o.pos, 1, 0.35); if (!out) return;
  this.tone({ out, f: 95, f2: 35, d: 0.45, v: 0.8 });
  this.noise({ out, type: 'lowpass', f: 1400, f2: 160, d: 0.6, v: 0.55 });
  for (let i = 0; i < 8; i++) this.noise({ out, t: Math.random() * 0.25, d: 0.05, v: 0.16, f: randRange(500, 1800), q: 3 });
};
S.enemy_panic = function (o) {
  const out = this.bus(o.pos, 0.8, 0.3); if (!out) return;
  const bp = this.filter('bandpass', 1400, 5, out);
  for (let i = 0; i < 3; i++) this.tone({ out: bp, type: 'sawtooth', f: randRange(560, 680), f2: randRange(820, 980), t: i * 0.13, d: 0.12, v: 0.2 });
};
S.body_fall = function (o) {
  const out = this.bus(o.pos, o.v || 1, 0.2); if (!out) return;
  this.tone({ out, f: 120, f2: 40, d: 0.25, v: 0.5 });
  this.noise({ out, type: 'lowpass', f: 700, f2: 150, d: 0.3, v: 0.35 });
};
S.enemy_dissolve = function (o) {
  const out = this.bus(o.pos, o.v || 1, 0.6); if (!out) return;
  this.noise({ out, type: 'highpass', f: 2600, f2: 6000, a: 0.15, d: 0.9, v: 0.12 });
  this.noise({ out, f: 1400, f2: 380, q: 1, a: 0.2, d: 1.0, v: 0.16 });
  const base = [74, 77, 81, 84];
  for (let i = 0; i < 3; i++) this.note(out, base[i + (Math.random() < 0.5 ? 0 : 1)], 0.2 + i * 0.12, 0.035, 1.3);
};
S.sentinel_charge = function (o) {
  const out = this.bus(o.pos, 1, 0.5); if (!out) return;
  this.tone({ out, f: 220, f2: 880, a: 0.05, d: o.d || 1.1, v: 0.08 });
  this.tone({ out, f: 223, f2: 890, a: 0.05, d: o.d || 1.1, v: 0.08 });
  this.noise({ out, type: 'highpass', f: 3000, f2: 7000, a: 0.3, d: o.d || 1.1, v: 0.05 });
};
