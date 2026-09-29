// Visual effects toolkit: particle presets, flash lights, shockwave rings,
// rune circles, lightning, ice crystals, tornados, beams and telegraphs —
// plus velocity-aligned spark streaks, projectile ribbons, ground decals
// (scorch / frost / puddle / char / swirl / rune / crack), shock shells,
// light pillars and the per-element cast / impact / reaction / aftermath
// recipes used by spells and combat.
import * as THREE from 'three';
import { Particles } from './particles.js';
import { fresnelMat, toon, U } from './materials.js';
import { G } from '../core/context.js';
import { randRange, rand, easeOutBack, clamp, mulberry32 } from '../core/util.js';

const C = (r, g, b) => new THREE.Color(r, g, b);
export const PAL = {
  arcane: { core: C(2.4, 1.9, 3.2), glow: C(1.2, 0.55, 2.6), deep: C(0.35, 0.12, 0.8), light: 0xa070ff },
  fire: { core: C(4.0, 2.6, 0.9), glow: C(3.0, 0.9, 0.12), deep: C(1.1, 0.12, 0.02), light: 0xff7a2a },
  frost: { core: C(2.4, 3.0, 3.4), glow: C(0.6, 1.8, 3.2), deep: C(0.15, 0.45, 1.2), light: 0x6cd0ff },
  storm: { core: C(3.6, 3.4, 2.2), glow: C(3.2, 2.4, 0.4), deep: C(1.4, 0.6, 1.6), light: 0xffd84a },
  wind: { core: C(2.0, 3.2, 2.6), glow: C(0.5, 2.4, 1.4), deep: C(0.1, 0.6, 0.4), light: 0x6effc0 },
  water: { core: C(1.6, 2.6, 3.6), glow: C(0.25, 0.9, 3.0), deep: C(0.04, 0.2, 0.8), light: 0x4a9aff },
  hush: { core: C(1.6, 1.2, 2.4), glow: C(0.7, 0.35, 1.4), deep: C(0.12, 0.06, 0.2), light: 0x8a5aff },
  heal: { core: C(2.2, 3.2, 2.0), glow: C(0.6, 2.4, 0.8), deep: C(0.1, 0.5, 0.1), light: 0x8aff9a },
  gold: { core: C(3.4, 2.9, 1.8), glow: C(2.4, 1.6, 0.5), deep: C(0.8, 0.5, 0.1), light: 0xffd88a },
  white: { core: C(3, 3, 3), glow: C(1.8, 1.8, 2), deep: C(0.5, 0.5, 0.6), light: 0xffffff },
};

const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpV3 = new THREE.Vector3(), tmpV4 = new THREE.Vector3();
const UPV = new THREE.Vector3(0, 1, 0);
const tmpQ = new THREE.Quaternion();
const tmpC = new THREE.Color();
const _sd = new THREE.Vector3(), _tan = new THREE.Vector3();
const FLASH_K = 0.55;
const rv = (s) => randRange(-s, s);
const pal = (el) => PAL[el] || PAL.arcane;

// ------------------------------------------------------------------
// Procedural textures
// ------------------------------------------------------------------
function runeTexture(seed = 7, detail = 1) {
  const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const rnd = mulberry32(seed);
  g.translate(S / 2, S / 2);
  g.strokeStyle = '#fff'; g.fillStyle = '#fff';
  g.shadowColor = '#fff'; g.shadowBlur = 6;
  const circ = (r, w) => { g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); };
  circ(244, 5); circ(230, 2); circ(172, 3); circ(156, 1.5); circ(62, 2.5);
  const N = 28;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    g.save(); g.rotate(a); g.translate(0, -201); g.lineWidth = 2.4;
    g.beginPath();
    const k = 3 + Math.floor(rnd() * 3);
    let x = (rnd() - 0.5) * 16, y = (rnd() - 0.5) * 18;
    g.moveTo(x, y);
    for (let j = 0; j < k; j++) {
      x = Math.round((rnd() - 0.5) * 2) * 8; y = Math.round((rnd() - 0.5) * 2) * 9;
      if (rnd() < 0.3) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    if (rnd() < 0.4) { g.beginPath(); g.arc((rnd() - 0.5) * 10, (rnd() - 0.5) * 10, 2.5, 0, Math.PI * 2); g.fill(); }
    g.restore();
  }
  g.lineWidth = 2.5;
  for (let t = 0; t < 2; t++) {
    g.beginPath();
    for (let i = 0; i <= 3; i++) {
      const a = (i / 3) * Math.PI * 2 + t * Math.PI / 3 - Math.PI / 2;
      const x = Math.cos(a) * 156, y = Math.sin(a) * 156;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  if (detail) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      g.beginPath(); g.lineWidth = 2; g.arc(Math.cos(a) * 112, Math.sin(a) * 112, 14, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(Math.cos(a) * 112, Math.sin(a) * 112, 4, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath(); g.lineWidth = 1.2;
      g.moveTo(Math.cos(a) * 62, Math.sin(a) * 62); g.lineTo(Math.cos(a) * 92, Math.sin(a) * 92); g.stroke();
    }
  }
  g.beginPath(); g.arc(0, 0, 10, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.userData.canvas = cv;
  return tex;
}

function softDiscTexture() {
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(cv);
}

// value noise for decal masks
function hash2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 144665)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vn(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let fx = x - xi, fy = y - yi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(x, y, s, o = 3) { let v = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < o; i++) { v += a * vn(x * f, y * f, s + i * 17); n += a; f *= 2.03; a *= 0.5; } return v / n; }
const sst = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

// draw with the 2D canvas API, return a luminance mask
function canvasMask(S, draw) {
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  draw(g, S);
  const d = g.getImageData(0, 0, S, S).data;
  const out = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) out[i] = d[i * 4] / 255;
  return out;
}
function jaggedBranches(g, S, rnd, o) {
  g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = '#fff'; g.shadowBlur = o.blur ?? 4;
  const walk = (x, y, a, len, w, depth) => {
    g.lineWidth = w; g.beginPath(); g.moveTo(x, y);
    const steps = 6 + Math.floor(rnd() * 5);
    for (let i = 0; i < steps; i++) {
      a += (rnd() - 0.5) * (o.jag ?? 0.9);
      const l = len / steps;
      x += Math.cos(a) * l; y += Math.sin(a) * l;
      g.lineTo(x, y);
      if (depth < 2 && rnd() < (o.branch ?? 0.22)) { g.stroke(); walk(x, y, a + (rnd() < 0.5 ? -1 : 1) * randRange(0.5, 1.1), len * 0.45, w * 0.6, depth + 1); g.lineWidth = w; g.beginPath(); g.moveTo(x, y); }
    }
    g.stroke();
  };
  const n = o.n ?? 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.6;
    const r0 = S * (o.r0 ?? 0.04);
    walk(S / 2 + Math.cos(a) * r0, S / 2 + Math.sin(a) * r0, a, S * (o.len ?? 0.42) * randRange(0.7, 1.05), o.w ?? 3, 0);
  }
}

// Decal masks, packed RGBA: R = base coverage, G = glow, B = detail / phase.
const DECAL_GEN = {
  scorch(S) {
    return (u, v, r) => {
      const n = fbm(u * 2.4 + 5, v * 2.4 + 5, 11);
      const edge = r + (n - 0.5) * 0.55;
      const ca = u / (r + 1e-4), sa = v / (r + 1e-4);
      const rays = sst(0.55, 0.9, vn(ca * 5 + 9, sa * 5 + 9, 12)) * sst(1.0, 0.45, r);
      const soot = Math.max(sst(0.95, 0.35, edge) * (0.72 + 0.28 * fbm(u * 7, v * 7, 13)), rays * 0.55);
      const rn = 1 - Math.abs(fbm(u * 3.4 + 1, v * 3.4 + 1, 14) * 2 - 1);
      const cracks = Math.pow(rn, 9) * sst(0.85, 0.2, edge);
      const hot = sst(0.6, 0.0, r) * (0.35 + 0.65 * n);
      return [soot, clamp(cracks * 1.3 + hot * 0.55, 0, 1), n, 1];
    };
  },
  frost(S) {
    return (u, v, r) => {
      const n = fbm(u * 2.2 + 3, v * 2.2 + 3, 21);
      const edge = r + (n - 0.5) * 0.5;
      const mask = sst(1.0, 0.5, edge);
      const ang = Math.atan2(v, u) + (n - 0.5) * 0.5;
      const main = sst(0.07, 0.0, r * Math.abs(Math.sin(ang * 3))) * sst(0.98, 0.15, r);
      const sub = sst(0.05, 0.0, r * Math.abs(Math.sin(ang * 9 + 0.5))) * sst(0.7, 0.3, r) * sst(0.1, 0.3, r);
      const cr = Math.pow(1 - Math.abs(fbm(u * 6 + 7, v * 6 + 7, 22) * 2 - 1), 7);
      const lines = clamp(main + sub * 0.7 + cr * 0.6, 0, 1);
      return [mask * (0.45 + 0.55 * clamp(lines + fbm(u * 9, v * 9, 23) * 0.4, 0, 1)), lines * mask, fbm(u * 14, v * 14, 24), 1];
    };
  },
  wet(S) {
    return (u, v, r) => {
      const n = fbm(u * 1.8 + 2, v * 1.8 + 2, 31);
      const edge = r + (n - 0.5) * 0.7;
      let mask = sst(0.9, 0.72, edge);
      const drops = sst(0.72, 0.8, fbm(u * 7 + 4, v * 7 + 4, 32)) * sst(1.0, 0.6, r);
      mask = Math.max(mask, drops);
      const rim = sst(0.08, 0.0, Math.abs(edge - 0.8)) * 0.9;
      return [mask, rim, n, 1];
    };
  },
  swirl(S) {
    return (u, v, r) => {
      const ang = Math.atan2(v, u);
      const s = Math.sin(ang * 3 + r * 9 + fbm(u * 3, v * 3, 41) * 1.5);
      const line = Math.pow(Math.max(0, s), 14) * sst(1.0, 0.35, r) * sst(0.04, 0.22, r);
      const dust = sst(1.0, 0.5, r) * 0.25 * fbm(u * 5, v * 5, 42);
      return [clamp(line * 0.7 + dust, 0, 1), line, 0, 1];
    };
  },
  char(S) {
    const rnd = mulberry32(77);
    const lines = canvasMask(S, (g) => jaggedBranches(g, S, rnd, { n: 7, len: 0.46, w: S / 90, jag: 1.0, branch: 0.3, blur: 3 }));
    return (u, v, r, x, y) => {
      const n = fbm(u * 3 + 8, v * 3 + 8, 51);
      const l = lines[y * S + x];
      const burn = sst(0.55, 0.05, r + (n - 0.5) * 0.4);
      return [clamp(burn * 0.85 + l * 0.75, 0, 1), clamp(l * 1.2 + burn * 0.25 * sst(0.3, 0, r), 0, 1), n, 1];
    };
  },
  crack(S) {
    const rnd = mulberry32(91);
    const lines = canvasMask(S, (g) => jaggedBranches(g, S, rnd, { n: 9, len: 0.47, w: S / 70, jag: 0.7, branch: 0.35, blur: 2, r0: 0.08 }));
    return (u, v, r, x, y) => {
      const n = fbm(u * 3 + 1, v * 3 + 1, 61);
      const l = lines[y * S + x];
      const dent = sst(0.4, 0.0, r + (n - 0.5) * 0.3);
      return [clamp(l * 0.9 + dent * 0.55, 0, 1), clamp(l * sst(1.0, 0.1, r) * 1.2 + dent * 0.4, 0, 1), n, 1];
    };
  },
  rune(S, vfx) {
    const cv = vfx.runeTex.userData.canvas;
    const lines = canvasMask(S, (g) => g.drawImage(cv, 0, 0, S, S));
    return (u, v, r, x, y) => [0, lines[y * S + x], 0, 1];
  },
};
const DECAL_SIZE = { scorch: 128, frost: 128, wet: 128, swirl: 128, char: 256, crack: 256, rune: 256 };

function buildDecalTex(kind, vfx) {
  const S = DECAL_SIZE[kind] || 128;
  const fn = DECAL_GEN[kind](S, vfx);
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1;
      const r = Math.hypot(u, v);
      const px = r > 1 ? [0, 0, 0, 0] : fn(u, v, r, x, y);
      const fade = sst(1.0, 0.92, r);
      const i = (y * S + x) * 4;
      data[i] = clamp(px[0] * fade, 0, 1) * 255; data[i + 1] = clamp(px[1] * fade, 0, 1) * 255; data[i + 2] = clamp(px[2], 0, 1) * 255; data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------
// Shaders
// ------------------------------------------------------------------
const RING_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const RING_FS = `
  uniform vec3 uColor; uniform float uAlpha; uniform float uThick; uniform float uFill; uniform float uTime; uniform float uNoise;
  varying vec2 vUv;
  void main(){
    vec2 p = vUv * 2.0 - 1.0; float d = length(p);
    if (d > 1.0) discard;
    float band = smoothstep(1.0, 1.0 - uThick * 0.35, d) * smoothstep(1.0 - uThick, 1.0 - uThick * 0.4, d);
    float fill = smoothstep(0.2, 1.0, d) * uFill;
    float ang = atan(p.y, p.x);
    float n = mix(1.0, 0.6 + 0.4 * sin(ang * 13.0 + uTime * 6.0) * sin(ang * 7.0 - uTime * 3.0), uNoise);
    float a = (band + fill) * uAlpha * n;
    gl_FragColor = vec4(uColor * a, a);
  }`;

const TORNADO_FS = `
  uniform vec3 uColor; uniform vec3 uCore; uniform float uAlpha; uniform float uTime; uniform float uSpeed;
  varying vec2 vUv;
  float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
  float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
  void main(){
    vec2 uv = vUv; uv.x += uTime * uSpeed + uv.y * 0.6;
    float n = n2(vec2(uv.x * 9.0, uv.y * 3.0 - uTime * 2.0)) * 0.6 + n2(vec2(uv.x * 18.0, uv.y * 6.0 - uTime * 3.0)) * 0.4;
    float stripes = smoothstep(0.45, 0.8, n);
    float edge = smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
    float a = stripes * edge * uAlpha;
    vec3 col = mix(uColor, uCore, smoothstep(0.7, 1.0, n));
    gl_FragColor = vec4(col * a, a);
  }`;

// velocity-aligned spark streaks
const STREAK_VS = `
  attribute vec4 aCol; varying vec4 vCol; varying vec2 vUv;
  void main(){ vCol = aCol; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const STREAK_FS = `
  varying vec4 vCol; varying vec2 vUv;
  void main(){
    float e = 1.0 - abs(vUv.x * 2.0 - 1.0);
    e = e * e * (3.0 - 2.0 * e);
    float a = e * mix(0.15, 1.0, vUv.y * vUv.y) * vCol.a;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vCol.rgb * (0.7 + 0.6 * e), a);
  }`;

// projectile ribbons
const RIBBON_VS = `
  attribute float aK; attribute float aS; varying float vK; varying float vS;
  void main(){ vK = aK; vS = aS; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RIBBON_FS = `
  uniform vec3 uCore; uniform vec3 uGlow; uniform float uAlpha; uniform float uTime; uniform float uWave;
  varying float vK; varying float vS;
  void main(){
    float e = 1.0 - abs(vS);
    float soft = smoothstep(0.0, 1.0, e);
    float k = clamp(vK, 0.0, 1.0);
    float fade = pow(1.0 - k, 1.35);
    float wob = 1.0 + uWave * 0.35 * sin(k * 40.0 - uTime * 30.0);
    vec3 col = mix(uGlow, uCore, pow(e, 3.0) * (1.0 - k * 0.8));
    gl_FragColor = vec4(col * wob, uAlpha * soft * fade);
  }`;

// ground decals (premultiplied: darkens via base, adds glow)
const DECAL_VS = `
  varying vec2 vUv; varying float vFog;
  uniform float uFogDensity;
  void main(){
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = -mv.z;
    vFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
    gl_Position = projectionMatrix * mv;
  }`;
const DECAL_FS = `
  uniform sampler2D uMap; uniform vec3 uBase; uniform float uBaseA; uniform vec3 uGlow; uniform float uGlowA;
  uniform vec3 uSheen; uniform float uRipple; uniform float uFlick; uniform float uTime; uniform float uAmb; uniform float uSeed;
  varying vec2 vUv; varying float vFog;
  void main(){
    vec4 t = texture2D(uMap, vUv);
    float a = t.r * uBaseA;
    vec3 col = uBase * uAmb * a;
    float fl = mix(1.0, 0.55 + 0.45 * sin(uTime * 7.0 + t.b * 23.0 + uSeed), uFlick);
    col += uGlow * t.g * uGlowA * fl;
    if (uRipple > 0.001) {
      vec2 p = vUv * 2.0 - 1.0; float r = length(p);
      float w = 0.5 + 0.5 * sin(r * 30.0 - uTime * 4.5 + t.b * 3.0);
      col += uSheen * uAmb * pow(w, 8.0) * t.r * uRipple;
    }
    float k = 1.0 - vFog;
    gl_FragColor = vec4(col * k, a * k);
  }`;

// fresnel shell (shock spheres)
const SHELL_VS = `
  varying vec3 vN; varying vec3 vV;
  void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const SHELL_FS = `
  uniform vec3 uColor; uniform float uAlpha; uniform float uPow;
  varying vec3 vN; varying vec3 vV;
  void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPow); gl_FragColor = vec4(uColor, f * uAlpha); }`;

// light pillars
const PILLAR_VS = `
  varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const PILLAR_FS = `
  uniform vec3 uColor; uniform vec3 uCore; uniform float uAlpha; uniform float uTime;
  varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
  float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
  void main(){
    float facing = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
    float streak = n2(vec2(vUv.x * 14.0, vUv.y * 2.5 - uTime * 3.5));
    float v = smoothstep(0.0, 0.06, vUv.y) * pow(1.0 - vUv.y, 1.6);
    float a = facing * v * (0.55 + 0.45 * streak) * uAlpha;
    gl_FragColor = vec4(mix(uColor, uCore, facing * facing), a);
  }`;

