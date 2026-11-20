// Instanced grass tufts (and wildflower patches) streamed in chunks around
// the camera. The vertex shader grows every blade of every tuft from the tuft's
// hash, so no two tufts share a silhouette. Root → tip gradient, per-blade tint,
// rolling wind waves (bend + sheen), body and spell push-away, sun shadows,
// cloud shadows, distance thinning and fade in the shaders.
import * as THREE from 'three';
import { U, noiseTexture } from '../render/materials.js';
import { clamp, mulberry32, smoothstep } from '../core/util.js';
import { tier } from '../render/quality.js';
import { G } from '../core/context.js';
import { POI } from './layout.js';
import { WIND_GLSL, WIND_CONTACT_GLSL, windUniforms, windContactUniforms } from './wind.js';

const VS = /* glsl */ `
attribute vec3 iOffset;
attribute vec3 iColor;
attribute vec4 iParams; // rot, width scale, height, hash
#ifdef FLOWER
  attribute vec2 aBlade; // y: part (0 stem, 1 petal, 2 centre)
#else
  // The position attribute of grass is not a point: x side of the blade, y distance along it, z blade index.
  attribute vec4 iShape; // root spread (m), blade count + droop, ground slope x / z
#endif
uniform float uTime;
uniform vec3 uCam;
uniform float uFade;
${WIND_GLSL}
${WIND_CONTACT_GLSL}
uniform sampler2D uBurnMap;
uniform vec4 uFireSpill;
uniform vec4 uHeightP;
uniform float uWet;
uniform vec4 uCloud;
uniform vec3 uSunW;
uniform sampler2D uNoiseTex;
varying vec3 vColor;
varying float vH;
varying float vWave;
varying float vCloud;
varying float vFacing;
varying float vHeat;
varying vec2 vBlade;
#include <common>
#include <shadowmap_pars_vertex>
#include <fog_pars_vertex>
void main(){
  float dist = length(iOffset.xz - uCam.xz);
  float thin = smoothstep(uFade * 0.28, uFade * 0.95, dist);
  float keep = 1.0;
  #ifndef FLOWER
    // Distance LOD: shrink each retiring tuft over a band instead of popping it off.
    keep = smoothstep(iParams.w - 0.07, iParams.w, 1.0 - thin * 0.55);
    if (keep < 0.001) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  #endif
  // Shrink tufts smoothly when a steep bank brings their blades through the lens.
  keep *= smoothstep(0.35, 1.25, distance(iOffset + vec3(0.0, iParams.z * 0.5, 0.0), uCam));
  // wildfire: burning blades wither, scorched ones are stubble until they grow back
  vec4 burnS = texture2D(uBurnMap, (iOffset.xz + uHeightP.x) * uHeightP.y + uHeightP.z);
  float burnK = max(burnS.r, burnS.g);
  float lift = 0.0;
  #ifdef FLOWER
    float h = position.y;
    vec3 p = position;
    p.xz *= iParams.y;
    p.y *= iParams.z * (1.0 - burnK * 0.69);
    float c = cos(iParams.x), s = sin(iParams.x);
    p = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
    vBlade = aBlade;
  #else
    float bi = position.z, t = position.y;
    vec4 rb = fract(sin((iParams.w * 113.0 + bi * 7.31 + 0.37) * vec4(12.9898, 78.233, 37.719, 93.989)) * 43758.5453);
    float count = floor(iShape.y), droop = fract(iShape.y);
    // Blades past the seventh are short filler scattered wide of the tuft: underfoot, they close
    // the ground between neighbours. With distance the outer blades go first and the rest widen.
    float filler = step(6.5, bi);
    float alive = step(bi + 0.5, count + 5.0 * filler) * (1.0 - filler * smoothstep(9.0, 16.0, dist));
    alive *= 1.0 - step(3.5, bi) * smoothstep(20.0, 30.0, dist) - step(2.5, bi) * (1.0 - step(3.5, bi)) * smoothstep(46.0, 58.0, dist);
    float ang = iParams.x + bi * 2.39996 + (rb.x - 0.5) * 1.6;
    float rootA = ang + (rb.y - 0.5) * 2.4, faceA = ang + 1.5708 + (rb.w - 0.5) * 1.4;
    vec2 dir = vec2(cos(ang), sin(ang)), face = vec2(cos(faceA), sin(faceA));
    // Flat blades vanish edge-on: turn each most of the way to show the camera its face.
    vec2 across = normalize(vec2(uCam.z - iOffset.z, iOffset.x - uCam.x) + 1e-4);
    vec2 shown = normalize(face + across * (1.5 * (dot(face, across) < 0.0 ? -1.0 : 1.0)));
    vec2 root = vec2(cos(rootA), sin(rootA)) * (iShape.x * sqrt(0.06 + 0.94 * rb.z) * (1.0 + 0.7 * filler) * keep);
    float len = bi < 0.5 ? 0.88 + 0.12 * rb.w : 0.42 + (0.53 - 0.2 * filler) * rb.w;
    float lean = droop * (0.25 + 0.75 * rb.z);
    // The blade arcs outward and gives up height for it, keeping its length.
    float arc = lean * t * (0.25 + 0.75 * t);
    float h = len * t * (1.0 - 0.32 * lean * lean * t);
    float blen = iParams.z * (1.0 - burnK * (0.69 + rb.x * 0.17));
    float profile = t < 0.2 ? 0.86 : t < 0.5 ? 0.92 : t < 0.9 ? 0.58 : 0.0;
    float width = 0.022 * iParams.y * (0.75 + 0.45 * rb.y) * (1.0 + thin * 0.9) * keep * alive * profile;
    vec3 p = vec3(root + dir * (arc * len * blen) + shown * (position.x * width), h * blen).xzy;
    lift = dot(iShape.zw, root);
    vBlade = vec2(rb.x, rb.w);
  #endif
  vec3 wp = iOffset + p;
  float fade = (1.0 - smoothstep(uFade * 0.8, uFade, dist)) * keep;
  // Roll the same front through blades and wildflower stems.
  vec2 wdir = uWindFlow.xy;
  vec2 air = windStrength(iOffset, uTime);
  float flutter = sin(uTime * 4.2 + iOffset.x * 0.9 + iOffset.z * 0.7 + vBlade.x * 6.28);
  vec2 bend = wdir * (0.17 * air.x + 0.82 * air.y) + vec2(-wdir.y, wdir.x) * flutter * 0.11 * air.x;
  bend += windContact(iOffset) * 1.6;
  // Tilt about the root with increasing leverage toward the tip, keeping blade length.
  vec2 slope = bend * h;
  float rise = inversesqrt(1.0 + dot(slope, slope));
  float stem = p.y * fade * rise;
  wp.xz += slope * stem;
  wp.y = iOffset.y + lift + stem;
  vWave = air.y;
  vColor = mix(iColor, vec3(0.055, 0.035, 0.025), burnK * 0.98);
  // Charred stalks stay dark against the light coming through the ash.
  // Broad spill at the advancing front illuminates live grass from its base.
  float edgeHeat = smoothstep(0.03, 0.42, burnS.g) * (1.0 - smoothstep(0.62, 0.98, burnS.g));
  vHeat = edgeHeat * (1.0 - burnS.r) * (0.23 + 0.24 * (1.0 - h));
  vec3 delta = wp - uFireSpill.xyz;
  float fall = 1.0 / (1.0 + dot(delta, delta) * 1.55);
  vHeat += uFireSpill.w * fall * fall * (0.24 + 0.30 * h);
  vColor *= 1.0 - uWet * 0.16;
  vH = h;
  #ifdef FLOWER
    vFacing = 1.0;
  #else
    vFacing = 0.65 + 0.35 * abs(dot(normalize(vec3(-face.y, 0.65, face.x)), uSunW));
  #endif
  vec2 q = iOffset.xz + uSunW.xz * ((160.0 - iOffset.y) / max(uSunW.y, 0.25));
  vCloud = 1.0 - uCloud.w * smoothstep(0.5, 0.64, texture2D(uNoiseTex, (q + uCloud.xy) * uCloud.z).r);
  vec4 worldPosition = vec4(wp, 1.0);
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  vec3 transformedNormal = vec3(0.0, 1.0, 0.0);
  #include <shadowmap_vertex>
  #include <fog_vertex>
}`;

