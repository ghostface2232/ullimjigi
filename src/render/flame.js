import { Color, ImageLoader, LinearFilter } from 'three';

// Scene-linear colours shared by the particle, volume and fuel-bed programs.
export const firePaint = {
  core: new Color(2.80, 1.85, 0.62),
  body: new Color(1.24, 0.36, 0.035),
  tip: new Color(0.66, 0.068, 0.018),
};
// Shared by the point, volume and fuel-bed shaders. Loaded with the authored models.
export async function preloadFireVolume(texture) {
  // Like the model preload, a failed fetch must not stall boot: the flames then read an empty texture.
  try { texture.image = await new ImageLoader().loadAsync('./textures/fire-density.png'); }
  catch (err) { console.warn('fire-density.png failed to load', err); return; }
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
}

export const FIRE_RAMP = /* glsl */ `
vec3 fireRadiance(float heat, float core) {
  float h = clamp(heat, 0.0, 1.0);
  // Keep the radiance of the gold band just over the bloom knee. Strong
  // white emission is confined to the deepest fuel at the foot of the plume.
  vec3 glow = mix(vec3(0.057, 0.027, 0.020), vec3(0.52, 0.034, 0.007), smoothstep(0.12, 0.49, h));
  glow = mix(glow, vec3(1.35, 0.275, 0.008), smoothstep(0.42, 0.62, h));
  glow = mix(glow, vec3(2.08, 1.65, 0.012), smoothstep(0.55, 0.78, h));
  glow = mix(glow, vec3(2.55, 2.41, 0.074), smoothstep(0.75, 0.94, h));
  return glow + vec3(3.05, 2.93, 1.20) * pow(clamp(core, 0.0, 1.0), 2.1);
}
`;

export const COMBUSTION_GLSL = /* glsl */ `
uniform sampler2D uFireVolume;
// Volume projections store temperature, hot optical depth, soot and coverage.
// Blend neighbouring projections before mapping optical depth to scene light.
vec4 pyroFrame(vec2 uv, float frame) {
  vec2 tile = vec2(mod(frame, 8.0), 11.0 - floor(frame / 8.0));
  return texture2D(uFireVolume, (tile + clamp(uv, 0.004, 0.996)) / vec2(8.0, 12.0));
}
vec4 pyroVolume(vec2 uv, float phase, float page) {
  float frame = (page != 1.0 ? fract(phase) * 32.0 : clamp(phase, 0.0, 1.0) * 31.0);
  float next = page != 1.0 ? mod(floor(frame) + 1.0, 32.0) : min(31.0, floor(frame) + 1.0);
  return mix(pyroFrame(uv, floor(frame) + page * 32.0), pyroFrame(uv, next + page * 32.0), fract(frame));
}
${FIRE_RAMP}
vec4 pyroLight(vec4 field, float age) {
  float hot = field.r - 0.08 * age;
  vec3 light = fireRadiance(hot, field.g * (1.0 - 0.23 * age));
  light = mix(light, vec3(0.049, 0.030, 0.026), field.b * 0.81);
  return vec4(light, field.a);
}
// Soot absorbs the light below a blast. Only the hottest pockets reach
// white heat, leaving enough orange between them to read the turbulent body.
vec4 impactGas(vec4 fuel, float underside, float age, float grain) {
  float heat = clamp(fuel.r - 0.11 * age, 0.0, 1.0);
  float soot = clamp(0.65 * fuel.b + underside * (1.10 - 0.67 * fuel.g), 0.0, 0.96);
  float knots = smoothstep(0.40, 0.78, fuel.g) * smoothstep(0.65, 0.91, heat) * smoothstep(0.49, 0.76, grain);
  vec3 light = mix(vec3(0.26, 0.030, 0.006), vec3(2.05, 0.47, 0.016), smoothstep(0.29, 0.91, heat + (grain - 0.5) * 0.13));
  light = mix(light, vec3(3.6, 1.52, 0.08), smoothstep(0.47, 0.93, fuel.g) * (0.34 + 0.53 * grain));
  light += vec3(5.12, 5.22, 3.06) * knots * knots;
  return vec4(mix(light, vec3(0.065, 0.036, 0.028), soot), fuel.a);
}
vec4 combustion(vec2 uv, float seed, float age, float t, float lean) {
  uv.x -= uv.y * uv.y * lean * 0.44;
  if (fract(seed * 8.13) < 0.5) uv.x = 1.0 - uv.x;
  vec2 margin = smoothstep(vec2(0.0), vec2(0.045), min(uv, 1.0 - uv));
  vec4 field = pyroVolume(uv, t * (0.66 + 0.20 * fract(seed * 3.79)) + seed * 6.4 + age * 0.22, 0.0);
  vec4 gas = pyroLight(vec4(field.r, field.g * (1.0 - smoothstep(0.16, 0.59, uv.y) * 0.78), field.ba), age);
  float fx = uv.x * 2.0 - 1.0;
  float foot = smoothstep(0.012, 0.17, uv.y - fx * fx * 0.105);
  gas.a *= margin.x * margin.y * foot;
  return gas;
}
`;

