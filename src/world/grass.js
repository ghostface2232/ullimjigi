// Instanced grass tufts (and wildflower patches) streamed in chunks around
// the camera. Thin curved blades with a dark-root → light-tip gradient,
// per-blade tint, rolling wind waves (bend + sheen), player push-away,
// sun shadows, cloud shadows, distance thinning and fade in the shaders.
import * as THREE from 'three';
import { U, noiseTexture } from '../render/materials.js';
import { mulberry32, smoothstep } from '../core/util.js';

const VS = /* glsl */ `
attribute vec3 iOffset;
attribute vec3 iColor;
attribute vec4 iParams; // rot, width scale, height, hash
attribute vec2 aBlade;  // x: per-blade random, y: part (flowers: 0 stem, 1 petal, 2 centre)
uniform float uTime;
uniform vec3 uPlayer;
uniform vec3 uCam;
uniform float uFade;
uniform float uWind;
uniform vec4 uBurns[4];
uniform vec4 uCloud;
uniform vec3 uSunW;
uniform sampler2D uNoiseTex;
varying vec3 vColor;
varying float vH;
varying float vWave;
varying float vCloud;
varying vec2 vBlade;
#include <common>
#include <shadowmap_pars_vertex>
#include <fog_pars_vertex>
void main(){
  float h = position.y;
  float dist = length(iOffset.xz - uCam.xz);
  float thin = smoothstep(uFade * 0.28, uFade * 0.95, dist);
  #ifndef FLOWER
    // distance LOD: drop a growing share of tufts, survivors widen to keep coverage
    if (iParams.w > 1.0 - thin * 0.55) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  #endif
  vec3 p = position;
  #ifndef FLOWER
    p.xz *= iParams.y * (1.0 + thin * 0.9);
  #else
    p.xz *= iParams.y;
  #endif
  p.y *= iParams.z;
  float c = cos(iParams.x), s = sin(iParams.x);
  p = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
  vec3 wp = iOffset + p;
  float fade = 1.0 - smoothstep(uFade * 0.8, uFade, dist);
  wp.y = iOffset.y + p.y * fade;
  // wind: rolling waves across the field, broken up by drifting gust noise
  vec2 wdir = vec2(0.88, 0.47);
  float gustN = texture2D(uNoiseTex, iOffset.xz * 0.006 - wdir * uTime * 0.02).g;
  float wave = sin(dot(iOffset.xz, wdir) * 0.17 - uTime * 2.2 + gustN * 6.0) * 0.5 + 0.5;
  wave = smoothstep(0.3, 1.0, wave) * (0.35 + gustN);
  float flutter = sin(uTime * 3.6 + iOffset.x * 0.9 + iOffset.z * 0.7 + aBlade.x * 6.28);
  float hh = h * h;
  vec2 bend = (wdir * (0.1 + 0.55 * wave) + vec2(-wdir.y, wdir.x) * flutter * 0.06) * uWind * hh * iParams.z;
  vec2 d = wp.xz - uPlayer.xz;
  float pd = length(d);
  float push = (1.0 - smoothstep(0.2, 1.3, pd)) * step(abs(wp.y - uPlayer.y), 2.5);
  bend += normalize(d + vec2(0.0001)) * push * hh * 0.8 * iParams.z;
  for (int i = 0; i < 4; i++) {
    vec2 bd = wp.xz - uBurns[i].xy;
    float bl = length(bd);
    bend += normalize(bd + vec2(0.0001)) * (1.0 - smoothstep(0.0, uBurns[i].z, bl)) * uBurns[i].w * h * 1.4;
  }
  wp.xz += bend;
  wp.y -= length(bend) * 0.4 * h;
  vWave = wave * uWind;
  vColor = iColor;
  vH = h;
  vBlade = aBlade;
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
varying vec2 vBlade;
#include <common>
#include <packing>
#include <shadowmap_pars_fragment>
#include <fog_pars_fragment>
void main(){
  float sh = 1.0;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    sh = getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize, directionalLightShadows[ 0 ].shadowIntensity, directionalLightShadows[ 0 ].shadowBias, directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ] );
  #endif
  float lit = sh * vCloud;
  #ifdef FLOWER
    vec3 stem = vec3(0.1, 0.2, 0.05);
    vec3 base = vBlade.y < 0.5 ? mix(stem * 0.6, stem * 1.3, vH) : mix(vColor, vec3(1.0, 0.78, 0.18), step(1.5, vBlade.y) * 0.9);
    float up = 1.0;
  #else
    float bv = 0.84 + 0.3 * vBlade.x;
    vec3 root = vColor * vec3(0.42, 0.48, 0.5);
    vec3 tip = vColor * vec3(1.1, 1.08, 0.86) + vec3(0.02, 0.02, 0.0);
    vec3 base = mix(root, tip, smoothstep(0.0, 1.0, vH)) * bv;
    float up = 0.55 + 0.45 * vH;
  #endif
  vec3 sunL = uSun * mix(uShadeTint, vec3(1.0), lit * up);
  vec3 col = base * (uAmb * (0.75 + 0.25 * vH) + sunL);
  // wind sheen: blades bent by a passing wave catch the light
  col += base * uSun * vWave * vH * vH * 0.45 * (0.3 + 0.7 * lit);
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`;

