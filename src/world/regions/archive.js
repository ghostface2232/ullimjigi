import { fbm, smoothstep } from '../../core/util.js';

// 이름 서고 고원 (working name): a high plateau with mesas west of the Thunder Plateau.
export default {
  id: 'archive', name: '이름 서고 고원', en: 'PLATEAU OF NAMES',
  dir: 180, lv: 3, music: 'field',
  climate: { clear: 3, cloudy: 3, rain: 2, storm: 3 },   // thunderstorms come with the climate
  label: [-440, 10],
  height: (x, z, f) => 50 + 12 * smoothstep(-0.15, 0.15, f.b + 0.2) + f.d * 3
    + 16 * smoothstep(0.3, 0.4, fbm(f.n3, x * 0.009 + 40, z * 0.009, 2)),
  // pale, wind-dried grass
  paint: (c, k, f, P) => c.lerp(P.grassWarm, k * 0.45),
};
