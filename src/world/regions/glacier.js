import { smoothstep } from '../../core/util.js';

// Beyond Frostpeak: a glacier valley between high flanks. Between-land, not a region of its own.
export default {
  id: 'glacier', name: null, en: null,
  dir: -90, lv: 3, music: 'field',
  climate: { clear: 3, cloudy: 4, rain: 3, storm: 0.3 },  // falls as snow up there
  height: (x, z, f) => 84 + f.b * 10 + f.rg * 28 * smoothstep(30, 130, Math.abs(x + 30 + f.b * 40)),
};
