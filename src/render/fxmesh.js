// Mesh-based effect primitives used by vfx.js:
// - FxSphere: noise-displaced, eroding spheres (fire balls, explosion cores,
//   lit smoke puffs, plasma, water blobs, energy domes)
// - Slash: crescent blade / sweep arcs with streaked noise and erosion
// - Crown: splash sheet (open cylinder with a torn, eroding rim)
// - ice spike geometry + faceted spell-ice material
// - Debris: instanced physical chunks (rock, ice, embers) that tumble and bounce
// - Distort: screen-space refraction objects (shock rings, shells, heat haze)
//   rendered into the renderer's distortion target
import * as THREE from 'three';
import { U, toon } from './materials.js';
import { G } from '../core/context.js';

export const SNOISE = /* glsl */ `
vec3 _m289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 _m289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 _perm(vec4 x){ return _m289(((x * 34.0) + 1.0) * x); }
vec4 _tis(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = _m289(i);
  vec4 p = _perm(_perm(_perm(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = _tis(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}`;

// shared fog for effect meshes (vfx.js keeps these in sync with the scene)
export const FXU = {
  fogD: { value: 0.004 },
  fogC: { value: new THREE.Color(0.7, 0.8, 0.9) },
  amb: { value: 1 },
};
const FOG_GLSL = /* glsl */ `
uniform float uFogD; uniform vec3 uFogC;
float fxFog(vec3 w){ float d = length(w - cameraPosition); return 1.0 - exp(-uFogD * uFogD * d * d); }`;

// ------------------------------------------------------------------
// FxSphere
// ------------------------------------------------------------------
const SPHERE_VS = /* glsl */ `
uniform float uTime, uScale, uDisp, uSeed, uRise, uSpeed;
varying vec3 vN, vW, vL;
varying float vN1;
${SNOISE}
float field(vec3 d){
  vec3 q = d * uScale + vec3(uSeed * 7.1, uSeed * 13.7 - uTime * uRise, uSeed * 3.3);
  return snoise(q + vec3(0.0, 0.0, uTime * uSpeed)) * 0.66 + snoise(q * 2.13 - vec3(uTime * uSpeed * 1.3, 0.0, 0.0)) * 0.34;
}
vec3 disp(vec3 d, out float n){ n = field(d); return d * (1.0 + n * uDisp); }
void main(){
  vec3 d = normalize(position);
  vec3 t1 = normalize(cross(d, abs(d.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(d, t1);
  float n, na, nb;
  vec3 p0 = disp(d, n);
  vec3 pa = disp(normalize(d + t1 * 0.07), na);
  vec3 pb = disp(normalize(d + t2 * 0.07), nb);
  vec3 nn = normalize(cross(pa - p0, pb - p0));
  if (dot(nn, d) < 0.0) nn = -nn;
  vN1 = n; vL = d;
  vec4 wp = modelMatrix * vec4(p0, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * nn);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const SPHERE_FS = /* glsl */ `
