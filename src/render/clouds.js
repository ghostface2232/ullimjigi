// Volumetric cumulus, marched into a map of the sky dome.
//
//   layout  - where the clouds are. Heaps of domes standing on a flat base are splatted into a
//             tiling height field; a second pass pushes that field about and bites bays out of
//             it with noise, so the round heaps lean, merge into banks and shed fragments; a
//             third takes its gradient. (r = top height above the base, g = metres inside the
//             footprint, ba = gradient.) A coarse map holds the highest top nearby.
//             Heaps grow in with the weather's cover, so these are redrawn when it changes.
//   noise   - a tiling 3D texture of billow (inverted Worley) and Perlin noise that carves the
//             field into cauliflower lobes and soft, ragged edges.
//   dome    - the marcher writes sun energy, height in the cloud, distance and opacity for every
//             direction of the upper hemisphere (stereographic), a band of rows per frame into a
//             back buffer. The sky shader samples the finished map, re-aimed for the drift and
//             the camera travel since it was drawn, and turns those terms into colour there, so
//             the palette follows the hour at once.
import * as THREE from 'three';
import { G } from '../core/context.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { mulberry32 } from '../core/util.js';
import { tier } from './quality.js';

export const CLOUD = { base: 1500, tile: 20000, far: 30000, domeS: 0.985, mid: 1800 };
const MARGIN = 700; // how far outside a footprint the layout still knows its distance

// Project the same shaped cumulus footprint used by the dome onto a receiver. Two taps
// account for the cloud's height along an oblique light ray; no second noise field or pass.
// This is a soft column approximation, not the marcher's fine billow self-shadowing.
export const CLOUD_SHADOW = `
uniform sampler2D uCloudLayout;
uniform vec3 uCloudWind;
float landscapeCloudShadow(vec3 p, vec3 light, float strength) {
  if (strength <= 0.0) return 1.0;
  vec2 ray = light.xz / max(light.y, 0.12);
  vec2 q = p.xz + ray * max(${CLOUD.base.toFixed(1)} - p.y, 0.0) + uCloudWind.xy;
  vec2 column = texture2D(uCloudLayout, q / ${CLOUD.tile.toFixed(1)}).rg;
  column = texture2D(uCloudLayout, (q + ray * column.r * 0.5) / ${CLOUD.tile.toFixed(1)}).rg;
  float edge = smoothstep(-35.0, 140.0, column.g - ${MARGIN.toFixed(1)});
  float opacity = 1.0 - exp(-max(column.r, 0.0) * 0.008);
  return 1.0 - strength * edge * opacity;
}
`;

// --- 3D noise ---------------------------------------------------------------
const NOISE_FS = `
precision highp float;
uniform float uZ;
varying vec2 vUv;
vec3 hash33(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
// 1 at a feature point, falling to 0 between them: round puffs with sharp creases
float worley(vec3 p, float n){
  p *= n; vec3 i = floor(p), f = fract(p); float d = 1.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 r = g + hash33(mod(i + g, n)) - f;
    d = min(d, dot(r, r));
  }
  return 1.0 - min(sqrt(d), 1.0);
}
float grad(vec3 i, vec3 f, vec3 o, float n){ return dot(hash33(mod(i + o, n)) * 2.0 - 1.0, f - o); }
float perlin(vec3 p, float n){
  p *= n; vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = mix(mix(mix(grad(i, f, vec3(0, 0, 0), n), grad(i, f, vec3(1, 0, 0), n), u.x),
                    mix(grad(i, f, vec3(0, 1, 0), n), grad(i, f, vec3(1, 1, 0), n), u.x), u.y),
                mix(mix(grad(i, f, vec3(0, 0, 1), n), grad(i, f, vec3(1, 0, 1), n), u.x),
                    mix(grad(i, f, vec3(0, 1, 1), n), grad(i, f, vec3(1, 1, 1), n), u.x), u.y), u.z);
  return a * 0.8 + 0.5;
}
void main(){
  vec3 p = vec3(vUv, uZ);
  float pf = perlin(p, 4.0) * 0.5 + perlin(p, 8.0) * 0.27 + perlin(p, 16.0) * 0.15 + perlin(p, 32.0) * 0.08;
  float wl = worley(p, 3.0) * 0.6 + worley(p, 6.0) * 0.28 + worley(p, 12.0) * 0.12;
  float wm = worley(p, 6.0) * 0.58 + worley(p, 12.0) * 0.28 + worley(p, 24.0) * 0.14;
  float wh = worley(p, 10.0) * 0.6 + worley(p, 20.0) * 0.28 + worley(p, 40.0) * 0.12;
  // r: Perlin-Worley (broad, connected), g: billows, b: fine billows, a: Perlin
  float pw = clamp((pf - (1.0 - wl) * 0.55) / (1.0 - (1.0 - wl) * 0.55), 0.0, 1.0);
  gl_FragColor = vec4(pw, wm, wh, pf);
}`;