const FS = /* glsl */ `
uniform vec3 uSun;
uniform vec3 uAmb;
uniform vec3 uShadeTint;
varying vec3 vColor;
varying float vH;
varying float vWave;
varying float vCloud;
varying float vFacing;
varying float vHeat;
varying vec2 vBlade;
#include <common>
#include <packing>
#include <shadowmap_pars_fragment>
#include <fog_pars_fragment>
void main(){
  float sh = 1.0;
  #if defined( USE_SHADOWMAP ) && NUM_SUN_LIGHT_SHADOWS > 0
    sh = getSunShadow( sunShadowMap[ 0 ], sunLightShadows[ 0 ], 0 );
  #endif
  float lit = sh * vCloud;
  #ifdef FLOWER
    vec3 stem = vec3(0.1, 0.2, 0.05);
    vec3 base = vBlade.y < 0.5 ? mix(stem * 0.6, stem * 1.3, vH) : mix(vColor, vec3(1.0, 0.78, 0.18), step(1.5, vBlade.y) * 0.9);
    float up = 1.0;
  #else
    float bv = 0.84 + 0.3 * vBlade.x;
    vec3 root = vColor * vec3(0.68, 0.79, 0.82);
    // Some blades are a season ahead: their tips dry toward straw.
    vec3 tip = vColor * mix(vec3(1.12, 1.12, 0.86), vec3(1.26, 1.1, 0.72), smoothstep(0.55, 1.0, vBlade.y)) + vec3(0.015, 0.014, 0.0);
    vec3 base = mix(root, tip, smoothstep(0.0, 1.0, vH)) * bv;
    float up = 0.55 + 0.45 * vH;
  #endif
  vec3 sunL = uSun * mix(uShadeTint, vec3(1.0), lit * up * vFacing);
  vec3 col = base * (uAmb * (0.75 + 0.25 * vH) + sunL);
  // wind sheen: blades bent by a passing wave catch the light
  col += base * uSun * min(vWave, 1.3) * vH * vH * 0.3 * lit;
  // alpha of the scene target = how much screen-space occlusion a pixel takes (Renderer):
  // blades shading each other would only read as dirt
  gl_FragColor = vec4(col + vec3(1.44,0.25,0.012) * vHeat, 0.3);
  #include <fog_fragment>
}`;