uniform float uTime, uScale, uRise, uErode, uAlpha, uMode, uFres, uGlow, uEmiss, uEdge, uAdd, uSoft;
uniform vec3 uHot, uMid, uCool, uSun, uLit, uShade;
uniform float uAmb;
varying vec3 vN, vW, vL;
varying float vN1;
${SNOISE}
${FOG_GLSL}
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float facing = clamp(abs(dot(N, V)), 0.0, 1.0);
  float fres = pow(1.0 - facing, uFres);
  float n2 = snoise(vL * uScale * 2.9 + vec3(0.0, -uTime * uRise * 1.6, uTime * 0.37));
  float mask = vN1 * 0.5 + 0.5 + n2 * 0.22 + facing * 0.12;
  float ero = smoothstep(uErode - uSoft * 0.3, uErode + uSoft, mask);
  float alpha = ero * uAlpha;
  if (alpha < 0.008) discard;
  vec3 col;
  if (uMode < 0.5) {
    // fire: banded (toon) temperature ramp; hot facing core, cooler smoky rim,
    // dark soot swirls where the noise dips, hot rim on eroding edges
    float heat = 0.38 + vN1 * 0.5 + n2 * 0.24 + facing * 0.5 - fres * 0.62 - uErode * 0.7;
    float hb = clamp(heat, 0.0, 1.0) * 3.0;
    heat = (floor(hb) + smoothstep(0.3, 0.7, fract(hb))) / 3.0;
    col = heat < 0.5 ? mix(uCool, uMid, heat * 2.0) : mix(uMid, uHot, (heat - 0.5) * 2.0);
    col *= mix(0.45, 1.0, smoothstep(-0.55, -0.15, vN1 + n2 * 0.3)); // soot
    col += uHot * fres * uGlow;
    float edge = smoothstep(uErode + 0.1, uErode + 0.02, mask) * step(0.001, uErode);
    col += uHot * edge * uEdge;
    alpha *= smoothstep(0.0, 0.22, facing);
  } else if (uMode < 1.5) {
    // lit smoke: toon-stepped sun, cool shade, fire glow from inside/below while young
    float ndl = dot(N, uSun) + n2 * 0.25;
    float lit = smoothstep(-0.05, 0.3, ndl);
    col = mix(uShade, uLit, lit) * uAmb;
    col += uLit * 0.35 * pow(fres, 2.0) * lit;
    col += uHot * uEmiss * (0.35 + 0.65 * (1.0 - smoothstep(-0.7, 0.5, N.y))) * (0.6 + 0.4 * n2);
    alpha *= smoothstep(0.0, 0.2, facing);
  } else if (uMode < 2.5) {
    // water / ice: fresnel rim, refracted body tint, sun glint, caustic bands
    float band = 0.5 + 0.5 * sin((vL.y + n2 * 0.4) * 14.0 - uTime * 6.0);
    col = mix(uCool, uMid, facing * 0.8 + band * 0.2) + uHot * pow(fres, 1.4) * 1.2;
    vec3 H = normalize(uSun + V);
    col += vec3(2.4) * pow(max(dot(N, H), 0.0), 90.0);
    alpha *= mix(0.55, 1.0, pow(fres, 0.6));
  } else {
    // energy shell (additive): bright fresnel skin with flowing filaments, thin core
    float fil = smoothstep(0.55, 0.95, 1.0 - abs(n2)) * 0.8 + smoothstep(0.35, 0.8, vN1 * 0.5 + 0.5) * 0.35;
    float sk = mix(0.1, 1.0, pow(fres, 1.1));
    col = mix(uCool, uMid, sk) + uHot * (fil * 0.55 + pow(fres, 3.0) * uGlow);
    float edge = smoothstep(uErode + 0.1, uErode + 0.02, mask) * step(0.001, uErode);
    col += uHot * edge * uEdge;
    alpha *= clamp(sk * 0.8 + fil * 0.45, 0.0, 1.0);
  }
  float fk = fxFog(vW);
  if (uAdd > 0.5) gl_FragColor = vec4(col * (1.0 - fk), alpha);
  else gl_FragColor = vec4(mix(col, uFogC, fk), alpha);
}`;

// Presets: colours are linear HDR; only fire/energy cores exceed the bloom threshold.
const C = (r, g, b) => new THREE.Color(r, g, b);
export const SPHERE_LOOK = {
  fire: { mode: 0, hot: C(3.8, 2.7, 1.1), mid: C(2.2, 0.62, 0.08), cool: C(0.32, 0.05, 0.02), fres: 1.5, glow: 0.1, edge: 2.2, scale: 1.45, disp: 0.3, rise: 0.8, speed: 0.9, add: 0 },
  fireball: { mode: 0, hot: C(4.4, 3.3, 1.5), mid: C(2.6, 0.95, 0.16), cool: C(0.9, 0.18, 0.04), fres: 1.2, glow: 0.4, edge: 2.0, scale: 1.6, disp: 0.18, rise: 2.4, speed: 2.8, add: 0 },
  sun: { mode: 0, hot: C(6.0, 4.6, 2.2), mid: C(4.2, 1.7, 0.3), cool: C(1.4, 0.3, 0.05), fres: 1.2, glow: 0.5, edge: 2.0, scale: 1.1, disp: 0.16, rise: 1.2, speed: 1.4, add: 0 },
  smoke: { mode: 1, hot: C(2.2, 0.65, 0.12), lit: C(0.46, 0.44, 0.44), shade: C(0.13, 0.13, 0.17), fres: 2, scale: 1.1, disp: 0.3, rise: 0.35, speed: 0.25, add: 0 },
  steam: { mode: 1, hot: C(0, 0, 0), lit: C(1.05, 1.07, 1.1), shade: C(0.55, 0.62, 0.72), fres: 2, scale: 1.0, disp: 0.28, rise: 0.6, speed: 0.3, add: 0 },
  dust: { mode: 1, hot: C(0, 0, 0), lit: C(0.72, 0.64, 0.5), shade: C(0.32, 0.3, 0.3), fres: 2, scale: 1.2, disp: 0.3, rise: 0.25, speed: 0.2, add: 0 },
  water: { mode: 2, hot: C(1.2, 1.7, 2.1), mid: C(0.35, 0.72, 1.2), cool: C(0.05, 0.2, 0.55), fres: 1.8, scale: 1.4, disp: 0.12, rise: 0.4, speed: 1.6, add: 0 },
  frost: { mode: 2, hot: C(1.7, 2.3, 2.7), mid: C(0.55, 1.0, 1.4), cool: C(0.18, 0.4, 0.75), fres: 2.2, scale: 1.8, disp: 0.06, rise: 0.2, speed: 0.6, add: 0 },
  arcane: { mode: 3, hot: C(2.6, 2.0, 3.6), mid: C(1.1, 0.45, 2.4), cool: C(0.16, 0.05, 0.45), fres: 1.4, glow: 0.8, edge: 2.2, scale: 1.8, disp: 0.08, rise: 0.5, speed: 1.4, add: 1 },
  plasma: { mode: 3, hot: C(3.6, 3.2, 2.4), mid: C(2.4, 1.2, 0.35), cool: C(0.8, 0.2, 0.9), fres: 1.2, glow: 0.8, edge: 2.6, scale: 2.4, disp: 0.14, rise: 1.2, speed: 4.0, add: 1 },
  storm: { mode: 3, hot: C(3.4, 3.2, 2.4), mid: C(2.0, 1.5, 0.35), cool: C(0.5, 0.3, 0.8), fres: 1.4, glow: 0.9, edge: 3.0, scale: 3.0, disp: 0.08, rise: 0.6, speed: 5.0, add: 1 },
  wind: { mode: 3, hot: C(1.4, 2.2, 1.8), mid: C(0.25, 1.0, 0.6), cool: C(0.02, 0.12, 0.08), fres: 2.0, glow: 0.4, edge: 1.5, scale: 1.5, disp: 0.1, rise: 1.0, speed: 2.0, add: 1 },
  hush: { mode: 0, hot: C(1.6, 1.1, 2.4), mid: C(0.6, 0.25, 1.1), cool: C(0.05, 0.02, 0.1), fres: 1.5, glow: 0.6, edge: 1.6, scale: 1.8, disp: 0.15, rise: 0.6, speed: 1.5, add: 0 },
};

function sphereMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: U.time, uScale: { value: 1 }, uDisp: { value: 0.2 }, uSeed: { value: 0 }, uRise: { value: 0.5 }, uSpeed: { value: 1 },
      uErode: { value: 0 }, uSoft: { value: 0.1 }, uAlpha: { value: 1 }, uMode: { value: 0 }, uFres: { value: 1.5 }, uGlow: { value: 0.2 }, uEmiss: { value: 0 }, uEdge: { value: 1 }, uAdd: { value: 0 },
      uHot: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uCool: { value: new THREE.Color() },
      uLit: { value: new THREE.Color() }, uShade: { value: new THREE.Color() }, uSun: U.sunDir,
      uAmb: FXU.amb, uFogD: FXU.fogD, uFogC: FXU.fogC,
    },
    vertexShader: SPHERE_VS, fragmentShader: SPHERE_FS,
    transparent: true, depthWrite: false,
  });
}

// ------------------------------------------------------------------
// Slash (crescent blade / sweep arc). Local geometry: arc in the XZ plane
// around +Z, radius 1, u along the arc (0..1), v across (0 inner .. 1 outer).
// ------------------------------------------------------------------
function slashGeometry(span = Math.PI * 0.95, inner = 0.45, seg = 40) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg, a = -span / 2 + span * u;
    for (let j = 0; j <= 2; j++) {
      const v = j / 2, r = inner + (1 - inner) * v;
      pos.push(Math.sin(a) * r, 0, Math.cos(a) * r);
      uv.push(u, v);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < 2; j++) {
    const a = i * 3 + j, b = a + 3;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
const SLASH_VS = /* glsl */ `varying vec2 vUv; varying vec3 vW;
void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const SLASH_FS = /* glsl */ `
uniform vec3 uCore, uGlow; uniform float uAlpha, uTime, uErode, uReveal, uThick, uSeed;
uniform sampler2D uNoise;
varying vec2 vUv; varying vec3 vW;
${FOG_GLSL}
void main(){
  float u = vUv.x, v = vUv.y;
  // crescent profile: thick in the middle, tapering to needle tips
  float prof = pow(sin(3.14159 * clamp(u, 0.0, 1.0)), 0.65) * uThick;
  float inner = 1.0 - prof;
  float body = smoothstep(inner, inner + prof * 0.55, v) * smoothstep(1.0, 0.9, v);
  // sweep reveal (u) and streaked erosion along the arc
  float rev = smoothstep(uReveal, uReveal - 0.18, 1.0 - u);
  float n = texture2D(uNoise, vec2(u * 2.2 - uTime * 1.8 + uSeed, v * 0.35 + uSeed * 0.3)).r;
  float n2 = texture2D(uNoise, vec2(u * 5.0 - uTime * 3.1 + uSeed * 1.7, v * 0.8)).g;
  float streak = n * 0.65 + n2 * 0.35;
  float a = body * rev * smoothstep(uErode, uErode + 0.25, streak + (1.0 - uErode) * 0.25) * uAlpha;
  if (a < 0.004) discard;
  float edge = pow(smoothstep(inner + prof * 0.35, 1.0, v), 3.0);
  vec3 col = mix(uGlow, uCore, edge) * (0.75 + streak * 0.6);
  gl_FragColor = vec4(col * (1.0 - fxFog(vW)), a);
}`;

