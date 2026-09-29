// Traversal and world-system sounds: climbing, weather, wildfire, props.
import { randRange as R } from '../util.js';
import { S } from './registry.js';

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