// ------------------------------------------------------------------
// Streaks: CPU-simulated, camera-facing stretched quads (one draw call)
// ------------------------------------------------------------------
class Streaks {
  constructor(scene, max = 1400) {
    this.max = max; this.count = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.ml = new Float32Array(max);
    this.w = new Float32Array(max); this.st = new Float32Array(max); this.minL = new Float32Array(max); this.maxL = new Float32Array(max);
    this.c0 = new Float32Array(max * 4); this.c1 = new Float32Array(max * 4);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    const g = (this.geo = new THREE.BufferGeometry());
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 12), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(max * 16), 4).setUsage(THREE.DynamicDrawUsage);
    const uv = new Float32Array(max * 8), idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) {
      uv.set([0, 0, 1, 0, 0, 1, 1, 1], i * 8);
      const b = i * 4; idx.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], i * 6);
    }
    g.setAttribute('position', this.aPos); g.setAttribute('aCol', this.aCol);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({ vertexShader: STREAK_VS, fragmentShader: STREAK_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 10;
    scene.add(this.mesh);
  }
  // o: p, v, life, w, stretch, minL, maxL, color, color1, alpha, alpha1, grav, drag
  emit(o) {
    if (this.count >= this.max) return;
    const i = this.count++, i3 = i * 3, i4 = i * 4;
    const p = o.p, v = o.v;
    this.p[i3] = p.x ?? p[0]; this.p[i3 + 1] = p.y ?? p[1]; this.p[i3 + 2] = p.z ?? p[2];
    this.v[i3] = v.x ?? v[0]; this.v[i3 + 1] = v.y ?? v[1]; this.v[i3 + 2] = v.z ?? v[2];
    this.life[i] = this.ml[i] = o.life ?? 0.4;
    this.w[i] = o.w ?? 0.05; this.st[i] = o.stretch ?? 0.035; this.minL[i] = o.minL ?? 0.05; this.maxL[i] = o.maxL ?? 3;
    const c = o.color, c1 = o.color1 ?? c;
    this.c0[i4] = c.r; this.c0[i4 + 1] = c.g; this.c0[i4 + 2] = c.b; this.c0[i4 + 3] = o.alpha ?? 1;
    this.c1[i4] = c1.r; this.c1[i4 + 1] = c1.g; this.c1[i4 + 2] = c1.b; this.c1[i4 + 3] = o.alpha1 ?? 0;
    this.grav[i] = o.grav ?? 0; this.drag[i] = o.drag ?? 0;
  }
  _kill(i) {
    const j = --this.count; if (i === j) return;
    const c3 = (a) => { a[i * 3] = a[j * 3]; a[i * 3 + 1] = a[j * 3 + 1]; a[i * 3 + 2] = a[j * 3 + 2]; };
    const c4 = (a) => { a[i * 4] = a[j * 4]; a[i * 4 + 1] = a[j * 4 + 1]; a[i * 4 + 2] = a[j * 4 + 2]; a[i * 4 + 3] = a[j * 4 + 3]; };
    c3(this.p); c3(this.v); c4(this.c0); c4(this.c1);
    this.life[i] = this.life[j]; this.ml[i] = this.ml[j]; this.w[i] = this.w[j]; this.st[i] = this.st[j];
    this.minL[i] = this.minL[j]; this.maxL[i] = this.maxL[j]; this.grav[i] = this.grav[j]; this.drag[i] = this.drag[j];
  }
  update(dt, cam) {
    const P = this.p, V = this.v, ap = this.aPos.array, ac = this.aCol.array;
    const cx = cam.x, cy = cam.y, cz = cam.z;
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this._kill(i); continue; }
      const i3 = i * 3, i4 = i * 4;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      V[i3] *= dr; V[i3 + 1] = V[i3 + 1] * dr - this.grav[i] * dt; V[i3 + 2] *= dr;
      P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
      const t = 1 - this.life[i] / this.ml[i];
      const px = P[i3], py = P[i3 + 1], pz = P[i3 + 2];
      let vx = V[i3], vy = V[i3 + 1], vz = V[i3 + 2];
      const sp = Math.hypot(vx, vy, vz);
      if (sp > 1e-4) { vx /= sp; vy /= sp; vz /= sp; } else { vx = 0; vy = 1; vz = 0; }
      const L = clamp(sp * this.st[i], this.minL[i], this.maxL[i]);
      const tx = px - vx * L, ty = py - vy * L, tz = pz - vz * L;
      let ex = cx - px, ey = cy - py, ez = cz - pz;
      const ed = Math.hypot(ex, ey, ez) || 1; ex /= ed; ey /= ed; ez /= ed;
      let sx = vy * ez - vz * ey, sy = vz * ex - vx * ez, sz = vx * ey - vy * ex;
      const sl = Math.hypot(sx, sy, sz) || 1;
      const w = this.w[i] * (1 - t * 0.6) / sl;
      sx *= w; sy *= w; sz *= w;
      const o = i * 12;
      ap[o] = tx - sx; ap[o + 1] = ty - sy; ap[o + 2] = tz - sz;
      ap[o + 3] = tx + sx; ap[o + 4] = ty + sy; ap[o + 5] = tz + sz;
      ap[o + 6] = px - sx; ap[o + 7] = py - sy; ap[o + 8] = pz - sz;
      ap[o + 9] = px + sx; ap[o + 10] = py + sy; ap[o + 11] = pz + sz;
      const c0 = this.c0, c1 = this.c1;
      const r = c0[i4] + (c1[i4] - c0[i4]) * t, g = c0[i4 + 1] + (c1[i4 + 1] - c0[i4 + 1]) * t, b = c0[i4 + 2] + (c1[i4 + 2] - c0[i4 + 2]) * t;
      const a = (c0[i4 + 3] + (c1[i4 + 3] - c0[i4 + 3]) * t) * sst(0.3, 1.8, ed);
      const q = i * 16;
      for (let k = 0; k < 4; k++) { ac[q + k * 4] = r; ac[q + k * 4 + 1] = g; ac[q + k * 4 + 2] = b; ac[q + k * 4 + 3] = a; }
      i++;
    }
    this.geo.setDrawRange(0, this.count * 6);
    this.mesh.visible = this.count > 0;
    if (this.count > 0) {
      this.aPos.needsUpdate = true; this.aCol.needsUpdate = true;
      this.aPos.clearUpdateRanges(); this.aPos.addUpdateRange(0, this.count * 12);
      this.aCol.clearUpdateRanges(); this.aCol.addUpdateRange(0, this.count * 16);
    }
  }
}

