// World layout: landmarks, roads and named regions of the Hanui Vale.
// North is -Z. Units are meters.
import { OUTER_R, outerRegion } from './regions/index.js';

// The whole map is a square of `size` metres centred on the origin; the Hanui Vale is the
// ring-walled bowl in the middle (r ≈ 214). `bound` is how far the player can go.
export const WORLD = { size: 1280, half: 640, bound: 612 };

// Passes cut through the vale's ring mountains towards the outer lands: [x, z, floor height].
// Inside the ring (r < 232) the terrain is only lowered towards the floor, never raised, so the
// vale keeps its shape; outside, the floor is also filled in so the way through is smooth.
export const PASSES = [
  { id: 'south', w: 14, pts: [[30, 193, 7], [37, 240, 28], [44, 285, 30], [53, 340, 20]] },
  { id: 'east', w: 14, pts: [[192, 32, 18], [247, 41, 40], [296, 49, 34], [336, 55, 28]] },
  { id: 'west', w: 15, pts: [[-204, -21, 34], [-249, -26, 46], [-298, -31, 55], [-338, -35, 60]] },
  { id: 'north', w: 14, pts: [[-34, -202, 57], [-41, -247, 70], [-50, -296, 80], [-56, -335, 86]] },
  { id: 'northwest', w: 13, pts: [[-158, -114, 12], [-203, -146, 40], [-244, -175, 56], [-276, -198, 66]] },
];

export const POI = {
  tower: { x: -27, z: 153 },
  towerYard: { x: -14, z: 146, h: 24 },
  training: { x: -3, z: 141 },
  grave: { x: -36, z: 136 },
  village: { x: 0, z: 20, h: 8 },
  bellTower: { x: 6, z: 10 },
  lake: { x: -78, z: 58, r: 40 },
  island: { x: -84, z: 64 },
  frost: { x: -34, z: -170, h: 56 },
  storm: { x: -170, z: -24, h: 34 },
  rift: { x: 126, z: -120 },
  meadow: { x: 80, z: 64 },
  spawn: { x: -8, z: 150 },
};

export const PATHS = [
  { id: 'tower', h0: 24, h1: 8, pts: [[-12, 136], [-6, 114], [2, 94], [6, 74], [3, 50]] },
  { id: 'frost', h0: 8, h1: 56, pts: [[-2, -6], [-8, -38], [-15, -74], [-22, -108], [-30, -140], [-34, -156]] },
  { id: 'storm', h0: 8, h1: 34, pts: [[-28, 12], [-62, 4], [-100, -6], [-132, -18], [-154, -24]] },
  { id: 'rift', h0: 8, h1: 5, pts: [[24, 2], [52, -30], [80, -64], [104, -95]] },
  { id: 'lake', h0: 8, h1: 1.5, pts: [[-24, 34], [-40, 44]] },
  { id: 'meadow', h0: 8, h1: 12, pts: [[26, 32], [52, 48], [74, 60]] },
];

// The first point of each approach meets its country road, the last meets the ring.
// These are surface routes on the existing village grade. The old road beds still seed scatter.
export const VILLAGE_LANES = {
  ring: [
    [-9.7, 13], [-9.1, 9.2], [-7, 5.6], [-4, 2.6], [-1, -0.7],
    [2, -2.5], [6, -3.1], [10, -1.9], [12.4, -0.2], [13, 2.6],
    [13.6, 5.5], [16.2, 5.8], [18.9, 7.9], [20.8, 10.5], [20.9, 14.2],
    [19.6, 17.6], [19.7, 20.5], [17.6, 23.2], [13.2, 24.6], [9, 24.6],
    [5, 24.2], [1.6, 23.7], [-1.7, 21.4], [-5.5, 19.9], [-8.7, 17.4],
    [-9.7, 13],
  ],
  tower: [
    [3.875, 57], [2.8, 54.5], [1, 52], [0.45, 49.5], [1.2, 47.3],
    [2.9, 45], [4.9, 41], [5.6, 37], [5.4, 33],
    [5, 28], [5, 24.2],
  ],
  frost: [
    [-3.125, -12], [-2.2, -10], [-0.2, -7.6], [1.1, -5.4], [2, -2.5],
  ],
  storm: [
    [-28, 12], [-25.6, 14.3], [-22.5, 14.9], [-18, 14.4], [-13.4, 12.8],
    [-9.7, 13],
  ],
  rift: [
    [30.125, -5], [26, -5.6], [22, -6.2], [17.7, -5.8], [14, -4.8],
    [11.5, -3.5], [10, -1.9],
  ],
  lake: [
    [-24, 34], [-24.6, 31.4], [-23.6, 29.2], [-21, 27.2], [-17.7, 25.6],
    [-14.6, 23.6], [-12.1, 21.3], [-9.9, 20], [-8.7, 17.4],
  ],
  meadow: [
    [39, 40], [38.3, 41.4], [36.3, 43.8], [33.7, 45], [30, 44.4],
    [26, 42.6], [23.8, 41.6], [20.6, 40.5], [16.9, 38.6], [14.1, 36],
    [12.3, 32.8], [11.4, 29], [9, 24.6],
  ],
};

export const REGIONS = [
  { id: 'village', name: '하늬 마을', en: 'HANUI VILLAGE', x: 0, z: 18, r: 56, music: 'village', safe: true, lv: 0 },
  { id: 'tower', name: '모라의 언덕', en: "MORA'S HILL", x: -16, z: 146, r: 40, lv: 0 },
  { id: 'lake', name: '거울 호수', en: 'MIRROR LAKE', x: -78, z: 58, r: 50, lv: 0 },
  { id: 'meadow', name: '노을 들판', en: 'SUNSET MEADOW', x: 80, z: 62, r: 42, lv: 0 },
  { id: 'frost', name: '서리봉 성소', en: 'SANCTUM OF FROST', x: -34, z: -170, r: 36, music: 'shrine', lv: 1 },
  { id: 'frostpass', name: '서리봉 오르막', en: 'FROSTPEAK PASS', x: -20, z: -112, r: 46, lv: 1 },
  { id: 'storm', name: '천둥 고원', en: 'THUNDER PLATEAU', x: -170, z: -24, r: 44, music: 'shrine', lv: 1 },
  { id: 'rift', name: '고요의 틈', en: 'THE HUSH RIFT', x: 126, z: -120, r: 58, music: 'rift', lv: 2 },
  { id: 'woods', name: '속삭이는 숲', en: 'WHISPERING WOODS', x: -92, z: 128, r: 50, lv: 0 },
  { id: 'bluffs', name: '동쪽 벼랑', en: 'EASTERN BLUFFS', x: 150, z: 10, r: 50, lv: 1 },
];
// Paved stone yards: no grass (so nothing burns) and a flagstone tint in the terrain.
// Used by the trials (world/trials.js).
export const PADS = [
  { x: 118, z: 104, r: 11 }, // 들불 오르기: the last lookout stands in a stone yard
  { x: 40, z: 148, r: 9 },   // 노래하는 돌
];
export const DEFAULT_REGION = { id: 'vale', name: '하늬 골짜기', en: 'HANUI VALE', lv: 0 };

// Named places in the vale first, then the vale itself; past the ring, the outer region by
// direction (world/regions/).
export function regionAt(x, z) {
  let best = null, bd = 1e9;
  for (const r of REGIONS) {
    const d = Math.hypot(x - r.x, z - r.z);
    if (d < r.r && d / r.r < bd) { bd = d / r.r; best = r; }
  }
  if (best) return best;
  return Math.hypot(x, z) > OUTER_R ? outerRegion(x, z) : DEFAULT_REGION;
}
