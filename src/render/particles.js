// Pooled particle system rendered as point sprites with procedural shapes.
// shape: 0 glow, 1 hot spark, 2 shard/diamond, 3 smoke puff, 4 star, 5 ring, 6 streak,
//        7 flame tongue, 8 dissolving wisp (smoke that breaks up as it ages),
//        9 droplet (specular water drop), 10 snowflake, 11 leaf, 12 rune glyph,
//        13 electric spark (jagged, flickering), 14 bubble, 15 glint (hairline cross flare),
//        16 shock ring (thins with age), 17 hit spark (spiked burst), 18 surface flame, 19 fire impact, 20 trailing flame, 21 ignition flash,
//        22 soot, 23 airborne cinder
// Sprites can rotate (rot/spin) and stretch along their screen-space velocity
// (sparks, streaks and droplets do by default). Colour runs through up to three
// keys (color → color2 at `mid` → color1) and size follows an ease curve.
// Alpha softens where a sprite meets the terrain (heightmap) and right in front
// of the camera.
import * as THREE from 'three';
import { COMBUSTION_GLSL } from './flame.js';
import { windUniforms } from '../world/wind.js';
import { U } from './materials.js';

// Eight independently filtered stamps. RG stores a puff's tangent normal, B the
// painted highlight / relief, A coverage. Array layers keep the mip chains apart.
let stamps;
function particleStamps() {
  if (stamps) return stamps;
  const size = 64, layers = 8;
  const data = new Uint8Array(size * size * layers * 4);
  const sat = (v) => Math.max(0, Math.min(1, v));
  const puffs = [
    [[-0.31, 0.16, 0.51], [0.20, 0.18, 0.59], [-0.10, -0.28, 0.55], [0.44, -0.19, 0.32]],
    [[-0.28, -0.05, 0.54], [0.22, -0.26, 0.49], [0.27, 0.22, 0.50], [-0.36, 0.37, 0.30]],
  ];
  for (let layer = 0; layer < layers; layer++) {
    const variant = layer % 2;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const x = (i + 0.5) * 2 / size - 1, y = (j + 0.5) * 2 / size - 1;
      let nx = 0, ny = 0, relief = 0, alpha = 0;
      if (layer < 2) {
        // A rolled bank of lobes. Blend their normals in the overlap to keep
        // the shared ridge from turning into a stepped seam on a large puff.
        let weight = 0;
        for (const [cx, cy, r] of puffs[variant]) {
          const dx = (x - cx) / r, dy = (y - cy) / r;
          const dome = 1 - dx * dx - dy * dy;
          alpha = Math.max(alpha, sat(dome * 2.4));
          const height = r * Math.sqrt(Math.max(0, dome));
          const w = height ** 7;
          weight += w; nx += dx * w; ny += dy * w;
          relief = Math.max(relief, height);
        }
        if (weight > 0) { nx /= weight; ny /= weight; }
        relief *= 1.6;
      } else if (layer < 4) {
        // A folded cinder, wide at its leading edge with a swept, tapering tail.
        const t = sat((y + 0.85) / 1.7);
        const axis = (variant ? -0.27 : 0.18) * (1 - t) ** 2;
        const width = Math.min(t * (variant ? 0.52 : 0.68), (1 - t) * 1.25);
        alpha = sat((width - Math.abs(x - axis)) * 19);
        relief = sat(1 - Math.abs(x - axis - width * 0.28) / (0.025 + width * 0.31)) * t;
      } else if (layer < 6) {
        // Slender willow and broad oval leaf, each divided by a bent midrib.
        const t = sat((y + 0.9) / 1.8), arch = Math.sin(t * Math.PI);
        const axis = (variant ? 0.19 : -0.22) * arch;
        const dx = x - axis, width = (variant ? 0.42 : 0.27) * arch * (1.28 - 0.6 * t);
        alpha = sat((width - Math.abs(dx)) * 22);
        relief = 0.27 + 0.44 * sat(0.5 + dx * 16) + 0.22 * sat(1 - Math.abs(dx) * 40);
      } else {
        // Fold six radial sectors onto one stem. Branchlets grow from the stem,
        // leaving six open wedges even when the flake is only a few pixels wide.
        const angle = Math.abs(((Math.atan2(y, x) + Math.PI * 13 / 6) % (Math.PI / 3)) - Math.PI / 6);
        const r = Math.hypot(x, y), along = r * Math.cos(angle), across = r * Math.sin(angle);
        const stem = Math.max(across - 0.042, along - 0.86);
        const twig = Math.max(Math.abs(along - 0.34 - across) - 0.049, across - 0.20);
        const tip = Math.max(Math.abs(along - 0.59 - across) - 0.037, across - 0.13);
        alpha = sat(0.5 - Math.min(stem, twig, variant ? tip : 1) * 25);
        relief = sat(1 - r);
      }
      const k = ((layer * size + j) * size + i) * 4;
      data[k] = Math.round((nx * 0.5 + 0.5) * 255); data[k + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[k + 2] = Math.round(sat(relief) * 255); data[k + 3] = Math.round(alpha * 255);
    }
  }
  stamps = new THREE.DataArrayTexture(data, size, size, layers);
  stamps.minFilter = THREE.LinearMipmapLinearFilter; stamps.magFilter = THREE.LinearFilter;
  stamps.generateMipmaps = true; stamps.needsUpdate = true;
  return stamps;
}

