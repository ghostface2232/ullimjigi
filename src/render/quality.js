// Graphics quality tiers: the one table for everything a tier changes.
import { G } from '../core/context.js';

export const TIERS = {
  // dpr: pixel-ratio cap (low renders below native) · shadowMap: size of one cascade (0 = no shadows)
  // shadowRadius: valley PCF footprint (atlas texels)
  // shadowDist: how far sun shadows reach (m) · ao / shafts / dof: depth-based post effects
  // aoRadius / aoStrength: contact scale (m) and obscurance weight · sharp: bounded contrast sharpening
  // cliff: quads per 2 m cell side in the cliff mesh at terrain LOD 0 / 1, then the longest edge (m)
  //        left on a rock wall at LOD 0 (walls get vertices up their height and a soft relief; 0 = neither)
  // reflect: planar water reflection scale (0 = sky only) · grassR / grassD: grass radius (m), tufts per m²
  // texCap: longest side of an authored model texture, applied at load (0 = as authored)
  low:    { dpr: 0.75, shadowMap: 0,    shadowDist: 0,   shadowRadius: 0,   ao: false, aoRadius: 0.85, aoStrength: 0,    sharp: 0,    shafts: false, dof: false, reflect: 0,   grassR: 34,  grassD: 2.0, clouds: [768, 16, 56], cliff: [1, 1, 0], texCap: 1024 },
  medium: { dpr: 1,    shadowMap: 1536, shadowDist: 90,  shadowRadius: 1.7, ao: false, aoRadius: 0.85, aoStrength: 0,    sharp: 0,    shafts: false, dof: false, reflect: 0,   grassR: 50,  grassD: 3.4, clouds: [1024, 12, 72], cliff: [2, 1, 0], texCap: 1024 },
  high:   { dpr: 1.5,  shadowMap: 2048, shadowDist: 150, shadowRadius: 2.0, ao: true,  aoRadius: 0.85, aoStrength: 0.85, sharp: 0.3,  shafts: true,  dof: true,  reflect: 0,   grassR: 64,  grassD: 5.0, clouds: [1536, 10, 96], cliff: [2, 1, 1.5], texCap: 2048 },
  ultra:  { dpr: 2,    shadowMap: 4096, shadowDist: 260, shadowRadius: 2.4, ao: true,  aoRadius: 1,    aoStrength: 0.95, sharp: 0.28, shafts: true,  dof: true, reflect: 0.5, grassR: 104, grassD: 7.5, clouds: [2048, 10, 128], cliff: [4, 1, 1.1], texCap: 0 },
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