function bakeNoise(renderer, size = 128) {
  const rt = new THREE.WebGL3DRenderTarget(size, size, size, { depthBuffer: false });
  const t = rt.texture;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uZ: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: NOISE_FS, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new FullScreenQuad(mat);
  const prev = renderer.getRenderTarget();
  for (let z = 0; z < size; z++) {
    mat.uniforms.uZ.value = (z + 0.5) / size;
    renderer.setRenderTarget(rt, z);
    quad.render(renderer);
  }
  renderer.setRenderTarget(prev);
  quad.dispose(); mat.dispose();
  return t;
}

// --- layout -----------------------------------------------------------------
const LAY = 1024, PEAK = 64;
// the coarse map must cover whatever the shaping pass can push into a cell
const PEAK_PAD = (CLOUD.tile / PEAK) * 1.5 + 650;
// Each dome is half an ellipsoid standing on the base: [x, z, height, radius, rank, wide].
// (A dome lifted off the base would leave a cliff under its rim in a height field; tall, narrow
// ones rooted in the base rise out of the mass around them with round shoulders instead.)
// A dome shows once the cover passes its rank. `wide` domes also write the distance around
// their footprint.
function heaps(seed = 11) {
  const rnd = mulberry32(seed), T = CLOUD.tile, out = [], TAU = Math.PI * 2;
  const R = (a, b) => a + (b - a) * rnd();
  const dome = (x, z, h, r, rank, wide) => out.push([x, z, h, r, Math.min(0.98, rank), wide ? 1 : 0]);
  const cap = (h, r, d) => h * Math.sqrt(Math.max(1 - (d * d) / (r * r), 0));
  // lobes swelling out of a dome's top: narrower ellipsoids a little taller than the dome there
  const lobes = (cx, cz, h, r, n, lift, rank) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n + R(-0.15, 0.15)) * TAU, d = r * R(0.12, 0.56), lr = r * R(0.36, 0.52);
      dome(cx + Math.cos(a) * d, cz + Math.sin(a) * d, cap(h, r, d) + lr * R(lift * 0.5, lift), lr, rank, false);
    }
  };
  // one cumulus: a main dome, flanks spreading its base, lobes on every top, sometimes a tower
  const heap = (x, z, S, rank, tower) => {
    const H = S * R(0.74, 0.95);
    dome(x, z, H, S, rank, true);
    lobes(x, z, H, S, 4 + ((rnd() * 4) | 0), 0.72, rank);
    const nf = 2 + ((rnd() * 4) | 0), a0 = rnd() * TAU;
    for (let i = 0; i < nf; i++) {
      const a = a0 + (i / nf + R(-0.1, 0.1)) * TAU, d = S * R(0.45, 0.85), r = S * R(0.4, 0.62), fh = r * R(0.7, 1.0);
      const fx = x + Math.cos(a) * d, fz = z + Math.sin(a) * d;
      dome(fx, fz, fh, r, rank, true);
      lobes(fx, fz, fh, r, 2 + ((rnd() * 2) | 0), 0.6, rank);
    }
    if (tower) {
      const a = rnd() * TAU, d = S * R(0.05, 0.3), r = S * R(0.42, 0.56), th = H * R(1.25, 1.6);
      const tx = x + Math.cos(a) * d, tz = z + Math.sin(a) * d;
      dome(tx, tz, th, r, rank, false);
      lobes(tx, tz, th, r, 3, 0.5, rank);
    }
  };
  // a smooth field that tiles: clouds gather where it is low and leave open sky where it is high
  const ph = [rnd() * TAU, rnd() * TAU, rnd() * TAU, rnd() * TAU];
  const field = (u, v) => 0.5 + 0.25 * (Math.sin(TAU * u + ph[0]) * Math.cos(TAU * v + ph[1]) + Math.sin(TAU * (2 * u + v) + ph[2]) * 0.6 + Math.cos(TAU * (2 * v - u) + ph[3]) * 0.4);
  const N = 8, cell = T / N;
  for (let gz = 0; gz < N; gz++) for (let gx = 0; gx < N; gx++) {
    const cx = (gx + R(0.1, 0.9)) * cell, cz = (gz + R(0.1, 0.9)) * cell;
    const cl = field(cx / T, cz / T);
    const rank = Math.max(0.02, rnd() * 0.4 + cl * 0.55);
    const kind = rnd() + (0.45 - cl) * 0.9;
    const ax = rnd() * Math.PI, ca = Math.cos(ax), sa = Math.sin(ax);
    const put = (u, v) => [cx + u * ca - v * sa, cz + u * sa + v * ca];
    let spread;
    if (kind > 0.72) {
      // a bank: many heaps run together along one axis, the later ones filling in as cover grows
      const n = 5 + ((rnd() * 4) | 0);
      spread = R(1500, 2600);
      for (let i = 0; i < n; i++) {
        const [x, z] = put(((i + R(0.1, 0.9)) / n * 2 - 1) * spread, R(-1, 1) * spread * 0.32);
        heap(x, z, R(520, 980), rank + i * 0.02, rnd() < 0.5);
      }
    } else if (kind > 0.36) {
      // a few heaps grown into each other
      const n = 2 + ((rnd() * 3) | 0);
      spread = R(520, 1050);
      for (let i = 0; i < n; i++) {
        const a = (i / n + R(-0.15, 0.15)) * TAU, d = i ? spread * R(0.6, 1.0) : 0;
        const [x, z] = put(Math.cos(a) * d, Math.sin(a) * d * 0.7);
        heap(x, z, i ? R(320, 620) : R(480, 800), rank + i * 0.03, rnd() < 0.2);
      }
    } else {
      spread = R(300, 420);
      heap(cx, cz, R(300, 600), rank, false);
    }
    // fragments drifting off it
    const nfr = (rnd() * 4) | 0;
    for (let i = 0; i < nfr; i++) {
      const a = rnd() * TAU, d = spread * R(1.05, 1.6) + R(250, 500), r = R(150, 280);
      const [x, z] = put(Math.cos(a) * d, Math.sin(a) * d * 0.7);
      dome(x, z, r * R(0.8, 1.1), r, rank + 0.02, true);
      if (rnd() < 0.6) dome(x + R(-1, 1) * r, z + R(-1, 1) * r, r * R(0.6, 0.9), r * R(0.6, 0.9), rank + 0.02, true);
    }
  }
  // repeat across the tile's edges so the textures wrap
  const all = [];
  for (const d of out) {
    const far = d[3] + Math.max(MARGIN, PEAK_PAD);
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
      const x = d[0] + ox * T, z = d[1] + oz * T;
      if (x < -far || x > T + far || z < -far || z > T + far) continue;
      all.push(x, z, d[2], d[3], d[4], d[5]);
    }
  }
  return new Float32Array(all);
}

