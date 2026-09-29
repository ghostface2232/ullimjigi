// Instanced grass tufts streamed in chunks around the camera.
// Wind sway, player push-away and distance fade in the vertex shader.
import * as THREE from 'three';
import { U } from '../render/materials.js';
import { mulberry32 } from '../core/util.js';

const VS = `
attribute vec3 iOffset;
attribute vec3 iColor;
attribute vec3 iParams; // rot, width, height
uniform float uTime;
uniform vec3 uPlayer;
uniform vec3 uCam;
uniform float uFade;
uniform float uWind;
uniform vec4 uBurns[4];
varying vec3 vColor;
varying float vH;
#include <fog_pars_vertex>
void main(){
  float h = position.y;
  vec3 p = position;
  p.x *= iParams.y; p.z *= iParams.y; p.y *= iParams.z;
  float c = cos(iParams.x), s = sin(iParams.x);
  p = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
  vec3 wp = iOffset + p;
  float dist = length(wp.xz - uCam.xz);
  float fade = 1.0 - smoothstep(uFade * 0.72, uFade, dist);
  wp.y = iOffset.y + p.y * fade;
  float gust = sin(uTime * 0.7 + iOffset.x * 0.05) * 0.5 + 0.5;
  float w = sin(uTime * 1.9 + iOffset.x * 0.35 + iOffset.z * 0.22) * (0.35 + gust * 0.4) + sin(uTime * 3.3 + iOffset.x * 0.9) * 0.12;
  vec2 bend = vec2(0.85, 0.45) * w * uWind * h * h * iParams.z * 0.45;
  vec2 d = wp.xz - uPlayer.xz;
  float pd = length(d);
  float push = (1.0 - smoothstep(0.2, 1.4, pd)) * step(abs(wp.y - uPlayer.y), 2.5);
  bend += normalize(d + vec2(0.0001)) * push * h * 0.7 * iParams.z;
  for (int i = 0; i < 4; i++) {
    vec2 bd = wp.xz - uBurns[i].xy;
    float bl = length(bd);
    bend += normalize(bd + vec2(0.0001)) * (1.0 - smoothstep(0.0, uBurns[i].z, bl)) * uBurns[i].w * h * 1.4;
  }
  wp.xz += bend;
  wp.y -= length(bend) * 0.35 * h;
  vColor = iColor;
  vH = h;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FS = `