// ------------------------------------------------------------------
// Crown: splash sheet / water wall ring (open cylinder, torn eroding rim)
// ------------------------------------------------------------------
const CROWN_VS = /* glsl */ `varying vec2 vUv; varying vec3 vW; varying vec3 vN;
void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }`;
const CROWN_FS = /* glsl */ `
uniform vec3 uCore, uBody; uniform float uAlpha, uTime, uErode, uSeed;
uniform sampler2D uNoise;
varying vec2 vUv; varying vec3 vW; varying vec3 vN;
${FOG_GLSL}
void main(){
  float n = texture2D(uNoise, vec2(vUv.x * 3.0 + uSeed, vUv.y * 0.6 - uTime * 0.8)).r;
  float n2 = texture2D(uNoise, vec2(vUv.x * 9.0 - uSeed, vUv.y * 1.4 - uTime * 1.3)).b;
  float top = 1.0 - vUv.y;
  float rim = smoothstep(0.0, 0.28 + n * 0.3, top);            // torn top edge
  float holes = smoothstep(uErode, uErode + 0.2, n * 0.7 + n2 * 0.5);
  float a = rim * holes * smoothstep(0.0, 0.06, vUv.y) * uAlpha;
  if (a < 0.004) discard;
  vec3 V = normalize(cameraPosition - vW);
  float fres = pow(1.0 - abs(dot(normalize(vN), V)), 1.6);
  float foam = smoothstep(0.55, 0.85, n2 + (1.0 - top) * 0.4);
  vec3 col = mix(uBody, uCore, clamp(fres * 0.8 + foam, 0.0, 1.0));
  a *= mix(0.45, 1.0, clamp(fres + foam, 0.0, 1.0));
  gl_FragColor = vec4(mix(col, uFogC, fxFog(vW)), a);
}`;