// The brazier retains its turbulent fuel mask, with the shared gold-to-white emission.
export const BRAZIER_GLSL = /* glsl */ `
vec4 brazierCombustion(vec2 uv, float seed, float age, float t, float lean) {
  float y = uv.y;
  float x = uv.x * 2.0 - 1.0;
  vec2 travel = vec2(seed * 5.79, seed * 3.87 - t * (0.66 + 0.41 * seed));
  vec2 p = vec2(x * 0.33, y * 0.64) + travel;
  vec2 warp = texture2D(uNoise, p * 0.64).rg - 0.5;
  x -= y * (lean + 0.48 * warp.x);
  p = vec2(x * 0.40, y * 0.64) + travel + warp * vec2(0.32, 0.23);
  vec4 billow = texture2D(uNoise, p);
  vec3 filament = texture2D(uNoise, p * vec2(1.85, 1.38) + warp * 0.25 - vec2(0.0, t * 0.13)).rgb;
  float thickness = 1.09 - x * x * (1.15 + 0.74 * y) - 1.06 * y - 0.21 * age;
  thickness += (billow.g - 0.5) * 1.10 + (filament.r - 0.5) * 0.61 + (billow.b - 0.5) * 0.22;
  float mask = smoothstep(0.19, 0.54, thickness);
  mask *= smoothstep(0.00, 0.27, y) * (1.0 - smoothstep(0.83, 1.0, y));
  mask *= (1.0 - smoothstep(0.76, 1.0, abs(uv.x * 2.0 - 1.0)));
  float heat = clamp(thickness * 0.82 + 0.12 * (1.0 - y) + 0.18 * filament.g - 0.10 * age - 0.15 * y, 0.0, 1.0);
  heat += (1.0 - heat) * 0.18 * (1.0 - smoothstep(0.22, 0.79, y));
  float heart = (1.0 - smoothstep(0.19, 0.49, y)) * smoothstep(0.51, 0.91, thickness);
  return vec4(fireRadiance(heat, heart * (1.0 - smoothstep(0.15, 0.40, y))), mask);
}
`;

// Grass fire: one card holds a low bed of flame with several tongues. Fuel noise rises through
// the card, so the tongues lift, lean and tear at their own pace with no cycle to repeat.
// `heat` is the cell's burn (1 full, over 1 a flare-up, towards 0 dying): a cooling bed thins
// into separate red flamelets before it goes out. `halo` is the soft light around the bed, for
// the cards that carry a glow (their quad leaves room for it beyond the flame).
export const GRASS_FLAME_GLSL = /* glsl */ `
vec4 grassFlame(vec2 uv, float seed, float t, float lean, float heat, out float halo) {
  float y = uv.y, x = uv.x * 2.0 - 1.0;
  float vigor = min(heat, 1.0), cool = 1.0 - vigor;
  vec2 travel = vec2(seed * 5.79, seed * 3.87 - t * (0.40 + 0.17 * seed));
  vec2 sway = texture2D(uNoise, vec2(x * 0.16, y * 0.21) + travel * vec2(1.0, 0.55)).rg - 0.5;
  x -= y * (lean + 0.62 * sway.x);
  vec2 p = vec2(x * 0.31, y * 0.30) + travel + sway * vec2(0.13, 0.07);
  float tongue = texture2D(uNoise, p).g;
  vec3 lick = texture2D(uNoise, p * vec2(2.6, 1.7) - vec2(seed, t * 0.23)).rgb;
  float side = abs(uv.x * 2.0 - 1.0);
  float thickness = 1.20 - 1.34 * y - side * side * (0.50 + 0.62 * y) - 0.50 * cool;
  thickness += (tongue - 0.5) * 1.66 + (lick.b - 0.5) * 0.40;
  float mask = smoothstep(0.30, 0.50, thickness) * (1.0 - smoothstep(0.84, 1.0, y));
  // round and soft, densest about the body of the flame and gone before the quad ends
  float reach = side * side * 0.56 + (y - 0.34) * (y - 0.34) * (y > 0.34 ? 0.95 : 8.0);
  halo = (1.0 - smoothstep(0.0, 1.0, reach)) * (0.70 + 0.60 * tongue);
  halo *= halo;
  // the bed thins out to nothing at its foot and ends, so no card shows a straight edge on the ground
  mask *= smoothstep(0.0, 0.11, y - 0.13 * side * side + 0.05 * (lick.g - 0.5)) * (1.0 - smoothstep(0.72, 1.0, side));
  // gold at the foot and through the body, red only where a tongue thins out towards its tip
  float temp = clamp(0.46 + min(thickness, 1.3) * 0.37 - 0.34 * y + 0.14 * (lick.r - 0.5) - 0.24 * cool, 0.0, 1.0);
  float heart = smoothstep(0.80, 1.45, thickness) * (1.0 - smoothstep(0.10, 0.42, y)) * vigor;
  // thin red gas at the tips lets the flames behind show through
  return vec4(fireRadiance(temp, heart), mask * (0.58 + 0.42 * smoothstep(0.26, 0.56, temp)));
}
`;
