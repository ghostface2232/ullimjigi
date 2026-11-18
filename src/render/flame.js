import { Color } from 'three';

// Scene-linear colours shared by the particle, volume and fuel-bed programs.
export const firePaint = {
  core: new Color(2.80, 1.85, 0.62),
  body: new Color(1.24, 0.36, 0.035),
  tip: new Color(0.66, 0.068, 0.018),
};
export const FIRE_RAMP = /* glsl */ `
const vec3 fireTip = vec3(${firePaint.tip.toArray().join(', ')});
const vec3 fireBody = vec3(${firePaint.body.toArray().join(', ')});
const vec3 fireCore = vec3(${firePaint.core.toArray().join(', ')});`;

export const FLAME_GLSL = /* glsl */ `
${FIRE_RAMP}
// x spans -1..1, h grows upward from the fuel. The shorter arm peels away
// from the trunk as the neck narrows. Late in the cycle its crest breaks free.
vec4 flameTongue(float x, float h, float phase, float age, float lean) {
  float wave = sin(phase - h * 5.4);
  float top = 0.83 + 0.12 * sin(phase * 0.8) + 0.04 * sin(phase * 1.7);
  float y = h / top;
  x -= y * y * lean + y * (0.24 * wave + 0.13 * sin(phase * 0.68 - y * 8.0));
  float fork = smoothstep(0.20, 0.88, y);
  float width = (0.33 + 0.16 * sin(y * 4.8 - 0.4)) * (1.0 - y);
  float trunk = width - abs(x - fork * (0.20 + 0.10 * sin(phase)));
  float branchH = 0.68 + 0.16 * sin(phase - 0.8);
  float forkY = clamp(y / branchH, 0.0, 1.0);
  float side = (0.41 + 0.12 * sin(forkY * 4.0)) * (branchH - y)
             - abs(x + 0.40 * smoothstep(0.17, 0.83, forkY) - 0.10 * sin(forkY * 5.4));
  float root = h - 0.028 - 0.70 * x * x;
  float outline = min(max(trunk, side), root);
  outline = min(outline, abs(y - 0.81 + 0.10 * x) + 0.16 - smoothstep(0.61, 0.95, age) * 0.20);
  float aa = max(fwidth(outline), 0.003);
  float alpha = smoothstep(-0.5 * aa, 0.5 * aa, outline);
  float band = outline - (0.031 + 0.081 * y);
  float lip = max(1.35 * fwidth(band), 0.012);
  vec3 col = mix(fireTip, fireBody, smoothstep(-lip, lip, band));
  float heart = 0.21 * (1.0 - y * y * 5.3) - abs(x + 0.075 * sin(y * 8.0 + phase));
  col = mix(col, fireCore, smoothstep(-lip, lip, heart) * (1.0 - 0.35 * age));
  return vec4(col, alpha);
}`;