const FS_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
// uMode 0: top height + footprint distance (MAX). 1: the highest top around, coarse (MAX).
const LAY_VS = `
attribute vec4 aS; attribute vec2 aK;
uniform float uCover, uMode;
varying vec2 vL; varying vec3 vS;
void main(){
  float g = sqrt(smoothstep(aK.x - 0.05, aK.x + 0.1, uCover));
  float r = aS.w * g, h = aS.z * g;
  float hs = uMode > 0.5 ? r + ${PEAK_PAD.toFixed(1)} : (aK.y > 0.5 ? r + ${MARGIN.toFixed(1)} : r);
  if (g <= 0.0) hs = 0.0;
  vL = position.xy * 2.0 * hs;
  vS = vec3(r, h, aK.y);
  gl_Position = vec4((aS.xy + vL) / ${CLOUD.tile.toFixed(1)} * 2.0 - 1.0, 0.0, 1.0);
}`;
const LAY_FS = `
uniform float uMode;
varying vec2 vL; varying vec3 vS;
void main(){
  if (uMode > 0.5) { gl_FragColor = vec4(vS.y, 0.0, 0.0, 1.0); return; }
  float rho = length(vL), x = rho / max(vS.x, 1.0);
  // lobes (narrow, tall) get a blunter profile than an ellipsoid's sharp tip
  float e = vS.z > 0.5 ? x * x : x * x * x * x;
  float top = x < 1.0 ? vS.y * sqrt(1.0 - e) : 0.0;
  // b: the radius of the widest dome here, the local size of the cloud
  gl_FragColor = vec4(top, vS.z > 0.5 ? max(vS.x - rho + ${MARGIN.toFixed(1)}, 0.0) : 0.0, x < 1.0 ? vS.x : 0.0, 1.0);
}`;
// Shaping pass: the splatted heaps are unions of circles. Read them through a wandering
// offset so they lean, bulge and pinch, then bite bays and scallops out of the outline: heaps
// that overlapped stay joined by necks, thin ones split, and scraps come away from the edges.
const SHAPE_FS = `
precision highp float; precision highp sampler3D;
uniform sampler2D uSrc; uniform sampler3D uN3;
varying vec2 vUv;
void main(){
  vec2 a = vec2(texture(uN3, vec3(vUv, 0.21)).a, texture(uN3, vec3(vUv.yx + 0.37, 0.63)).a) - 0.5;
  vec2 b = vec2(texture(uN3, vec3(vUv * 4.0, 0.47)).a, texture(uN3, vec3(vUv.yx * 4.0 + 0.19, 0.83)).a) - 0.5;
  vec3 m = texture2D(uSrc, vUv + (a * 1500.0 + b * 320.0) / ${CLOUD.tile.toFixed(1)}).rgb;
  float lat = m.g - ${MARGIN.toFixed(1)}, top = m.r;
  if (lat > 0.0) {
    // bays as deep as most of the cloud's own radius in places, nothing in others; scallops
    float R = max(m.b, 120.0);
    float n1 = smoothstep(0.08, 0.5, texture(uN3, vec3(vUv * 7.0, 0.71)).r);
    float n2 = smoothstep(0.25, 0.75, texture(uN3, vec3(vUv * 14.0, 0.13)).g);
    // (big heaps keep their mass: the bays stop growing with them)
    lat -= (1.0 - n1) * min(R, 480.0) * 0.6 + (1.0 - n2) * min(R, 480.0) * 0.14;
    // the new edge rises like the side of a dome, and a sliver is never taller than it is wide
    float Rs = R * 0.75, e = clamp(lat, 0.0, Rs);
    top = lat > 0.0 ? min(top, min(sqrt(e * (2.0 * Rs - e)) + 20.0, 14.0 * sqrt(lat) + 6.0)) : 0.0;
  }
  gl_FragColor = vec4(top, max(lat + ${MARGIN.toFixed(1)}, 0.0), 0.0, 1.0);
}`;
// Gradient of the shaped height field (ba). It gives the surface normal for shading, and turns
// the height left above a point into the distance to the surface (steep sides are close,
// however tall).
const SLOPE_FS = `
uniform sampler2D uSrc;
varying vec2 vUv;
void main(){
  const float px = 1.0 / ${LAY.toFixed(1)}, m = ${(CLOUD.tile / LAY).toFixed(3)};
  vec2 c = texture2D(uSrc, vUv).rg;
  vec2 g = vec2(texture2D(uSrc, vUv + vec2(px, 0.0)).r - texture2D(uSrc, vUv - vec2(px, 0.0)).r,
                texture2D(uSrc, vUv + vec2(0.0, px)).r - texture2D(uSrc, vUv - vec2(0.0, px)).r) / (2.0 * m);
  gl_FragColor = vec4(c, g);
}`;