// Blade slots of one tuft. The shader places and shapes them; this is only their topology:
// three rows and a tip per blade (5 triangles), then the same blades again without the upper
// row (3 triangles) for chunks too far away to show the curve.
const BLADES = 12, FINE = 15, COARSE = 9;
function tuftGeometry() {
  const pos = [], fine = [], coarse = [];
  for (let b = 0; b < BLADES; b++) {
    const v = b * 7;
    pos.push(-1, 0, b, 1, 0, b, -1, 0.36, b, 1, 0.36, b, -1, 0.7, b, 1, 0.7, b, 0, 1, b);
    fine.push(v, v + 2, v + 1, v + 1, v + 2, v + 3, v + 2, v + 4, v + 3, v + 3, v + 4, v + 5, v + 4, v + 6, v + 5);
    coarse.push(v, v + 2, v + 1, v + 1, v + 2, v + 3, v + 2, v + 6, v + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(fine.concat(coarse));
  return g;
}

// Wildflower: thin stem + five-petal star head (13 triangles).
function flowerGeometry() {
  const pos = [], bl = [], idx = [];
  const w = 0.012;
  pos.push(-w, 0, 0, w, 0, 0, -w * 0.7, 0.5, 0.01, w * 0.7, 0.5, 0.01, 0, 1, 0.02);
  for (let k = 0; k < 5; k++) bl.push(0, 0);
  idx.push(0, 2, 1, 1, 2, 3, 2, 4, 3);
  const c = pos.length / 3;
  pos.push(0, 1.0, 0.02); bl.push(0, 2);
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const r = k % 2 === 0 ? 0.075 : 0.028;
    pos.push(Math.cos(a) * r, 1.0 + (k % 2 === 0 ? 0.03 : 0.0), 0.02 + Math.sin(a) * r);
    bl.push(0, 1);
  }
  for (let k = 0; k < 10; k++) idx.push(c, c + 1 + k, c + 1 + ((k + 1) % 10));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aBlade', new THREE.Float32BufferAttribute(bl, 2));
  g.setIndex(idx);
  return g;
}

const FLOWER_COLORS = [0xf4f0e2, 0xffd445, 0x9d82e6, 0x7fa8f2, 0xf49cc2].map((h) => new THREE.Color(h).multiplyScalar(0.85));

export class Grass {
  constructor(scene, terrain, water) {
    this.scene = scene; this.terrain = terrain;
    // chunks live in one group so the water's mirrored view can leave them out (tufts are
    // sub-pixel at reflection resolution but cost dozens of draws and their vertex load)
    this.group = new THREE.Group();
    this.group.name = 'grass';
    this.group.userData.noBake = true;
    scene.add(this.group);
    if (water) water.skip.push(this.group);
    this.chunk = 16;
    this.radius = 64;
    this.flowerRadius = 30;
    this.chunks = new Map();
    this.base = tuftGeometry();
    this.flowerBase = flowerGeometry();
    this.uni = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog, {
      uCam: { value: new THREE.Vector3() }, uFade: { value: this.radius },
      uSun: { value: new THREE.Color(1, 1, 1) }, uAmb: { value: new THREE.Color(0.5, 0.5, 0.5) },
    }]);
    this.uni.uTime = U.time;
    Object.assign(this.uni, windUniforms, windContactUniforms);
    this.uni.uCloud = U.cloud;
    this.uni.uSunW = U.sunDir;
    this.uni.uShadeTint = U.shadeTint;
    this.uni.uBurnMap = U.burnTex; this.uni.uFireSpill = U.fireSpill;
    this.uni.uHeightP = U.heightP;
    this.uni.uWet = U.wet;
    this.uni.uNoiseTex = { value: noiseTexture() };
    const opts = { uniforms: this.uni, vertexShader: VS, fragmentShader: FS, fog: true, lights: true, side: THREE.DoubleSide };
    this.mat = new THREE.ShaderMaterial(opts);
    this.flowerMat = new THREE.ShaderMaterial({ ...opts, defines: { FLOWER: 1 } });
    this.density = 2.6;
    this.tmpC = new THREE.Color();
  }

  setQuality(q) {
    const T = tier();
    this.radius = T.grassR;
    this.density = T.grassD;
    this.flowerRadius = q === 'low' ? 20 : 30;
    this.uni.uFade.value = this.radius;
    for (const c of this.chunks.values()) this.disposeChunk(c);
    this.chunks.clear();
  }

  disposeChunk(c) {
    if (c.mesh) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); }
    if (c.flowers) { this.group.remove(c.flowers); c.flowers.geometry.dispose(); }
  }

  // Wind burst that flattens grass (used by wind spells / explosions)
  gust(x, z, radius = 5, strength = 1) {
    G.wind?.impact(x, this.terrain.height(x, z), z, radius, strength * 1.65);
  }

  instanced(base, off, col, par, k, cx, cz, cy, mat, shape) {
    const S = this.chunk;
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    Object.assign(geo.attributes, base.attributes);
    geo.setAttribute('iOffset', new THREE.InstancedBufferAttribute(off.subarray(0, k * 3), 3));
    geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(col.subarray(0, k * 3), 3));
    geo.setAttribute('iParams', new THREE.InstancedBufferAttribute(par.subarray(0, k * 4), 4));
    if (shape) geo.setAttribute('iShape', new THREE.InstancedBufferAttribute(shape.subarray(0, k * 4), 4));
    geo.instanceCount = k;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx * S + S / 2, cy, cz * S + S / 2), S * 0.75 + 6);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = true;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false; // world-space instances at the origin
    mesh.userData.noBake = true;
    return mesh;
  }

  build(cx, cz) {
    const T = this.terrain, S = this.chunk;
    const rnd = mulberry32((cx * 73856093) ^ (cz * 19349663));
    // One candidate per cell of a jittered grid: free scatter leaves bald spots next to pile-ups.
    const side = Math.max(1, Math.round(S * Math.sqrt(this.density))), n = side * side;
    const off = new Float32Array(n * 3), col = new Float32Array(n * 3), par = new Float32Array(n * 4), shape = new Float32Array(n * 4);
    const fOff = [], fCol = [], fPar = [];
    let k = 0;
    const c = this.tmpC, surface = { y: 0 };
    // Reuse the world's existing footprints. Query once per streamed chunk, never per
    // frame; the collision grid already contains trees, rocks, walls and buildings.
    const solids = [];
    G.world?.col?.query(cx * S + S / 2, cz * S + S / 2, S * 0.71 + 1, (s) => solids.push(s));
    const paving = U.paveTex.value?.image;
    for (let i = 0; i < n; i++) {
      const x = (cx + (i % side + rnd()) / side) * S, z = (cz + (Math.floor(i / side) + rnd()) / side) * S;
      const g = T.grassAt(x, z, surface);
      if (g < 0.08) continue;
      const y = surface.y;
      const path = T.pathAt(x, z);
      const paved = paving?.width === T.N && paving.data.length === T.N * T.N ? T.sampleGrid(paving.data, x, z) / 255 : 0;
      // Paving and well-trodden paths have a clear open centre. Short little islands
      // at the verge break its edge; they must never become another full-height lawn.
      const verge = 1 - smoothstep(0.12, 0.74, Math.max(path, paved));
      if (verge <= 0) continue;
      let contact = 1;
      for (const s of solids) {
        if (s.h0 > y + 0.35 || s.h1 < y + 0.08) continue;
        let d;
        if (s.type === 'circle') d = Math.hypot(x - s.x, z - s.z) - s.r;
        else {
          const dx = x - s.x, dz = z - s.z;
          const u = Math.abs(dx * s.cos - dz * s.sin) - s.hw;
          const v = Math.abs(dx * s.sin + dz * s.cos) - s.hd;
          d = Math.hypot(Math.max(0, u), Math.max(0, v)) + Math.min(0, Math.max(u, v));
        }
        contact = Math.min(contact, smoothstep(0.06, 0.75, d));
        if (contact === 0) break;
      }
      if (contact === 0) continue;
      const patch = T.noise2(x * 0.19, z * 0.19);
      const clump = smoothstep(-0.45, 0.5, patch);
      const yard = 1 - smoothstep(28, 48, Math.hypot(x - POI.village.x, z - POI.village.z));
      // The roadside keeps its cover and only loses height: sparse tufts there read as bald ground.
      const density = g * (0.8 + 0.2 * clump) * Math.min(1, verge * 2.5) * (0.45 + 0.55 * contact) * (1 - yard * 0.15);
      if (rnd() > density) continue;
      T.colorAt(x, z, c);
      // Quiet colour families across several metres; the tips supply the fine detail.
      const hue = T.noise2(x * 0.05, z * 0.05);
      const v = 0.91 + rnd() * 0.16;
      const warm = Math.max(0, hue) * 0.24, cool = Math.max(0, -hue) * 0.18;
      off[k * 3] = x; off[k * 3 + 1] = y - 0.04; off[k * 3 + 2] = z;
      col[k * 3] = c.r * v * (1.02 + warm);
      col[k * 3 + 1] = c.g * v * (1.04 + warm * 0.4);
      col[k * 3 + 2] = c.b * v * (0.95 + cool * 1.5 - warm * 0.4);
      // Three habits share the ground: the common tuft, tall arching grass that gathers into
      // swaths tens of metres across, and low rosettes that fill in under both.
      const open = verge * contact * (1 - yard);
      const swath = smoothstep(0.1, 0.5, T.noise2(x * 0.031 + 40, z * 0.031 - 17)) * open;
      const habit = rnd();
      let tall = 0.85 + rnd() * 0.4, wide = 1, spread = 0.1 + rnd() * 0.14, droop = 0.25 + rnd() * 0.4, blades = 5 + Math.floor(rnd() * 3);
      if (habit < 0.05 + 0.45 * swath) {
        tall = 1.4 + rnd() * 0.5; wide = 0.86; spread = 0.05 + rnd() * 0.08; droop = 0.5 + rnd() * 0.4; blades = 4 + Math.floor(rnd() * 3);
      } else if (habit > 0.8) {
        tall = 0.5 + rnd() * 0.2; wide = 1.15; spread = 0.18 + rnd() * 0.12; droop = 0.6 + rnd() * 0.35; blades = 7;
      }
      const slopeX = clamp((T.height(x + 0.4, z) - y) / 0.4, -0.9, 0.9), slopeZ = clamp((T.height(x, z + 0.4) - y) / 0.4, -0.9, 0.9);
      par[k * 4] = rnd() * Math.PI * 2;
      par[k * 4 + 1] = (0.9 + rnd() * 0.4) * (0.7 + 0.3 * verge) * wide;
      par[k * 4 + 2] = (0.3 + rnd() * 0.22) * tall * (0.72 + clump * 0.38) * (0.28 + verge * 0.72) * (0.55 + contact * 0.45) * (1 - yard * 0.55);
      par[k * 4 + 3] = rnd();
      shape[k * 4] = spread * (0.5 + 0.5 * verge) * (0.5 + 0.5 * contact);
      shape[k * 4 + 1] = blades + Math.min(droop, 0.98);
      shape[k * 4 + 2] = slopeX; shape[k * 4 + 3] = slopeZ;
      k++;
      // wildflower patches
      const fp = T.noise3(x * 0.04 + 100, z * 0.04 - 30);
      if (g > 0.55 && verge > 0.9 && contact > 0.8 && yard < 0.35 && rnd() < 0.004 + 0.16 * smoothstep(0.3, 0.65, fp)) {
        const pal = T.noise2(x * 0.013 - 50, z * 0.013 + 20) * 0.5 + 0.5;
        const fc = FLOWER_COLORS[Math.min(FLOWER_COLORS.length - 1, Math.floor(pal * FLOWER_COLORS.length + (rnd() - 0.5) * 0.9))] || FLOWER_COLORS[0];
        const fv = 0.9 + rnd() * 0.2;
        fOff.push(x + (rnd() - 0.5) * 0.3, y - 0.02, z + (rnd() - 0.5) * 0.3);
        fCol.push(fc.r * fv, fc.g * fv, fc.b * fv);
        fPar.push(rnd() * Math.PI * 2, 0.8 + rnd() * 0.5, 0.3 + rnd() * 0.22, rnd());
      }
    }
    if (k === 0) return null;
    const cy = T.height(cx * S + S / 2, cz * S + S / 2);
    const mesh = this.instanced(this.base, off, col, par, k, cx, cz, cy, this.mat, shape);
    let flowers = null;
    if (fOff.length) {
      const fk = fOff.length / 3;
      flowers = this.instanced(this.flowerBase, new Float32Array(fOff), new Float32Array(fCol), new Float32Array(fPar), fk, cx, cz, cy, this.flowerMat);
    }
    return { mesh, flowers };
  }

  update(_dt, camPos, _playerPos, sky) {
    this.uni.uCam.value.copy(camPos);
    this.uni.uSun.value.copy(sky.sun.color).multiplyScalar(sky.sun.intensity * 0.34);
    this.uni.uAmb.value.copy(sky.hemi.color).multiplyScalar(sky.hemi.intensity * 0.4);
    const S = this.chunk, R = this.radius;
    const ccx = Math.floor(camPos.x / S), ccz = Math.floor(camPos.z / S);
    const rc = Math.ceil(R / S);
    // missing chunks, nearest first, a few milliseconds' worth per frame (a dense chunk takes
    // ~10 ms: three at once stalled frames after a teleport)
    const want = this._want || (this._want = []);
    want.length = 0;
    for (let dz = -rc; dz <= rc; dz++) for (let dx = -rc; dx <= rc; dx++) {
      const cx = ccx + dx, cz = ccz + dz;
      const d = Math.hypot((cx + 0.5) * S - camPos.x, (cz + 0.5) * S - camPos.z);
      if (d > R + S || this.chunks.has(cx + ',' + cz)) continue;
      want.push({ cx, cz, d });
    }
    want.sort((a, b) => a.d - b.d);
    const t0 = performance.now();
    for (const { cx, cz } of want) {
      if (performance.now() - t0 > 4) break;
      const key = cx + ',' + cz;
      const H = this.terrain.half; // chunks lying on the map (edges included: the last one ends exactly at ±half)
      if (cx * S < -H || cz * S < -H || (cx + 1) * S > H || (cz + 1) * S > H) { this.chunks.set(key, { mesh: null, cx, cz }); continue; }
      const r = this.build(cx, cz);
      if (r) { this.group.add(r.mesh); if (r.flowers) this.group.add(r.flowers); }
      this.chunks.set(key, { mesh: r ? r.mesh : null, flowers: r ? r.flowers : null, cx, cz });
    }
    for (const [key, c] of this.chunks) {
      if (c.cx === undefined) continue;
      const d = Math.hypot((c.cx + 0.5) * S - camPos.x, (c.cz + 0.5) * S - camPos.z);
      if (d > R + S * 3) {
        this.disposeChunk(c);
        this.chunks.delete(key);
      } else {
        if (c.mesh) {
          c.mesh.visible = d < R + S;
          // Matches the per-blade fade in the shader, measured to the chunk's nearest corner.
          const near = d - S * 0.71;
          if (near < 16) c.mesh.geometry.setDrawRange(0, BLADES * FINE);
          else if (near < 30) c.mesh.geometry.setDrawRange(0, 7 * FINE);
          else if (near < 44) c.mesh.geometry.setDrawRange(0, 4 * FINE);
          else if (near < 58) c.mesh.geometry.setDrawRange(BLADES * FINE, 4 * COARSE);
          else c.mesh.geometry.setDrawRange(BLADES * FINE, 3 * COARSE);
        }
        if (c.flowers) c.flowers.visible = d < this.flowerRadius + S * 0.5;
      }
    }
  }
}