const VS = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
attribute float aShape;
attribute vec3 aVel;
attribute vec2 aRot;  // x: angle (rad), y: stretch amount (0 = none)
attribute vec2 aMisc; // x: seed 0..1, y: normalized age 0..1
uniform float uScale;
uniform float uFogDensity;
uniform vec2 uViewport;
uniform sampler2D uHeightTex;
uniform vec4 uHeightP;
uniform float uAdditive;
varying vec4 vColor;
varying float vShape;
varying float vFog;
varying float vDist;
varying vec2 vDir;
varying float vStretch;
varying vec2 vMisc;
varying vec3 vGround;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec4 clip = projectionMatrix * mv;
  gl_Position = clip;
  float size = min(aSize * uScale / max(-mv.z, 0.2), 900.0);
  // orientation: explicit angle, or along the projected velocity when stretching
  float ang = aRot.x;
  float stretch = 1.0;
  if (aRot.y > 0.0) {
    vec4 c1 = projectionMatrix * (modelViewMatrix * vec4(position + aVel * 0.05, 1.0));
    vec2 d = (c1.xy / c1.w - clip.xy / clip.w) * uViewport * 0.5;
    float len = length(d);
    if (len > 0.01) {
      ang = atan(-d.y, d.x) - 1.5707963;
      stretch = 1.0 + clamp(len * 0.6 * aRot.y / max(size, 1.0), 0.0, 4.0);
    }
  }
  gl_PointSize = min(size * stretch, 1024.0);
  vDir = vec2(cos(ang), sin(ang));
  vStretch = stretch;
  vColor = aColor; vShape = aShape; vMisc = aMisc;
  float dd = -mv.z;
  vDist = dd;
  vFog = 1.0 - exp(-uFogDensity * uFogDensity * dd * dd);
  // soften sprites that sink into the ground
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 groundUV = (wp.xz + uHeightP.x) * uHeightP.y + uHeightP.z;
  float gh = texture2D(uHeightTex, groundUV).r;
  float above = wp.y - gh;
  vGround = vec3(2.0, 0.0, 0.0);
  bool puff = abs(aShape - 3.0) < 0.5 || abs(aShape - 8.0) < 0.5;
  bool flame = abs(aShape - 7.0) < 0.5 || (aShape > 17.5 && aShape < 21.5);
  if ((puff || flame) && above < aSize * 1.5) {
    // Project the local heightfield tangent across the billboard. Only large
    // contact puffs pay the extra two vertex reads; all fragments share them.
    float cell = 1.0 / float(textureSize(uHeightTex, 0).x);
    vec2 delta = vec2(texture2D(uHeightTex, groundUV + vec2(cell, 0.0)).r,
                      texture2D(uHeightTex, groundUV + vec2(0.0, cell)).r) - gh;
    vec2 slope = delta * (uHeightP.y / cell);
    vec3 normalV = mat3(viewMatrix) * vec3(-slope.x, 1.0, -slope.y);
    vGround = vec3(above / max(aSize, 0.01), normalV.x * 0.5, -normalV.y * 0.5);
  }
  if (aShape < 20.5) vColor.a *= mix(0.4, 1.0, smoothstep(-aSize * 0.2, aSize * 0.3, above));
  // tiny sprites (sub-pixel) would shimmer; fade them instead
  vColor.a *= smoothstep(0.6, 2.0, size);
  // a sprite that would come out invisible (sub-pixel, or faded right in front of the lens,
  // the same fade the fragment shader applies) is dropped here instead of being shaded
  float nearK = uAdditive > 0.5 ? smoothstep(0.3, 2.0, dd) : smoothstep(0.2, 1.2, dd);
  if (vColor.a * nearK < 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; }
}`;

const FS = /* glsl */ `
uniform vec3 uFogColor;
uniform float uAdditive;
uniform float uOcc;
uniform float uTime;
uniform sampler2D uNoise;
uniform highp sampler2DArray uStamps;
uniform vec3 uSun;
uniform float uLightK;
varying vec4 vColor;
varying float vShape;
varying float vFog;
varying float vDist;
varying vec2 vDir;
varying float vStretch;
varying vec2 vMisc;
varying vec3 vGround;
${COMBUSTION_GLSL}
uniform vec4 uWindFlow;
float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// value noise, one lattice cell per unit: the shared noise texture's A channel is the same
// smoothstep-interpolated value noise with 32 cells per tile, so one fetch replaces four hashes
float vn(vec2 p){ return textureLod(uNoise, p * (1.0 / 32.0), 0.0).a; }
void main(){
  vec2 p0 = gl_PointCoord * 2.0 - 1.0;
  // rotate into the particle frame; x across, y along the motion/orientation
  vec2 p = vec2(p0.x * vDir.x + p0.y * vDir.y, -p0.x * vDir.y + p0.y * vDir.x);
  p.x *= vStretch;
  float d = length(p);
  float seed = vMisc.x, age = vMisc.y;
  float a;
  vec3 ink = vColor.rgb;
  vec3 tint = vec3(1.0);
  float variant = step(0.5, seed);
  vec2 stampUV = clamp(p * 0.5 + 0.5, 0.0, 1.0);
  if (vShape < 0.5) {
    float core = 1.0 - smoothstep(0.04, 0.34, abs(p.x) + abs(p.y) * 0.8);
    a = core + 0.24 * pow(max(1.0 - d, 0.0), 2.0);
  }
  else if (vShape < 1.5) {
    // hot spark: bright core, tapered tail
    vec4 ink = texture(uStamps, vec3(stampUV, 2.0 + variant));
    a = ink.a * (0.65 + 0.65 * ink.b);
    tint = mix(vec3(0.85, 0.68, 0.53), vec3(1.18), ink.b);
  }
  else if (vShape < 2.5) {
    float q = abs(p.x) * 1.8 + abs(p.y) * 0.9;
    a = smoothstep(1.0, 0.8, q);
    a *= 0.75 + 0.35 * step(0.0, p.x * 0.6 + p.y * 0.3); // two-tone facet
    a += smoothstep(0.28, 0.0, q) * 0.8;
  }
  else if (vShape < 3.5 || abs(vShape - 8.0) < 0.5) {
    vec4 puff = texture(uStamps, vec3(stampUV, variant));
    vec2 n = puff.rg * 2.0 - 1.0;
    // Undo sprite rotation and the downward point UV axis before lighting.
    vec2 screenN = vec2(dot(n, vec2(vDir.x, -vDir.y)), -dot(n, vDir.yx));
    vec3 normalV = vec3(screenN, sqrt(max(0.0, 1.0 - dot(n,n))));
    float key = smoothstep(-0.24, 0.54, dot(normalV, mat3(viewMatrix) * uSun));
    tint = mix(vec3(0.54, 0.63, 0.77), vec3(1.15, 1.09, 0.98), key);
    tint *= mix(1.0, 0.54, smoothstep(0.45, 1.0, uLightK));
    float grain = vn(p * 2.9 + vec2(seed * 11.0, -uTime * 0.28));
    a = puff.a * smoothstep(age * age * 0.92 - 0.20, age * age * 0.92 + 0.14, puff.b * 0.60 + grain * 0.40);
    a *= smoothstep(-0.02, 0.22, vGround.x + dot(p0, vGround.yz));
  }
  else if (vShape < 4.5) {
    float cx = smoothstep(0.14, 0.0, abs(p.x)) * smoothstep(1.0, 0.0, abs(p.y));
    float cy = smoothstep(0.14, 0.0, abs(p.y)) * smoothstep(1.0, 0.0, abs(p.x));
    a = max(cx, cy) + pow(max(1.0 - d, 0.0), 4.0);
  }
  else if (vShape < 5.5) { a = smoothstep(0.2, 0.0, abs(d - 0.72)); }
  else if (vShape < 6.5) { a = smoothstep(0.3, 0.0, abs(p.x)) * smoothstep(1.0, 0.15, abs(p.y)) * mix(1.0, 0.5, smoothstep(0.2, -1.0, p.y)); }
  else if (vShape < 7.5 || abs(vShape - 18.0) < 0.5) {
    vec2 uv = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y);
    float wind = dot(uWindFlow.xy, vec2(viewMatrix[0].x, viewMatrix[2].x));
    vec4 fire = combustion(uv, seed, age, uTime, wind * 0.28);
    a = fire.a * smoothstep(-0.015, 0.12, vGround.x + dot(p0, vGround.yz));
    ink = fire.rgb;
  }
  else if (vShape < 9.5) {
    // A round leading bead trails a drawn-out neck along the projected motion.
    vec2 bead = vec2(p.x / mix(0.30, 0.73, smoothstep(-0.9, 0.35, p.y)), (p.y - 0.05) * 1.1);
    float radius = length(bead);
    float body = 1.0 - smoothstep(0.88, 1.0, radius);
    float rim = smoothstep(0.62, 0.94, radius);
    float spec = 1.0 - smoothstep(0.10, 0.27, length((bead - vec2(-0.26, 0.24)) * vec2(1.0, 0.58)));
    a = body * (0.46 + 0.44 * rim + 0.64 * spec);
    tint = mix(vec3(0.32, 0.55, 0.79), vec3(0.94, 1.02, 1.1), rim) + vec3(1.35) * spec;
  }
  else if (vShape < 10.5) {
    vec4 ink = texture(uStamps, vec3(stampUV, 6.0 + variant));
    a = ink.a; tint = mix(vec3(0.74, 0.87, 1.0), vec3(1.12), ink.b);
  }
  else if (vShape < 11.5) {
    vec4 ink = texture(uStamps, vec3(stampUV, 4.0 + variant));
    a = ink.a; tint = mix(vec3(0.54, 0.64, 0.51), vec3(1.32, 1.18, 0.86), ink.b);
  }
  else if (vShape < 12.5) {
    // rune glyph: ring + seeded strokes
    float ring = smoothstep(0.07, 0.0, abs(d - 0.78));
    float s1 = smoothstep(0.08, 0.0, abs(p.x + (seed - 0.5) * 0.6)) * step(abs(p.y), 0.62);
    float a2 = seed * 6.283;
    vec2 r2 = vec2(p.x * cos(a2) - p.y * sin(a2), p.x * sin(a2) + p.y * cos(a2));
    float s2 = smoothstep(0.08, 0.0, abs(r2.y - 0.18)) * step(abs(r2.x), 0.5);
    float dot1 = smoothstep(0.14, 0.05, length(p - vec2(0.3 * cos(a2 * 1.7), 0.3 * sin(a2 * 1.7))));
    a = max(max(ring * 0.8, s1), max(s2, dot1)) + pow(max(1.0 - d, 0.0), 3.0) * 0.35;
  }
  else if (vShape < 13.5) {
    // electric spark: jagged four-point burst that flickers on and off
    float ang = atan(p.y, p.x) + seed * 6.28;
    float spikes = pow(abs(cos(ang * 2.0 + vn(vec2(ang * 3.0, uTime * 30.0 + seed * 50.0)) * 1.2)), 18.0);
    a = smoothstep(1.0, 0.0, d) * spikes * 1.4 + smoothstep(0.25, 0.0, d);
    a *= step(0.28, h21(vec2(floor(uTime * 28.0), seed * 97.0)));
  }
  else if (vShape < 14.5) {
    // bubble: thin rim, bright highlight, faint body
    float rim = smoothstep(0.14, 0.0, abs(d - 0.84));
    float spec = smoothstep(0.2, 0.0, length(p0 - vec2(-0.35, -0.38)));
    a = rim * 0.85 + spec + smoothstep(1.0, 0.0, d) * 0.08;
    a *= step(d, 1.0);
  }
  else if (vShape < 15.5) {
    // glint: long hairline across, a shorter one along, pin-point core (a flash with almost no area)
    float sx = smoothstep(0.045, 0.0, abs(p.y)) * pow(max(1.0 - abs(p.x), 0.0), 1.5);
    float sy = smoothstep(0.035, 0.0, abs(p.x)) * pow(max(1.0 - abs(p.y) * 2.4, 0.0), 1.5);
    a = sx + sy * 0.8 + smoothstep(0.13, 0.0, d);
  }
  else if (vShape < 16.5) {
    // shock ring: a crisp band that thins and breaks up as it ages (grow it with size)
    float w = mix(0.11, 0.02, age);
    float n = vn(vec2(atan(p.y, p.x) * 2.6, seed * 23.0));
    a = smoothstep(w, w * 0.3, abs(d - (1.0 - w))) * smoothstep(age * 1.1 - 0.35, age * 1.1 + 0.05, n + 0.1);
  }
  else if (vShape < 17.5) {
    // hit spark: seven hard spikes of uneven length, hollowing out from the middle with age
    float t = atan(p.y, p.x) * (7.0 / 6.2831853) + seed * 7.0;
    float f = abs(fract(t) - 0.5);
    float len = 0.42 + 0.58 * h21(vec2(mod(floor(t), 7.0), floor(seed * 64.0)));
    float w = 0.2 * max(1.0 - d / len, 0.0);
    a = smoothstep(w, w * 0.45, f) * step(d, len) * smoothstep(age * 0.85 - 0.2, age * 0.85, d);
    a += smoothstep(0.2, 0.0, d) * (1.0 - age);
  }
  else if (vShape > 22.5) {
    // Raised cinders have a compact warm head and just a hint of velocity stretch.
    a = 1.0 - smoothstep(0.16, 0.89, d);
    ink = mix(vec3(1.59, 0.38, 0.014), vec3(3.50, 2.10, 0.26), (1.0 - age) * (1.0 - d * 0.55));
  }
  else if (vShape > 21.5) {
    vec4 mist = pyroVolume(stampUV, age * 0.83 + seed * 0.15, 1.0);
    a = mist.a * (0.46 + 0.54 * mist.b) * (1.0 - smoothstep(0.61, 1.0, age));
    ink = mix(vec3(0.058, 0.044, 0.039), vec3(0.16, 0.145, 0.14), age + mist.b * 0.17);
  }

  else if (vShape > 20.5) {
    vec4 field = pyroVolume(stampUV, age * 0.70, 1.0);
    float centre = 1.0 - smoothstep(0.025, 0.32, d);
    float veins = vn(stampUV * 31.0 + seed * 41.0 + vec2(0.0, -age * 2.6));
    a = field.a * centre * (0.04 + 0.96 * smoothstep(0.54, 0.78, veins));
    ink = mix(vec3(2.0, 0.49, 0.012), vec3(6.2, 5.45, 1.91), smoothstep(0.58, 0.83, veins));
  }
  else {
    float phase = vShape > 19.5 ? age * 0.78 + seed * 0.17 : age;
    float grain = vn(stampUV * 29.0 + vec2(seed * 41.0, -age * 2.4));
    vec4 cloud = impactGas(pyroVolume(stampUV, phase, 1.0), smoothstep(0.06, 0.77, p0.y), age, grain);
    a = cloud.a;
    ink = cloud.rgb;
  }
  if (vShape > 18.5 && vShape < 21.5) a *= smoothstep(-0.01, 0.13, vGround.x + dot(p0, vGround.yz));
  if (a < 0.004) discard;
  float al = vColor.a * a;
  if (uAdditive > 0.5) {
    al *= smoothstep(0.3, 2.0, vDist);
    // The contact flash has calibrated radiance at noon and dusk; the pool's
    // premultiplied blend becomes purely additive with zero coverage.
    if (abs(vShape - 21.0) < 0.5) {
      gl_FragColor = vec4(ink * al * (1.0 - vFog), 0.0);
      return;
    }
    // "additive-over": premultiplied colour plus a little coverage, so glowing sprites
    // also dim what's behind them and keep their hue over bright sky / snow
    ink *= tint;
    float lum = dot(ink, vec3(0.2126, 0.7152, 0.0722));
    vec3 body = ink * min(1.0, 1.0 / max(lum, 0.001));
    vec3 radiance = mix(body, ink, smoothstep(0.68, 1.0, a) * clamp(uLightK, 0.0, 1.0));
    gl_FragColor = vec4(radiance * (1.0 - vFog * 0.9) * al, min(al, 1.0) * uOcc);
  } else {
    al *= smoothstep(0.2, 1.2, vDist);
    gl_FragColor = vec4(mix(ink * tint, uFogColor, vFog), min(al, 1.0));
  }
}`;

export class Particles {
  constructor(scene, max = 6000, additive = true) {
    this.max = max; this.count = 0;
    this.anchors = []; // optional animated world origins for attached surface flames
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.ease = new Float32Array(max);
    this.c0 = new Float32Array(max * 4); this.c1 = new Float32Array(max * 4); this.c2 = new Float32Array(max * 4);
    this.mid = new Float32Array(max);
    this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    this.shape = new Float32Array(max);
    this.turb = new Float32Array(max);
    this.fadeIn = new Float32Array(max);
    this.rot = new Float32Array(max); this.spin = new Float32Array(max); this.stretch = new Float32Array(max);
    this.seed = new Float32Array(max);

    const g = (this.geo = new THREE.BufferGeometry());
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aShape = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.BufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.aMisc = new THREE.BufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aColor', this.aColor);
    g.setAttribute('aShape', this.aShape);
    g.setAttribute('aVel', this.aVel);
    g.setAttribute('aRot', this.aRot);
    g.setAttribute('aMisc', this.aMisc);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS,
      uniforms: {
        uScale: { value: 400 },
        uFogDensity: { value: 0.004 },
        uFogColor: { value: new THREE.Color() },
        uAdditive: { value: additive ? 1 : 0 },
        uOcc: { value: 0.3 },
        uViewport: { value: new THREE.Vector2(1280, 720) },
        uHeightTex: U.heightTex,
        uHeightP: U.heightP,
        uTime: U.time, uWindFlow: windUniforms.uWindFlow,
        uNoise: U.noise, uFireVolume: U.fireVolume,
        uStamps: { value: particleStamps() }, uSun: U.sunDir, uLightK: { value: 0.45 },
      },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 10 : 9;
    scene.add(this.points);
  }

  /**
   * o: { p:[x,y,z] | Vector3, v:[x,y,z], life, size, size1, ease (size curve exponent, <1 grows fast),
   *      color:Color, color1 (end), color2 (optional middle key at `mid`, default 0.35), alpha, alpha1, alpha2,
   *      drag, grav, shape, turb, fadeIn, rot (initial angle, rad), spin (rad/s),
   *      stretch (velocity stretch amount; sparks/streaks/droplets default on), seed }
   */
  emit(o) {
    if (this.count >= this.max) return;
    const i = this.count++;
    const i3 = i * 3, i4 = i * 4;
    const p = o.p;
    this.anchors[i] = o.anchor;
    this.pos[i3] = p.x ?? p[0]; this.pos[i3 + 1] = p.y ?? p[1]; this.pos[i3 + 2] = p.z ?? p[2];
    const v = o.v || [0, 0, 0];
    this.vel[i3] = v.x ?? v[0]; this.vel[i3 + 1] = v.y ?? v[1]; this.vel[i3 + 2] = v.z ?? v[2];
    this.life[i] = this.maxLife[i] = o.life ?? 1;
    this.s0[i] = o.size ?? 1; this.s1[i] = o.size1 ?? this.s0[i]; this.ease[i] = o.ease ?? 1;
    const c = o.color, c1 = o.color1 ?? c;
    const a0 = o.alpha ?? 1, a1 = o.alpha1 ?? 0;
    this.c0[i4] = c.r; this.c0[i4 + 1] = c.g; this.c0[i4 + 2] = c.b; this.c0[i4 + 3] = a0;
    this.c1[i4] = c1.r; this.c1[i4 + 1] = c1.g; this.c1[i4 + 2] = c1.b; this.c1[i4 + 3] = a1;
    if (o.color2) {
      const c2 = o.color2;
      this.c2[i4] = c2.r; this.c2[i4 + 1] = c2.g; this.c2[i4 + 2] = c2.b; this.c2[i4 + 3] = o.alpha2 ?? (a0 + a1) * 0.5;
      this.mid[i] = Math.min(0.95, Math.max(0.05, o.mid ?? 0.35));
    } else this.mid[i] = 0;
    this.drag[i] = o.drag ?? 0; this.grav[i] = o.grav ?? 0;
    const sh = (this.shape[i] = o.shape ?? 0);
    this.turb[i] = o.turb ?? 0; this.fadeIn[i] = o.fadeIn ?? 0;
    // smoke, wisps, shards, leaves and flakes get a random orientation + spin unless specified
    const tumble = (sh > 1.5 && sh < 3.5) || (sh > 7.5 && sh < 8.5) || (sh > 9.5 && sh < 12.5);
    this.rot[i] = o.rot ?? (tumble ? Math.random() * Math.PI * 2 : 0);
    this.spin[i] = o.spin ?? (tumble ? (Math.random() - 0.5) * (sh < 2.5 || (sh > 9.5 && sh < 11.5) ? 6 : 1.2) : 0);
    this.stretch[i] = o.stretch ?? (sh > 5.5 && sh < 6.5 ? 1 : sh > 0.5 && sh < 1.5 ? 0.6 : sh > 8.5 && sh < 9.5 ? 0.8 : 0);
    this.seed[i] = o.seed ?? Math.random();
  }

  update(dt, time) {
    const P = this.pos, V = this.vel, ap = this.aPos.array, as = this.aSize.array, ac = this.aColor.array, ash = this.aShape.array;
    const av = this.aVel.array, ar = this.aRot.array, am = this.aMisc.array;
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this._kill(i); continue; }
      const i3 = i * 3, i4 = i * 4;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      V[i3] *= dr; V[i3 + 1] = V[i3 + 1] * dr - this.grav[i] * dt; V[i3 + 2] *= dr;
      const tb = this.turb[i];
      if (tb > 0) {
        // cheap divergence-free-ish swirl: curl of a few crossed sines in space and time
        const x = P[i3] * 0.9, y = P[i3 + 1] * 0.9, z = P[i3 + 2] * 0.9, ph = time * 1.7 + this.seed[i] * 6.3;
        const sx = Math.sin(y * 1.3 + ph), sy = Math.sin(z * 1.1 - ph * 0.8), sz = Math.sin(x * 1.2 + ph * 1.3);
        const cx = Math.cos(z * 1.7 + ph * 0.6), cy = Math.cos(x * 1.5 - ph), cz = Math.cos(y * 1.6 + ph * 0.9);
        const k = tb * 0.65 * dt;
        V[i3] += (sx - cz) * k; V[i3 + 1] += (sy - cx) * k * 0.6; V[i3 + 2] += (sz - cy) * k;
      }
      P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const anchor = this.anchors[i];
      ap[i3] = P[i3] + (anchor ? anchor.x : 0);
      ap[i3 + 1] = P[i3 + 1] + (anchor ? anchor.y : 0);
      ap[i3 + 2] = P[i3 + 2] + (anchor ? anchor.z : 0);
      av[i3] = V[i3]; av[i3 + 1] = V[i3 + 1]; av[i3 + 2] = V[i3 + 2];
      this.rot[i] += this.spin[i] * dt;
      ar[i * 2] = this.rot[i]; ar[i * 2 + 1] = this.stretch[i];
      am[i * 2] = this.seed[i]; am[i * 2 + 1] = t;
      const e = this.ease[i];
      as[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * (e === 1 ? t : Math.pow(t, e));
      let fi = 1;
      if (this.fadeIn[i] > 0) fi = Math.min(1, t / this.fadeIn[i]);
      const m = this.mid[i];
      let A, B, k;
      if (m > 0) { if (t < m) { A = this.c0; B = this.c2; k = t / m; } else { A = this.c2; B = this.c1; k = (t - m) / (1 - m); } }
      else { A = this.c0; B = this.c1; k = t; }
      ac[i4] = A[i4] + (B[i4] - A[i4]) * k;
      ac[i4 + 1] = A[i4 + 1] + (B[i4 + 1] - A[i4 + 1]) * k;
      ac[i4 + 2] = A[i4 + 2] + (B[i4 + 2] - A[i4 + 2]) * k;
      ac[i4 + 3] = (A[i4 + 3] + (B[i4 + 3] - A[i4 + 3]) * k) * fi;
      ash[i] = this.shape[i];
      i++;
    }
    this.geo.setDrawRange(0, this.count);
    if (this.count > 0) {
      for (const [a, n] of [[this.aPos, 3], [this.aSize, 1], [this.aColor, 4], [this.aShape, 1], [this.aVel, 3], [this.aRot, 2], [this.aMisc, 2]]) {
        a.needsUpdate = true; a.clearUpdateRanges(); a.addUpdateRange(0, this.count * n);
      }
    }
  }

  _kill(i) {
    const j = --this.count;
    this.anchors[i] = this.anchors[j]; this.anchors[j] = undefined;
    if (i === j) return;
    const cp3 = (a) => { a[i * 3] = a[j * 3]; a[i * 3 + 1] = a[j * 3 + 1]; a[i * 3 + 2] = a[j * 3 + 2]; };
    const cp4 = (a) => { a[i * 4] = a[j * 4]; a[i * 4 + 1] = a[j * 4 + 1]; a[i * 4 + 2] = a[j * 4 + 2]; a[i * 4 + 3] = a[j * 4 + 3]; };
    cp3(this.pos); cp3(this.vel); cp4(this.c0); cp4(this.c1); cp4(this.c2);
    this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j];
    this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j]; this.ease[i] = this.ease[j]; this.mid[i] = this.mid[j];
    this.drag[i] = this.drag[j]; this.grav[i] = this.grav[j];
    this.shape[i] = this.shape[j]; this.turb[i] = this.turb[j]; this.fadeIn[i] = this.fadeIn[j];
    this.rot[i] = this.rot[j]; this.spin[i] = this.spin[j]; this.stretch[i] = this.stretch[j]; this.seed[i] = this.seed[j];
  }

  setScale(h, fov) {
    this.mat.uniforms.uScale.value = h / (2 * Math.tan((fov * Math.PI) / 360));
    // viewport in device pixels (h is the drawing-buffer height)
    const aspect = typeof window !== 'undefined' ? window.innerWidth / Math.max(1, window.innerHeight) : 16 / 9;
    this.mat.uniforms.uViewport.value.set(h * aspect, h);
  }
}