// --- march ------------------------------------------------------------------
const MARCH_FS = `
precision highp float; precision highp sampler3D;
uniform sampler2D uLay, uPeak; uniform sampler3D uN3;
uniform vec3 uCam, uLight, uWind;
uniform float uDeck;
varying vec2 vUv;
const float BASE = ${CLOUD.base.toFixed(1)}, TILE = ${CLOUD.tile.toFixed(1)}, TMAX = ${CLOUD.far.toFixed(1)}, MARGIN = ${MARGIN.toFixed(1)};
const float HMAX = 1800.0;
// the layer sinks with distance as if over a small planet, so far clouds reach the horizon
const float CURV = 1.33e-6;
float gFar, gFold, gNdl, gWisp;
vec3 gDir; vec2 gGrad;
void lay(vec2 w, out float top, out float lat, out float cs){
  vec4 m = textureLod(uLay, w / TILE, 0.0);
  top = m.r * gFar; lat = m.g - MARGIN; gGrad = m.ba; cs = inversesqrt(1.0 + dot(m.ba, m.ba));
}
// Metres inside the cloud's surface at layout position w, height h above the base
// (negative outside), before the fine detail. q: where the noise is read.
float shape(vec2 w, float h, float top, float lat, float cs, out vec3 q){
  q = vec3(w.x, h - uWind.z, w.y);
  vec4 n = texture(uN3, q / 1250.0);
  // billows bite into the top and into the outline seen from below
  float amp = clamp(top * 0.34, 36.0, 170.0);
  float puff = smoothstep(0.22, 0.72, n.g);
  gWisp = n.a;
  float bite = (1.0 - puff) * amp - (n.a - 0.5) * amp * 0.6;
  gFold = n.g;
  float up = clamp(h / max(top, 80.0), 0.0, 1.0);
  float d = min((top - h) * cs - bite * (0.3 + 0.7 * smoothstep(0.0, 0.35, up)), lat - bite * clamp(max(top, lat) * 0.45, 40.0, 130.0) / amp);
  // the base stays flat
  d = min(d, h * 1.5 + 14.0 + (n.g - 0.5) * 22.0);
  #ifdef DECK
  // overcast: a broken deck fills in between the heaps
  float dd = min(min(h + 60.0, 430.0 - h), (texture(uN3, q / 5000.0).r - (1.02 - uDeck * 0.62)) * 900.0);
  d = max(d, dd);
  #endif
  return d;
}
float fine(float d, vec3 q, float top){
  float n2 = smoothstep(0.2, 0.8, texture(uN3, q / 800.0 + 0.37).b);
  return d - (1.0 - n2) * clamp(top * 0.18, 28.0, 72.0);
}
// The cloud along the view ray at distance t: metres inside its surface, or a negative
// number whose size is how far the ray may safely stride.
float field(float t, float s, out vec2 w, out float h){
  vec3 p = uCam + gDir * t;
  p.y += t * t * CURV;
  w = p.xz + uWind.xy;
  h = p.y - BASE;
  float top, lat, cs;
  lay(w, top, lat, cs);
  #ifdef DECK
  lat = max(lat, 1.0); top = max(top, 430.0);
  #else
  // clear air: stride towards the nearest footprint (half the way: the shaping pass bends it)
  if (lat <= 0.0) return -max(-lat * 0.3, s);
  if (h >= top || h <= -40.0) {
    // inside a footprint but over or under the cloud: stride while nothing nearby reaches here
    if (h > textureLod(uPeak, w / TILE, 0.0).r * gFar) return -max(s, 250.0);
    if (h <= -40.0) return -max(s, min(250.0, (-40.0 - h) / max(gDir.y, 0.02)));
    return -s;
  }
  #endif
  // the height field's normal against the light
  gNdl = (uLight.y - dot(gGrad, uLight.xz)) * cs;
  vec3 q;
  float d = shape(w, h, top, lat, cs, q);
  if (d > -80.0) d = fine(d, q, top);
  return d > 0.0 ? d : -s;
}
float root(float y, float dy){ return (-dy + sqrt(dy * dy + 4.0 * CURV * y)) / (2.0 * CURV); }
void main(){
  vec2 s2 = (vUv * 2.0 - 1.0) / ${CLOUD.domeS.toFixed(3)};
  float r2 = dot(s2, s2);
  if (r2 >= 1.0) { gl_FragColor = vec4(0.0); return; }
  gDir = vec3(2.0 * s2.x, 1.0 - r2, 2.0 * s2.y) / (1.0 + r2);
  float yb = BASE - 60.0 - uCam.y, yt = BASE + HMAX - uCam.y;
  float t = yb > 0.0 ? root(yb, gDir.y) : 0.0;
  float tEnd = min(root(yt, gDir.y), TMAX);
  float T = 1.0, tClear = t;
  vec3 acc = vec3(0.0);
  bool clear = true;
  for (int i = 0; i < STEPS; i++) {
    if (t >= tEnd || T < 0.02) break;
    gFar = 1.0 + 0.25 * smoothstep(6000.0, 17000.0, t);
    float s = 12.0 + t * 0.006;
    vec2 w; float h;
    float d = field(t, s, w, h);
    float ndl = gNdl, fold = gFold, wisp = gWisp;
    if (d <= 0.0) { clear = true; tClear = t; t -= d; continue; }
    if (clear) {
      // first sample inside: find where the ray crossed the surface
      float lo = tClear, hi = t;
      for (int k = 0; k < 4; k++) {
        float tm = 0.5 * (lo + hi);
        vec2 w2; float h2;
        if (field(tm, s, w2, h2) > 0.0) hi = tm; else lo = tm;
      }
      clear = false;
      if (hi < t - 1.0) { t = hi + s * 0.3; continue; }
    }
    // the skin: crisp along most of the outline, drawn out into soft wisps here and there
    float dn = smoothstep(0.0, mix(26.0, 130.0, smoothstep(0.5, 0.68, wisp)) + t * 0.005, d);
    // sunlight reaching this point through the cloud above it
    float tau = 0.0, ls = 26.0, dist = 0.0;
    for (int j = 0; j < 5; j++) {
      dist += ls;
      vec2 lw = w + uLight.xz * dist;
      float lh = h + uLight.y * dist, ltop, llat, lcs; vec3 q2;
      lay(lw, ltop, llat, lcs);
      #ifdef DECK
      llat = max(llat, 1.0); ltop = max(ltop, 430.0);
      #endif
      if (llat > 0.0 && lh < ltop && lh > -40.0) tau += smoothstep(0.0, 70.0, shape(lw, lh, ltop, llat, lcs, q2)) * ls;
      ls *= 1.7;
    }
    // Beer's law with a slow second lobe for light scattered many times; sides turned from
    // the sun fall into shade, as do the folds between billows
    float E = max(exp(-tau * 0.011), 0.5 * exp(-tau * 0.0024));
    E *= mix(0.35, 1.0, smoothstep(-0.3, 0.5, ndl)) * mix(0.72, 1.0, smoothstep(0.3, 0.62, fold));
    float a = 1.0 - exp(-dn * 0.055 * s);
    acc += T * a * vec3(E, clamp(h / 450.0, 0.0, 1.0), t / TMAX);
    T *= 1.0 - a;
    t += s;
  }
  gl_FragColor = vec4(acc, 1.0 - T);
}`;