// ------------------------------------------------------------------
// Ribbons: pooled camera-facing trails that follow a moving point
// ------------------------------------------------------------------
const RIB_PTS = 32;
class RibbonPool {
  constructor(scene, n = 40) {
    this.scene = scene; this.list = []; this.clock = 0;
    const idx = [];
    for (let i = 0; i < RIB_PTS - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const aS = new Float32Array(RIB_PTS * 2);
    for (let i = 0; i < RIB_PTS; i++) { aS[i * 2] = -1; aS[i * 2 + 1] = 1; }
    this.baseMat = new THREE.ShaderMaterial({
      uniforms: { uCore: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uAlpha: { value: 1 }, uTime: U.time, uWave: { value: 0 } },
      vertexShader: RIBBON_VS, fragmentShader: RIBBON_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    for (let i = 0; i < n; i++) {
      const g = new THREE.BufferGeometry();
      const pos = new THREE.BufferAttribute(new Float32Array(RIB_PTS * 6), 3).setUsage(THREE.DynamicDrawUsage);
      const k = new THREE.BufferAttribute(new Float32Array(RIB_PTS * 2), 1).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', pos); g.setAttribute('aK', k); g.setAttribute('aS', new THREE.BufferAttribute(aS, 1));
      g.setIndex(idx); g.setDrawRange(0, 0);
      const mat = this.baseMat.clone();
      mat.uniforms.uTime = U.time;
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 11; m.visible = false;
      scene.add(m);
      this.list.push({ m, pos, k, busy: false, px: new Float32Array(RIB_PTS * 3), pt: new Float32Array(RIB_PTS), n: 0 });
    }
  }
  acquire(o) {
    const r = this.list.find((x) => !x.busy);
    if (!r) return null;
    r.busy = true; r.n = 0; r.released = false;
    r.follow = o.follow || null;
    r.width = o.width ?? 0.3; r.life = o.life ?? 0.2; r.taper = o.taper ?? 0.7; r.minDt = o.minDt ?? 1 / 90;
    const u = r.m.material.uniforms;
    u.uCore.value.copy(o.core); u.uGlow.value.copy(o.glow); u.uAlpha.value = o.alpha ?? 1; u.uWave.value = o.wave ?? 0;
    r.head = new THREE.Vector3();
    if (r.follow) r.head.copy(r.follow);
    const self = this;
    r.h = r.h || {
      push(p) { r.head.copy(p); },
      release() { if (!r.released) { r.released = true; self._commit(r, r.head); r.follow = null; } },
      get alive() { return r.busy; },
    };
    r.m.visible = true;
    return r.h;
  }
  _commit(r, p) {
    const n = Math.min(r.n + 1, RIB_PTS);
    r.px.copyWithin(3, 0, (n - 1) * 3); r.pt.copyWithin(1, 0, n - 1);
    r.px[0] = p.x; r.px[1] = p.y; r.px[2] = p.z; r.pt[0] = this.clock;
    r.n = n;
  }
  update(dt, cam) {
    this.clock += dt;
    const now = this.clock;
    for (const r of this.list) {
      if (!r.busy) continue;
      if (!r.released) {
        if (r.n === 0 || now - r.pt[0] >= r.minDt) this._commit(r, r.head);
        if (r.follow) r.head.copy(r.follow);
      }
      // drop expired points
      while (r.n > 0 && now - r.pt[r.n - 1] >= r.life) r.n--;
      const live = !r.released;
      const tot = r.n + (live ? 1 : 0);
      if (r.released && r.n < 2) { r.busy = false; r.m.visible = false; r.m.geometry.setDrawRange(0, 0); continue; }
      if (tot < 2) { r.m.geometry.setDrawRange(0, 0); continue; }
      const ap = r.pos.array, ak = r.k.array;
      const N = Math.min(tot, RIB_PTS);
      const P = (j, out) => {
        if (live) { if (j === 0) return out.copy(r.head); j--; }
        return out.set(r.px[j * 3], r.px[j * 3 + 1], r.px[j * 3 + 2]);
      };
      const T = (j) => (live ? (j === 0 ? now : r.pt[j - 1]) : r.pt[j]);
      _tan.set(0, 0, 1);
      for (let j = 0; j < N; j++) {
        P(j, tmpV);
        P(Math.max(0, j - 1), tmpV2);
        P(Math.min(N - 1, j + 1), tmpV3);
        tmpV2.sub(tmpV3);
        if (tmpV2.lengthSq() < 1e-8) tmpV2.copy(_tan); else _tan.copy(tmpV2);
        tmpV4.subVectors(cam, tmpV);
        tmpV3.crossVectors(tmpV2, tmpV4);
        const len = tmpV3.length() || 1;
        const k = clamp((now - T(j)) / r.life, 0, 1);
        const w = r.width * Math.pow(1 - k, r.taper) / len;
        tmpV3.multiplyScalar(w);
        ap[j * 6] = tmpV.x - tmpV3.x; ap[j * 6 + 1] = tmpV.y - tmpV3.y; ap[j * 6 + 2] = tmpV.z - tmpV3.z;
        ap[j * 6 + 3] = tmpV.x + tmpV3.x; ap[j * 6 + 4] = tmpV.y + tmpV3.y; ap[j * 6 + 5] = tmpV.z + tmpV3.z;
        ak[j * 2] = ak[j * 2 + 1] = k;
      }
      r.pos.needsUpdate = true; r.k.needsUpdate = true;
      r.m.geometry.setDrawRange(0, (N - 1) * 6);
    }
  }
}

// Decal presets
const DECAL = {
  scorch: { base: C(0.025, 0.018, 0.014), baseA: 0.8, glow: C(3.4, 1.1, 0.18), glowA: 1, glowDur: 2.4, flick: 1, dur: 11 },
  frost: { base: C(0.6, 0.76, 0.88), baseA: 0.6, glow: C(0.45, 1.3, 2.1), glowA: 0.7, glowDur: 1.4, dur: 9, sheen: C(0.9, 1, 1.1) },
  wet: { base: C(0.02, 0.035, 0.06), baseA: 0.5, glow: C(0.22, 0.32, 0.45), glowA: 0.5, glowDur: 99, ripple: 0.35, sheen: C(0.35, 0.45, 0.6), dur: 8 },
  char: { base: C(0.02, 0.02, 0.03), baseA: 0.62, glow: C(2.8, 2.3, 0.7), glowA: 1.2, glowDur: 1.6, flick: 1, dur: 7 },
  swirl: { base: C(0.55, 0.52, 0.42), baseA: 0.3, glow: C(0.5, 2.0, 1.2), glowA: 0.8, glowDur: 0.7, dur: 2.6, spin: 1.6 },
  rune: { base: C(0, 0, 0), baseA: 0, glow: C(1.0, 0.45, 2.2), glowA: 1, glowDur: 2.2, dur: 3, spin: 0.5 },
  crack: { base: C(0.03, 0.025, 0.025), baseA: 0.72, glow: C(3.0, 1.0, 0.2), glowA: 1, glowDur: 1.8, dur: 10 },
};

// ------------------------------------------------------------------
export class VFX {
  constructor(scene) {
    this.scene = scene;
    this.add = new Particles(scene, 8000, true);
    this.norm = new Particles(scene, 3000, false);
    this.fx = [];
    this.runeTex = runeTexture(7, 1);
    this.runeTex2 = runeTexture(23, 0);
    this.discTex = softDiscTexture();
    this.streaks = new Streaks(scene, 1400);
    this.ribbons = new RibbonPool(scene, 40);
    this.fogU = { density: { value: 0.004 } };
    this.ambU = { value: 1 };
    this.nCircles = 0;

    // Light pool
    this.lights = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 14, 1.4);
      l.castShadow = false;
      scene.add(l);
      this.lights.push({ l, t: 0, dur: 0, peak: 0, follow: null, held: false });
    }

    // Ring pool (grows on demand)
    this.ringGeo = new THREE.PlaneGeometry(2, 2);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.planeGeo = new THREE.PlaneGeometry(2, 2);
    this.rings = [];
    for (let i = 0; i < 28; i++) this._newRing();

    // Geometries
    this.orbGeo = new THREE.IcosahedronGeometry(1, 3);
    this.shellGeo = new THREE.IcosahedronGeometry(1, 2);
    this.crystalGeo = new THREE.OctahedronGeometry(1, 0);
    this.crystalGeo.scale(0.45, 1, 0.45);
    this.crystalGeo.translate(0, 0.9, 0);
    this.iceMat = toon(0xc8f2ff, { emissive: 0x3a8ab0, emissiveIntensity: 0.9, rim: 1.2, flat: true });
    this.iceMatT = toon(0xc8f2ff, { emissive: 0x3a8ab0, emissiveIntensity: 0.9, rim: 1.2, flat: true, transparent: true, opacity: 0.8, nocache: true });
    this.cylGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
    this.cylGeo.translate(0, 0.5, 0);

    // Lightning strand pool
    this.strands = [];
    this.strandIdx = [];
    for (let i = 0; i < 16; i++) { const a = i * 2; this.strandIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    for (let i = 0; i < 64; i++) this._newStrand();

    // Shock shells
    this.shells = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(this.shellGeo, new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uPow: { value: 2.2 } },
        vertexShader: SHELL_VS, fragmentShader: SHELL_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      m.visible = false; m.renderOrder = 9; m.frustumCulled = false;
      scene.add(m); this.shells.push({ m, busy: false });
    }
    // Light pillars
    this.pillars = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(this.cylGeo, new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uCore: { value: new THREE.Color() }, uAlpha: { value: 0 }, uTime: U.time },
        vertexShader: PILLAR_VS, fragmentShader: PILLAR_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }));
      m.visible = false; m.renderOrder = 9; m.frustumCulled = false;
      scene.add(m); this.pillars.push({ m, busy: false });
    }

    // Decals
    this.decalTex = {};
    this.decalGeo = new THREE.PlaneGeometry(2, 2); this.decalGeo.rotateX(-Math.PI / 2);
    this.decals = [];
    this.decalSeq = 0;
    for (let i = 0; i < 28; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: null }, uBase: { value: new THREE.Color() }, uBaseA: { value: 0 }, uGlow: { value: new THREE.Color() }, uGlowA: { value: 0 },
          uSheen: { value: new THREE.Color() }, uRipple: { value: 0 }, uFlick: { value: 0 }, uTime: U.time, uAmb: this.ambU, uSeed: { value: 0 },
          uFogDensity: this.fogU.density,
        },
        vertexShader: DECAL_VS, fragmentShader: DECAL_FS, transparent: true, depthWrite: false,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      });
      const m = new THREE.Mesh(this.decalGeo, mat);
      m.visible = false; m.renderOrder = 2; m.frustumCulled = false;
      scene.add(m);
      this.decals.push({ m, busy: false, t: 0, seq: 0 });
    }
    // build decal masks progressively so the first use doesn't hitch
    const kinds = Object.keys(DECAL_GEN);
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 60));
    const next = () => { const k = kinds.shift(); if (!k) return; this.tex(k); idle(next); };
    setTimeout(() => idle(next), 1500);
    setTimeout(() => this.prewarm(), 800);

    this._slowPrev = false;
  }

  // Compile the pooled effect shaders up front (pooled meshes start invisible,
  // so the boot-time compileAsync would otherwise skip them and the first
  // explosion would hitch).
  prewarm() {
    const R = G.renderer && G.renderer.renderer;
    if (!R || !G.camera) return;
    const sc = new THREE.Scene();
    const add = (mat, geo = this.planeGeo) => { const m = new THREE.Mesh(geo, mat); m.position.set(0, -500, 0); m.frustumCulled = false; sc.add(m); };
    add(this.decals[0].m.material, this.decalGeo);
    add(this.shells[0].m.material, this.shellGeo);
    add(this.pillars[0].m.material, this.cylGeo);
    add(this.streaks.mat, this.streaks.geo);
    add(this.ribbons.list[0].m.material, this.ribbons.list[0].m.geometry);
    add(this.strands[0].m.material, this.strands[0].m.geometry);
    const done = () => { sc.clear(); };
    try { const p = R.compileAsync ? R.compileAsync(sc, G.camera, this.scene) : (R.compile(sc, G.camera, this.scene), null); if (p && p.then) p.then(done, done); else done(); } catch (e) { done(); }
  }

  tex(kind) { return this.decalTex[kind] || (this.decalTex[kind] = buildDecalTex(kind, this)); }

  _newRing() {
    const m = new THREE.Mesh(this.ringGeo, new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 1 }, uThick: { value: 0.2 }, uFill: { value: 0 }, uTime: U.time, uNoise: { value: 0 } },
      vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    m.visible = false; m.renderOrder = 8; m.frustumCulled = false;
    this.scene.add(m);
    const r = { m, busy: false };
    this.rings.push(r);
    return r;
  }
  _newStrand() {
    const geo = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(17 * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', pos); geo.setIndex(this.strandIdx);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 11; m.visible = false;
    this.scene.add(m);
    const s = { m, busy: false };
    this.strands.push(s);
    return s;
  }

  // ---------------- lights ----------------
  flash(pos, color, intensity = 30, distance = 14, dur = 0.25) {
    // Flash lights are physically-based point lights; at the old values a single
    // blast lit the whole screen. Scale down and cap the reach so the glow stays local.
    intensity *= FLASH_K; distance = Math.min(distance, 22);
    // a flash already burning at (almost) the same spot absorbs this one instead of stacking
    for (const s of this.lights) {
      if (s.held || s.dur <= 0 || s.l.intensity < 1) continue;
      if (s.l.position.distanceToSquared(pos) < 9) {
        if (intensity > s.l.intensity) { s.l.color.set(color); s.peak = intensity; s.l.intensity = intensity; s.dur = Math.max(dur, s.dur - s.t); s.t = 0; }
        s.l.distance = Math.max(s.l.distance, distance);
        return;
      }
    }
    let best = null;
    for (const s of this.lights) if (!s.held && (!best || s.l.intensity < best.l.intensity)) best = s;
    if (!best) return;
    best.l.position.copy(pos);
    best.l.color.set(color);
    best.l.distance = distance;
    best.peak = intensity; best.t = 0; best.dur = dur; best.follow = null;
    best.l.intensity = intensity;
  }
  holdLight(color, intensity = 18, distance = 10) {
    const s = this.lights.find((s) => !s.held && s.l.intensity < 0.5) || this.lights.find((s) => !s.held);
    if (!s) return null;
    intensity *= 0.7; s.held = true; s.l.color.set(color); s.l.intensity = intensity; s.l.distance = distance; s.peak = intensity; s.dur = 0;
    return s;
  }
  releaseLight(s) { if (s) { s.held = false; s.t = 0; s.dur = 0.15; s.peak = s.l.intensity; } }

  // ---------------- particles ----------------
  burst(pos, preset, n = 12, o = {}) {
    const P = this.presets[preset];
    if (!P) return;
    const q = G.settings.quality === 'low' ? 0.5 : 1;
    const cnt = Math.max(1, Math.round(n * q));
    for (let i = 0; i < cnt; i++) P.call(this, pos, o, i, cnt);
  }

  // ---------------- streaks ----------------
  // cone spray of velocity-aligned sparks. dir may be null (sphere).
  sparks(pos, dir, n = 10, o = {}) {
    const q = G.settings.quality === 'low' ? 0.5 : 1;
    const cnt = Math.max(1, Math.round(n * q));
    const c = o.pal || pal(o.el);
    const spread = o.spread ?? 0.6, sp = o.speed ?? 14;
    if (dir) dir = _sd.copy(dir).normalize();
    for (let i = 0; i < cnt; i++) {
      if (dir) coneDir(tmpV, dir, spread); else sphereV(tmpV);
      if (o.up) tmpV.y = Math.abs(tmpV.y) * o.up + (1 - o.up) * tmpV.y;
      const s = sp * randRange(0.45, 1.1);
      this.streaks.emit({
        p: [pos.x + rv(o.jitter ?? 0.05), pos.y + rv(o.jitter ?? 0.05), pos.z + rv(o.jitter ?? 0.05)], v: [tmpV.x * s, tmpV.y * s, tmpV.z * s],
        life: randRange(0.6, 1) * (o.life ?? 0.32), w: (o.w ?? 0.045) * randRange(0.7, 1.2), stretch: o.stretch ?? 0.03, minL: o.minL ?? 0.06, maxL: o.maxL ?? 2.2,
        color: o.color || c.core, color1: o.color1 || c.glow, alpha: o.alpha ?? 1, alpha1: 0, grav: o.grav ?? 9, drag: o.drag ?? 2.5,
      });
    }
  }
  // radial ring of streaks flying outward in the ground plane (shock debris)
  radial(pos, n = 16, o = {}) {
    const c = o.pal || pal(o.el);
    const q = G.settings.quality === 'low' ? 0.5 : 1;
    const cnt = Math.max(1, Math.round(n * q));
    for (let i = 0; i < cnt; i++) {
      const a = (i / cnt) * Math.PI * 2 + rv(0.2);
      const s = (o.speed ?? 16) * randRange(0.6, 1.1);
      const up = o.up ?? 0.25;
      this.streaks.emit({
        p: [pos.x + Math.cos(a) * (o.r0 ?? 0.3), pos.y + (o.y ?? 0.2), pos.z + Math.sin(a) * (o.r0 ?? 0.3)], v: [Math.cos(a) * s, s * up * randRange(0.3, 1), Math.sin(a) * s],
        life: randRange(0.7, 1) * (o.life ?? 0.4), w: (o.w ?? 0.06) * randRange(0.7, 1.2), stretch: o.stretch ?? 0.035, minL: 0.1, maxL: o.maxL ?? 3,
        color: o.color || c.core, color1: o.color1 || c.glow, alpha: o.alpha ?? 1, alpha1: 0, grav: o.grav ?? 6, drag: o.drag ?? 2,
      });
    }
  }
  // spiral streaks swirling around a vertical axis
  swirl(pos, n = 14, o = {}) {
    const c = o.pal || pal(o.el);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, r = (o.r ?? 1.2) * randRange(0.5, 1);
      const s = (o.speed ?? 10) * randRange(0.7, 1.1), dirS = o.ccw ? -1 : 1;
      this.streaks.emit({
        p: [pos.x + Math.cos(a) * r, pos.y + randRange(0, o.h ?? 1.5), pos.z + Math.sin(a) * r],
        v: [(-Math.sin(a) * dirS + Math.cos(a) * (o.out ?? 0.3)) * s, randRange(0.5, 2.5) * (o.rise ?? 1), (Math.cos(a) * dirS + Math.sin(a) * (o.out ?? 0.3)) * s],
        life: randRange(0.25, 0.5) * (o.life ?? 1), w: (o.w ?? 0.05), stretch: 0.04, minL: 0.2, maxL: 2.5,
        color: o.color || c.core, color1: o.color1 || c.glow, alpha: o.alpha ?? 0.9, alpha1: 0, grav: 0, drag: 1.5,
      });
    }
  }

  // ---------------- ribbons ----------------
  ribbon(o) {
    const c = pal(o.el);
    return this.ribbons.acquire({ core: o.core || c.core, glow: o.glow || c.glow, ...o });
  }

  // ---------------- rings ----------------
  ring(pos, color, radius = 4, dur = 0.5, o = {}) {
    let r = this.rings.find((r) => !r.busy);
    if (!r && this.rings.length < 56) r = this._newRing();
    if (!r) return;
    r.busy = true;
    const m = r.m, u = m.material.uniforms;
    m.visible = true;
    m.position.copy(pos); m.position.y += o.y ?? 0.15;
    m.rotation.set(o.rx ?? 0, 0, o.rz ?? 0);
    if (o.up) m.quaternion.setFromUnitVectors(tmpV.set(0, 1, 0), o.up);
    u.uColor.value.copy(color instanceof THREE.Color ? color : tmpC.set(color));
    u.uThick.value = o.thick ?? 0.18; u.uFill.value = o.fill ?? 0; u.uNoise.value = o.noise ?? 0;
    const r0 = o.r0 ?? 0.2;
    const delay = o.delay ?? 0;
    let t = -delay;
    m.scale.setScalar(delay > 0 ? 0.0001 : r0);
    u.uAlpha.value = 0;
    this.fx.push({
      update: (dt) => {
        t += dt;
        if (t < 0) return true;
        const k = clamp(t / dur, 0, 1);
        const e = 1 - Math.pow(1 - k, o.ease ?? 3);
        const s = r0 + (radius - r0) * e;
        m.scale.set(s, s, s);
        u.uAlpha.value = (o.alpha ?? 1) * (1 - k) * (1 - k);
        if (k >= 1) { m.visible = false; r.busy = false; return false; }
        return true;
      },
    });
  }

  // ---------------- rune circle ----------------
  circle(pos, color, size = 2, dur = 1, o = {}) {
    const mat = new THREE.MeshBasicMaterial({
      map: o.alt ? this.runeTex2 : this.runeTex, color: (color instanceof THREE.Color ? color.clone() : new THREE.Color(color)).multiplyScalar(o.intensity ?? 1.05),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, opacity: 0,
    });
    const m = new THREE.Mesh(this.planeGeo, mat);
    m.renderOrder = 7;
    if (o.vertical) {
      m.position.copy(pos);
      if (o.dir) m.lookAt(tmpV.copy(pos).add(o.dir));
    } else {
      m.rotation.x = -Math.PI / 2;
      m.position.copy(pos); m.position.y += 0.08;
    }
    this.scene.add(m);
    this.nCircles++;
    let t = 0;
    const spin = o.spin ?? 1.2;
    const h = {
      mesh: m, done: false, follow: o.follow || null, offset: o.offset || null,
      end() { h.done = true; },
      update: (dt) => {
        t += dt;
        const inT = Math.min(1, t / 0.18);
        const s = size * (o.grow ? 0.5 + 0.5 * easeOutBack(inT) : easeOutBack(inT));
        let alpha = inT;
        if (dur > 0 && t > dur) h.done = true;
        if (h.done) { h.out = (h.out || 0) + dt / 0.3; alpha = Math.max(0, 1 - h.out); }
        m.scale.set(s * (1 + (h.out || 0) * 0.3), s * (1 + (h.out || 0) * 0.3), 1);
        // additive budget: many stacked circles dim each other instead of washing out the frame
        const bud = Math.min(1, 1.9 / Math.sqrt(Math.max(1, this.nCircles)));
        mat.opacity = alpha * (o.alpha ?? 0.9) * bud;
        if (o.vertical) m.rotateZ(dt * spin); else m.rotation.z += dt * spin;
        if (h.follow) {
          m.position.copy(h.follow.position || h.follow);
          if (h.offset) m.position.add(h.offset);
          if (!o.vertical) m.position.y += 0.08;
        }
        if (h.done && alpha <= 0) { this.scene.remove(m); mat.dispose(); this.nCircles--; return false; }
        return true;
      },
    };
    this.fx.push(h);
    return h;
  }

  // ---------------- lightning ----------------
  lightning(from, to, o = {}) {
    const color = o.color || PAL.storm.core;
    const width = o.width ?? 0.18;
    const dur = o.dur ?? 0.22;
    const segs = clamp(o.segs ?? 14, 2, 16);
    const strands = [{ a: from.clone(), b: to.clone(), w: width, jag: o.jag ?? 0.12 }];
    const nb = o.branches ?? 2;
    for (let i = 0; i < nb; i++) {
      const t = randRange(0.25, 0.75);
      const a = from.clone().lerp(to, t);
      const len = from.distanceTo(to) * randRange(0.2, 0.4);
      const b = a.clone().add(tmpV.set(randRange(-1, 1), randRange(-0.6, 0.3), randRange(-1, 1)).normalize().multiplyScalar(len));
      strands.push({ a, b, w: width * 0.5, jag: 0.18 });
    }
    const meshes = [];
    for (const s of strands) {
      for (const layer of [0, 1]) {
        let st = this.strands.find((x) => !x.busy);
        if (!st && this.strands.length < 160) st = this._newStrand();
        if (!st) continue;
        st.busy = true;
        st.m.visible = true;
        st.m.geometry.setDrawRange(0, segs * 6);
        st.m.material.color.copy(layer === 0 ? color : (o.glow || PAL.storm.glow)).multiplyScalar(layer === 0 ? 1.6 : 0.55);
        meshes.push({ st, s, layer, pts: [] });
      }
    }
    const regen = () => {
      for (const mm of meshes) {
        if (mm.layer === 1) continue;
        const { a, b, jag } = mm.s;
        const len = a.distanceTo(b);
        const pts = mm.pts.length ? mm.pts : Array.from({ length: segs + 1 }, () => new THREE.Vector3());
        for (let i = 0; i <= segs; i++) {
          const t = i / segs;
          const p = pts[i].copy(a).lerp(b, t);
          if (i > 0 && i < segs) {
            const amp = len * jag * Math.sin(t * Math.PI);
            p.x += randRange(-1, 1) * amp; p.y += randRange(-1, 1) * amp; p.z += randRange(-1, 1) * amp;
          }
        }
        mm.pts = pts;
        const twin = meshes.find((x) => x.s === mm.s && x.layer === 1);
        if (twin) twin.pts = pts;
      }
    };
    regen();
    let t = 0, rt = 0;
    this.fx.push({
      update: (dt) => {
        t += dt; rt += dt;
        if (rt > 0.05) { rt = 0; regen(); }
        const cam = G.camera.position;
        const k = t / dur;
        const fl = (0.6 + rand() * 0.4) * (1 - k * k);
        for (const mm of meshes) {
          const arr = mm.st.m.geometry.attributes.position.array;
          const pts = mm.pts; const w = mm.s.w * (mm.layer ? 5 : 1);
          for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const pa = pts[Math.max(0, i - 1)], pb = pts[Math.min(pts.length - 1, i + 1)];
            tmpV.subVectors(pb, pa).normalize();
            tmpV2.subVectors(cam, p).normalize();
            tmpV3.crossVectors(tmpV, tmpV2).normalize().multiplyScalar(w * (1 - 0.6 * (i / pts.length)));
            arr[i * 6] = p.x + tmpV3.x; arr[i * 6 + 1] = p.y + tmpV3.y; arr[i * 6 + 2] = p.z + tmpV3.z;
            arr[i * 6 + 3] = p.x - tmpV3.x; arr[i * 6 + 4] = p.y - tmpV3.y; arr[i * 6 + 5] = p.z - tmpV3.z;
          }
          mm.st.m.geometry.attributes.position.needsUpdate = true;
          mm.st.m.material.opacity = fl;
        }
        if (t >= dur) {
          for (const mm of meshes) { mm.st.busy = false; mm.st.m.visible = false; }
          return false;
        }
        return true;
      },
    });
  }
  // small crackling arcs around a point (electric residue)
  arcs(pos, n = 2, r = 1, o = {}) {
    for (let i = 0; i < n; i++) {
      const a = tmpV4.set(pos.x + rv(r * 0.4), pos.y + rv(r * 0.3), pos.z + rv(r * 0.4)).clone();
      const b = a.clone().add(tmpV.set(rv(1), rv(0.6) + (o.up ?? 0), rv(1)).normalize().multiplyScalar(r * randRange(0.5, 1)));
      this.lightning(a, b, { width: o.width ?? 0.035, dur: o.dur ?? 0.12, branches: 0, segs: 6, jag: 0.22, color: o.color, glow: o.glow });
    }
  }

  // ---------------- orbs ----------------
  orb(el, size = 0.3, o = {}) {
    const p = PAL[el] || PAL.arcane;
    const mat = fresnelMat(p.core, p.glow, { intensity: 1.2 });
    const m = new THREE.Mesh(this.orbGeo, mat);
    m.scale.setScalar(size);
    m.renderOrder = 12;
    if (o.halo) {
      const sm = new THREE.SpriteMaterial({ map: this.discTex, color: p.glow.clone().multiplyScalar(o.haloI ?? 0.45), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const s = new THREE.Sprite(sm);
      s.scale.setScalar(o.halo);
      s.renderOrder = 11;
      m.add(s); m.userData.halo = s;
    }
    this.scene.add(m);
    return m;
  }
  disposeOrb(m) { this.scene.remove(m); m.material.dispose(); if (m.userData.halo) m.userData.halo.material.dispose(); }

  // ---------------- ice crystal ----------------
  crystal(pos, height = 2, o = {}) {
    const m = new THREE.Mesh(this.crystalGeo, o.transparent ? this.iceMatT : this.iceMat);
    m.position.copy(pos);
    m.rotation.set(randRange(-0.25, 0.25) + (o.tiltX || 0), rand() * Math.PI * 2, randRange(-0.25, 0.25) + (o.tiltZ || 0));
    m.castShadow = true;
    m.scale.set(0.001, 0.001, 0.001);
    this.scene.add(m);
    let t = 0;
    const life = o.life ?? 1.4;
    const w = o.width ?? height * 0.45;
    if (!o.quiet) { this.sparks(tmpV4.copy(pos).setY(pos.y + 0.2), UPV, Math.min(8, 2 + height * 2), { el: 'frost', spread: 0.8, speed: 7, grav: 12, life: 0.35, w: 0.035 }); }
    this.fx.push({
      update: (dt) => {
        t += dt;
        if (t < 0.16) {
          const k = easeOutBack(t / 0.16);
          m.scale.set(w * k, height * k, w * k);
        } else if (t > life) {
          const k = (t - life) / 0.18;
          if (k >= 1) {
            const c = m.position.clone().add(tmpV.set(0, height * 0.5, 0));
            this.burst(c, 'ice', 8, { spread: height * 0.4 });
            this.burst(c, 'shard', 4, { spread: height * 0.3 });
            this.scene.remove(m);
            return false;
          }
          m.scale.set(w * (1 - k), height * (1 - k * 0.3), w * (1 - k));
        }
        return true;
      },
    });
    return m;
  }

  // ---------------- tornado ----------------
  tornado(pos, o = {}) {
    const p = PAL[o.el || 'wind'];
    const grp = new THREE.Group();
    grp.position.copy(pos);
    const mats = [];
    const layers = [[1.3, 3.2, 7, 0.9], [0.9, 2.3, 6, 1.4], [0.5, 1.4, 5, 2.1]];
    for (const [rb, rt, h, sp] of layers) {
      const geo = new THREE.CylinderGeometry(rt, rb, h, 20, 6, true); geo.translate(0, h / 2, 0);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: p.glow.clone() }, uCore: { value: p.core.clone() }, uAlpha: { value: 0 }, uTime: U.time, uSpeed: { value: sp } },
        vertexShader: RING_VS, fragmentShader: TORNADO_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      mats.push(mat);
      const m = new THREE.Mesh(geo, mat); m.renderOrder = 9; grp.add(m);
    }
    const sc = o.scale ?? 1;
    grp.scale.setScalar(sc);
    this.scene.add(grp);
    let dustT = 0;
    const h = {
      grp, alpha: 0, done: false,
      update: (dt) => {
        h.alpha = h.done ? Math.max(0, h.alpha - dt * 2.5) : Math.min(1, h.alpha + dt * 4);
        // when the camera is at/inside the funnel wall (tornados worn by the player), both walls
        // stack right in front of the lens — fade them so the view stays readable
        let camK = 1;
        if (G.camera) {
          const cp = G.camera.position, gp = grp.position;
          const d = Math.hypot(cp.x - gp.x, cp.z - gp.z);
          const hy = clamp((cp.y - gp.y) / (7 * Math.max(0.05, grp.scale.y)), 0, 1);
          const wall = (1.3 + 1.9 * hy) * grp.scale.x;
          camK = 0.3 + 0.7 * clamp((d - wall * 0.9) / (wall * 0.8), 0, 1);
        }
        for (const m of mats) m.uniforms.uAlpha.value = h.alpha * (o.alpha ?? 0.5) * camK;
        grp.rotation.y += dt * 6;
        // debris and ground dust swirling at the base
        if (!h.done && !o.noDebris) {
          dustT -= dt;
          if (dustT <= 0) {
            dustT = 0.05;
            const gp = grp.position;
            const a = rand() * Math.PI * 2, r = randRange(1.2, 2.8) * sc;
            this.streaks.emit({ p: [gp.x + Math.cos(a) * r, gp.y + randRange(0.1, 2.5) * sc, gp.z + Math.sin(a) * r], v: [-Math.sin(a) * 11 * sc, randRange(2, 6), Math.cos(a) * 11 * sc],
              life: 0.35, w: 0.05, stretch: 0.04, minL: 0.2, maxL: 2.5, color: p.core, color1: p.glow, alpha: 0.7, alpha1: 0, drag: 1 });
            if (rand() < 0.4 && o.el !== 'water') this.burst(tmpV.set(gp.x + Math.cos(a) * r * 0.8, gp.y + 0.1, gp.z + Math.sin(a) * r * 0.8), 'dust', 1, { speed: 3, size: 0.6 * sc });
          }
        }
        if (h.done && h.alpha <= 0) { this.scene.remove(grp); grp.traverse((c) => c.geometry && c.geometry.dispose()); mats.forEach((m) => m.dispose()); return false; }
        return true;
      },
    };
    this.fx.push(h);
    return h;
  }

  // ---------------- beam ----------------
  beam(el, o = {}) {
    const p = PAL[el] || PAL.arcane;
    const grp = new THREE.Group();
    const core = new THREE.Mesh(this.cylGeo, new THREE.MeshBasicMaterial({ color: p.core.clone().multiplyScalar(1.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const glow = new THREE.Mesh(this.cylGeo, new THREE.MeshBasicMaterial({ color: p.glow.clone().multiplyScalar(0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const outer = new THREE.Mesh(this.cylGeo, new THREE.MeshBasicMaterial({ color: p.glow.clone().multiplyScalar(0.18), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    core.renderOrder = 12; glow.renderOrder = 11; outer.renderOrder = 10;
    grp.add(core, glow, outer);
    this.scene.add(grp);
    const a0 = new THREE.Vector3(), b0 = new THREE.Vector3();
    let ft = 0;
    const self = this;
    const h = {
      grp, width: o.width ?? 0.25, alpha: 0, done: false,
      set(a, b) {
        a0.copy(a); b0.copy(b);
        const len = a.distanceTo(b);
        grp.position.copy(a);
        tmpV.subVectors(b, a).normalize();
        grp.quaternion.setFromUnitVectors(tmpV2.set(0, 1, 0), tmpV);
        const w = h.width * (0.85 + Math.sin(G.time * 40) * 0.15);
        core.scale.set(w * 0.45, len, w * 0.45);
        glow.scale.set(w * 1.6, len, w * 1.6);
        outer.scale.set(w * 3.2 * (0.9 + Math.sin(G.time * 13) * 0.1), len, w * 3.2);
      },
      update: (dt) => {
        h.alpha = h.done ? Math.max(0, h.alpha - dt * 5) : Math.min(1, h.alpha + dt * 10);
        core.material.opacity = h.alpha; glow.material.opacity = h.alpha * 0.7; outer.material.opacity = h.alpha * 0.4;
        // flare at the muzzle and a spray at the end point
        if (!h.done && h.alpha > 0.3) {
          ft -= dt;
          if (ft <= 0) {
            ft = 0.03;
            self.burst(a0, 'glow', 1, { el, size: h.width * 2.4, size1: h.width * 3, life: 0.06, alpha: 0.35 });
            self.burst(b0, 'glow', 1, { el, size: h.width * 7, size1: h.width * 9, life: 0.07, alpha: 0.7 });
            tmpV.subVectors(a0, b0).normalize();
            self.sparks(b0, tmpV, 2, { el, spread: 0.9, speed: 10, life: 0.25 });
          }
        }
        if (h.done && h.alpha <= 0) { this.scene.remove(grp); core.material.dispose(); glow.material.dispose(); outer.material.dispose(); return false; }
        return true;
      },
    };
    this.fx.push(h);
    return h;
  }

  // ---------------- telegraph (enemy warnings) ----------------
  telegraph(pos, radius, dur, color = 0xff3a2a, o = {}) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(1.5) }, uAlpha: { value: 0 }, uThick: { value: 0.08 }, uFill: { value: 0.35 }, uTime: U.time, uNoise: { value: 0 } },
      vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.position.copy(pos); m.position.y += 0.2; m.renderOrder = 8;
    m.scale.setScalar(radius);
    this.scene.add(m);
    const inner = new THREE.Mesh(this.ringGeo, mat.clone());
    inner.material.uniforms.uFill.value = 0.6; inner.material.uniforms.uThick.value = 0.15;
    inner.position.copy(m.position); inner.renderOrder = 8;
    this.scene.add(inner);
    let t = 0;
    const h = {
      mesh: m, done: false,
      update: (dt) => {
        t += dt; const k = clamp(t / dur, 0, 1);
        if (o.follow) { m.position.copy(o.follow); m.position.y += 0.2; inner.position.copy(m.position); }
        mat.uniforms.uAlpha.value = Math.min(1, t * 6) * (0.7 + 0.3 * Math.sin(t * 20));
        inner.scale.setScalar(Math.max(0.01, radius * k));
        inner.material.uniforms.uAlpha.value = 0.8;
        if (t >= dur || h.done) {
          this.scene.remove(m); this.scene.remove(inner); mat.dispose(); inner.material.dispose();
          return false;
        }
        return true;
      },
    };
    this.fx.push(h);
    return h;
  }

  // ---------------- decals ----------------
  // Ground decal aligned to the terrain. kind: scorch | frost | wet | char | swirl | rune | crack
  // o: dur, glowDur, glow (Color), alpha, rot, spin, noGround (use pos.y as-is), delay
  decal(pos, kind = 'scorch', radius = 2, o = {}) {
    const D = DECAL[kind];
    if (!D || radius <= 0.05) return null;
    const W = G.world;
    let x = pos.x, z = pos.z, y = pos.y;
    let onPlat = false;
    if (W && !o.noGround) {
      const th = W.h(x, z);
      if (th < -0.2 && kind !== 'rune' && kind !== 'swirl') return null; // over water
      const gy = W.ground(x, z, y + 1.5);
      if (Math.abs(gy - y) > 3.5) return null; // too far from the ground (mid-air)
      onPlat = gy > th + 0.05;
      y = gy;
    }
    let d = this.decals.find((q) => !q.busy);
    if (!d) { d = this.decals.reduce((a, b) => (a.seq < b.seq ? a : b)); }
    d.busy = true; d.seq = ++this.decalSeq; d.t = -(o.delay ?? 0); d.kind = kind;
    const m = d.m, u = m.material.uniforms;
    u.uMap.value = this.tex(kind);
    u.uBase.value.copy(D.base); u.uBaseA.value = 0;
    u.uGlow.value.copy(o.glow || D.glow); u.uGlowA.value = 0;
    u.uSheen.value.copy(D.sheen || D.base); u.uRipple.value = D.ripple || 0; u.uFlick.value = D.flick || 0;
    u.uSeed.value = rand() * 100;
    d.baseA = (o.alpha ?? 1) * D.baseA; d.glowA = (o.glowA ?? 1) * D.glowA;
    d.dur = o.dur ?? D.dur; d.glowDur = o.glowDur ?? D.glowDur; d.spin = o.spin ?? D.spin ?? 0; d.r = radius;
    m.position.set(x, y + 0.04, z);
    if (W && !o.noGround && !onPlat) {
      W.terrain.normal(x, z, tmpV);
      if (tmpV.y < 0.55) tmpV.set(0, 1, 0);
      m.quaternion.setFromUnitVectors(UPV, tmpV);
      m.position.addScaledVector(tmpV, 0.03);
    } else m.quaternion.identity();
    m.rotateY(o.rot ?? rand() * Math.PI * 2);
    m.scale.setScalar(0.001);
    m.renderOrder = 2 + (this.decalSeq % 4) * 0.01;
    m.visible = true;
    return d;
  }
  _updateDecals(dt) {
    for (const d of this.decals) {
      if (!d.busy) continue;
      d.t += dt;
      if (d.t < 0) continue;
      const m = d.m, u = m.material.uniforms, t = d.t;
      const pop = Math.min(1, t / 0.14);
      const s = d.r * (0.55 + 0.45 * (1 - Math.pow(1 - pop, 3)));
      m.scale.set(s, 1, s);
      const out = clamp((d.dur - t) / (d.dur * 0.35), 0, 1);
      u.uBaseA.value = d.baseA * Math.min(1, t / 0.08) * out;
      u.uGlowA.value = d.glowA * Math.min(1, t / 0.05) * Math.exp(-t / Math.max(0.05, d.glowDur)) * out;
      if (d.spin) m.rotateY(dt * d.spin * Math.exp(-t * 0.8));
      if (t >= d.dur) { d.busy = false; m.visible = false; }
    }
  }
  // kept for existing callers: dark charred decal
  scorch(pos, radius = 2.5, color = 0x000000, dur = 6) {
    return this.decal(pos, 'scorch', radius, { dur: Math.max(dur, 4), glowA: 0.6 });
  }

  // ---------------- shock shells & pillars ----------------
  shock(pos, color, radius = 4, dur = 0.4, o = {}) {
    const s = this.shells.find((x) => !x.busy);
    if (!s) return;
    s.busy = true;
    const m = s.m, u = m.material.uniforms;
    m.visible = true; m.position.copy(pos);
    u.uColor.value.copy(color instanceof THREE.Color ? color : tmpC.set(color));
    u.uPow.value = o.pow ?? 3.2;
    const flat = o.flat ?? 1;
    let t = 0;
    this.fx.push({
      update: (dt) => {
        t += dt; const k = clamp(t / dur, 0, 1);
        const e = 1 - Math.pow(1 - k, 3);
        const r = (o.r0 ?? 0.3) + (radius - (o.r0 ?? 0.3)) * e;
        m.scale.set(r, r * flat, r);
        u.uAlpha.value = (o.alpha ?? 0.5) * 0.7 * (1 - k) * (1 - k);
        if (k >= 1) { m.visible = false; s.busy = false; return false; }
        return true;
      },
    });
  }
  pillar(pos, color, radius = 1.5, height = 12, dur = 0.8, o = {}) {
    const s = this.pillars.find((x) => !x.busy);
    if (!s) return;
    s.busy = true;
    const m = s.m, u = m.material.uniforms;
    const pc = color instanceof THREE.Color ? color : tmpC.set(color);
    m.visible = true; m.position.copy(pos);
    // pillars are large additive surfaces: keep them well below full HDR so they never white out the frame
    const gi = o.i ?? 0.3;
    u.uColor.value.copy(pc).multiplyScalar(gi); u.uCore.value.copy(o.core || pc).multiplyScalar(gi * 1.3);
    let t = 0;
    const inT = o.in ?? 0.08;
    this.fx.push({
      update: (dt) => {
        t += dt; const k = clamp(t / dur, 0, 1);
        const a = Math.min(1, t / inT) * (1 - k) * (1 - k);
        const w = radius * (o.shrink === false ? 1 : 1 - 0.6 * k) * (o.grow ? 0.4 + 0.6 * Math.min(1, t / 0.2) : 1);
        m.scale.set(w, height * (o.rise ? Math.min(1, t / 0.15) : 1), w);
        u.uAlpha.value = a * (o.alpha ?? 1);
        if (o.follow) m.position.copy(o.follow.position || o.follow);
        if (k >= 1) { m.visible = false; s.busy = false; return false; }
        return true;
      },
    });
  }

  // generic timed callback effect
  timer(dur, fn, end) {
    let t = 0;
    this.fx.push({ update: (dt) => { t += dt; fn && fn(dt, t / dur, t); if (t >= dur) { end && end(); return false; } return true; } });
  }
  // rate-based emitter (framerate independent): fn(dt, k) called `rate` times per second
  emitter(dur, rate, fn, end) {
    let t = 0, acc = 0;
    this.fx.push({ update: (dt) => {
      t += dt; acc += dt * rate;
      const k = clamp(t / dur, 0, 1);
      let n = 0;
      while (acc >= 1 && n < 12) { acc -= 1; n++; fn(k); }
      if (t >= dur) { end && end(); return false; }
      return true;
    } });
  }

  // ============================================================
  // Element recipes
  // ============================================================
  groundInfo(pos, out = {}) {
    const W = G.world;
    if (!W) { out.y = pos.y; out.near = true; out.water = false; return out; }
    const th = W.h(pos.x, pos.z);
    out.y = W.ground(pos.x, pos.z, pos.y + 1.5);
    out.near = pos.y - out.y < 1.6;
    out.water = th < -0.2 && out.y <= th + 0.05;
    return out;
  }

  // staff-tip anticipation + muzzle flash. kind: bolt | heavy | weave | ult
  cast(el, origin, dir, kind = 'bolt') {
    const p = pal(el);
    const big = kind !== 'bolt';
    this.burst(origin, 'glow', 1, { el, size: big ? 2.6 : 1.25, size1: big ? 3.6 : 1.6, life: big ? 0.16 : 0.09, alpha: 0.85 });
    this.circle(origin, p.glow, big ? 0.62 : 0.4, big ? 0.24 : 0.15, { vertical: true, dir, spin: big ? 7 : 10, intensity: big ? 1.1 : 1.3, grow: true, alt: el !== 'arcane' });
    if (big) {
      this.burst(origin, 'implode', 18, { el, r: 1.6 });
      this.ring(origin, p.core, 1.4, 0.22, { up: dir, thick: 0.22, y: 0, alpha: 0.7 });
      this.flash(origin, p.light, 22, 9, 0.22);
    }
    const n = big ? 2 : 1;
    switch (el) {
      case 'fire':
        for (let i = 0; i < 6 * n; i++) { coneDir(tmpV, dir, 0.45); const s = randRange(3, 7) * n; this.add.emit({ p: [origin.x, origin.y, origin.z], v: [tmpV.x * s, tmpV.y * s + 0.6, tmpV.z * s], life: randRange(0.18, 0.32), size: randRange(0.35, 0.7) * n, size1: 0.1, color: PAL.fire.core, color1: PAL.fire.deep, alpha: 0.85, alpha1: 0, drag: 4, grav: -3, shape: 0 }); }
        this.sparks(origin, dir, 4 * n, { el: 'fire', spread: 0.5, speed: 10, grav: 4, life: 0.3 });
        break;
      case 'frost':
        this.burst(origin, 'ice', 4 * n, { speed: 3, size: 0.6 });
        this.sparks(origin, dir, 5 * n, { el: 'frost', spread: 0.7, speed: 9, grav: 6, life: 0.25, w: 0.035 });
        if (big) this.burst(origin, 'frostmist', 3, { size: 0.6, spread: 0.3 });
        break;
      case 'storm':
        this.arcs(origin, big ? 3 : 1, big ? 1.1 : 0.55, { width: 0.03 });
        this.burst(origin, 'electric', 4 * n, { speed: 4 });
        break;
      case 'wind':
        this.swirl(origin, 6 * n, { el: 'wind', r: 0.5 * n, h: 0.2, speed: 8, life: 0.6, out: 0.8 });
        break;
      case 'water':
        for (let i = 0; i < 6 * n; i++) { coneDir(tmpV, dir, 0.6); const s = randRange(3, 6); this.add.emit({ p: [origin.x, origin.y, origin.z], v: [tmpV.x * s, tmpV.y * s + 1.5, tmpV.z * s], life: randRange(0.3, 0.5), size: randRange(0.1, 0.2), size1: 0.04, color: PAL.water.core, color1: PAL.water.glow, alpha: 0.95, alpha1: 0, drag: 1.2, grav: 14, shape: 2 }); }
        if (big) this.ring(origin, PAL.water.core, 1.2, 0.3, { up: dir, thick: 0.3, y: 0 });
        break;
      case 'arcane':
        this.burst(origin, 'star', 1, { el: 'arcane', size: big ? 2.4 : 1.1, life: 0.1 });
        this.sparks(origin, dir, 3 * n, { el: 'arcane', spread: 0.6, speed: 8, grav: 0, life: 0.25 });
        break;
    }
  }

  // projectile / small-spell impact. o: dir (travel), ground, target, scale
  impact(el, pos, o = {}) {
    const p = pal(el), s = o.scale ?? 1;
    const gi = this.groundInfo(pos);
    const ground = o.ground ?? (gi.near && !o.target);
    const dir = o.dir;
    // spray direction: bounce off the ground, spray through a target, or back toward the caster
    const spray = tmpV3.set(0, 1, 0);
    if (dir) {
      if (ground) spray.copy(dir).reflect(UPV).add(tmpV4.set(0, 0.6, 0)).normalize();
      else if (o.target) spray.copy(dir).add(tmpV4.set(0, 0.35, 0)).normalize();
      else spray.copy(dir).negate();
    }
    const sprayDir = spray.clone();
    this.burst(pos, 'glow', 1, { el, size: 1.7 * s, size1: 2.4 * s, life: 0.1, alpha: 0.8 });
    this.burst(pos, 'star', 1, { el, size: 2.1 * s, life: 0.09 });
    this.flash(pos, p.light, 16 * s, 7 * s, 0.16);
    const up = dir ? tmpV4.copy(dir).negate() : UPV;
    if (!ground) this.ring(pos, p.glow, 1.3 * s, 0.22, { y: 0, thick: 0.32, up: up.clone() });
    const gp = tmpV2.set(pos.x, gi.y, pos.z).clone();
    switch (el) {
      case 'arcane':
        this.burst(pos, 'arcane', 10 * s, { speed: 5 });
        this.sparks(pos, sprayDir, 8 * s, { el, spread: 0.8, speed: 12, grav: 2, life: 0.3 });
        if (ground) this.decal(gp, 'rune', 0.9 * s, { dur: 1.6, glowDur: 0.8 });
        break;
      case 'fire':
        this.burst(pos, 'fire', 12 * s, { speed: 4 });
        this.burst(pos, 'smoke', 3 * s, { size: 0.6 });
        this.sparks(pos, sprayDir, 12 * s, { el, spread: 0.9, speed: 13, grav: 10, life: 0.5, w: 0.04 });
        if (ground) { this.decal(gp, 'scorch', 1.1 * s, { dur: 7, glowDur: 1.6 }); this.linger(gp, 'fire', 0.7 * s, 1.6); }
        break;
      case 'wind':
        this.burst(pos, 'wind', 12 * s, { radius: 0.6 });
        this.swirl(pos, 8 * s, { el, r: 0.8 * s, h: 0.4, speed: 10, life: 0.8, out: 0.6 });
        if (ground) { this.decal(gp, 'swirl', 1.6 * s, { dur: 1.8 }); this.burst(gp, 'dust', 5, { speed: 5, size: 0.6 }); }
        break;
      case 'frost':
        this.burst(pos, 'ice', 7 * s, { speed: 5 });
        this.burst(pos, 'frostmist', 2, { size: 0.5 });
        this.sparks(pos, sprayDir, 8 * s, { el, spread: 0.9, speed: 10, grav: 14, life: 0.4, w: 0.035 });
        if (ground) { this.decal(gp, 'frost', 1.0 * s, { dur: 6 }); if (rand() < 0.5) this.crystal(gp, randRange(0.5, 0.9) * s, { life: 0.8, quiet: true }); }
        break;
      case 'water':
        this.burst(pos, 'water', 12 * s, { speed: 5 });
        this.burst(pos, 'splash', 3, { size: 0.7 });
        this.crown(pos, 10 * s, { speed: 6 * s });
        if (ground) { this.decal(gp, 'wet', 1.3 * s, { dur: 6 }); this.ring(gp, PAL.water.core, 1.6 * s, 0.35, { thick: 0.2 }); }
        break;
      case 'storm':
        this.burst(pos, 'electric', 10 * s, { speed: 6 });
        this.sparks(pos, sprayDir, 10 * s, { el, spread: 1.0, speed: 16, grav: 8, life: 0.3, w: 0.035 });
        this.arcs(pos, 2, 0.9 * s);
        if (ground) { this.decal(gp, 'char', 1.1 * s, { dur: 5 }); this.linger(gp, 'storm', 0.8 * s, 1.2); }
        break;
    }
  }

  // enemy hit feedback: directional spark spray + element tint
  hit(pos, dir, el, o = {}) {
    const p = pal(el);
    const heavy = !!o.heavy, crit = !!o.crit;
    const d = dir ? tmpV3.copy(dir).setY(dir.y + 0.25).normalize().clone() : null;
    this.sparks(pos, d, heavy ? 12 : 6, { el, spread: heavy ? 0.75 : 0.55, speed: heavy ? 16 : 12, grav: 10, life: heavy ? 0.4 : 0.28, w: heavy ? 0.055 : 0.04 });
    if (d && heavy) this.sparks(pos, tmpV4.copy(d).negate(), 4, { el, spread: 0.9, speed: 8, grav: 10, life: 0.25 });
    this.burst(pos, 'star', 1, { el, size: heavy ? 3.2 : 1.9, life: 0.1 });
    if (crit) {
      this.burst(pos, 'star', 1, { el: 'gold', size: 4.2, life: 0.14 });
      this.ring(pos, PAL.gold.core, 1.6, 0.22, { y: 0, thick: 0.35, up: tmpV4.subVectors(G.camera.position, pos).normalize().clone() });
      this.sparks(pos, null, 8, { pal: PAL.gold, speed: 11, grav: 6, life: 0.35 });
    }
    if (heavy) this.burst(pos, 'glow', 1, { el, size: 1.8, size1: 2.6, life: 0.08, alpha: 0.6 });
  }

  // killing blow flourish (the enemy's own death burst plays on top)
  kill(pos, el) {
    const p = pal(el);
    this.shock(pos, p.glow, 2.2, 0.28, { alpha: 0.55 });
    this.sparks(pos, null, 14, { el, speed: 13, grav: 5, life: 0.45 });
    this.sparks(pos, UPV, 8, { pal: PAL.gold, spread: 0.5, speed: 9, grav: -1, life: 0.6, w: 0.03 });
  }

  // splash crown of droplets
  crown(pos, n = 12, o = {}) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rv(0.3), sp = (o.speed ?? 6) * randRange(0.6, 1.1);
      this.streaks.emit({ p: [pos.x, pos.y, pos.z], v: [Math.cos(a) * sp * 0.6, sp * randRange(0.8, 1.3), Math.sin(a) * sp * 0.6], life: randRange(0.4, 0.65), w: 0.035, stretch: 0.025, minL: 0.05, maxL: 0.6,
        color: PAL.water.core, color1: PAL.water.glow, alpha: 0.9, alpha1: 0.2, grav: 20, drag: 0.6 });
    }
  }

  // aftermath: lingering embers, frost mist, residue arcs, drips, dust, rune motes
  linger(pos, el, r = 1, dur = 2, o = {}) {
    const P0 = pos.clone();
    const rate = (o.rate ?? 10) * Math.max(0.6, r);
    this.emitter(dur, rate, (k) => {
      const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * r;
      const x = P0.x + Math.cos(a) * rr, z = P0.z + Math.sin(a) * rr, y = P0.y + 0.08;
      const fade = 1 - k;
      switch (el) {
        case 'fire':
          if (rand() < 0.55) this.add.emit({ p: [x, y, z], v: [rv(0.4), randRange(1.2, 3), rv(0.4)], life: randRange(0.6, 1.3), size: randRange(0.05, 0.1), size1: 0.02, color: PAL.fire.core, color1: PAL.fire.glow, alpha: fade, alpha1: 0, drag: 1, grav: -0.5, shape: 1, turb: 3 });
          else if (rand() < 0.6 * fade) this.add.emit({ p: [x, y, z], v: [rv(0.2), randRange(0.8, 1.6), rv(0.2)], life: randRange(0.3, 0.55), size: randRange(0.3, 0.6) * fade, size1: 0.08, color: PAL.fire.core, color1: PAL.fire.deep, alpha: 0.7, alpha1: 0, drag: 2, grav: -2, shape: 0 });
          else this.norm.emit({ p: [x, y + 0.2, z], v: [rv(0.3), randRange(0.6, 1.2), rv(0.3)], life: randRange(1, 1.8), size: 0.3, size1: 1.2, color: C(0.14, 0.12, 0.12), color1: C(0.3, 0.29, 0.3), alpha: 0.25 * fade, alpha1: 0, drag: 1, grav: -0.2, shape: 3, fadeIn: 0.2 });
          break;
        case 'frost':
          if (rand() < 0.5) this.norm.emit({ p: [x, y + 0.1, z], v: [rv(0.6), randRange(0.05, 0.3), rv(0.6)], life: randRange(1, 1.8), size: 0.5, size1: randRange(1.4, 2.2), color: C(0.85, 0.93, 1), color1: C(0.75, 0.88, 1), alpha: 0.22 * fade, alpha1: 0, drag: 1.2, shape: 3, fadeIn: 0.25 });
          else this.add.emit({ p: [x, y + randRange(0.05, 0.6), z], v: [0, randRange(0.05, 0.3), 0], life: randRange(0.3, 0.7), size: randRange(0.12, 0.24), size1: 0.02, color: PAL.frost.core, color1: PAL.frost.glow, alpha: fade, alpha1: 0, shape: 4 });
          break;
        case 'storm':
          if (rand() < 0.35) this.arcs(tmpV.set(x, y + 0.1, z), 1, 0.6 * Math.max(0.5, r * 0.5), { width: 0.03, up: 0.3 });
          else this.add.emit({ p: [x, y + 0.05, z], v: [rv(1.5), randRange(0.5, 2), rv(1.5)], life: randRange(0.1, 0.25), size: randRange(0.1, 0.22), size1: 0.03, color: PAL.storm.core, color1: PAL.storm.glow, alpha: fade, alpha1: 0, drag: 5, shape: 4 });
          break;
        case 'water':
          if (rand() < 0.5) this.add.emit({ p: [x, y + randRange(0.4, 1.6), z], v: [0, -1, 0], life: 0.4, size: 0.08, size1: 0.05, color: PAL.water.core, color1: PAL.water.glow, alpha: 0.9 * fade, alpha1: 0.4, grav: 14, shape: 2 });
          else this.norm.emit({ p: [x, y + 0.05, z], v: [rv(0.2), randRange(0.3, 0.8), rv(0.2)], life: randRange(0.8, 1.4), size: 0.3, size1: 1.1, color: C(0.9, 0.95, 1), color1: C(0.85, 0.9, 0.95), alpha: 0.18 * fade, alpha1: 0, drag: 1, shape: 3, fadeIn: 0.2 });
          break;
        case 'wind':
          this.streaks.emit({ p: [x, y + 0.15, z], v: [-Math.sin(a) * 5, randRange(0.2, 1), Math.cos(a) * 5], life: 0.4, w: 0.04, stretch: 0.06, minL: 0.2, maxL: 1.4, color: PAL.wind.core, color1: PAL.wind.glow, alpha: 0.6 * fade, alpha1: 0, drag: 1 });
          if (rand() < 0.3) this.norm.emit({ p: [x, y + 0.1, z], v: [-Math.sin(a) * 2, 0.3, Math.cos(a) * 2], life: 0.9, size: 0.4, size1: 1.4, color: C(0.62, 0.56, 0.44), color1: C(0.7, 0.65, 0.53), alpha: 0.3 * fade, alpha1: 0, drag: 1.5, shape: 3 });
          break;
        case 'arcane':
          this.add.emit({ p: [x, y + randRange(0, 0.4), z], v: [rv(0.2), randRange(0.6, 1.6), rv(0.2)], life: randRange(0.7, 1.3), size: randRange(0.1, 0.22), size1: 0.02, color: PAL.arcane.core, color1: PAL.arcane.glow, alpha: fade, alpha1: 0, drag: 0.6, shape: rand() < 0.4 ? 4 : 0, turb: 1.5 });
          break;
      }
    });
  }

  // area explosion (fireball, spell bursts). r = damage radius
  explode(el, pos, r = 4, o = {}) {
    const p = pal(el);
    const gi = this.groundInfo(pos);
    const near = pos.y - gi.y < 2.5;
    const g = new THREE.Vector3(pos.x, gi.y, pos.z);
    const k = clamp(r / 4.5, 0.5, 2);
    this.burst(pos, 'glow', 1, { el, size: Math.min(5, r * 1.1), size1: Math.min(7.5, r * 1.7), life: 0.2, alpha: 0.5 });
    this.burst(pos, 'star', 1, { el, size: r * 1.5, life: 0.14 });
    this.shock(pos, p.core, r * 1.2, 0.35, { alpha: 0.55, flat: near ? 0.7 : 1, pow: 3.5 });
    this.flash(pos, p.light, 60 * k, r * 5, 0.5);
    this.sparks(pos, null, 26 * k, { el, speed: 18, grav: 10, life: 0.55, w: 0.06, up: 0.6 });
    if (near) {
      this.ring(g, p.glow, r * 1.35, 0.5, { thick: 0.22 });
      this.ring(g, p.core, r * 0.9, 0.3, { thick: 0.4, alpha: 0.7 });
      this.burst(g, 'dust', 12 * k, { speed: 9 });
      this.burst(g, 'debris', 10 * k, { speed: 8 });
      if (G.world) G.world.grass.gust(g.x, g.z, r * 1.6, 2);
    }
    switch (el) {
      case 'fire':
        this.burst(pos, 'fire', 24 * k, { speed: 8, spread: 0.8, size: 1.4, alpha: 0.6 });
        this.burst(pos, 'ember', 26 * k, { speed: 10 });
        this.burst(pos, 'smoke', 12 * k, { spread: 1.4, size: 1.7 });
        this.burst(pos.clone().setY(pos.y + 0.5), 'fireball', 7 * k, { r: r * 0.4 });
        if (near) { this.decal(g, 'scorch', r * 0.95); this.linger(g, 'fire', r * 0.6, 3.5, { rate: 14 }); }
        break;
      case 'water':
        this.burst(pos, 'splash', 16 * k, { speed: 8, size: 1.3 });
        this.burst(pos, 'water', 26 * k, { speed: 11 });
        this.crown(g.clone().setY(g.y + 0.2), 24 * k, { speed: 10 * k });
        if (near) { this.decal(g, 'wet', r * 1.1); this.linger(g, 'water', r * 0.5, 2.5); }
        break;
      case 'arcane':
        this.burst(pos, 'arcane', 30 * k, { speed: 8, spread: 0.6 });
        if (near) { this.decal(g, 'rune', r * 0.8, { dur: 2.6 }); this.linger(g, 'arcane', r * 0.5, 1.6); }
        break;
      case 'frost':
        this.burst(pos, 'ice', 28 * k, { speed: 10 });
        this.burst(pos, 'frostmist', 10, { spread: r * 0.4, size: 1.4 });
        if (near) { this.decal(g, 'frost', r); this.linger(g, 'frost', r * 0.6, 3); }
        break;
      case 'storm':
        this.burst(pos, 'electric', 30 * k, { speed: 10 });
        this.arcs(pos, 4, r * 0.5);
        if (near) { this.decal(g, 'char', r * 0.9); this.linger(g, 'storm', r * 0.5, 2); }
        break;
      case 'wind':
        this.burst(pos, 'wind', 24, { radius: r * 0.4 });
        this.swirl(pos, 20, { el, r: r * 0.5, speed: 14 });
        if (near) this.decal(g, 'swirl', r * 1.2);
        break;
    }
  }

  // sky bolt landing. o.big
  strike(tp, r = 3, o = {}) {
    const big = !!o.big;
    this.pillar(tp, PAL.storm.glow, big ? 1.1 : 0.7, big ? 30 : 20, big ? 0.35 : 0.25, { core: PAL.storm.core, alpha: 0.8, i: 0.4 });
    this.shock(tp.clone().setY(tp.y + 0.6), PAL.storm.core, r * 1.2, 0.35, { alpha: 0.6, flat: 0.5 });
    this.ring(tp, PAL.storm.core, r + 1, 0.4, { thick: 0.3 });
    this.ring(tp, PAL.storm.glow, r * 0.6, 0.25, { thick: 0.5, alpha: 0.7 });
    this.radial(tp, big ? 26 : 14, { el: 'storm', speed: big ? 20 : 14, up: 0.5, life: 0.35, w: 0.05 });
    this.sparks(tp.clone().setY(tp.y + 0.3), UPV, big ? 18 : 10, { el: 'storm', spread: 0.8, speed: 16, grav: 16, life: 0.5 });
    this.burst(tp, 'electric', big ? 30 : 16, { speed: 12 }); this.burst(tp, 'dust', big ? 14 : 6, { speed: 7 });
    this.burst(tp, 'debris', big ? 12 : 5, { speed: 9 });
    if (big) this.burst(tp.clone().setY(tp.y + 1), 'star', 1, { el: 'storm', size: 7 });
    this.flash(tp.clone().setY(tp.y + 3), 0xfff0a0, (big ? 80 : 50) * (o.dim ? 0.5 : 1), big ? 30 : 18, o.dim ? 0.25 : 0.4);
    this.decal(tp, 'char', r * (big ? 1.1 : 0.9), { dur: big ? 9 : 6 });
    if (big) this.decal(tp, 'crack', r * 0.8, { glow: PAL.storm.glow.clone().multiplyScalar(0.8), dur: 8 });
    this.linger(tp, 'storm', r * 0.6, big ? 2.4 : 1.4, { rate: 8 });
  }

  // ------------------------------------------------------------
  // Reaction signatures. c = target center, o.r = radius, o.ground
  // ------------------------------------------------------------
  react(kind, c, o = {}) {
    const r = o.r ?? 3;
    const gi = this.groundInfo(c);
    const g = new THREE.Vector3(c.x, gi.y, c.z);
    const near = c.y - gi.y < 3;
    const camUp = tmpV4.subVectors(G.camera.position, c).normalize().clone();
    switch (kind) {
      case 'melt':
        this.burst(c, 'steam', 12, { size: 0.9 }); this.burst(c, 'ice', 10, { speed: 5 }); this.burst(c, 'fire', 16, { speed: 5 });
        this.shock(c, C(3.0, 1.4, 0.5), 2.6, 0.3, { alpha: 0.39 });
        this.sparks(c, null, 10, { pal: PAL.frost, speed: 10, grav: 14, life: 0.4 });
        this.sparks(c, UPV, 10, { pal: PAL.fire, spread: 0.7, speed: 9, grav: -2, life: 0.4 });
        this.flash(c, 0xffb070, 32, 12, 0.3);
        if (near) { this.decal(g, 'wet', 1.8); this.linger(g, 'water', 0.8, 1.6); }
        break;
      case 'evaporate':
        this.burst(c, 'steam', 16, { size: 1.0, spread: 0.6 });
        this.burst(c, 'steamjet', 14, { speed: 9 });
        this.ring(c, PAL.white.core, 2.6, 0.3, { y: -0.6, thick: 0.25, alpha: 0.6 });
        this.burst(c, 'glow', 1, { el: 'white', size: 3, size1: 4, life: 0.12, alpha: 0.4 });
        break;
      case 'thermal':
        this.shock(c, C(2.2, 1.6, 2.8), r + 0.5, 0.4, { alpha: 0.5 });
        this.ring(c, PAL.frost.glow, r + 0.5, 0.4, { y: -0.8 }); this.ring(c, PAL.fire.glow, r * 0.7, 0.3, { y: -0.6, thick: 0.35 });
        this.burst(c, 'steam', 16, { spread: 0.8 });
        this.radial(c, 18, { pal: PAL.frost, speed: 16, up: 0.4, y: 0, life: 0.35 });
        this.radial(c, 12, { pal: PAL.fire, speed: 12, up: 0.5, y: 0, life: 0.35 });
        this.flash(c, 0xbfe8ff, 32, 12, 0.3);
        if (near) this.decal(g, 'crack', r * 0.7, { glow: C(2.2, 1.2, 2.6), dur: 6 });
        break;
      case 'flashfreeze': {
        this.burst(c, 'ice', 16, { speed: 5 }); this.burst(c, 'frostmist', 8, { size: 1 });
        this.shock(c, PAL.frost.core, 2.4, 0.25, { alpha: 0.45, pow: 3 });
        this.sparks(c, null, 14, { el: 'frost', speed: 7, grav: 0, drag: 5, life: 0.4, w: 0.03 });
        this.flash(c, 0x8fe3ff, 26, 10, 0.25);
        if (near) {
          this.decal(g, 'frost', 2.4, { dur: 7 });
          for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + rand(); this.crystal(tmpV.set(g.x + Math.cos(a) * 0.9, g.y, g.z + Math.sin(a) * 0.9).clone(), randRange(0.6, 1.1), { life: 1.0, quiet: true, tiltX: Math.sin(a) * 0.6, tiltZ: -Math.cos(a) * 0.6 }); }
        }
        break;
      }
      case 'shatter':
        this.burst(c, 'ice', 30, { speed: 11, size: 1.3 }); this.burst(c, 'frostmist', 10); this.burst(c, 'shard', 16, { speed: 9 });
        this.burst(c, 'star', 1, { size: 5, el: 'frost' });
        this.shock(c, PAL.frost.core, r + 0.6, 0.3, { alpha: 0.5, pow: 3 });
        this.ring(c, PAL.frost.core, r + 0.8, 0.45, { y: -0.8, thick: 0.25 });
        this.sparks(c, null, 36, { pal: PAL.frost, speed: 22, grav: 12, life: 0.55, w: 0.06, stretch: 0.025 });
        this.flash(c, 0xd8f6ff, 58, 16, 0.35);
        if (near) { this.decal(g, 'frost', r * 0.8); this.linger(g, 'frost', r * 0.5, 2); }
        break;
      case 'conduct':
        this.burst(c, 'electric', 18); this.burst(c, 'water', 10, { speed: 4 });
        this.shock(c, PAL.storm.core, 2.4, 0.25, { alpha: 0.39 });
        this.arcs(c, 4, 1.4);
        this.flash(c, 0xffe86a, 39, 14, 0.3);
        if (near) { this.ring(g, PAL.storm.glow, 3.2, 0.35, { thick: 0.25, noise: 1 }); this.decal(g, 'wet', 1.6); this.linger(g, 'storm', 1.2, 1.5); }
        break;
      case 'overload':
        this.explode('fire', c, r, {});
        this.burst(c, 'electric', 20); this.arcs(c, 5, r * 0.5);
        this.shock(c, PAL.storm.core, r * 0.8, 0.25, { alpha: 0.33 });
        if (near) this.decal(g, 'char', r * 0.7);
        break;
      case 'firestorm':
        this.burst(c, 'fire', 18, { speed: 6 }); this.burst(c, 'wind', 14, { radius: 1.5 });
        this.swirl(c, 22, { pal: PAL.fire, r: 1.2, speed: 16, out: 1.4, life: 0.8, h: 1.2 });
        this.ring(g, PAL.fire.glow, r, 0.5, { thick: 0.18, noise: 1 });
        if (near) this.decal(g, 'swirl', r * 0.8, { glow: PAL.fire.glow.clone().multiplyScalar(0.8), dur: 2 });
        break;
      case 'blizzard':
        this.burst(c, 'frostmist', 14, { size: 1.2 }); this.burst(c, 'ice', 12);
        this.swirl(c, 26, { pal: PAL.frost, r: 1.4, speed: 14, out: 1.3, life: 0.9, h: 1.5, w: 0.035 });
        this.burst(c, 'snowflake', 24, { spread: 1.5 });
        this.ring(g, PAL.frost.core, r, 0.5, { thick: 0.15, noise: 1 });
        if (near) this.decal(g, 'frost', r * 0.6);
        break;
      case 'stormspread':
        this.swirl(c, 18, { pal: PAL.storm, r: 1, speed: 15, out: 1.5, life: 0.6, h: 1 });
        this.ring(g, PAL.storm.core, r, 0.4, { thick: 0.15, noise: 1 });
        this.burst(c, 'electric', 14, { speed: 8 });
        break;
      case 'extinguish':
        this.burst(c, 'steam', 14, { size: 1 }); this.burst(c, 'smoke', 6, { size: 0.9 });
        this.ring(c, C(0.5, 0.52, 0.55), 1.8, 0.4, { y: -0.4, thick: 0.3, alpha: 0.5 });
        this.sparks(c, UPV, 6, { pal: { core: C(1.2, 0.6, 0.3), glow: C(0.4, 0.2, 0.1) }, spread: 0.8, speed: 4, grav: 4, life: 0.5, w: 0.03 });
        break;
      case 'scald':
        this.burst(c, 'steam', 24, { size: 1.4, spread: 1.4 }); this.burst(c, 'water', 14, { speed: 7 }); this.burst(c, 'fire', 8, { speed: 5 });
        this.burst(c, 'steamjet', 18, { speed: 11 });
        this.shock(c, C(2.6, 2.4, 2.2), r + 0.5, 0.35, { alpha: 0.39 });
        this.ring(c, PAL.white.core, r + 1.5, 0.45, { y: -0.8, thick: 0.25 }); this.flash(c, 0xfff0e0, 39, 14, 0.3);
        this.crown(c, 16, { speed: 8 });
        if (near) this.decal(g, 'wet', r * 0.8);
        break;
      case 'shortcircuit':
        this.burst(c, 'electric', 18, { speed: 6 }); this.burst(c, 'water', 10);
        this.arcs(c, 4, 1.6, { color: C(2.0, 2.8, 3.4), glow: C(0.4, 1.0, 2.6) });
        this.sparks(c, null, 18, { pal: { core: C(2.6, 3.0, 3.4), glow: C(0.5, 1.2, 3.0) }, speed: 14, grav: 12, life: 0.35, w: 0.035 });
        this.flash(c, 0xb8e4ff, 26, 10, 0.2);
        break;
      case 'superconduct':
        this.burst(c, 'ice', 14, { speed: 6 }); this.burst(c, 'electric', 16, { speed: 6 });
        this.shock(c, C(2.2, 2.4, 3.2), 3.2, 0.3, { alpha: 0.45, pow: 3 });
        this.ring(c, PAL.frost.core, 3.5, 0.35, { y: -0.8, thick: 0.25 }); this.ring(c, PAL.storm.core, 2.4, 0.25, { y: -0.8, thick: 0.35 });
        this.sparks(c, null, 16, { pal: { core: C(2.6, 2.8, 3.4), glow: C(1.2, 1.0, 2.6) }, speed: 16, grav: 6, life: 0.35 });
        this.flash(c, 0xd9f0ff, 39, 12, 0.3);
        break;
      case 'monsoon':
        this.burst(c, 'water', 26, { speed: 9 }); this.burst(c, 'splash', 10, { speed: 6 });
        this.swirl(c, 16, { el: 'wind', r: 1.2, speed: 12, out: 1.6, life: 0.7 });
        this.crown(c, 22, { speed: 10 });
        this.ring(g, PAL.water.core, r, 0.5, { thick: 0.15, noise: 1 });
        if (near) this.decal(g, 'wet', r * 0.6);
        break;
      case 'resonance':
        this.burst(c, 'arcane', 10, { speed: 4 });
        this.circle(c, PAL.arcane.glow, 1.0, 0.28, { vertical: true, dir: camUp, spin: 8, intensity: 1.1, alt: true, grow: true });
        this.ring(c, PAL.arcane.core, 1.8, 0.25, { y: 0, thick: 0.3, up: camUp, alpha: 0.8 });
        this.sparks(c, null, 8, { el: 'arcane', speed: 8, grav: 0, life: 0.35 });
        break;
      case 'prism':
        this.shock(c, PAL.arcane.core, r, 0.35, { alpha: 0.45 });
        this.ring(c, PAL.arcane.core, r, 0.4, { y: -0.8, thick: 0.25 }); this.burst(c, 'star', 1, { el: 'arcane', size: r });
        for (const e of ['fire', 'frost', 'storm', 'water']) this.sparks(c, null, 6, { el: e, speed: 14, grav: 4, life: 0.4 });
        break;
      case 'airborne':
        this.ring(c, PAL.wind.core, 1.8, 0.2, { y: 0, thick: 0.3, up: camUp });
        break;
    }
  }

  // perfect dodge ("울림 가속"): time-stop ripple, clock rune, suspended motes
  dodge() {
    const P = G.player;
    if (!P) return;
    const c = P.center ? P.center() : P.pos.clone();
    const white = PAL.white, cy = C(1.4, 2.4, 3.2);
    this.shock(c, cy, 9, 0.7, { alpha: 0.45, pow: 3.5, r0: 0.6 });
    this.shock(c, white.glow, 4, 0.4, { alpha: 0.25, pow: 2.5, r0: 0.3 });
    this.ring(P.pos, cy, 8, 0.8, { thick: 0.08, alpha: 0.8 });
    this.ring(P.pos, white.core, 4.5, 0.5, { thick: 0.16, alpha: 0.6, delay: 0.08 });
    // converging streaks
    for (let i = 0; i < 26; i++) {
      sphereV(tmpV); const d = randRange(3.5, 6);
      const s = d / 0.28;
      this.streaks.emit({ p: [c.x + tmpV.x * d, c.y + tmpV.y * d * 0.6, c.z + tmpV.z * d], v: [-tmpV.x * s, -tmpV.y * s * 0.6, -tmpV.z * s], life: 0.28, w: 0.035, stretch: 0.03, minL: 0.3, maxL: 2.5, color: white.core, color1: cy, alpha: 0.9, alpha1: 0.2, drag: 0 });
    }
    // suspended motes (time "stops" around the player)
    for (let i = 0; i < 36; i++) {
      const a = rand() * Math.PI * 2, r = randRange(1, 3.6);
      this.add.emit({ p: [c.x + Math.cos(a) * r, c.y + randRange(-0.9, 2.2), c.z + Math.sin(a) * r], v: [rv(0.08), rv(0.05), rv(0.08)], life: randRange(1.8, 2.8), size: randRange(0.05, 0.12), size1: 0.02, color: white.core, color1: cy, alpha: 1, alpha1: 0, shape: rand() < 0.3 ? 4 : 0, fadeIn: 0.1 });
    }
    // aura that lasts as long as the slow motion
    if (this.dodgeAura) this.dodgeAura.end();
    this.dodgeAura = this.circle(P.pos, cy, 2.4, 0, { follow: P.root || P.pos, spin: 0.6, alpha: 0.5, intensity: 0.7, alt: true, grow: true });
    this.dodgeAura2 && this.dodgeAura2.end();
    this.dodgeAura2 = this.circle(P.pos, white.glow, 1.5, 0, { follow: P.root || P.pos, spin: -1.4, alpha: 0.35, intensity: 0.6, grow: true });
  }

  // ultimate cast: pillar of light, gathering motes, shock
  ultCast(el, feet, center) {
    const p = pal(el);
    this.pillar(feet, p.glow, 1.1, 14, 0.9, { core: p.core, alpha: 0.6, grow: true });
    this.burst(center, 'implode', 36, { el, r: 4 });
    this.shock(center, p.glow, 6, 0.5, { alpha: 0.35 });
    this.radial(feet, 22, { el, speed: 18, up: 0.2, life: 0.45 });
    this.decal(feet, 'rune', 3.2, { glow: p.glow.clone().multiplyScalar(0.7), dur: 2.4, spin: 1.2 });
    this.burst(feet, 'dust', 12, { speed: 8 });
  }

  update(dt) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      let alive = false;
      try { alive = this.fx[i].update(dt); } catch (e) { console.warn('fx', e); }
      if (!alive) this.fx.splice(i, 1);
    }
    for (const s of this.lights) {
      if (s.held) continue;
      if (s.dur > 0) {
        s.t += dt;
        const k = clamp(1 - s.t / s.dur, 0, 1);
        s.l.intensity = s.peak * k * k;
        if (k <= 0) { s.dur = 0; s.l.intensity = 0; }
      }
    }
    // perfect-dodge flourish (driven by G.slowmo so player code stays untouched)
    const slow = G.slowmo > 0;
    if (slow && !this._slowPrev && G.state === 'play') this.dodge();
    if (!slow && this._slowPrev) { if (this.dodgeAura) { this.dodgeAura.end(); this.dodgeAura = null; } if (this.dodgeAura2) { this.dodgeAura2.end(); this.dodgeAura2 = null; } }
    this._slowPrev = slow;
    if (slow && G.player && rand() < dt * 18) {
      const c = G.player.pos; const a = rand() * Math.PI * 2, r = randRange(1.2, 3);
      this.add.emit({ p: [c.x + Math.cos(a) * r, c.y + randRange(0.1, 2.4), c.z + Math.sin(a) * r], v: [-Math.sin(a) * 0.6, 0.2, Math.cos(a) * 0.6], life: 1.2, size: 0.07, size1: 0.02, color: PAL.white.core, color1: PAL.frost.glow, alpha: 0.9, alpha1: 0, shape: 0, fadeIn: 0.2 });
    }
    // decal lighting & fog follow the scene
    const fog = this.scene.fog;
    if (fog && fog.density !== undefined) this.fogU.density.value = fog.density;
    const sky = G.world && G.world.sky;
    if (sky) this.ambU.value = 1 - 0.65 * clamp(sky.night ?? 0, 0, 1);
    this._updateDecals(dt);
    const cam = G.camera ? G.camera.position : tmpV.set(0, 0, 0);
    this.streaks.update(dt, cam);
    this.ribbons.update(dt, cam);
    this.add.update(dt, G.time);
    this.norm.update(dt, G.time);
  }
}

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------
function sphereDir(out, s = 1) { const u = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - u * u); out[0] = r * Math.cos(a) * s; out[1] = u * s; out[2] = r * Math.sin(a) * s; return out; }
function sphereV(out) { const u = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - u * u); return out.set(r * Math.cos(a), u, r * Math.sin(a)); }
// random unit vector within a cone around dir (spread ~ 0..1.5 rad-ish)
const _cd = new THREE.Vector3();
function coneDir(out, dir, spread) {
  _cd.copy(dir);
  sphereV(out).multiplyScalar(spread).add(_cd);
  return out.normalize();
}
const D = [0, 0, 0];
const GREY = C(0.12, 0.11, 0.13), GREY2 = C(0.3, 0.29, 0.31);
const FIREBALL_C0 = C(2.2, 0.8, 0.15), FIREBALL_C1 = C(0.5, 0.06, 0.01);

