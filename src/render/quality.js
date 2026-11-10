// Graphics quality tiers: the one table for everything a tier changes.
import { G } from '../core/context.js';

export const TIERS = {
  // dpr: pixel-ratio cap (low renders below native) · shadowMap: size of one cascade (0 = no shadows)
  // shadowDist: how far sun shadows reach (m) · ao / shafts / dof: depth-based post effects
  // cliff: quads per 2 m cell side in the cliff mesh at terrain LOD 0 / 1, then the longest edge (m)
  //        left on a rock wall at LOD 0 (walls are meshed finer than tops and sculpted; 0 = not at all)
  // reflect: planar water reflection scale (0 = sky only) · grassR / grassD: grass radius (m), tufts per m²
  low:    { dpr: 0.75, shadowMap: 0,    shadowDist: 0,   ao: false, shafts: false, dof: false, reflect: 0,   grassR: 34,  grassD: 1.2, clouds: [768, 16, 56], cliff: [1, 1, 0] },
  medium: { dpr: 1,    shadowMap: 1536, shadowDist: 90,  ao: false, shafts: false, dof: false, reflect: 0,   grassR: 50,  grassD: 2.0, clouds: [1024, 12, 72], cliff: [2, 1, 1.1] },
  high:   { dpr: 1.5,  shadowMap: 2048, shadowDist: 150, ao: true,  shafts: true,  dof: true,  reflect: 0,   grassR: 64,  grassD: 3.2, clouds: [1536, 10, 96], cliff: [4, 1, 0.9] },
  ultra:  { dpr: 2,    shadowMap: 4096, shadowDist: 260, ao: true,  shafts: true,  dof: true,  reflect: 0.5, grassR: 104, grassD: 7.5, clouds: [2048, 10, 128], cliff: [4, 1, 0.75] },
};

export const tier = () => TIERS[G.settings.quality] || TIERS.high;

// First run only: a discrete desktop GPU starts on the top tier.
export function suggestTier(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/RTX|RX\s?[5-9]\d{3}|Arc\(TM\) [AB]\d|Apple M\d+ (Pro|Max|Ultra)/i.test(name)) return 'ultra';
  } catch (_) { /* keep the default */ }
  return 'high';
}