const _cam = new THREE.Camera();
const snap = () => ({ cam: new THREE.Vector3(), wind: new THREE.Vector3(), light: new THREE.Vector3(0, 1, 0), deck: 0 });

export class Clouds {
  constructor() {
    this.ready = false;
    this.wind = new THREE.Vector3(); // xy: drift in metres, z: how far the billows have risen
    this.cover = 0.4;
    this.deck = 0;
    this.light = new THREE.Vector3(0, 1, 0);
    // what the sky shader needs to read the finished map
    this.uni = {
      uCloudMap: { value: null }, uSnapCam: { value: new THREE.Vector3() }, uDrift: { value: new THREE.Vector2() },
      uCloudLayout: { value: null }, uCloudWind: { value: new THREE.Vector3() },
    };
    this.phase = 0;
    this.front = snap(); this.back = snap();
    this.force = true;
  }

  init(renderer) {
    this.noise = bakeNoise(renderer);
    const data = heaps();
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const ib = new THREE.InstancedInterleavedBuffer(data, 6);
    geo.setAttribute('aS', new THREE.InterleavedBufferAttribute(ib, 4, 0));
    geo.setAttribute('aK', new THREE.InterleavedBufferAttribute(ib, 2, 4));
    geo.instanceCount = data.length / 6;
    this.layMat = new THREE.ShaderMaterial({
      uniforms: { uCover: { value: -1 }, uMode: { value: 0 } }, vertexShader: LAY_VS, fragmentShader: LAY_FS,
      depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    const mesh = new THREE.Mesh(geo, this.layMat);
    mesh.frustumCulled = false;
    this.layScene = new THREE.Scene(); this.layScene.add(mesh);
    const lrt = (n) => {
      const rt = new THREE.WebGLRenderTarget(n, n, { type: THREE.HalfFloatType, depthBuffer: false });
      const t = rt.texture;
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
      return rt;
    };
    this.rawRT = lrt(LAY); this.shapedRT = lrt(LAY); this.layRT = lrt(LAY); this.peakRT = lrt(PEAK);
    this.peakRT.texture.minFilter = this.peakRT.texture.magFilter = THREE.NearestFilter;
    const pass = (fs, uniforms) => new FullScreenQuad(new THREE.ShaderMaterial({ uniforms, vertexShader: FS_VS, fragmentShader: fs, depthTest: false, depthWrite: false, toneMapped: false }));
    this.shapePass = pass(SHAPE_FS, { uSrc: { value: this.rawRT.texture }, uN3: { value: this.noise } });
    this.slopePass = pass(SLOPE_FS, { uSrc: { value: this.shapedRT.texture } });
    this.march = new THREE.ShaderMaterial({
      uniforms: {
        uLay: { value: this.layRT.texture }, uPeak: { value: this.peakRT.texture }, uN3: { value: this.noise },
        uCam: { value: new THREE.Vector3() }, uLight: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector3() },
        uDeck: { value: 0 },
      },
      defines: { STEPS: 96 },
      vertexShader: FS_VS, fragmentShader: MARCH_FS, depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.march);
    this.ready = true;
    this.applyQuality();
  }

  applyQuality() {
    if (!this.ready) return;
    const [size, bands, steps] = tier().clouds;
    this.bands = bands;
    if (this.march.defines.STEPS !== steps) { this.march.defines.STEPS = steps; this.march.needsUpdate = true; }
    if (this.rtA && this.rtA.width === size) return;
    const mk = () => {
      const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, depthBuffer: false });
      rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter; rt.texture.generateMipmaps = false;
      return rt;
    };
    if (this.rtA) { this.rtA.dispose(); this.rtB.dispose(); }
    this.rtA = mk(); this.rtB = mk();
    this.phase = 0; this.force = true;
  }

