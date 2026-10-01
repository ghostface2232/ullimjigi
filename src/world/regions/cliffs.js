import { smoothstep } from '../../core/util.js';

// 구름 벼랑 (working name): tall cliffs and rock pillars north-west of the vale.
export default {
  id: 'cliffs', name: '구름 벼랑', en: 'CLOUD CLIFFS',
  dir: -135, lv: 4, music: 'field',
  climate: { clear: 4, cloudy: 4, rain: 2, storm: 0.6 },
  label: [-380, -380],
  height: (x, z, f) => 54 + f.rg * 50 + 36 * smoothstep(0.5, 0.64, f.n2(x * 0.034 + 17, z * 0.034 - 4)),
};