// ------------------------------------------------------------------
// Particle presets. `this` = VFX.  (pos, opts, index, count)
// ------------------------------------------------------------------
VFX.prototype.presets = {
  fire(p, o) {
    const s = o.spread ?? 0.4, sp = o.speed ?? 2;
    sphereDir(D, sp);
    const hot = rand() < 0.3;
    this.add.emit({ p: [p.x + rv(s), p.y + rv(s), p.z + rv(s)], v: [D[0] + (o.vx || 0), Math.abs(D[1]) + 1.5 + (o.vy || 0), D[2] + (o.vz || 0)], life: randRange(0.35, 0.8) * (o.life || 1),
      size: randRange(0.5, 1.1) * (o.size || 1), size1: randRange(0.1, 0.3), color: hot ? PAL.white.core : PAL.fire.core, color1: PAL.fire.deep, alpha: o.alpha ?? 0.75, alpha1: 0, drag: 2, grav: -2.5, shape: 0 });
  },
  // rolling fireball puffs expanding from the blast center
  fireball(p, o) {
    sphereDir(D, 1);
    const r = o.r ?? 1.5;
    this.add.emit({ p: [p.x + D[0] * r * 0.3, p.y + Math.abs(D[1]) * r * 0.3, p.z + D[2] * r * 0.3], v: [D[0] * r * 2.5, Math.abs(D[1]) * r * 2 + 2, D[2] * r * 2.5], life: randRange(0.4, 0.7),
      size: r * randRange(0.9, 1.4), size1: r * 1.9, color: FIREBALL_C0, color1: FIREBALL_C1, alpha: 0.3, alpha1: 0, drag: 3, grav: -3, shape: 0 });
  },
  ember(p, o) {
    const sp = o.speed ?? 5;
    sphereDir(D, sp);
    this.add.emit({ p: [p.x, p.y, p.z], v: [D[0], Math.abs(D[1]) * 1.2 + 1, D[2]], life: randRange(0.6, 1.4),
      size: randRange(0.06, 0.14), color: PAL.fire.core, color1: PAL.fire.glow, alpha: 1, alpha1: 0, drag: 1.8, grav: 3, shape: 1, turb: 4 });
  },
  smoke(p, o) {
    const s = o.spread ?? 0.6;
    this.norm.emit({ p: [p.x + rv(s), p.y + rv(s) * 0.5, p.z + rv(s)], v: [rv(0.8), randRange(0.8, 2), rv(0.8)], life: randRange(1.2, 2.2),
      size: randRange(0.8, 1.4) * (o.size || 1), size1: randRange(2.2, 3.4) * (o.size || 1), color: o.color || GREY, color1: o.color1 || GREY2, alpha: o.alpha ?? 0.45, alpha1: 0, drag: 1.2, grav: -0.3, shape: 3, fadeIn: 0.1 });
  },
  spark(p, o) {
    const c = PAL[o.el || 'fire'] || PAL.fire;
    sphereDir(D, o.speed ?? 9);
    this.add.emit({ p: [p.x, p.y, p.z], v: [D[0], D[1] + 2, D[2]], life: randRange(0.25, 0.55), size: randRange(0.08, 0.16), size1: 0.02,
      color: c.core, color1: c.glow, alpha: 1, alpha1: 0.2, drag: 3.5, grav: 14, shape: 1 });
  },
  ice(p, o) {
    const s = o.spread ?? 0.3;
    sphereDir(D, o.speed ?? 6);
    this.add.emit({ p: [p.x + rv(s), p.y + rv(s), p.z + rv(s)], v: [D[0], Math.abs(D[1]) + 2, D[2]], life: randRange(0.5, 1),
      size: randRange(0.15, 0.35) * (o.size || 1), size1: 0.05, color: PAL.frost.core, color1: PAL.frost.glow, alpha: 1, alpha1: 0, drag: 1.5, grav: 16, shape: 2 });
  },
  // opaque pale ice chunks (read against bright snow / sky)
  shard(p, o) {
    const s = o.spread ?? 0.3;
    sphereDir(D, o.speed ?? 7);
    this.norm.emit({ p: [p.x + rv(s), p.y + rv(s), p.z + rv(s)], v: [D[0], Math.abs(D[1]) + 2.5, D[2]], life: randRange(0.5, 0.9),
      size: randRange(0.12, 0.26) * (o.size || 1), size1: 0.06, color: C(0.78, 0.92, 1.0), color1: C(0.55, 0.78, 0.95), alpha: 0.95, alpha1: 0.2, drag: 1, grav: 18, shape: 2 });
  },
  // ground debris chunks
  debris(p, o) {
    const a = rand() * Math.PI * 2, sp = (o.speed ?? 7) * randRange(0.4, 1);
    this.norm.emit({ p: [p.x + Math.cos(a) * 0.4, p.y + 0.2, p.z + Math.sin(a) * 0.4], v: [Math.cos(a) * sp * 0.6, randRange(3, 7), Math.sin(a) * sp * 0.6], life: randRange(0.6, 1.0),
      size: randRange(0.1, 0.22) * (o.size || 1), size1: 0.08, color: o.color || C(0.3, 0.26, 0.2), color1: o.color || C(0.36, 0.32, 0.26), alpha: 1, alpha1: 0.6, drag: 0.5, grav: 20, shape: 2 });
  },
  frostmist(p, o) {
    const s = o.spread ?? 0.8;
    this.norm.emit({ p: [p.x + rv(s), p.y + rv(s) * 0.4, p.z + rv(s)], v: [rv(1), randRange(0.2, 1), rv(1)], life: randRange(0.9, 1.6),
      size: randRange(0.8, 1.5) * (o.size || 1), size1: randRange(2, 3.2) * (o.size || 1), color: C(0.82, 0.93, 1.0), color1: C(0.7, 0.85, 1.0), alpha: o.alpha ?? 0.35, alpha1: 0, drag: 1.5, grav: 0.2, shape: 3, fadeIn: 0.15 });
  },
  snowflake(p, o) {
    const s = o.spread ?? 1;
    this.add.emit({ p: [p.x + rv(s), p.y + rv(s) * 0.6, p.z + rv(s)], v: [rv(3), randRange(-0.5, 1.5), rv(3)], life: randRange(0.8, 1.5),
      size: randRange(0.06, 0.12), size1: 0.03, color: C(2.2, 2.6, 3.0), color1: PAL.frost.glow, alpha: 1, alpha1: 0, drag: 1.5, grav: 1.2, shape: 0, turb: 2.5 });
  },
  electric(p, o) {
    const s = o.spread ?? 0.3;
    sphereDir(D, o.speed ?? 8);
    this.add.emit({ p: [p.x + rv(s), p.y + rv(s), p.z + rv(s)], v: [D[0], D[1], D[2]], life: randRange(0.12, 0.35),
      size: randRange(0.15, 0.35), size1: 0.05, color: PAL.storm.core, color1: PAL.storm.glow, alpha: 1, alpha1: 0, drag: 6, grav: 0, shape: 4 });
  },
  wind(p, o, i, n) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.3, r = o.radius ?? 0.8, sp = o.speed ?? 6;
    const ca = Math.cos(a), sa = Math.sin(a);
    this.add.emit({ p: [p.x + ca * r, p.y + rv(0.4), p.z + sa * r], v: [-sa * sp + ca * 2 + (o.vx || 0), randRange(0.5, 2) + (o.vy || 0), ca * sp + sa * 2 + (o.vz || 0)], life: randRange(0.4, 0.8),
      size: randRange(0.25, 0.5), size1: 0.05, color: PAL.wind.core, color1: PAL.wind.glow, alpha: 0.8, alpha1: 0, drag: 2.5, grav: 0, shape: o.shape ?? 0 });
  },
  arcane(p, o) {
    const s = o.spread ?? 0.3;
    sphereDir(D, o.speed ?? 4);
    this.add.emit({ p: [p.x + rv(s), p.y + rv(s), p.z + rv(s)], v: [D[0], D[1] + 1, D[2]], life: randRange(0.35, 0.8),
      size: randRange(0.18, 0.4), size1: 0.02, color: PAL.arcane.core, color1: PAL.arcane.glow, alpha: 1, alpha1: 0, drag: 3, grav: -0.5, shape: rand() < 0.4 ? 4 : 0 });
  },
  trail(p, o) {
    const c = PAL[o.el || 'arcane'] || PAL.arcane;
    const s = o.spread ?? 0.08;
    this.add.emit({ p: [p.x + rv(s), p.y + rv(s), p.z + rv(s)], v: [rv(0.5) + (o.vx || 0), rv(0.5) + (o.vy || 0), rv(0.5) + (o.vz || 0)], life: o.life ?? randRange(0.18, 0.35),
      size: (o.size ?? 0.35) * randRange(0.7, 1.1), size1: 0.02, color: c.core, color1: c.glow, alpha: o.alpha ?? 0.9, alpha1: 0, drag: 2, grav: o.grav ?? 0, shape: o.shape ?? 0 });
  },
  // particles converging onto a point (charge-up)
  implode(p, o) {
    const c = PAL[o.el || 'arcane'] || PAL.arcane;
    sphereDir(D, 1);
    const r = (o.r ?? 1.5) * randRange(0.6, 1), life = o.life ?? randRange(0.18, 0.3);
    this.add.emit({ p: [p.x + D[0] * r, p.y + D[1] * r, p.z + D[2] * r], v: [-D[0] * r / life, -D[1] * r / life, -D[2] * r / life], life,
      size: randRange(0.08, 0.18), size1: 0.25, color: c.glow, color1: c.core, alpha: 0.2, alpha1: 1, shape: rand() < 0.3 ? 4 : 0 });
  },
  heal(p, o) {
    const s = o.spread ?? 0.5;
    this.add.emit({ p: [p.x + rv(s), p.y + rv(0.3), p.z + rv(s)], v: [rv(0.3), randRange(1, 2.5), rv(0.3)], life: randRange(0.7, 1.3),
      size: randRange(0.15, 0.3), size1: 0.02, color: PAL.heal.core, color1: PAL.heal.glow, alpha: 1, alpha1: 0, drag: 1, shape: 4 });
  },
  ash(p, o) {
    const s = o.spread ?? 0.5;
    this.norm.emit({ p: [p.x + rv(s), p.y + rv(s), p.z + rv(s)], v: [rv(1), randRange(0.5, 2.5), rv(1)], life: randRange(1, 2),
      size: randRange(0.1, 0.25), size1: 0.05, color: C(0.15, 0.12, 0.2), color1: C(0.35, 0.3, 0.45), alpha: 0.9, alpha1: 0, drag: 1, grav: -0.4, shape: 2, turb: 3 });
  },
  hush(p, o) {
    const s = o.spread ?? 0.6;
    this.norm.emit({ p: [p.x + rv(s), p.y + rv(s) * 0.5, p.z + rv(s)], v: [rv(0.6), randRange(0.3, 1.2), rv(0.6)], life: randRange(1.2, 2.2),
      size: randRange(0.6, 1.2) * (o.size || 1), size1: randRange(1.8, 2.8) * (o.size || 1), color: C(0.2, 0.17, 0.26), color1: C(0.4, 0.36, 0.48), alpha: o.alpha ?? 0.4, alpha1: 0, drag: 1, grav: -0.2, shape: 3, fadeIn: 0.2 });
  },
  dust(p, o) {
    const a = rand() * Math.PI * 2, sp = (o.speed ?? 5) * randRange(0.6, 1);
    this.norm.emit({ p: [p.x + Math.cos(a) * 0.5, p.y + 0.2, p.z + Math.sin(a) * 0.5], v: [Math.cos(a) * sp, randRange(0.3, 1.5), Math.sin(a) * sp], life: randRange(0.6, 1.2),
      size: randRange(0.6, 1.1) * (o.size || 1), size1: randRange(1.8, 2.8) * (o.size || 1), color: o.color || C(0.62, 0.55, 0.42), color1: o.color || C(0.7, 0.64, 0.52), alpha: 0.5, alpha1: 0, drag: 3, grav: -0.2, shape: 3 });
  },
  water(p, o) {
    const s = o.spread ?? 0.3;
    sphereDir(D, o.speed ?? 5);
    this.add.emit({ p: [p.x + rv(s), p.y + rv(s), p.z + rv(s)], v: [D[0], Math.abs(D[1]) * 1.3 + 2.5, D[2]], life: randRange(0.4, 0.8),
      size: randRange(0.12, 0.28) * (o.size || 1), size1: 0.04, color: PAL.water.core, color1: PAL.water.glow, alpha: 0.95, alpha1: 0, drag: 1.2, grav: 18, shape: 2 });
  },
  splash(p, o) {
    const a = rand() * Math.PI * 2, sp = (o.speed ?? 4) * randRange(0.5, 1);
    this.norm.emit({ p: [p.x + Math.cos(a) * 0.4, p.y + 0.1, p.z + Math.sin(a) * 0.4], v: [Math.cos(a) * sp, randRange(2, 5), Math.sin(a) * sp], life: randRange(0.5, 0.9),
      size: randRange(0.3, 0.6) * (o.size || 1), size1: randRange(0.9, 1.5) * (o.size || 1), color: C(0.78, 0.9, 1.0), color1: C(0.55, 0.75, 0.95), alpha: 0.6, alpha1: 0, drag: 2, grav: 9, shape: 3 });
  },
  steam(p, o) {
    const s = o.spread ?? 1;
    this.norm.emit({ p: [p.x + rv(s), p.y + rv(s) * 0.4, p.z + rv(s)], v: [rv(2), randRange(1.5, 4), rv(2)], life: randRange(1.2, 2.2),
      size: randRange(1, 2) * (o.size || 1), size1: randRange(3.5, 5) * (o.size || 1), color: C(0.95, 0.97, 1), color1: C(0.85, 0.88, 0.92), alpha: 0.55, alpha1: 0, drag: 1.4, grav: -0.5, shape: 3, fadeIn: 0.08 });
  },
  // fast upward jet of steam (evaporate / scald / geysers)
  steamjet(p, o) {
    const sp = o.speed ?? 9;
    this.norm.emit({ p: [p.x + rv(0.3), p.y, p.z + rv(0.3)], v: [rv(1.2), sp * randRange(0.6, 1.1), rv(1.2)], life: randRange(0.5, 0.9),
      size: randRange(0.4, 0.8), size1: randRange(1.8, 2.8), color: C(0.97, 0.98, 1), color1: C(0.88, 0.9, 0.94), alpha: 0.5, alpha1: 0, drag: 3, grav: -0.5, shape: 3 });
  },
  soul(p, o) {
    const c = PAL[o.el || 'gold'] || PAL.gold;
    this.add.emit({ p: [p.x + rv(0.4), p.y + rv(0.4), p.z + rv(0.4)], v: [rv(0.5), randRange(1.2, 2.6), rv(0.5)], life: randRange(1.4, 2.6),
      size: randRange(0.15, 0.35), size1: 0.05, color: c.core, color1: c.glow, alpha: 1, alpha1: 0, drag: 0.5, grav: -0.3, shape: rand() < 0.5 ? 4 : 0, turb: 2 });
  },
  glow(p, o) {
    const c = PAL[o.el || 'gold'] || PAL.gold;
    this.add.emit({ p: [p.x, p.y, p.z], v: [0, 0, 0], life: o.life ?? 0.2, size: o.size ?? 2, size1: o.size1 ?? (o.size ?? 2) * 1.5,
      color: o.color || c.core, color1: o.color1 || c.glow, alpha: o.alpha ?? 1, alpha1: 0, shape: 0 });
  },
  star(p, o) {
    const c = PAL[o.el || 'white'] || PAL.white;
    this.add.emit({ p: [p.x, p.y, p.z], v: [0, 0, 0], life: o.life ?? 0.25, size: o.size ?? 2.5, size1: o.size1 ?? 0.5,
      color: c.core, color1: c.glow, alpha: 1, alpha1: 0, shape: 4 });
  },
  firefly(p, o) {
    this.add.emit({ p: [p.x + rv(o.spread ?? 10), p.y + randRange(0.5, 3), p.z + rv(o.spread ?? 10)], v: [rv(0.3), rv(0.2), rv(0.3)], life: randRange(3, 6),
      size: randRange(0.08, 0.14), color: C(2.2, 2.6, 0.8), color1: C(1.2, 1.6, 0.3), alpha: 1, alpha1: 0, drag: 0, grav: 0, shape: 0, turb: 1.2, fadeIn: 0.4 });
  },
  pollen(p, o) {
    this.add.emit({ p: [p.x + rv(o.spread ?? 14), p.y + randRange(0.3, 4), p.z + rv(o.spread ?? 14)], v: [randRange(0.2, 0.8), rv(0.15), randRange(0, 0.4)], life: randRange(3, 6),
      size: randRange(0.04, 0.08), color: C(1.4, 1.35, 1.0), color1: C(1.0, 1.0, 0.8), alpha: 0.9, alpha1: 0, drag: 0, shape: 0, turb: 0.6, fadeIn: 0.3 });
  },
  snow(p, o) {
    this.norm.emit({ p: [p.x + rv(o.spread ?? 16), p.y + randRange(4, 12), p.z + rv(o.spread ?? 16)], v: [randRange(0.5, 1.5), randRange(-1.6, -0.8), rv(0.4)], life: randRange(4, 7),
      size: randRange(0.06, 0.14), color: C(1, 1, 1), color1: C(1, 1, 1), alpha: 0.95, alpha1: 0.5, drag: 0, shape: 0, turb: 0.8, fadeIn: 0.1 });
  },
};