  drawLayout(renderer, cover) {
    const u = this.layMat.uniforms;
    u.uCover.value = cover;
    const pc = renderer.getClearColor(this._cc || (this._cc = new THREE.Color())), pa = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    const splat = (rt, mode) => {
      u.uMode.value = mode;
      renderer.setRenderTarget(rt); renderer.clear(true, false, false);
      renderer.render(this.layScene, _cam);
    };
    splat(this.rawRT, 0);
    splat(this.peakRT, 1);
    renderer.setRenderTarget(this.shapedRT); this.shapePass.render(renderer);
    renderer.setRenderTarget(this.layRT); this.slopePass.render(renderer);
    renderer.setClearColor(pc, pa);
  }

  // Draw the next band of the dome map (all of it when the view has jumped).
  render(renderer, camPos) {
    const drift = G.wind?.cloudOffset;
    if (drift) { this.wind.x = drift.x; this.wind.y = drift.y; }
    if (!this.ready) this.init(renderer);
    const prev = renderer.getRenderTarget();
    const b = this.back, f = this.front;
    // a jump in place, light or cover would show as the map catching up: redraw at once
    if (camPos.distanceToSquared(f.cam) > 250 * 250 || this.light.dot(f.light) < 0.995 || Math.abs(this.deck - f.deck) > 0.2) this.force = true;
    if (this.force) this.phase = 0;
    if (this.phase === 0) {
      b.cam.copy(camPos); b.wind.copy(this.wind); b.light.copy(this.light); b.deck = this.deck;
      if (Math.abs(this.cover - this.layMat.uniforms.uCover.value) > 0.008) this.drawLayout(renderer, this.cover);
      const u = this.march.uniforms;
      u.uCam.value.copy(b.cam); u.uWind.value.copy(b.wind); u.uLight.value.copy(b.light); u.uDeck.value = b.deck;
      const deck = b.deck > 0.001;
      if (!!this.march.defines.DECK !== deck) { if (deck) this.march.defines.DECK = 1; else delete this.march.defines.DECK; this.march.needsUpdate = true; }
    }
    const rt = this.rtB, n = this.bands, H = rt.height;
    const from = this.force ? 0 : this.phase, to = this.force ? n : this.phase + 1;
    const y0 = Math.floor((from / n) * H), y1 = Math.floor((to / n) * H);
    rt.scissorTest = true; rt.scissor.set(0, y0, rt.width, y1 - y0);
    renderer.setRenderTarget(rt);
    this.quad.render(renderer);
    this.phase = to;
    if (this.phase >= n) {
      // finished: show it
      this.rtB = this.rtA; this.rtA = rt;
      this.back = f; this.front = b;
      this.uni.uCloudMap.value = rt.texture;
      this.uni.uSnapCam.value.copy(b.cam);
      this.phase = 0; this.force = false;
    }
    const wr = (v) => ((v + 120000) % 80000) - 40000; // the wind wraps at 80 km
    this.uni.uDrift.value.set(wr(this.wind.x - this.front.wind.x), wr(this.wind.y - this.front.wind.y));
    this.uni.uCloudLayout.value = this.layRT.texture;
    this.uni.uCloudWind.value.copy(this.wind);
    renderer.setRenderTarget(prev);
  }
}
