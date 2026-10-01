// The outer lands, one data file per region (see README.md). Order does not matter.
import harbor from './harbor.js';
import ashfield from './ashfield.js';
import archive from './archive.js';
import cliffs from './cliffs.js';
import glacier from './glacier.js';
import { northeast, southeast, southwest } from './between.js';

export const OUTER = [ashfield, southeast, harbor, southwest, archive, cliffs, glacier, northeast];
for (const r of OUTER) r.a = (r.dir * Math.PI) / 180;

// Beyond this radius a point belongs to an outer region (inside it is the vale and its passes).
export const OUTER_R = 250;

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Blend weights of every outer region at (x, z) by direction, normalised. Shared scratch array.
const W = new Float32Array(OUTER.length);
export function outerWeights(x, z) {
  const th = Math.atan2(z, x);
  let sum = 0;
  for (let i = 0; i < OUTER.length; i++) { const d = wrap(th - OUTER[i].a) / 0.5; sum += (W[i] = Math.exp(-d * d)); }
  for (let i = 0; i < OUTER.length; i++) W[i] /= sum;
  return W;
}

// The outer region a point belongs to: the one whose direction is closest.
export function outerRegion(x, z) {
  const th = Math.atan2(z, x);
  let best = OUTER[0], bd = 1e9;
  for (const r of OUTER) { const d = Math.abs(wrap(th - r.a)); if (d < bd) { bd = d; best = r; } }
  return best;
}