uniform vec3 uSun;
uniform vec3 uAmb;
varying vec3 vColor;
varying float vH;
#include <fog_pars_fragment>
void main(){
  vec3 base = vColor * mix(0.62, 1.12, vH);
  vec3 col = base * (uAmb + uSun * (0.55 + 0.45 * vH));
  col += vec3(0.9, 0.95, 0.6) * smoothstep(0.85, 1.0, vH) * 0.06 * uSun;
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`;

function tuftGeometry() {
  // 3 crossed blades, each: 5 verts (tapering)
  const pos = [], idx = [];
  for (let b = 0; b < 3; b++) {
    const a = (b / 3) * Math.PI + 0.3 * b;
    const ca = Math.cos(a), sa = Math.sin(a);
    const lean = (b - 1) * 0.12;
    const base = pos.length / 3;
    const rows = [[0, 0.5], [0.45, 0.38], [0.8, 0.2]];
    for (const [y, w] of rows) {
      const ox = lean * y * 1.5;
      pos.push(-w * ca + ox, y, -w * sa, w * ca + ox, y, w * sa);
    }
    pos.push(lean * 1.5, 1, 0);
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4, base + 3, base + 5, base + 4, base + 4, base + 5, base + 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class Grass {
  constructor(scene, terrain, water) {
    this.scene = scene; this.terrain = terrain;
    this.chunk = 16;
    this.radius = 70;
    this.chunks = new Map();
    this.base = tuftGeometry();
    this.burns = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
    this.burnI = 0;
    this.uni = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uPlayer: { value: new THREE.Vector3() }, uCam: { value: new THREE.Vector3() },
      uFade: { value: this.radius }, uWind: { value: 1 }, uSun: { value: new THREE.Color(1, 1, 1) }, uAmb: { value: new THREE.Color(0.5, 0.5, 0.5) },
      uBurns: { value: this.burns },
    }]);
    this.uni.uTime = U.time;
    this.uni.uWind = U.wind;
    this.uni.uBurns = { value: this.burns };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uni, vertexShader: VS, fragmentShader: FS, fog: true, side: THREE.DoubleSide });
    this.density = 2.2;
    this.tmpC = new THREE.Color();
  }

  setQuality(q) {
    this.radius = q === 'high' ? 70 : q === 'medium' ? 52 : 34;
    this.density = q === 'high' ? 2.2 : q === 'medium' ? 1.6 : 1.0;
    this.uni.uFade.value = this.radius;
    for (const c of this.chunks.values()) { if (c.mesh) { this.scene.remove(c.mesh); c.mesh.geometry.dispose(); } }
    this.chunks.clear();
  }

  // Wind burst that flattens grass (used by wind spells / explosions)
  gust(x, z, radius = 5, strength = 1) {
    const b = this.burns[this.burnI++ % 4];
    b.set(x, z, radius, strength);
  }

  build(cx, cz) {
    const T = this.terrain, S = this.chunk;
    const rnd = mulberry32((cx * 73856093) ^ (cz * 19349663));
    const n = Math.floor(S * S * this.density);
    const off = new Float32Array(n * 3), col = new Float32Array(n * 3), par = new Float32Array(n * 3);
    let k = 0;
    const c = this.tmpC;
    for (let i = 0; i < n; i++) {
      const x = cx * S + rnd() * S, z = cz * S + rnd() * S;
      const g = T.grassAt(x, z);
      if (g < 0.35 || rnd() > g * 1.2) continue;
      const y = T.height(x, z);
      T.colorAt(x, z, c);
      const v = 0.85 + rnd() * 0.3;
      const flower = rnd();
      off[k * 3] = x; off[k * 3 + 1] = y - 0.05; off[k * 3 + 2] = z;
      let fl = false;
      if (flower < 0.008) { c.setRGB(1.0, 0.8, 0.2); fl = true; }
      else if (flower < 0.013) { c.setRGB(0.8, 0.55, 1.0); fl = true; }
      col[k * 3] = c.r * v * 1.05; col[k * 3 + 1] = c.g * v * 1.08; col[k * 3 + 2] = c.b * v;
      par[k * 3] = rnd() * Math.PI * 2;
      par[k * 3 + 1] = 0.1 + rnd() * 0.07;
      par[k * 3 + 2] = (0.3 + rnd() * 0.32) * (0.6 + g * 0.5) * (fl ? 0.7 : 1);
      k++;
    }
    if (k === 0) return null;
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = this.base.index;
    geo.attributes.position = this.base.attributes.position;
    geo.setAttribute('iOffset', new THREE.InstancedBufferAttribute(off.subarray(0, k * 3), 3));
    geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(col.subarray(0, k * 3), 3));
    geo.setAttribute('iParams', new THREE.InstancedBufferAttribute(par.subarray(0, k * 3), 3));
    geo.instanceCount = k;
    const cy = T.height(cx * S + S / 2, cz * S + S / 2);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx * S + S / 2, cy, cz * S + S / 2), S * 0.75 + 6);
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.frustumCulled = true;
    mesh.receiveShadow = false;
    return mesh;
  }

  update(dt, camPos, playerPos, sky) {
    this.uni.uCam.value.copy(camPos);
    this.uni.uPlayer.value.copy(playerPos);
    this.uni.uSun.value.copy(sky.sun.color).multiplyScalar(sky.sun.intensity * 0.36);
    this.uni.uAmb.value.copy(sky.hemi.color).multiplyScalar(sky.hemi.intensity * 0.42);
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
        const mesh = this.build(cx, cz);
        if (mesh) this.scene.add(mesh);
        this.chunks.set(key, { mesh, cx, cz });
        built++;
      }
    }
    for (const [key, c] of this.chunks) {
      if (c.cx === undefined) continue;
      const d = Math.hypot((c.cx + 0.5) * S - camPos.x, (c.cz + 0.5) * S - camPos.z);
      if (d > R + S * 3) {
        if (c.mesh) { this.scene.remove(c.mesh); c.mesh.geometry.dispose(); }
        this.chunks.delete(key);
      } else if (c.mesh) c.mesh.visible = d < R + S;
    }
  }
}