// One tuft: 4 thin, curved blades scattered around the root (12 triangles).
function tuftGeometry(rnd) {
  const pos = [], bl = [], idx = [];
  const B = 4;
  for (let b = 0; b < B; b++) {
    const a = (b / B) * Math.PI + rnd() * 0.6;
    const ca = Math.cos(a), sa = Math.sin(a);
    const or = 0.03 + rnd() * 0.07, oa = rnd() * Math.PI * 2;
    const ox = Math.cos(oa) * or, oz = Math.sin(oa) * or;
    const lean = 0.08 + rnd() * 0.14;
    const la = oa + (rnd() - 0.5) * 0.8;
    const lx = Math.cos(la) * lean, lz = Math.sin(la) * lean;
    const hMul = 0.75 + rnd() * 0.25;
    const w0 = 0.02 + rnd() * 0.007, w1 = w0 * 0.72;
    const r = rnd();
    const base = pos.length / 3;
    pos.push(ox - w0 * ca, 0, oz - w0 * sa, ox + w0 * ca, 0, oz + w0 * sa);
    pos.push(ox + lx * 0.3 - w1 * ca, 0.5 * hMul, oz + lz * 0.3 - w1 * sa, ox + lx * 0.3 + w1 * ca, 0.5 * hMul, oz + lz * 0.3 + w1 * sa);
    pos.push(ox + lx, hMul, oz + lz);
    for (let k = 0; k < 5; k++) bl.push(r, 0);
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3, base + 2, base + 4, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aBlade', new THREE.Float32BufferAttribute(bl, 2));
  g.setIndex(idx);
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
    this.chunk = 16;
    this.radius = 64;
    this.flowerRadius = 30;
    this.chunks = new Map();
    this.base = tuftGeometry(mulberry32(777));
    this.flowerBase = flowerGeometry();
    this.burns = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
    this.burnI = 0;
    this.uni = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uPlayer: { value: new THREE.Vector3() }, uCam: { value: new THREE.Vector3() },
      uFade: { value: this.radius }, uWind: { value: 1 }, uSun: { value: new THREE.Color(1, 1, 1) }, uAmb: { value: new THREE.Color(0.5, 0.5, 0.5) },
      uBurns: { value: this.burns },
    }]);
    this.uni.uTime = U.time;
    this.uni.uWind = U.wind;
    this.uni.uBurns = { value: this.burns };
    this.uni.uCloud = U.cloud;
    this.uni.uSunW = U.sunDir;
    this.uni.uShadeTint = U.shadeTint;
    this.uni.uNoiseTex = { value: noiseTexture() };
    const opts = { uniforms: this.uni, vertexShader: VS, fragmentShader: FS, fog: true, lights: true, side: THREE.DoubleSide };
    this.mat = new THREE.ShaderMaterial(opts);
    this.flowerMat = new THREE.ShaderMaterial({ ...opts, defines: { FLOWER: 1 } });
    this.density = 2.6;
    this.tmpC = new THREE.Color();
  }

  setQuality(q) {
    this.radius = q === 'high' ? 64 : q === 'medium' ? 50 : 34;
    this.density = q === 'high' ? 2.6 : q === 'medium' ? 2.0 : 1.2;
    this.flowerRadius = q === 'low' ? 20 : 30;
    this.uni.uFade.value = this.radius;
    for (const c of this.chunks.values()) this.disposeChunk(c);
    this.chunks.clear();
  }

  disposeChunk(c) {
    if (c.mesh) { this.scene.remove(c.mesh); c.mesh.geometry.dispose(); }
    if (c.flowers) { this.scene.remove(c.flowers); c.flowers.geometry.dispose(); }
  }

  // Wind burst that flattens grass (used by wind spells / explosions)
  gust(x, z, radius = 5, strength = 1) {
    const b = this.burns[this.burnI++ % 4];
    b.set(x, z, radius, strength);
  }

  instanced(base, off, col, par, k, cx, cz, cy, mat) {
    const S = this.chunk;
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.aBlade = base.attributes.aBlade;
    geo.setAttribute('iOffset', new THREE.InstancedBufferAttribute(off.subarray(0, k * 3), 3));
    geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(col.subarray(0, k * 3), 3));
    geo.setAttribute('iParams', new THREE.InstancedBufferAttribute(par.subarray(0, k * 4), 4));
    geo.instanceCount = k;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx * S + S / 2, cy, cz * S + S / 2), S * 0.75 + 6);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = true;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.userData.noBake = true;
    return mesh;
  }

  build(cx, cz) {
    const T = this.terrain, S = this.chunk;
    const rnd = mulberry32((cx * 73856093) ^ (cz * 19349663));
    const n = Math.floor(S * S * this.density);
    const off = new Float32Array(n * 3), col = new Float32Array(n * 3), par = new Float32Array(n * 4);
    const fOff = [], fCol = [], fPar = [];
    let k = 0;
    const c = this.tmpC;
    for (let i = 0; i < n; i++) {
      const x = cx * S + rnd() * S, z = cz * S + rnd() * S;
      const g = T.grassAt(x, z);
      if (g < 0.35 || rnd() > g * 1.2) continue;
      const y = T.height(x, z);
      T.colorAt(x, z, c);
      // per-tuft hue/brightness jitter + slow patchy drift towards yellow or teal
      const patch = T.noise2(x * 0.05, z * 0.05);
      const v = 0.84 + rnd() * 0.3;
      const warm = Math.max(0, patch) * 0.22, cool = Math.max(0, -patch) * 0.14;
      off[k * 3] = x; off[k * 3 + 1] = y - 0.04; off[k * 3 + 2] = z;
      col[k * 3] = c.r * v * (1.02 + warm);
      col[k * 3 + 1] = c.g * v * (1.04 + warm * 0.4);
      col[k * 3 + 2] = c.b * v * (0.95 + cool * 1.5 - warm * 0.4);
      par[k * 4] = rnd() * Math.PI * 2;
      par[k * 4 + 1] = 0.8 + rnd() * 0.45;
      par[k * 4 + 2] = (0.34 + rnd() * 0.3) * (0.6 + g * 0.5);
      par[k * 4 + 3] = rnd();
      k++;
      // wildflower patches
      const fp = T.noise3(x * 0.04 + 100, z * 0.04 - 30);
      if (g > 0.55 && rnd() < 0.004 + 0.16 * smoothstep(0.3, 0.65, fp)) {
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
    const mesh = this.instanced(this.base, off, col, par, k, cx, cz, cy, this.mat);
    let flowers = null;
    if (fOff.length) {
      const fk = fOff.length / 3;
      flowers = this.instanced(this.flowerBase, new Float32Array(fOff), new Float32Array(fCol), new Float32Array(fPar), fk, cx, cz, cy, this.flowerMat);
    }
    return { mesh, flowers };
  }

  update(dt, camPos, playerPos, sky) {
    this.uni.uCam.value.copy(camPos);
    this.uni.uPlayer.value.copy(playerPos);
    this.uni.uSun.value.copy(sky.sun.color).multiplyScalar(sky.sun.intensity * 0.34);
    this.uni.uAmb.value.copy(sky.hemi.color).multiplyScalar(sky.hemi.intensity * 0.4);
    for (const b of this.burns) b.w = Math.max(0, b.w - dt * 1.5);
    const S = this.chunk, R = this.radius;
    const ccx = Math.floor(camPos.x / S), ccz = Math.floor(camPos.z / S);
    const rc = Math.ceil(R / S);
    let built = 0;
    for (let dz = -rc; dz <= rc; dz++) for (let dx = -rc; dx <= rc; dx++) {
      const cx = ccx + dx, cz = ccz + dz;
      const key = cx + ',' + cz;
      const d = Math.hypot((cx + 0.5) * S - camPos.x, (cz + 0.5) * S - camPos.z);
      if (d > R + S) continue;
      if (!this.chunks.has(key)) {
        if (built >= 3) continue;
        if (Math.abs(cx * S) > 240 || Math.abs(cz * S) > 240) { this.chunks.set(key, { mesh: null }); continue; }
        const r = this.build(cx, cz);
        if (r) { this.scene.add(r.mesh); if (r.flowers) this.scene.add(r.flowers); }
        this.chunks.set(key, { mesh: r ? r.mesh : null, flowers: r ? r.flowers : null, cx, cz });
        built++;
      }
    }
    for (const [key, c] of this.chunks) {
      if (c.cx === undefined) continue;
      const d = Math.hypot((c.cx + 0.5) * S - camPos.x, (c.cz + 0.5) * S - camPos.z);
      if (d > R + S * 3) {
        this.disposeChunk(c);
        this.chunks.delete(key);
      } else {
        if (c.mesh) c.mesh.visible = d < R + S;
        if (c.flowers) c.flowers.visible = d < this.flowerRadius + S * 0.5;
      }
    }
  }
}
