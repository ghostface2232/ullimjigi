// Stylized crystals, gems and ice.
//
// crystalMaterial(opts): faceted "magic crystal" shader. Facets come from
// screen-space derivatives, so any geometry reads as cut stone. The body is a
// fake-refraction model: the view ray is bent at each facet (object space),
// then used to look up a tinted interior (Beer-Lambert absorption through a
// unit sphere), a soft glowing core along the crystal's axis, drifting inner
// veils, and an animated caustic network. On top: fresnel sky reflection,
// sharp rim, bright facet edges, per-facet sun glints, twinkling facets and
// sparkle points. Only the core, glints and sparkles exceed the bloom
// threshold (1.35 linear) at intensity 1.
//
// crystalGeometry(kind, opts): 'prism' | 'cluster' | 'gem' | 'shard'. Flat
// per-triangle geometry with extra attributes the shader uses:
//   aBary (vec3): barycentrics with fan diagonals hidden (facet edge lines)
//   aCore (vec4): xyz centre of the crystal body the vertex belongs to, w radius
//   aAxis (vec3): half axis of the glowing core segment (0 = point core)
// Meshes whose geometry lacks them still render (point core at the origin,
// radius 1, no edge lines).
//
// crystalGlowSprite(color, size, opts): additive soft halo sprite.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { U, noiseTexture } from './materials.js';
import { mulberry32 } from '../core/util.js';