// ------------------------------------------------------------------
// Spell ice: faceted, fresnel rim, milky depth, glints, cooling glow, cracks
// ------------------------------------------------------------------
const ICE_VS = /* glsl */ `varying vec3 vW; varying vec3 vL; varying vec3 vNo;
void main(){
  vec4 lp = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    lp = instanceMatrix * lp;
  #endif
  vL = position;
  vec4 wp = modelMatrix * lp; vW = wp.xyz;
  vNo = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const ICE_FS = /* glsl */ `
uniform vec3 uSun; uniform float uTime, uGlow, uCrack, uAmb, uAlpha;
uniform sampler2D uNoise;
varying vec3 vW; varying vec3 vL; varying vec3 vNo;
${FOG_GLSL}
float h31(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main(){
  vec3 N = normalize(cross(dFdx(vW), dFdy(vW)));
  vec3 V = normalize(cameraPosition - vW);
  if (dot(N, V) < 0.0) N = -N;
  float facing = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - facing, 2.2);
  // fake depth: sample streaks along the refracted ray
  vec3 R = refract(-V, N, 0.76);
  vec2 q = vW.xz * 0.35 + R.xz * 0.9 + vec2(vW.y * 0.25);
  float deep = texture2D(uNoise, q).r * 0.65 + texture2D(uNoise, q * 2.7 + 0.3).b * 0.35;
  float ndl = dot(N, uSun);
  float lit = smoothstep(-0.2, 0.35, ndl);
  vec3 shade = vec3(0.12, 0.3, 0.52), bright = vec3(0.6, 0.82, 0.96);
  vec3 col = mix(shade, bright, lit * 0.75 + deep * 0.35);
  col = mix(col, vec3(0.9, 0.97, 1.0), smoothstep(0.55, 0.95, deep) * 0.35); // milky inclusions
  col *= uAmb;
  col += vec3(0.5, 0.8, 1.0) * fres * 0.65;
  vec3 H = normalize(uSun + V);
  col += vec3(1.8, 1.9, 2.0) * pow(max(dot(N, H), 0.0), 60.0) * uAmb;
  // per-facet twinkle
  float fh = h31(floor(N * 7.0 + 0.5));
  col += vec3(1.6, 1.9, 2.2) * pow(max(sin(uTime * 2.2 + fh * 40.0), 0.0), 40.0) * 0.7 * uAmb;
  // fresh ice glows from within, cooling down
  col += vec3(0.3, 0.8, 1.5) * uGlow * (0.25 + 0.75 * fres);
  // crack lines just before shattering
  float cr = 1.0 - abs(texture2D(uNoise, vL.xy * 0.9 + vL.zy * 0.7).g * 2.0 - 1.0);
  col += vec3(1.8, 2.4, 2.8) * pow(cr, 14.0) * uCrack;
  float fk = fxFog(vW);
  gl_FragColor = vec4(mix(col, uFogC, fk), uAlpha);
}`;

export function iceMaterial(opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSun: U.sunDir, uTime: U.time, uNoise: U.noise, uGlow: { value: opts.glow ?? 0 }, uCrack: { value: 0 }, uAmb: FXU.amb, uAlpha: { value: opts.alpha ?? 1 },
      uFogD: FXU.fogD, uFogC: FXU.fogC,
    },
    vertexShader: ICE_VS, fragmentShader: ICE_FS,
    transparent: !!opts.transparent, depthWrite: !opts.transparent,
  });
}

// Hexagonal ice spike (base slightly below y=0, apex at y=1), a few jittered variants.
const _spikeGeos = [];
export function iceSpikeGeometry(variant = 0) {
  const k = variant % 4;
  if (_spikeGeos[k]) return _spikeGeos[k];
  const rnd = mulberry(91 + k * 17);
  const pts = [new THREE.Vector2(0.001, -0.35), new THREE.Vector2(0.92, -0.35), new THREE.Vector2(1.0, -0.05), new THREE.Vector2(0.86 + rnd() * 0.1, 0.55 + rnd() * 0.12), new THREE.Vector2(0.001, 1.0)];
  let g = new THREE.LatheGeometry(pts, 6, rnd() * Math.PI);
  g = g.toNonIndexed();
  const p = g.attributes.position;
  // lean the apex sideways and jitter rings for a hand-cut look
  const lean = (rnd() - 0.5) * 0.25, lean2 = (rnd() - 0.5) * 0.25;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = Math.max(0, y);
    p.setX(i, p.getX(i) * (1 + (hashf(p.getX(i), y, p.getZ(i)) - 0.5) * 0.12) + lean * t * t);
    p.setZ(i, p.getZ(i) * (1 + (hashf(p.getZ(i), y, p.getX(i)) - 0.5) * 0.12) + lean2 * t * t);
  }
  g.computeVertexNormals();
  _spikeGeos[k] = g;
  return g;
}
function hashf(x, y, z) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ------------------------------------------------------------------
// Debris: instanced tumbling chunks with ground bounce
// ------------------------------------------------------------------
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _ax = new THREE.Vector3(), _col = new THREE.Color();
class DebrisPool {
  constructor(scene, geo, mat, max, o = {}) {
    this.max = max; this.n = 0;
    this.im = new THREE.InstancedMesh(geo, mat, max);
    this.im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.im.count = 0; this.im.frustumCulled = false;
    this.im.castShadow = !!o.shadow;
    this.im.renderOrder = o.order ?? 0;
    if (o.color) { this.im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3); this.im.instanceColor.setUsage(THREE.DynamicDrawUsage); }
    this.glow = !!o.glow;
    scene.add(this.im);
    this.it = Array.from({ length: max }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), s: 1, sy: 1, life: 0, ml: 1, bounce: 0.35, c: new THREE.Color(), c1: new THREE.Color(), grav: 22 }));
  }
  emit(pos, vel, o = {}) {
    if (this.n >= this.max) return;
    const d = this.it[this.n++];
    d.p.copy(pos); d.v.copy(vel);
    d.q.setFromEuler(new THREE.Euler(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3));
    d.w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(o.spin ?? 14);
    d.s = o.size ?? 0.2; d.sy = o.stretch ?? 1;
    d.life = d.ml = o.life ?? 1.6; d.bounce = o.bounce ?? 0.35; d.grav = o.grav ?? 22;
    if (o.color) d.c.copy(o.color); else d.c.setRGB(1, 1, 1);
    if (o.color1) d.c1.copy(o.color1); else d.c1.copy(d.c);
  }
  update(dt) {
    const W = G.world;
    let i = 0;
    while (i < this.n) {
      const d = this.it[i];
      d.life -= dt;
      if (d.life <= 0) { const j = --this.n; const t = this.it[i]; this.it[i] = this.it[j]; this.it[j] = t; continue; }
      d.v.y -= d.grav * dt;
      d.p.addScaledVector(d.v, dt);
      if (W) {
        const gy = W.ground(d.p.x, d.p.z, d.p.y + 1) + d.s * 0.35;
        if (d.p.y < gy) {
          d.p.y = gy;
          if (d.v.y < -1.5) { d.v.y = -d.v.y * d.bounce; d.v.x *= 0.62; d.v.z *= 0.62; d.w.multiplyScalar(0.6); }
          else { d.v.y = 0; d.v.x *= 1 - Math.min(1, dt * 7); d.v.z *= 1 - Math.min(1, dt * 7); d.w.multiplyScalar(1 - Math.min(1, dt * 6)); }
        }
      }
      const wl = d.w.length();
      if (wl > 1e-3) { _ax.copy(d.w).divideScalar(wl); _q2.setFromAxisAngle(_ax, wl * dt); d.q.premultiply(_q2); }
      const k = 1 - d.life / d.ml;
      const sc = d.s * Math.min(1, d.life / 0.35) * Math.min(1, (d.ml - d.life) / 0.04 + 0.2);
      _s.set(sc, sc * d.sy, sc);
      _m4.compose(d.p, d.q, _s);
      this.im.setMatrixAt(i, _m4);
      if (this.im.instanceColor) {
        _col.copy(d.c).lerp(d.c1, this.glow ? Math.min(1, k * 1.6) : k);
        this.im.setColorAt(i, _col);
      }
      i++;
    }
    this.im.count = this.n;
    this.im.visible = this.n > 0;
    if (this.n) { this.im.instanceMatrix.needsUpdate = true; if (this.im.instanceColor) this.im.instanceColor.needsUpdate = true; }
  }
}

export class Debris {
  constructor(scene) {
    const rock = new THREE.IcosahedronGeometry(1, 0);
    const rp = rock.attributes.position;
    for (let i = 0; i < rp.count; i++) { const k = 0.7 + hashf(rp.getX(i), rp.getY(i), rp.getZ(i)) * 0.5; rp.setXYZ(i, rp.getX(i) * k, rp.getY(i) * k * 0.8, rp.getZ(i) * k); }
    rock.computeVertexNormals();
    const rockMat = toon(0xffffff, { nocache: true, rim: 0.2, noAO: true });
    this.rock = new DebrisPool(scene, rock, rockMat, 220, { color: true, shadow: true });
    const shard = new THREE.OctahedronGeometry(1, 0); shard.scale(0.45, 1.25, 0.32);
    this.iceMat = iceMaterial({ glow: 0.35 });
    this.ice = new DebrisPool(scene, shard.toNonIndexed(), this.iceMat, 220, { shadow: true });
    const ember = new THREE.OctahedronGeometry(1, 0);
    this.ember = new DebrisPool(scene, ember, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true }), 160, { color: true, glow: true });
  }
  update(dt) { this.rock.update(dt); this.ice.update(dt); this.ember.update(dt); }
}

// ------------------------------------------------------------------
// Screen-space distortion objects (drawn by Renderer into its distortion RT)
// Output: rg = uv offset (signed). Additive so overlapping objects stack.
// ------------------------------------------------------------------
const DIST_VS = /* glsl */ `
varying vec2 vUv; varying vec4 vClip; varying vec4 vCtr; varying vec3 vN; varying vec3 vV;
uniform float uBill;
void main(){
  vUv = uv;
  vec4 wp;
  if (uBill > 0.5) {
    // camera-facing quad, sized by the object scale
    vec3 ctr = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 sx = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 sy = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float s = length(modelMatrix[0].xyz);
    wp = vec4(ctr + sx * position.x * s + sy * position.y * s * (length(modelMatrix[1].xyz) / max(s, 1e-4)), 1.0);
  } else wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vClip = projectionMatrix * viewMatrix * wp;
  vCtr = projectionMatrix * viewMatrix * vec4((modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, 1.0);
  gl_Position = vClip;
}`;
const DIST_FS = /* glsl */ `
uniform float uKind, uR, uW, uAmp, uTime, uSeed;
uniform sampler2D uNoise;
varying vec2 vUv; varying vec4 vClip; varying vec4 vCtr; varying vec3 vN; varying vec3 vV;
void main(){
  vec2 sp = vClip.xy / vClip.w, sc = vCtr.xy / max(vCtr.w, 1e-4);
  vec2 dir = sp - sc; float dl = length(dir); dir = dl > 1e-5 ? dir / dl : vec2(0.0);
  vec2 off;
  if (uKind < 0.5) {
    // ring (flat or billboard): radial push on a gaussian band at radius uR
    float r = length(vUv * 2.0 - 1.0);
    float b = exp(-pow((r - uR) / max(uW, 1e-3), 2.0)) * smoothstep(1.0, 0.94, r);
    off = dir * b * uAmp;
  } else if (uKind < 1.5) {
    // shell: push on the silhouette band of a sphere
    float f = 1.0 - clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
    float b = smoothstep(0.05, 0.55, f) * smoothstep(1.0, 0.75, f);
    off = dir * b * uAmp;
  } else {
    // heat haze: rising noise wobble, soft round falloff
    vec2 q = vUv * vec2(1.6, 1.2) + vec2(uSeed, -uTime * 0.9);
    vec2 n = vec2(texture2D(uNoise, q).r, texture2D(uNoise, q * 1.3 + 0.5).g) - 0.5;
    float fall = smoothstep(1.0, 0.25, length((vUv - 0.5) * vec2(2.0, 2.0)));
    off = n * uAmp * fall;
  }
  gl_FragColor = vec4(off, 0.0, 1.0);
}`;

export class Distort {
  constructor() {
    this.scene = null;
    this.list = [];
    this.pool = { ring: [], shell: [], haze: [] };
    this.quad = new THREE.PlaneGeometry(2, 2);
    this.flat = new THREE.PlaneGeometry(2, 2); this.flat.rotateX(-Math.PI / 2);
    this.sph = new THREE.IcosahedronGeometry(1, 3);
    this.base = new THREE.ShaderMaterial({
      uniforms: { uKind: { value: 0 }, uR: { value: 0.7 }, uW: { value: 0.12 }, uAmp: { value: 0 }, uTime: U.time, uSeed: { value: 0 }, uNoise: U.noise, uBill: { value: 0 } },
      vertexShader: DIST_VS, fragmentShader: DIST_FS,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
  }
  bind(scene) { this.scene = scene; }
  _get(kind, geo) {
    let m = this.pool[kind].find((x) => !x.visible);
    if (!m) {
      if (this.pool[kind].length >= 24) return null;
      const mat = this.base.clone(); mat.uniforms.uTime = U.time; mat.uniforms.uNoise = U.noise;
      m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.visible = false;
      this.scene.add(m); this.pool[kind].push(m);
    }
    return m;
  }
  // expanding shock ring. o: flat (ground-aligned), up (normal), amp, width, follow
  ring(pos, radius, dur = 0.5, o = {}) {
    if (!this.scene || G.settings.quality === 'low') return;
    const m = this._get(o.flat ? 'ring' : 'ring', o.flat ? this.flat : this.quad);
    if (!m) return;
    if (m.geometry !== (o.flat ? this.flat : this.quad)) m.geometry = o.flat ? this.flat : this.quad;
    const u = m.material.uniforms;
    u.uKind.value = 0; u.uBill.value = o.flat ? 0 : 1; u.uW.value = o.width ?? 0.14;
    m.position.copy(pos); if (o.flat) m.position.y += 0.2;
    m.quaternion.identity();
    if (o.up) m.quaternion.setFromUnitVectors(_p.set(0, 1, 0), o.up);
    m.visible = true;
    this.list.push({ m, t: 0, dur, update: (x, k) => {
      const e = 1 - Math.pow(1 - k, 2.4);
      m.scale.setScalar(Math.max(0.01, radius * (0.25 + 0.75 * e)));
      u.uR.value = 0.35 + 0.55 * e;
      u.uAmp.value = (o.amp ?? 0.035) * (1 - k) * Math.min(1, k * 8);
    } });
  }
  // sphere silhouette refraction
  shell(pos, radius, dur = 0.45, o = {}) {
    if (!this.scene || G.settings.quality === 'low') return;
    const m = this._get('shell', this.sph);
    if (!m) return;
    const u = m.material.uniforms;
    u.uKind.value = 1; u.uBill.value = 0;
    m.position.copy(pos); m.visible = true;
    this.list.push({ m, t: 0, dur, update: (x, k) => {
      const e = 1 - Math.pow(1 - k, 3);
      m.scale.setScalar(Math.max(0.01, radius * (0.2 + 0.8 * e)));
      m.scale.y *= o.flat ?? 1;
      u.uAmp.value = (o.amp ?? 0.03) * (1 - k);
    } });
  }
  // heat haze sprite. o: follow (Vector3 / Object3D), h (height scale), amp
  haze(pos, size, dur = 2, o = {}) {
    if (!this.scene || G.settings.quality === 'low') return null;
    const m = this._get('haze', this.quad);
    if (!m) return null;
    const u = m.material.uniforms;
    u.uKind.value = 2; u.uBill.value = 1; u.uSeed.value = Math.random() * 10;
    m.position.copy(pos); if (!o.follow) m.position.y += size * (o.h ?? 1) * 0.6;
    m.scale.set(size, size * (o.h ?? 1), size);
    m.visible = true;
    const amp = o.amp ?? 0.012, fin = dur > 0;
    const h = { m, t: 0, dur: fin ? dur : Infinity, done: false, fin: 1, end() { h.done = true; }, update: (x, k, dt) => {
      if (o.follow) { m.position.copy(o.follow.position || o.follow); if (o.offY) m.position.y += o.offY; }
      if (h.done) h.fin = Math.max(0, h.fin - dt * 3);
      u.uAmp.value = amp * Math.min(1, x.t * 4) * (fin ? Math.min(1, (1 - k) * 3) : 1) * h.fin;
    } };
    this.list.push(h);
    return h;
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const x = this.list[i];
      x.t += dt;
      const k = Number.isFinite(x.dur) ? Math.min(1, x.t / Math.max(1e-4, x.dur)) : 0;
      x.update(x, k, dt);
      if ((Number.isFinite(x.dur) && x.t >= x.dur) || (x.done && x.fin <= 0)) { x.m.visible = false; this.list.splice(i, 1); }
    }
  }
  get active() { return this.list.length > 0; }
}

// ------------------------------------------------------------------
// Factories used by VFX
// ------------------------------------------------------------------
// dark storm cloud look (thunder strikes)
SPHERE_LOOK.cloud = { mode: 1, hot: C(1.2, 1.0, 2.0), lit: C(0.26, 0.25, 0.32), shade: C(0.05, 0.05, 0.09), fres: 2, scale: 1.0, disp: 0.32, rise: 0.2, speed: 0.4, add: 0 };
export function makeSphere(scene, detail = 4) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, detail), sphereMaterial());
  m.visible = false; m.frustumCulled = false; m.renderOrder = 8;
  scene.add(m);
  return m;
}
export function applyLook(mat, look, o = {}) {
  const L = typeof look === 'string' ? SPHERE_LOOK[look] : look;
  const u = mat.uniforms;
  u.uMode.value = L.mode; u.uSoft.value = L.soft ?? (L.mode === 1 ? 0.22 : 0.1); u.uFres.value = L.fres ?? 1.5; u.uGlow.value = L.glow ?? 0; u.uEdge.value = L.edge ?? 1;
  u.uScale.value = o.scale ?? L.scale ?? 1; u.uDisp.value = o.disp ?? L.disp ?? 0.2; u.uRise.value = o.rise ?? L.rise ?? 0.5; u.uSpeed.value = o.speed ?? L.speed ?? 1;
  u.uHot.value.copy(L.hot || C(1, 1, 1)); u.uMid.value.copy(L.mid || L.hot || C(1, 1, 1)); u.uCool.value.copy(L.cool || L.mid || C(0, 0, 0));
  u.uLit.value.copy(L.lit || C(0.5, 0.5, 0.5)); u.uShade.value.copy(L.shade || C(0.1, 0.1, 0.1));
  u.uEmiss.value = o.emiss ?? 0; u.uErode.value = 0; u.uAlpha.value = 1; u.uSeed.value = Math.random() * 10;
  const add = o.add ?? L.add;
  u.uAdd.value = add ? 1 : 0;
  mat.blending = add ? THREE.AdditiveBlending : THREE.NormalBlending;
  mat.depthWrite = false;
}
export function makeSlash(scene, span) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uCore: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uAlpha: { value: 1 }, uTime: U.time, uErode: { value: 0 }, uReveal: { value: 1.2 }, uThick: { value: 0.5 }, uSeed: { value: 0 }, uNoise: U.noise, uFogD: FXU.fogD, uFogC: FXU.fogC },
    vertexShader: SLASH_VS, fragmentShader: SLASH_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(slashGeometry(span), mat);
  m.visible = false; m.frustumCulled = false; m.renderOrder = 11;
  scene.add(m);
  return m;
}
export function makeCrown(scene) {
  const g = new THREE.CylinderGeometry(1, 0.7, 1, 36, 4, true); g.translate(0, 0.5, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uCore: { value: new THREE.Color(1.3, 1.5, 1.7) }, uBody: { value: new THREE.Color(0.3, 0.6, 1.0) }, uAlpha: { value: 1 }, uTime: U.time, uErode: { value: 0 }, uSeed: { value: 0 }, uNoise: U.noise, uFogD: FXU.fogD, uFogC: FXU.fogC },
    vertexShader: CROWN_VS, fragmentShader: CROWN_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(g, mat);
  m.visible = false; m.frustumCulled = false; m.renderOrder = 9;
  scene.add(m);
  return m;
}