// ---------------------------------------------------------------------------
// Shader
const VERT = /* glsl */ `
attribute vec3 aBary;
attribute vec4 aCore;
attribute vec3 aAxis;
varying vec3 vWP;
varying vec3 vOP;
varying vec3 vVO;
varying vec3 vBary;
varying vec4 vCore;
varying vec3 vAxis;
#include <fog_pars_vertex>
void main() {
  mat4 mm = modelMatrix;
  #ifdef USE_INSTANCING
    mm = modelMatrix * instanceMatrix;
  #endif
  vec4 wp = mm * vec4(position, 1.0);
  vWP = wp.xyz;
  vOP = position;
  // object-space view vector (exact for rotation + uniform scale; fine otherwise)
  vVO = transpose(mat3(mm)) * (cameraPosition - wp.xyz);
  vBary = aBary;
  vCore = aCore;
  vAxis = aAxis;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uGlow;
uniform float uIntensity;
uniform float uOpacity;
uniform float uRim;
uniform float uSparkle;
uniform float uFlash;
uniform float uSeed;
uniform float uTime;
uniform vec3 uSun;
uniform vec3 uLight;
uniform vec3 uShade;
uniform sampler2D uNoise;
varying vec3 vWP;
varying vec3 vOP;
varying vec3 vVO;
varying vec3 vBary;
varying vec4 vCore;
varying vec3 vAxis;
#include <fog_pars_fragment>

vec3 _h33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

void main() {
  vec3 V = normalize(cameraPosition - vWP);
  vec3 N = normalize(cross(dFdx(vWP), dFdy(vWP)));
  vec3 NO = normalize(cross(dFdx(vOP), dFdy(vOP)));
  if (dot(N, V) < 0.0) { N = -N; NO = -NO; }
  vec3 VO = normalize(vVO);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  // per-facet random value (object-space facet normal: stable while spinning)
  float fh = fract(dot(NO, vec3(17.31, 29.73, 41.17)) + uSeed * 0.37);

  // colours: HDR inputs are normalised, brightness comes from uIntensity
  vec3 tint = uColor / max(max(max(uColor.r, uColor.g), uColor.b), 1.0);
  vec3 glow = uGlow / max(max(max(uGlow.r, uGlow.g), uGlow.b), 1e-3);
  vec3 deep = tint * tint * 0.6;
  #ifdef ICE
    deep = mix(deep, vec3(0.1, 0.34, 0.6), 0.7);
  #endif

  // stylised lighting: key light (sun or moon) + cool ambient from the sky
  vec3 L = normalize(uSun);
  float ndl = dot(N, L);
  float lit = smoothstep(-0.12, 0.32, ndl);
  vec3 amb = uLight * (uShade * 1.25 + 0.12);
  vec3 light = amb + uLight * lit;

  // ---- fake refraction (object space, units of the body radius)
  vec3 p0 = (vOP - vCore.xyz) / vCore.w;
  vec3 rd = refract(-VO, NO, 0.66);
  if (dot(rd, rd) < 1e-4) rd = reflect(-VO, NO);
  // second, per-facet deflection: the ray leaves through some other back facet
  vec3 fj = _h33(floor(NO * 7.0 + 0.5) + uSeed) - 0.5;
  vec3 rd2 = normalize(rd + fj * 0.9);

  // soft core: closest approach of the refracted ray to the core segment
  float t = max(dot(-p0, rd), 0.0);
  vec3 q = p0 + rd * t;
  vec3 ax = vAxis / vCore.w;
  float hl = length(ax);
  vec3 an = ax / max(hl, 1e-4);
  float sa = clamp(dot(q, an), -hl, hl);
  float d = length(q - an * sa);
  float core = exp(-d * d * 4.0);
  float hot = exp(-d * d * 16.0);

  // path length to the exit of the unit sphere -> tinted absorption
  float b = dot(p0, rd);
  float c = dot(p0, p0) - 1.0;
  float disc = max(b * b - c, 0.0);
  float thick = clamp(-b + sqrt(disc), 0.0, 2.0);
  vec3 absorb = exp(-thick * (1.0 - tint) * 1.9);

  // what the bent ray "sees": bright above, deep below, different per facet,
  // broken into internal "back facets" (cells in ray-direction space whose
  // borders are straight lines across each outer facet and slide with view)
  float up = rd2.y * 0.7 + fj.x * 0.9;
  vec3 env = mix(deep * 0.3, mix(tint, vec3(1.0), 0.3), smoothstep(-0.5, 0.6, up));
  vec3 qi = rd2 * 1.6 + p0 * 0.9;
  float cid = step(0.0, dot(qi, vec3(0.62, 0.55, -0.56)) + 0.13)
            + 2.0 * step(0.0, dot(qi, vec3(-0.35, 0.8, 0.49)) - 0.21)
            + 4.0 * step(0.0, dot(qi, vec3(0.77, -0.28, 0.57)) + 0.05)
            + 8.0 * step(0.0, dot(qi, vec3(-0.5, -0.45, -0.74)) - 0.3);
  float ib = fract(sin(cid * 12.9898 + dot(fj, vec3(3.1, 5.3, 7.7)) + uSeed * 4.1) * 43758.5453);
  env *= (0.3 + 0.7 * fh) * mix(0.4, 1.3, ib);

  // drifting inner veils (soft contours of fbm sampled along the ray)
  float veil = 0.0;
  for (int i = 0; i < 2; i++) {
    vec3 pp = p0 + rd2 * (0.35 + 0.5 * float(i));
    float n = texture2D(uNoise, pp.xy * 0.2 + pp.z * vec2(0.13, 0.09) + uSeed * 0.31 + uTime * 0.003, 2.5).g;
    veil += (1.0 - smoothstep(0.0, 0.05, abs(n - 0.5))) * (1.0 - 0.35 * float(i));
  }
  // caustic shimmer: soft bands where two drifting noise fields meet
  vec2 cu = (p0.xz + rd2.xz * 0.7) * 0.3 + p0.y * vec2(0.15, 0.1) + uSeed * 0.13;
  float c1 = texture2D(uNoise, cu + vec2(uTime * 0.012, uTime * 0.007), 1.5).b;
  float c2 = texture2D(uNoise, cu * 1.37 + vec2(-uTime * 0.01, uTime * 0.013) + 0.5, 1.5).b;
  float caust = 1.0 - smoothstep(0.0, 0.07, abs(c1 - c2));
  caust *= caust;

  vec3 inner = env * absorb * (0.35 + 0.8 * light);
  float gI = uIntensity;
  float kal = mix(0.55, 1.25, ib);   // internal facets also break up the glow
  inner += glow * (veil * 0.14 + caust * 0.3) * (0.25 + 0.75 * core) * gI;
  inner += glow * core * 0.6 * kal * gI + mix(glow, vec3(1.0), 0.55) * hot * 1.1 * gI;

  #ifdef ICE
  {
    // milky, frosted core and thin white fracture planes
    float milk = 0.12 + smoothstep(0.1, 0.9, core) * 0.4;
    inner = mix(inner, mix(tint, vec3(1.0), 0.6) * (0.5 + 0.65 * light), milk * (0.6 + 0.4 * ib));
    vec3 pp = p0 * 1.2 + rd * 0.45;
    float n = texture2D(uNoise, pp.xz * 0.3 + pp.y * vec2(0.19, 0.15) + uSeed * 0.7, 1.0).b;
    float crack = 1.0 - smoothstep(0.0, 0.025, abs(n - 0.5));
    inner += vec3(0.9, 0.97, 1.0) * crack * 0.3 * (0.4 + 0.6 * light);
  }
  #endif

  // the surface itself: weak diffuse facet tone, crystals are mostly transmissive
  vec3 surf = tint * (0.5 + 0.4 * fh) * light;
  vec3 col = mix(inner, surf, 0.22) * mix(0.74, 1.08, lit);

  // fresnel sky reflection + sharp rim
  float fres = pow(1.0 - ndv, 3.0);
  vec3 sky = amb * 1.3 + uLight * 0.35 * (0.5 + 0.5 * N.y);
  col = mix(col, sky + tint * 0.15, fres * 0.55);
  float rim = smoothstep(0.5, 0.95, 1.0 - ndv);
  col += mix(tint, vec3(1.0), 0.55) * rim * uRim * (0.25 + 0.4 * light) + glow * rim * uRim * 0.18 * gI;

  // facet edges (constant pixel width; fade out when the crystal is tiny)
  float bs = vBary.x + vBary.y + vBary.z;
  float edge = 0.0;
  if (bs > 0.5) {
    vec3 bw = fwidth(vBary);
    vec3 e3 = smoothstep(bw * 0.4, bw * 1.6, vBary);
    edge = 1.0 - min(min(e3.x, e3.y), e3.z);
    float px = length(fwidth(p0));
    edge *= 1.0 - smoothstep(0.04, 0.14, px);
  }
  col += (mix(tint, vec3(1.0), 0.45) * (0.1 + 0.25 * light) + glow * 0.16 * gI) * edge;

  // sun glint: flat facets flash as a whole when they mirror the key light
  vec3 R = reflect(-V, N);
  float spec = pow(max(dot(R, L), 0.0), 90.0);
  col += (uLight * 2.2 + 0.3) * spec * uSparkle;
  // twinkling facets
  float ft = pow(max(sin(uTime * (0.6 + fh * 1.4) + fh * 61.0 + dot(V, vec3(1.3, 2.1, 1.7)) * 2.5), 0.0), 24.0);
  col += mix(glow, vec3(1.0), 0.5) * ft * 0.45 * uSparkle * (0.5 + 0.5 * gI);
  // sparkle points
  vec3 sp = p0 * 4.2 + uSeed * 7.0;
  vec3 cell = floor(sp);
  vec3 hh = _h33(cell);
  vec3 f = fract(sp) - 0.5 - (hh - 0.5) * 0.6;
  float tw = sin(uTime * (1.3 + 2.6 * hh.x) + hh.y * 40.0 + dot(VO, hh * 2.0 - 1.0) * 8.0);
  tw = pow(max(tw, 0.0), 10.0) * step(0.4, hh.z);
  float spark = tw * smoothstep(0.1, 0.0, length(f));
  col += mix(glow, vec3(1.0), 0.75) * spark * 3.2 * uSparkle;

  col += vec3(uFlash) * (0.6 + 0.8 * core);

  float a = uOpacity;
  if (uOpacity < 1.0) a = clamp(mix(uOpacity, 1.0, max(fres, edge * 0.7)) + spark + spec * 0.5 + hot * 0.4, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const matCache = new Map();

/**
 * Stylized crystal material.
 * opts: { color, glow, intensity, opacity, transparent, rim, sparkle, ice, side, seed, nocache, depthWrite }
 * - color: body tint (hex or THREE.Color; HDR colours are normalised)
 * - glow: inner emissive colour (defaults to a link to color, so mat.color drives both)
 * Uniforms for animation: uIntensity, uGlow, uColor, uFlash, uOpacity, uSparkle, uRim.
 * mat.color is the uColor value (a THREE.Color).
 */
export function crystalMaterial(opts = {}) {
  const key = opts.nocache ? null : JSON.stringify(opts, (k, v) => (v && v.isColor ? v.getHex() : v));
  if (key && matCache.has(key)) return matCache.get(key);
  noiseTexture();
  const color = opts.color instanceof THREE.Color ? opts.color.clone() : new THREE.Color(opts.color ?? (opts.ice ? 0xcfefff : 0xb894ff));
  const glow = opts.glow === undefined ? color : opts.glow instanceof THREE.Color ? opts.glow.clone() : new THREE.Color(opts.glow);
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  Object.assign(uniforms, {
    uColor: { value: color },
    uGlow: { value: glow },
    uIntensity: { value: opts.intensity ?? (opts.ice ? 0.45 : 1) },
    uOpacity: { value: opts.opacity ?? (opts.transparent ? 0.8 : 1) },
    uRim: { value: opts.rim ?? 1 },
    uSparkle: { value: opts.sparkle ?? 1 },
    uFlash: { value: 0 },
    uSeed: { value: opts.seed ?? 0 },
    uTime: U.time,
    uSun: U.sunDir,
    uLight: U.rimColor,
    uShade: U.shadeTint,
    uNoise: U.noise,
  });
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines: opts.ice ? { ICE: '' } : {},
    fog: true,
    transparent: !!opts.transparent,
    depthWrite: opts.depthWrite ?? true,
    side: opts.side ?? THREE.FrontSide,
  });
  m.defaultAttributeValues = { ...m.defaultAttributeValues, aBary: [0, 0, 0], aCore: [0, 0, 0, 1], aAxis: [0, 0, 0] };
  m.color = color;           // alias: gem.material.color.setRGB(...) retints the crystal
  m.userData.crystal = true;
  if (key) matCache.set(key, m);
  return m;
}

// ---------------------------------------------------------------------------
// Geometry
//
// A body is a list of planar polygons (outward order fixed afterwards) plus
// its core description. Polygons are fan-triangulated; fan diagonals are
// hidden from the edge lines.
function Body(core, radius, axis) { return { polys: [], core, radius, axis }; }

function bodyGeometry(bodies) {
  const pos = [], bary = [], acore = [], aaxis = [];
  for (const B of bodies) {
    // centroid for outward orientation (bodies are convex)
    const cen = new THREE.Vector3(); let nv = 0;
    for (const p of B.polys) for (const v of p) { cen.add(v); nv++; }
    cen.multiplyScalar(1 / nv);
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3(), pc = new THREE.Vector3();
    for (let poly of B.polys) {
      if (poly.length < 3) continue;
      // orient polygon outward
      pc.set(0, 0, 0); for (const v of poly) pc.add(v); pc.multiplyScalar(1 / poly.length);
      e1.subVectors(poly[1], poly[0]); e2.subVectors(poly[2], poly[0]); nn.crossVectors(e1, e2);
      if (nn.dot(pc.clone().sub(cen)) < 0) poly = poly.slice().reverse();
      const n = poly.length;
      for (let i = 1; i < n - 1; i++) {
        const tri = [poly[0], poly[i], poly[i + 1]];
        // hidden edges: opposite vertex 1 is (v_{i+1}, v0) -> internal unless last; opposite vertex 2 is (v0, v_i) -> internal unless first
        const hid = [0, i + 1 < n - 1 ? 1 : 0, i > 1 ? 1 : 0];
        for (let k = 0; k < 3; k++) {
          const v = tri[k];
          pos.push(v.x, v.y, v.z);
          bary.push((k === 0 ? 1 : 0) + hid[0], (k === 1 ? 1 : 0) + hid[1], (k === 2 ? 1 : 0) + hid[2]);
          acore.push(B.core.x, B.core.y, B.core.z, B.radius);
          aaxis.push(B.axis.x, B.axis.y, B.axis.z);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aBary', new THREE.Float32BufferAttribute(bary, 3));
  g.setAttribute('aCore', new THREE.Float32BufferAttribute(acore, 4));
  g.setAttribute('aAxis', new THREE.Float32BufferAttribute(aaxis, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// Hexagonal (n-sided) prism with a pointed tip; `double` terminates both ends.
// Default size: double -> y in [-1, 1]; single -> base y = 0, tip y = 2.
function prismBody(o, rnd) {
  const n = o.sides ?? 6;
  const r = o.radius ?? 0.42;
  const dbl = !!o.double;
  const tip = o.tip ?? (dbl ? 0.45 : 0.62);
  const tip2 = o.tip2 ?? tip * 0.85;
  const h = o.height ?? (dbl ? 2 - tip - tip2 : 2 - tip);
  const jit = o.jitter ?? 0.18;
  const cut = o.cut ?? 0;
  const y0 = dbl ? -h / 2 - (tip2 - tip) / 2 : 0, y1 = y0 + h;
  const cols = [];
  const a0 = rnd() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2 + (rnd() - 0.5) * jit * (2.4 / n);
    const rr = r * (1 - jit * 0.5 + rnd() * jit);
    cols.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  const top = cols.map(([x, z]) => V3(x, y1, z));
  const bot = cols.map(([x, z]) => V3(x, y0 + cut * x / r * 0.5 * r, z));
  const apex = V3((rnd() - 0.5) * r * jit * 0.8, y1 + tip, (rnd() - 0.5) * r * jit * 0.8);
  const B = Body(V3(0, dbl ? (y0 + y1) / 2 : h * 0.5, 0), r, V3(0, h * 0.5, 0));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    B.polys.push([bot[i], bot[j], top[j], top[i]]);
    B.polys.push([top[i], top[j], apex]);
  }
  if (dbl) {
    const apex2 = V3((rnd() - 0.5) * r * jit * 0.8, y0 - tip2, (rnd() - 0.5) * r * jit * 0.8);
    for (let i = 0; i < n; i++) B.polys.push([bot[(i + 1) % n], bot[i], apex2]);
  } else {
    B.polys.push(bot.slice().reverse());
  }
  return B;
}

function transformBody(B, m) {
  const s = new THREE.Vector3().setFromMatrixScale(m);
  const m3 = new THREE.Matrix3().setFromMatrix4(m);
  B.polys = B.polys.map((p) => p.map((v) => v.clone().applyMatrix4(m)));
  B.core = B.core.clone().applyMatrix4(m);
  B.axis = B.axis.clone().applyMatrix3(m3);
  B.radius *= (s.x + s.y + s.z) / 3;
  return B;
}

// Brilliant-ish cut: table, star + upper-girdle crown facets, girdle band and
// a pavilion fan to the culet. Radius 1, y from about -0.72 to 0.7.
function gemBody(o, rnd) {
  const n = o.sides ?? 8;
  const tr = o.table ?? 0.56, ty = o.crown ?? 0.42, gb = 0.08, cy = -(o.pavilion ?? 1.0);
  const s = (Math.PI * 2) / n;
  const T = [], Gt = [], Gb = [];
  for (let i = 0; i < n; i++) T.push(V3(Math.cos((i + 0.5) * s) * tr, ty, Math.sin((i + 0.5) * s) * tr));
  for (let j = 0; j < n * 2; j++) {
    const a = j * s * 0.5, rr = 1 + (rnd() - 0.5) * 0.03;
    Gt.push(V3(Math.cos(a) * rr, gb * 0.5, Math.sin(a) * rr));
    Gb.push(V3(Math.cos(a) * rr, -gb * 0.5, Math.sin(a) * rr));
  }
  const culet = V3(0, cy, 0);
  const B = Body(V3(0, 0, 0), 1, V3(0, 0, 0));
  B.polys.push(T.slice());
  for (let i = 0; i < n; i++) {
    const g0 = Gt[2 * i], g1 = Gt[2 * i + 1], g2 = Gt[(2 * i + 2) % (2 * n)];
    B.polys.push([T[i], g0, g1]);
    B.polys.push([T[i], g1, g2]);
    B.polys.push([T[i], g2, T[(i + 1) % n]]);
  }
  for (let j = 0; j < n * 2; j++) {
    const k = (j + 1) % (n * 2);
    B.polys.push([Gb[j], Gb[k], Gt[k], Gt[j]]);
    B.polys.push([Gb[k], Gb[j], culet]);
  }
  // centre the stone vertically
  const off = -(ty + cy) / 2;
  const m = new THREE.Matrix4().makeTranslation(0, off, 0);
  return transformBody(B, m);
}

const geoCache = new Map();

/**
 * crystalGeometry(kind, opts) — cached by kind + opts.
 *  prism:   { sides=6, radius, height, tip, tip2, double, jitter, cut, seed }
 *  cluster: { count (4..9), seed, spread, tilt } — base at y=0, about 2 units tall
 *  gem:     { sides=8, table, crown, pavilion, seed } — radius 1, centred
 *  shard:   { seed, sides } — thin broken splinter, base y=0, about 2 units tall
 */
export function crystalGeometry(kind = 'prism', opts = {}) {
  const key = kind + JSON.stringify(opts);
  let g = geoCache.get(key);
  if (g) return g;
  const rnd = mulberry32(opts.seed ?? 7);
  if (kind === 'prism') {
    g = bodyGeometry([prismBody(opts, rnd)]);
  } else if (kind === 'shard') {
    g = bodyGeometry([prismBody({ sides: opts.sides ?? 4, radius: opts.radius ?? 0.2, tip: opts.tip ?? 0.7, jitter: 0.35, cut: opts.cut ?? 0.9, height: opts.height ?? 1.25 }, rnd)]);
  } else if (kind === 'gem') {
    g = bodyGeometry([gemBody(opts, rnd)]);
  } else if (kind === 'cluster') {
    const count = opts.count ?? 4 + Math.floor(rnd() * 6);
    const spread = opts.spread ?? 1, tilt = opts.tilt ?? 1;
    const bodies = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < count; i++) {
      const main = i === 0;
      const a = rnd() * Math.PI * 2;
      const rr = main ? 0 : (0.18 + rnd() * 0.3) * spread;
      const lean = main ? (rnd() - 0.5) * 0.2 : (0.3 + rnd() * 0.6) * tilt;
      const sc = main ? 1 : 0.38 + rnd() * 0.45;
      const B = prismBody({ sides: rnd() < 0.7 ? 6 : 5, radius: 0.4 + rnd() * 0.08, tip: 0.5 + rnd() * 0.3, height: 1.3 + rnd() * 0.4, jitter: 0.22 }, rnd);
      // lean outward from the cluster centre
      e.set(Math.sin(a) * lean, 0, -Math.cos(a) * lean);
      q.setFromEuler(e).multiply(qy.setFromAxisAngle(V3(0, 1, 0), rnd() * Math.PI));
      m.compose(V3(Math.cos(a) * rr, -0.25 * sc, Math.sin(a) * rr), q, V3(sc, sc, sc));
      bodies.push(transformBody(B, m));
    }
    g = bodyGeometry(bodies);
  } else {
    throw new Error('crystalGeometry: unknown kind ' + kind);
  }
  geoCache.set(key, g);
  return g;
}

// ---------------------------------------------------------------------------
// Soft additive halo sprite
let _haloTex = null;
function haloTexture() {
  if (_haloTex) return _haloTex;
  const N = 64, data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (x + 0.5) / N * 2 - 1, dy = (y + 0.5) / N * 2 - 1;
    const r = Math.min(1, Math.hypot(dx, dy));
    const v = Math.pow(1 - r, 2.2) * 0.75 + Math.exp(-r * r * 30) * 0.25;
    const i = (y * N + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(Math.min(1, v) * 255);
  }
  _haloTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  _haloTex.magFilter = THREE.LinearFilter; _haloTex.minFilter = THREE.LinearMipmapLinearFilter;
  _haloTex.generateMipmaps = true; _haloTex.needsUpdate = true;
  return _haloTex;
}
const haloCache = new Map();
/** Additive soft glow sprite. opts: { intensity=0.5, nocache } */
export function crystalGlowSprite(color, size = 1, opts = {}) {
  const I = opts.intensity ?? 0.5;
  const key = new THREE.Color(color).getHexString() + '|' + I;
  let m = opts.nocache ? null : haloCache.get(key);
  if (!m) {
    m = new THREE.SpriteMaterial({ map: haloTexture(), color: new THREE.Color(color).multiplyScalar(I), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
    if (!opts.nocache) haloCache.set(key, m);
  }
  const s = new THREE.Sprite(m);
  s.scale.setScalar(size);
  s.castShadow = false; s.receiveShadow = false;
  return s;
}
